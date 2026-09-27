import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { BEADS_MARKER_ENTRIES, resolveBeadsRoot } from '../../src/beadsWorkspace';
import { BeadsReader, executeBd, validateIssueId } from '../../src/shared/node';
import type { ReadService } from './contracts';
import type { LaunchOptions } from './options';

const safety = ['--readonly', '--sandbox', '--dolt-auto-commit', 'off'];
const strings = ['title', 'description', 'status', 'issue_type', 'created_at', 'created_by', 'updated_at',
  'closed_at', 'close_reason', 'assignee', 'external_ref', 'acceptance_criteria', 'design', 'notes',
  'due_at', 'defer_until', 'event_kind', 'actor', 'target', 'payload', 'sender', 'mol_type', 'role_type',
  'rig', 'agent_state', 'last_activity', 'hook_bead', 'role_bead', 'await_type', 'await_id', 'waiters'];
const numbers = ['priority', 'dependency_count', 'dependent_count', 'blocked_by_count', 'estimated_minutes', 'timeout_ns'];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateIssues(value: unknown, selectedId?: string): void {
  const bad = () => { throw new Error('Invalid bd issue response'); };
  const textFields = (item: Record<string, unknown>, fields: string[]) => {
    for (const key of fields) {
      if (item[key] != null && typeof item[key] !== 'string') { bad(); }
    }
  };
  if (!Array.isArray(value)) { bad(); return; }
  if (selectedId && (value.length !== 1 || !object(value[0]) || value[0].id !== selectedId)) {
    throw new Error('bd show did not return the selected issue');
  }
  const ids = new Set<string>();
  for (const item of value) {
    if (!object(item)) { bad(); return; }
    validateIssueId(item.id as string);
    if (ids.has(item.id as string)) { bad(); }
    ids.add(item.id as string);
    textFields(item, strings);
    for (const key of numbers) {
      if (item[key] != null && (typeof item[key] !== 'number' || !Number.isFinite(item[key]))) { bad(); }
    }
    if (item.parent != null) { validateIssueId(item.parent as string); }
    if (item.metadata != null && !object(item.metadata)) { bad(); }
    for (const key of ['labels', 'dependencies', 'dependents', 'comments']) {
      const entries = item[key];
      if (entries == null) { continue; }
      if (!Array.isArray(entries)) { bad(); return; }
      for (const entry of entries) {
        if (key === 'labels') {
          if (typeof entry !== 'string' && !(selectedId && object(entry) && typeof entry.label === 'string')) { bad(); }
          continue;
        }
        if (!object(entry)) { bad(); return; }
        if (key === 'comments') {
          textFields(entry, ['author', 'text', 'created_at']);
          if (!(typeof entry.id === 'number' && Number.isFinite(entry.id)) &&
              !(typeof entry.id === 'string' && /^\d+$/u.test(entry.id))) { bad(); }
        } else {
          textFields(entry, ['title', 'created_at', 'created_by', 'metadata', 'thread_id', 'type', 'dependency_type']);
          for (const field of ['id', 'issue_id', 'depends_on_id']) {
            if (entry[field] != null) { validateIssueId(entry[field] as string); }
          }
          if (selectedId) {
            validateIssueId(entry.id as string);
            if (typeof entry.title !== 'string') { bad(); }
          }
        }
      }
    }
  }
}

function canonical(path: string): string {
  const result = realpathSync(path);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

export async function createReadService(options: LaunchOptions, startupSignal?: AbortSignal): Promise<{
  service: ReadService; repo: string; version: string;
}> {
  if (!options.repo || !options.bdPath || /[\x00-\x1f\x7f-\x9f]/u.test(options.repo + options.bdPath)) {
    throw new Error('Repository and bd executable must be paths without control characters');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5000) {
    throw new Error('Snapshot limit must be from 1 to 5000');
  }
  if (!statSync(options.repo).isDirectory()) { throw new Error('--repo must be a directory'); }
  const resolution = resolveBeadsRoot({
    roots: [realpathSync(options.repo)], homeDir: homedir(),
    hasBeadsDir: root => {
      try {
        return statSync(join(root, '.beads')).isDirectory() && BEADS_MARKER_ENTRIES.some(marker => {
          try { statSync(join(root, '.beads', marker)); return true; } catch { return false; }
        });
      } catch { return false; }
    }
  });
  if (resolution.kind === 'none' || !resolution.root) {
    throw new Error('No Beads repository found. For an external worktree use --repo <main-checkout>.');
  }
  const repo = realpathSync(resolution.root);
  const lifecycle = new AbortController();
  const dispose = () => lifecycle.abort();
  const active = () => {
    if (lifecycle.signal.aborted) { throw Object.assign(new Error('Read service disposed'), { name: 'AbortError' }); }
  };
  startupSignal?.addEventListener('abort', dispose, { once: true });
  if (startupSignal?.aborted) { dispose(); }
  const run = async (args: string[]) => {
    active();
    const result = await executeBd(args, {
      executable: options.bdPath, cwd: repo, jsonPolicy: 'strict', signal: lifecycle.signal, killGraceMs: 250
    });
    active();
    return result;
  };
  try {
    const versionResult = await run(['version', '--json']);
    if (!object(versionResult) || typeof versionResult.version !== 'string' || !versionResult.version) {
      throw new Error('Unsupported bd version JSON response');
    }
    const context = await run(['context', '--json', ...safety]);
    if (!object(context)) { throw new Error('Invalid bd context response'); }
    for (const [field, expected] of [['beads_dir', join(repo, '.beads')], ['repo_root', repo], ['cwd_repo_root', repo]]) {
      const actual = context[field];
      if (typeof actual !== 'string' || canonical(resolve(repo, actual)) !== canonical(expected)) {
        throw new Error(`bd context ${field} does not match --repo; check BEADS_DIR and repository overrides`);
      }
    }
    const reader = new BeadsReader(async args => {
      const list = args.length === 5 && args[0] === 'list' && args[1] === '--json' && args[2] === '--all' &&
        args[3] === '--limit' && /^\d+$/u.test(args[4]) && Number(args[4]) >= 1 && Number(args[4]) <= options.limit + 1;
      const show = args.length === 3 && args[0] === 'show' && args[1] === '--json';
      if (!list && !show) { throw new Error('Unsupported terminal read command'); }
      if (show) { validateIssueId(args[2]); }
      const result = await run([...args, ...safety]);
      validateIssues(result, show ? args[2] : undefined);
      return result;
    }, { strict: true });
    const service: ReadService = {
      async list(limit) {
        active();
        if (!Number.isInteger(limit) || limit < 1 || limit > options.limit + 1) { throw new Error('Invalid read limit'); }
        const result = await reader.getBoardMinimal(limit);
        active();
        return result;
      },
      async detail(id) {
        active();
        const result = await reader.getIssueFull(id);
        active();
        return result;
      },
      dispose
    };
    return { service, repo, version: versionResult.version };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    startupSignal?.removeEventListener('abort', dispose);
  }
}
