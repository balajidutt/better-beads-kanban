import { lstat, readFile, realpath, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'jsonc-parser';
import picomatch from 'picomatch';

const queues = new Map();
const MAX_BYTES = 256 * 1024;
export const sessionID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) ? value : null;
const basename = value => typeof value === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);

export function inside(base, target) {
  const relative = path.relative(base, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function readJson(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error('REVIEW_STATE_INVALID');
  return JSON.parse(await readFile(file, 'utf8'));
}

export function reviewDecision(text, prefix) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) return null;
  let body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (body.startsWith('<task ')) {
    const wrapped = /^<task id="[A-Za-z0-9._-]+" state="completed">\n<task_result>\n([\s\S]*)\n<\/task_result>\n<\/task>$/.exec(body);
    if (!wrapped) return null;
    body = wrapped[1];
  }
  const lines = body.split('\n').filter(line => line.trim());
  let fence = null;
  for (const line of lines) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length && /^[ \t]*$/.test(match[2])) fence = null;
  }
  if (fence) return null;
  const markers = lines.filter(line => line === `${prefix}=PASS` || line === `${prefix}=FAIL`);
  if (markers.length !== 1 || lines.at(-1) !== markers[0]) return null;
  return markers[0] === `${prefix}=PASS` ? 'PASS' : 'FAIL';
}

export function reviewRequest(config, sid, revision) {
  return [
    `Independent ${config.reviewLabel} review is pending for session ${sid}, revision ${revision}.`,
    'This reminder grants no implementation, review-acceptance, commit or publication authority.',
    'If this session is stopped, paused or lacks the required handoff, retain the pending review and await human reconciliation.',
    `Otherwise request ${config.reviewerAgent} through the normal authorized parent delegation route. Leaves return the request to their parent; they do not delegate.`,
    'Review the whole intended change: staged, unstaged, untracked, documentation, locks and generated files. The marker file list is only a hint.',
    'The reviewer must not edit. Return findings to the parent for remediation by the authorized owner.',
    'A passing marker does not replace the independent review or grant lifecycle approval.',
    'End the review with exactly one of these as the single final line:',
    `${config.resultMarkerPrefix}=PASS`,
    `${config.resultMarkerPrefix}=FAIL`
  ].join('\n');
}

