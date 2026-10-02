import * as fs from 'fs';
import * as path from 'path';

export const RECORDED_BD_VERSIONS = ['1.2.2', '1.3.1'] as const;
export type RecordedBdVersion = typeof RECORDED_BD_VERSIONS[number];

export interface SeededIds {
  parent: string;
  child: string;
  blocker: string;
  blocked: string;
  claimed: string;
  deferred: string;
}

export interface RecordedFailure {
  args: string[];
  exitCode: number;
  stdout: unknown;
  stderr: string;
}

/** Compiled tests run from a cache directory, so the fixtures are found by walking up to the repo. */
function fixturesRoot(): string {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, 'src', 'test', 'fixtures');
    if (fs.existsSync(path.join(candidate, 'bd-1.3.1'))) { return candidate; }
    const parent = path.dirname(dir);
    if (parent === dir) { throw new Error(`src/test/fixtures not found above ${__dirname}`); }
    dir = parent;
  }
}

export function loadFixture<T = unknown>(version: RecordedBdVersion, name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesRoot(), `bd-${version}`, name), 'utf8')) as T;
}

export function loadFixtureLines(version: RecordedBdVersion, name: string): Record<string, unknown>[] {
  return fs.readFileSync(path.join(fixturesRoot(), `bd-${version}`, name), 'utf8')
    .split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Record<string, unknown>);
}
