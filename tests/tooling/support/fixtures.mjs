import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function scratch(t) {
  const parent = path.join(os.tmpdir(), 'opencode');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'bbk-workflow-'));
  t.after(() => rm(directory, { recursive: true }));
  return directory;
}

export async function eventually(check, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('fixture condition did not become true');
}