export async function createRuntime(context) {
  const controllers = new Set();
  let disposed = false;
  const call = async (method, options, timeout = 10000) => {
    if (disposed || typeof method !== 'function') return { kind: 'unavailable' };
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => method({ ...options, signal: controller.signal })).then(response => {
          if (response?.error) return { kind: 'rejected', response };
          return { kind: 'returned', response };
        }),
        new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ kind: 'unknown' }); }, timeout); timer.unref?.(); })
      ]);
    } catch {
      return { kind: 'unknown' };
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };
  const warn = async code => {
    const method = context.client?.app?.log;
    if (typeof method === 'function') await call(method.bind(context.client.app), { body: { service: 'bbk-review-loop', level: 'warn', message: code } }, 2000);
  };
  let base;
  let config;
  const declaredBase = path.resolve(context.directory || context.worktree || process.cwd());
  try {
    base = await realpath(declaredBase);
    const directory = await lstat(path.join(base, '.opencode'));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('REVIEW_DIRECTORY_INVALID');
    const file = path.join(base, '.opencode/opencode-tooling.config.jsonc');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error('REVIEW_CONFIG_INVALID');
    const errors = [];
    config = parse(await readFile(file, 'utf8'), errors, { allowTrailingComma: true });
    if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)
      || !/^[a-z][a-z0-9-]{0,63}$/.test(config.reviewerAgent ?? '')
      || !/^[A-Z][A-Z0-9_]{0,79}$/.test(config.resultMarkerPrefix ?? '')
      || !basename(config.sentinelBase) || !basename(config.enforcerStateBase) || config.sentinelBase === config.enforcerStateBase
      || typeof config.reviewLabel !== 'string' || !config.reviewLabel || config.reviewLabel.length > 80 || /[\r\n]/.test(config.reviewLabel)
      || !Array.isArray(config.exemptPaths) || config.exemptPaths.length > 64 || config.exemptPaths.some(value => typeof value !== 'string' || value.length > 1024)
      || !Array.isArray(config.watchEvents) || config.watchEvents.some(value => !['file.edited', 'file.watcher.updated'].includes(value))
      || !Number.isInteger(config.debounceMs) || config.debounceMs < 1 || config.debounceMs > 5000) throw new Error('REVIEW_CONFIG_INVALID');
  } catch {
    await warn('review-configuration-unavailable; independent review remains required');
    return null;
  }
  const match = picomatch(config.exemptPaths.filter(value => !value.startsWith('!')), { dot: true });
  const negations = config.exemptPaths.filter(value => value.startsWith('!')).map(value => value.slice(1));
  const unmatch = negations.length ? picomatch(negations, { dot: true }) : () => false;
  const relativeFile = value => {
    if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value) || Buffer.byteLength(value) > 1024) return null;
    const declared = path.resolve(declaredBase, value);
    const full = inside(declaredBase, declared) ? path.resolve(base, path.relative(declaredBase, declared)) : path.resolve(base, value);
    if (!inside(base, full) || full === base) return null;
    const relative = path.relative(base, full).split(path.sep).join('/');
    if (relative.startsWith(`.opencode/${config.sentinelBase}`) || relative.startsWith(`.opencode/${config.enforcerStateBase}`)) return null;
    return match(relative) && !unmatch(relative) ? null : relative;
  };
  const statePath = (sid, kind) => {
    if (!sessionID(sid) || !['gate', 'delivery'].includes(kind)) throw new Error('REVIEW_SESSION_INVALID');
    return path.join(base, '.opencode', `${kind === 'gate' ? config.sentinelBase : config.enforcerStateBase}.${sid}.json`);
  };
  const load = async (sid, kind) => {
    try { return await readJson(statePath(sid, kind)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const gate = async sid => {
    const value = await load(sid, 'gate');
    if (value && (value.schemaVersion !== 1 || value.sessionID !== sid || typeof value.revision !== 'string' || !/^[0-9a-f-]{36}$/.test(value.revision) || !Array.isArray(value.files))) throw new Error('REVIEW_STATE_INVALID');
    return value;
  };
  const serial = (sid, work) => {
    const key = statePath(sid, 'gate');
    if (!queues.has(key) && queues.size >= 256) return Promise.reject(new Error('REVIEW_QUEUE_LIMIT'));
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(key, next);
    return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  };
  const save = async (sid, kind, value) => {
    if (disposed) throw new Error('REVIEW_DISPOSED');
    const dir = path.join(base, '.opencode');
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('REVIEW_DIRECTORY_INVALID');
    const file = statePath(sid, kind);
    const text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('REVIEW_STATE_LIMIT');
    const temp = `${file}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(text); }
    finally { await handle.close(); }
    try { await rename(temp, file); }
    catch (error) { await unlink(temp).catch(() => {}); throw error; }
  };
  return {
    base, config, call, warn, relativeFile, load, gate, save, serial,
    mark: (sid, files) => serial(sid, async () => {
      const previous = await gate(sid);
      const unique = [...new Set([...(previous?.files ?? []), ...files].map(relativeFile).filter(Boolean))];
      if (!unique.length) return;
      await save(sid, 'gate', { schemaVersion: 1, sessionID: sid, revision: randomUUID(), files: unique.slice(0, 128), overflow: unique.length > 128 || previous?.overflow === true });
    }),
    clear: (sid, revision) => serial(sid, async () => {
      const current = await gate(sid);
      if (!current || current.revision !== revision) return false;
      await unlink(statePath(sid, 'gate'));
      return true;
    }),
    dispose: async () => { disposed = true; for (const controller of controllers) controller.abort(); controllers.clear(); }
  };
}
