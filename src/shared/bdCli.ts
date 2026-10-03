import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { BdCommandError } from './bdCommandError';
import { sanitizeError } from './sanitizeError';

export interface BdCliOptions {
  executable: string;
  cwd: string;
  log?: (message: string) => void;
  timeoutMs?: number;
  jsonPolicy?: 'compatibility' | 'strict';
  signal?: AbortSignal;
  killGraceMs?: number;
}

export function sanitizeCliArg(arg: string): string {
  return typeof arg === 'string' ? arg.replace(/\0/g, '') : String(arg);
}

/** BD_JSON_ENVELOPE=1 wraps every --json result in {schema_version, data}, which no parser here expects. */
export function bdChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (key.toUpperCase() === 'BD_JSON_ENVELOPE') { delete childEnv[key]; }
  }
  return childEnv;
}

export function executeBd(args: string[], options: BdCliOptions): Promise<unknown> {
  const { executable, cwd, timeoutMs = 30000, jsonPolicy = 'compatibility' } = options;
  const log = options.log ?? (() => {});
  const sanitizedArgs = args.map(sanitizeCliArg);
  const command = `${executable} ${sanitizedArgs.join(' ')}`;
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('bd command aborted'), { name: 'AbortError' });
    if (options.signal?.aborted) { reject(abortError()); return; }
    const child = spawn(executable, sanitizedArgs, { cwd, shell: false, env: bdChildEnv() });
    let stdout = '';
    let stderr = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let settled = false;
    let killHandle: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      child.kill('SIGTERM');
      if (options.killGraceMs !== undefined) {
        killHandle = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
        }, Math.min(5000, Math.max(0, options.killGraceMs || 0)));
        killHandle.unref();
      }
    };
    const detach = () => options.signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timeoutHandle);
      detach();
      terminate();
      reject(abortError());
    };
    // Compatibility limits count decoded UTF-16 code units per stream.
    const maxBufferSize = 50 * 1024 * 1024;
    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        settled = true;
        detach();
        terminate();
        log(`Command timed out after ${timeoutMs}ms: ${command}`);
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      }
    }, timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); }

    child.stdout.on('data', data => {
      if (settled) { return; }
      const text = typeof data === 'string' ? data : stdoutDecoder.write(data);
      if (stdout.length + text.length > maxBufferSize) {
        settled = true;
        clearTimeout(timeoutHandle);
        detach();
        terminate();
        log(`Command exceeded buffer limit (${maxBufferSize} bytes): ${command}`);
        reject(new Error(`Command output exceeded ${maxBufferSize} bytes limit`));
        return;
      }
      stdout += text;
    });

    child.stderr.on('data', data => {
      if (settled) { return; }
      const text = typeof data === 'string' ? data : stderrDecoder.write(data);
      if (stderr.length + text.length > maxBufferSize) {
        settled = true;
        clearTimeout(timeoutHandle);
        detach();
        terminate();
        log(`Command error output exceeded buffer limit: ${command}`);
        reject(new Error(`Command error output exceeded ${maxBufferSize} bytes limit`));
        return;
      }
      stderr += text;
    });

    child.on('error', error => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timeoutHandle);
      detach();
      log(`Command error: ${error.message}`);
      log(`Command context: ${command} (cwd: ${cwd})`);
      log(`PATH: ${process.env.PATH ?? ''}`);
      log(`PATHEXT: ${process.env.PATHEXT ?? ''}`);
      reject(error);
    });

    child.on('close', code => {
      clearTimeout(killHandle);
      detach();
      if (settled) { return; }
      settled = true;
      clearTimeout(timeoutHandle);
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (code !== 0) {
        log(`Command context: ${command} (cwd: ${cwd})`);
        log(`Command failed (exit ${code}): ${stderr || stdout}`);
        reject(new BdCommandError(`bd command failed with exit code ${code}: ${sanitizeError(stderr || stdout)}`, {
          exitCode: code, stderr, stdout, args: sanitizedArgs
        }));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed && jsonPolicy === 'compatibility') {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        if (jsonPolicy === 'strict') {
          reject(new Error('bd returned invalid JSON output'));
        } else {
          log(`Non-JSON output: ${trimmed}`);
          resolve(null);
        }
      }
    });
  });
}
