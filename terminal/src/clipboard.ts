import { spawn, type ChildProcess } from 'node:child_process';
import { validateIssueId } from '../../src/shared/model';
import { safeText } from './text';

export interface ClipboardOptions {
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  write?: (text: string) => unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function copyId(
  id: string, mode: 'auto' | 'osc52' | 'manual', options: ClipboardOptions = {},
): Promise<string> {
  try { validateIssueId(id); } catch { return 'Cannot copy: invalid issue ID'; }
  if (options.signal?.aborted) { return `Clipboard cancelled; copy manually: ${id}`; }
  if (mode === 'osc52') {
    try {
      (options.write ?? (text => process.stdout.write(text)))(`\x1b]52;c;${Buffer.from(id).toString('base64')}\x07`);
      return 'OSC 52 clipboard request sent';
    } catch (error) { return `Clipboard request failed: ${safeText(error instanceof Error ? error.message : error)}`; }
  }
  if (mode !== 'auto' || (options.platform ?? process.platform) !== 'darwin') {
    return `Copy manually: ${id}`;
  }
  return new Promise(resolve => {
    let settled = false;
    let child: ChildProcess | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const finish = (message: string): void => {
      if (settled) { return; }
      settled = true;
      if (timer) { clearTimeout(timer); }
      if (abort) { options.signal?.removeEventListener('abort', abort); }
      resolve(message);
    };
    try {
      child = (options.spawn ?? spawn)('/usr/bin/pbcopy', [], { shell: false, stdio: ['pipe', 'ignore', 'ignore'] });
      const fail = (reason: string): void => {
        if (settled) { return; }
        child?.stdin?.destroy();
        child?.kill('SIGKILL');
        finish(`Clipboard ${reason}; copy manually: ${id}`);
      };
      abort = () => fail('cancelled');
      options.signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => fail('unavailable'));
      child.stdin?.once('error', () => fail('input failed'));
      child.once('close', code => finish(code === 0 ? `Copied ${id}` : `Clipboard failed; copy manually: ${id}`));
      const timeout = options.timeoutMs ?? 2000;
      timer = setTimeout(() => fail('timed out'), Number.isFinite(timeout) ? Math.max(1, Math.min(5000, timeout)) : 2000);
      if (!child.stdin) { fail('input unavailable'); return; }
      child.stdin.end(id, 'utf8');
    } catch {
      child?.stdin?.destroy();
      child?.kill('SIGKILL');
      finish(`Clipboard unavailable; copy manually: ${id}`);
    }
  });
}
