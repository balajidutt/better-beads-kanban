import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { roles } from './spec.mjs';

const CONFIG = new URL('../opencode.jsonc', import.meta.url);

export function bashRules(role) {
  if (typeof role === 'string') return role;
  const entries = [
    ['*', role.fallback],
    ...role.rules,
    ...role.denyBlocks.flat().map(pattern => [pattern, 'deny']),
    ...role.afterDeny,
    ['*>*', 'deny'],
    ...role.afterRedirect
  ];
  const keys = entries.map(([pattern]) => pattern);
  const duplicate = keys.find((pattern, index) => keys.indexOf(pattern) !== index);
  if (duplicate) throw new Error(`duplicate bash rule ${JSON.stringify(duplicate)}`);
  return entries;
}

function render(rules) {
  if (typeof rules === 'string') return JSON.stringify(rules);
  return `{\n${rules.map(([pattern, action]) => `          ${JSON.stringify(pattern)}: ${JSON.stringify(action)}`).join(',\n')}\n        }`;
}

function valueEnd(text, start) {
  if (text[start] !== '"' && text[start] !== '{') throw new Error(`expected a string or object at offset ${start}`);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') {
        inString = false;
        if (depth === 0) return i + 1;
      }
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  throw new Error('unterminated value in configuration');
}

function within(text, needle, from, to, what) {
  const at = text.indexOf(needle, from);
  if (at < 0 || at > to) throw new Error(`${what} not found`);
  return at;
}

export function applyBashPermissions(text) {
  const settings = JSON.parse(text);
  for (const [name, agent] of Object.entries(settings.agent)) {
    if (agent.permission?.bash !== undefined && !Object.hasOwn(roles, name)) throw new Error(`${name} has bash rules but no spec entry`);
  }
  const expected = structuredClone(settings);
  let out = text;
  for (const [name, role] of Object.entries(roles)) {
    if (!Object.hasOwn(settings.agent, name)) throw new Error(`spec names unknown agent ${name}`);
    const rules = bashRules(role);
    expected.agent[name].permission.bash = typeof rules === 'string' ? rules : Object.fromEntries(rules);
    const agentStart = within(out, `\n    ${JSON.stringify(name)}: {`, 0, out.length, `agent ${name}`);
    const agentEnd = valueEnd(out, out.indexOf('{', agentStart));
    const permissionStart = within(out, '"permission": {', agentStart, agentEnd, `${name} permission`);
    const permissionEnd = valueEnd(out, permissionStart + '"permission": '.length);
    const start = within(out, '"bash": ', permissionStart, permissionEnd, `${name} bash permission`) + '"bash": '.length;
    out = out.slice(0, start) + render(rules) + out.slice(valueEnd(out, start));
  }
  const generated = JSON.parse(out);
  const sameOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!isDeepStrictEqual(generated, expected) || !sameOrder(generated, expected)) throw new Error('generated configuration does not match the spec');
  return out;
}

function invokedPath() {
  try {
    return realpathSync(process.argv[1] ?? '');
  } catch {
    return '';
  }
}

if (invokedPath() === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => arg !== '--check');
  if (unknown.length) {
    console.error(`unknown argument ${unknown[0]}; usage: node .opencode/permissions/generate.mjs [--check]`);
    process.exit(2);
  }
  const current = await readFile(CONFIG, 'utf8');
  const generated = applyBashPermissions(current);
  if (generated === current) {
    console.log('opencode.jsonc bash permissions match the spec');
  } else if (args.includes('--check')) {
    console.error('opencode.jsonc bash permissions differ from .opencode/permissions/spec.mjs; run node .opencode/permissions/generate.mjs');
    process.exitCode = 1;
  } else {
    await writeFile(CONFIG, generated);
    console.log('opencode.jsonc bash permissions regenerated from the spec');
  }
}
