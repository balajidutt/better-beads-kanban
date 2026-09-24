import React from 'react';
import { render } from 'ink';
import { App } from './app';
import { BrowserController } from './controller';
import { parseOptions } from './options';
import { createReadService } from './runtime';
import { safeText } from './text';

const help = `Read-only Beads terminal proof of concept (Node 22+, bd 1.2.2 tested)
Usage: node terminal/dist/cli.mjs [--repo PATH] [--bd-path EXECUTABLE]
       [--limit 1..5000] [--clipboard auto|osc52|manual]

Tree, Table and stored-status Kanban; minimum terminal size 100x24.
Default cap 1000. For external worktrees, use --repo <main-checkout>.
Clipboard auto uses macOS pbcopy; OSC 52 requires explicit opt-in.
No editing, sync, lifecycle operations or repository switching.
Keys: v views, j/k move, arrows tree/columns, Tab details, / search,
f filters, r refresh, y copy ID, ? help, q or Ctrl-C exit.`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${help}\n`); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive launch requires a TTY on stdin and stdout. Use --help for launch options.');
  }
  const startup = new AbortController();
  let controller: BrowserController | undefined;
  let instance: ReturnType<typeof render> | undefined;
  let exiting = false;
  const stop = (): void => {
    if (exiting) { return; }
    exiting = true;
    startup.abort();
    controller?.dispose();
    instance?.unmount();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) { process.on(signal, stop); }
  try {
    const backend = await createReadService(options, startup.signal);
    controller = new BrowserController(backend.service, options.limit);
    if (exiting) { controller.dispose(); return; }
    instance = render(<App controller={controller} repo={backend.repo} version={backend.version}
      clipboard={options.clipboard} onExit={stop} />, { exitOnCtrlC: false });
    void controller.refresh();
    await instance.waitUntilExit();
  } catch (error) {
    if (!exiting) { throw error; }
  } finally {
    stop();
    for (const signal of signals) { process.off(signal, stop); }
  }
}

main().catch(error => {
  process.stderr.write(`Beads terminal: ${safeText(error instanceof Error ? error.message : error)}\n`);
  process.exitCode = 1;
});
