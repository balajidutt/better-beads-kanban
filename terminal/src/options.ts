import { resolve, isAbsolute } from 'node:path';

export interface LaunchOptions {
  repo: string;
  bdPath: string;
  limit: number;
  clipboard: 'auto' | 'osc52' | 'manual';
  help: boolean;
}

export function parseOptions(args: string[], cwd = process.cwd()): LaunchOptions {
  const result: LaunchOptions = { repo: resolve(cwd), bdPath: 'bd', limit: 1000, clipboard: 'auto', help: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--repo', '--bd-path', '--limit', '--clipboard', '--help'].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (seen.has(flag)) { throw new Error(`Duplicate option: ${flag}`); }
    seen.add(flag);
    if (flag === '--help') { result.help = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) { throw new Error(`Missing value for ${flag}`); }
    if (/[\x00-\x1f\x7f-\x9f]/u.test(value)) { throw new Error(`Control characters are not allowed in ${flag}`); }
    switch (flag) {
      case '--repo': result.repo = resolve(cwd, value); break;
      case '--bd-path':
        result.bdPath = isAbsolute(value) || /[/\\]/u.test(value) ? resolve(cwd, value) : value;
        break;
      case '--limit':
        if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 5000) {
          throw new Error('--limit must be an integer from 1 to 5000');
        }
        result.limit = Number(value);
        break;
      case '--clipboard':
        if (value !== 'auto' && value !== 'osc52' && value !== 'manual') {
          throw new Error('--clipboard must be auto, osc52, or manual');
        }
        result.clipboard = value;
    }
  }
  if (/[\x00-\x1f\x7f-\x9f]/u.test(result.repo)) { throw new Error('Control characters are not allowed in --repo'); }
  return result;
}
