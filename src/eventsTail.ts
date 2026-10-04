import { ChildProcess, spawn as nodeSpawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { BeadsEvent, EventsTruncation, bdChildEnv, parseEventsLine } from './shared/node';

export interface EventsTailOptions {
  executable: string;
  cwd: string;
  since: number;
  /** One call per stdout chunk, so a replayed journal costs one refresh rather than one per record. */
  onEvents: (events: BeadsEvent[]) => void;
  onTruncated: (truncation: EventsTruncation) => void;
  log: (message: string) => void;
  spawn?: typeof nodeSpawn;
}

/** A single record is one issue snapshot; anything longer is not a record bd would print. */
export const MAX_EVENT_LINE_CHARS = 1024 * 1024;
const MAX_STDERR_CHARS = 4096;
/** bd prints a refusal such as a truncated checkpoint as one pretty-printed JSON object before exiting. */
const MAX_REFUSAL_CHARS = 64 * 1024;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;
/** A child that ran this long counts as healthy, so the next failure starts the backoff over. */
export const HEALTHY_RUN_MS = 60000;
/** The follower is recycled on this period; it resumes from the last seq, so nothing is lost. */
export const MAX_CHILD_LIFETIME_MS = 30 * 60 * 1000;
export const KILL_GRACE_MS = 2000;

const EVENTS_FEED_SETTINGS = ['beadsKanban.useEventsJournal', 'beadsKanban.bdPath'];

export function affectsEventsFeed(event: { affectsConfiguration(section: string): boolean }): boolean {
  return EVENTS_FEED_SETTINGS.some(section => event.affectsConfiguration(section));
}

/**
 * Owns a long-running `bd events tail --follow` child: restarts it with backoff
 * when it exits, recycles it periodically, resumes from the last seq seen, and
 * stops for good on dispose.
 */
export class EventsTail {
  private child: ChildProcess | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs = INITIAL_BACKOFF_MS;
  private disposed = false;
  private since: number;
  private pendingChars = 0;

  constructor(private readonly options: EventsTailOptions) {
    this.since = options.since;
  }

  get lastSeq(): number {
    return this.since;
  }

  /** Characters of an incomplete line currently held; never above MAX_EVENT_LINE_CHARS. */
  get bufferedChars(): number {
    return this.pendingChars;
  }

  start(): void {
    if (this.disposed || this.child) { return; }
    const spawn = this.options.spawn ?? nodeSpawn;
    const args = ['events', 'tail', '--since', String(this.since), '--follow', '--json'];
    const startedAt = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(this.options.executable, args, {
        cwd: this.options.cwd, shell: false, env: bdChildEnv(), stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      this.options.log(`events tail failed to start: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleRestart(startedAt);
      return;
    }
    this.child = child;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let pending = '';
    let discarding = false;
    let stderr = '';
    let refusal = '';
    let sawEvent = false;
    let sawTruncation = false;

    const consume = (text: string) => {
      const batch: BeadsEvent[] = [];
      if (!sawEvent && refusal.length < MAX_REFUSAL_CHARS) { refusal += text.slice(0, MAX_REFUSAL_CHARS - refusal.length); }
      pending += text;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (discarding) {
          discarding = false;
        } else {
          const kind = this.handleLine(line, batch);
          if (kind === 'event') { sawEvent = true; }
          if (kind === 'truncated') { sawTruncation = true; }
        }
        newline = pending.indexOf('\n');
      }
      if (pending.length > MAX_EVENT_LINE_CHARS) {
        this.options.log(`events tail line exceeded ${MAX_EVENT_LINE_CHARS} characters; dropped`);
        pending = '';
        discarding = true;
      }
      this.pendingChars = pending.length;
      if (batch.length > 0 && !this.disposed) { this.options.onEvents(batch); }
    };

    child.stdout?.on('data', (data: Buffer | string) => {
      if (this.disposed || this.child !== child) { return; }
      consume(typeof data === 'string' ? data : stdoutDecoder.write(data));
    });
    child.stderr?.on('data', (data: Buffer | string) => {
      stderr = (stderr + (typeof data === 'string' ? data : stderrDecoder.write(data))).slice(-MAX_STDERR_CHARS);
    });
    child.on('error', error => {
      this.options.log(`events tail error: ${error.message}`);
    });
    child.on('close', code => {
      if (this.child !== child) { return; }
      this.child = undefined;
      this.clearLifetimeTimer();
      if (this.disposed) { return; }
      consume(`${stdoutDecoder.end()}\n`);
      if (!sawEvent && !sawTruncation && refusal.trim()) {
        this.handleLine(refusal.replace(/\s*\n\s*/g, ' '), []);
      }
      this.pendingChars = 0;
      this.options.log(`events tail exited (code ${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
      this.scheduleRestart(startedAt);
    });

    this.lifetimeTimer = setTimeout(() => {
      this.lifetimeTimer = undefined;
      if (this.child !== child || this.disposed) { return; }
      this.options.log('events tail recycled after its maximum lifetime');
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.child = undefined;
      this.terminate(child);
      this.start();
    }, MAX_CHILD_LIFETIME_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); }
    this.restartTimer = undefined;
    this.clearLifetimeTimer();
    if (this.child) { this.terminate(this.child); }
    this.child = undefined;
  }

  private terminate(child: ChildProcess): void {
    child.kill('SIGTERM');
    const escalate = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
    }, KILL_GRACE_MS);
    escalate.unref?.();
  }

  private clearLifetimeTimer(): void {
    if (this.lifetimeTimer) { clearTimeout(this.lifetimeTimer); }
    this.lifetimeTimer = undefined;
  }

  private handleLine(line: string, batch: BeadsEvent[]): 'event' | 'truncated' | 'other' {
    if (this.disposed || !line.trim() || line.length > MAX_EVENT_LINE_CHARS) { return 'other'; }
    const parsed = parseEventsLine(line);
    if (parsed.kind === 'event') {
      if (parsed.event.seq > this.since) {
        this.since = parsed.event.seq;
        batch.push(parsed.event);
      }
      return 'event';
    }
    if (parsed.kind === 'truncated') {
      this.since = parsed.truncation.head;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.options.onTruncated(parsed.truncation);
      return 'truncated';
    }
    return 'other';
  }

  private scheduleRestart(startedAt: number): void {
    if (this.disposed) { return; }
    if (Date.now() - startedAt >= HEALTHY_RUN_MS) { this.backoffMs = INITIAL_BACKOFF_MS; }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, delay);
  }
}
