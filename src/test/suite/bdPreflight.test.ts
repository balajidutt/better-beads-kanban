import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DaemonBeadsAdapter, STORE_MIGRATION_TIMEOUT_MS } from '../../daemonBeadsAdapter';
import { BdCommandError, findBdCommandError } from '../../shared/node';

interface Call { args: string[]; timeoutMs: number | undefined; cwd: string }

suite('bd version pre-flight and first-open migration', () => {
  let roots: string[];
  let calls: Call[];
  let bdVersion: string;
  let versionFailure: unknown;
  let statsFailure: unknown;
  let versionGate: Promise<void> | undefined;
  let statsGate: Promise<void> | undefined;
  let withProgress: sinon.SinonStub;
  let showWarning: sinon.SinonStub;

  function makeRoot(localVersion: string | null): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bbk-preflight-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, '.beads'));
    if (localVersion !== null) { fs.writeFileSync(path.join(root, '.beads', '.local_version'), `${localVersion}\n`); }
    return root;
  }

  /** Like bd, a store-opening command records the opening version in .local_version. */
  function makeAdapter(root: string): DaemonBeadsAdapter {
    const adapter = new DaemonBeadsAdapter(root, { appendLine: () => undefined } as unknown as vscode.OutputChannel);
    (adapter as any).execBd = async (args: string[], timeoutMs?: number) => {
      const cwd = (adapter as any).workspaceRoot as string;
      calls.push({ args, timeoutMs, cwd });
      if (args[0] === 'version') {
        if (versionGate) { await versionGate; }
        if (versionFailure !== undefined) { throw versionFailure; }
        return { version: bdVersion, schema_version: 1 };
      }
      if (args[0] === 'stats' && statsGate) { await statsGate; }
      if (args[0] === 'stats' && statsFailure !== undefined) { throw statsFailure; }
      const marker = path.join(cwd, '.beads', '.local_version');
      if (fs.existsSync(marker)) { fs.writeFileSync(marker, `${bdVersion}\n`); }
      if (args[0] === 'show') { return [{ id: args[args.length - 1] }]; }
      return [];
    };
    return adapter;
  }

  // Board loads also run `bd ready`; these tests are about the pre-flight around it.
  const preflightCalls = () => calls.filter(call => call.args[0] !== 'ready');
  const commands = () => preflightCalls().map(call => call.args[0]);

  setup(() => {
    roots = [];
    calls = [];
    bdVersion = '1.3.1';
    versionFailure = undefined;
    statsFailure = undefined;
    versionGate = undefined;
    statsGate = undefined;
    withProgress = sinon.stub(vscode.window, 'withProgress').callsFake(async (_options, task) =>
      task({ report: () => undefined }, new vscode.CancellationTokenSource().token));
    showWarning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
  });

  teardown(() => {
    sinon.restore();
    for (const root of roots) { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('a store last opened by the installed bd loads with no extra open', async () => {
    const adapter = makeAdapter(makeRoot('1.3.1'));
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'list']);
    assert.ok(withProgress.notCalled);
  });

  test('a store last opened by an older bd is opened first with the long timeout under progress', async () => {
    const adapter = makeAdapter(makeRoot('1.2.2'));
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'stats', 'list']);
    assert.strictEqual(preflightCalls()[1].timeoutMs, STORE_MIGRATION_TIMEOUT_MS);
    assert.strictEqual(preflightCalls()[2].timeoutMs, undefined);
    assert.ok(withProgress.calledOnce);
    assert.strictEqual(withProgress.firstCall.args[0].title, 'Upgrading the Beads database from bd 1.2.2 to 1.3.1…');
  });

  test('bd upgraded while the board is open gets the long first open on the next load', async () => {
    bdVersion = '1.2.2';
    const adapter = makeAdapter(makeRoot('1.2.2'));
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'list']);
    bdVersion = '1.3.1';
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'list', 'version', 'stats', 'list']);
    assert.strictEqual(preflightCalls()[3].timeoutMs, STORE_MIGRATION_TIMEOUT_MS);
    assert.ok(withProgress.calledOnce);
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands().slice(5), ['version', 'list']);
  });

  test('a mutation that is the first open after an upgrade gets the long open too', async () => {
    bdVersion = '1.2.2';
    const adapter = makeAdapter(makeRoot('1.2.2'));
    await adapter.getBoardMinimal();
    bdVersion = '1.3.1';
    await adapter.setIssueStatus('fx-a1', 'in_progress');
    assert.deepStrictEqual(commands().slice(2), ['version', 'stats', 'update']);
    assert.strictEqual(preflightCalls()[3].timeoutMs, STORE_MIGRATION_TIMEOUT_MS);
  });

  test('a store with no .local_version is opened once with the long timeout and no notification', async () => {
    const adapter = makeAdapter(makeRoot(null));
    await adapter.getBoardMinimal();
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'stats', 'list', 'version', 'list']);
    assert.strictEqual(preflightCalls()[1].timeoutMs, STORE_MIGRATION_TIMEOUT_MS);
    assert.ok(withProgress.notCalled);
  });

  test('a downgrade opens without claiming an upgrade', async () => {
    bdVersion = '1.2.2';
    const adapter = makeAdapter(makeRoot('1.3.1'));
    await adapter.getBoardMinimal();
    assert.strictEqual(withProgress.firstCall.args[0].title, 'Opening the Beads database with bd 1.2.2…');
  });

  test('concurrent callers share one check', async () => {
    const adapter = makeAdapter(makeRoot('1.2.2'));
    await Promise.all([adapter.getBoardMinimal(), adapter.getIssueFull('fx-a1'), adapter.getCapabilities()]);
    assert.deepStrictEqual(commands().filter(c => c === 'version' || c === 'stats'), ['version', 'stats']);
  });

  test('a check still running when the root changes is redone against the new root', async () => {
    const oldRoot = makeRoot('1.2.2');
    const newRoot = makeRoot('1.2.2');
    const adapter = makeAdapter(oldRoot);
    let release!: () => void;
    versionGate = new Promise(resolve => { release = resolve; });
    const stale = adapter.getCapabilities();
    await new Promise(resolve => setImmediate(resolve));
    adapter.setWorkspaceRoot(newRoot);
    versionGate = undefined;
    release();
    await stale;
    assert.deepStrictEqual(commands(), ['version', 'version', 'stats']);
    assert.strictEqual(preflightCalls()[0].cwd, oldRoot);
    assert.ok(preflightCalls().slice(1).every(call => call.cwd === newRoot));
    assert.strictEqual(fs.readFileSync(path.join(oldRoot, '.beads', '.local_version'), 'utf8'), '1.2.2\n');
  });

  test('a board load waiting on a stale check opens the new root with the long timeout', async () => {
    const adapter = makeAdapter(makeRoot('1.3.1'));
    let release!: () => void;
    versionGate = new Promise(resolve => { release = resolve; });
    const staleLoad = adapter.getBoardMinimal();
    await new Promise(resolve => setImmediate(resolve));
    const newRoot = makeRoot('1.2.2');
    adapter.setWorkspaceRoot(newRoot);
    versionGate = undefined;
    release();
    await staleLoad;
    assert.deepStrictEqual(commands(), ['version', 'version', 'stats', 'list']);
    assert.strictEqual(preflightCalls()[2].timeoutMs, STORE_MIGRATION_TIMEOUT_MS);
    assert.ok(preflightCalls().slice(1).every(call => call.cwd === newRoot));
  });

  test('a root switch during the long open makes the waiting load check the new root before reading it', async () => {
    const adapter = makeAdapter(makeRoot('1.2.2'));
    let release!: () => void;
    statsGate = new Promise(resolve => { release = resolve; });
    const staleLoad = adapter.getBoardMinimal();
    while (!commands().includes('stats')) { await new Promise(resolve => setImmediate(resolve)); }
    const newRoot = makeRoot('1.3.1');
    adapter.setWorkspaceRoot(newRoot);
    statsGate = undefined;
    release();
    await staleLoad;
    assert.deepStrictEqual(commands(), ['version', 'stats', 'version', 'list']);
    assert.ok(preflightCalls().slice(2).every(call => call.cwd === newRoot));
  });

  test('setting the same root again does not start a second check', async () => {
    const root = makeRoot('1.2.2');
    const adapter = makeAdapter(root);
    let release!: () => void;
    versionGate = new Promise(resolve => { release = resolve; });
    const first = adapter.getBoardMinimal();
    await new Promise(resolve => setImmediate(resolve));
    adapter.setWorkspaceRoot(root);
    const second = adapter.getBoardMinimal();
    versionGate = undefined;
    release();
    await Promise.all([first, second]);
    assert.deepStrictEqual(commands().filter(c => c === 'version' || c === 'stats'), ['version', 'stats']);
  });

  const firstOpenCases: Array<[string, (adapter: DaemonBeadsAdapter) => Promise<unknown>, string]> = [
    ['createIssue', a => a.createIssue({ title: 'New' }), 'create'],
    ['setIssueStatus', a => a.setIssueStatus('fx-a1', 'in_progress'), 'update'],
    ['updateIssue', a => a.updateIssue('fx-a1', { title: 'Renamed' }), 'update'],
    ['updateIssue ephemeral only', a => a.updateIssue('fx-a1', { ephemeral: true }), 'update'],
    ['addComment', a => a.addComment('fx-a1', 'hi', 'me'), 'comments'],
    ['addLabel', a => a.addLabel('fx-a1', 'x'), 'label'],
    ['removeLabel', a => a.removeLabel('fx-a1', 'x'), 'label'],
    ['addDependency', a => a.addDependency('fx-a1', 'fx-b2', 'blocks'), 'dep'],
    ['removeDependency', a => a.removeDependency('fx-a1', 'fx-b2'), 'dep'],
    ['getColumnData (Load more)', a => a.getColumnData('open', 0, 10), 'list'],
    ['getColumnCount', a => a.getColumnCount('open'), 'stats']
  ];
  for (const [name, run, command] of firstOpenCases) {
    test(`${name} as the first open after an upgrade gets the long open first`, async () => {
      bdVersion = '1.2.2';
      const adapter = makeAdapter(makeRoot('1.2.2'));
      await adapter.getBoardMinimal();
      bdVersion = '1.3.1';
      await run(adapter).catch(() => undefined);
      const after = preflightCalls().slice(2);
      assert.deepStrictEqual(after.slice(0, 2).map(c => c.args[0]), ['version', 'stats']);
      assert.strictEqual(after[1].timeoutMs, STORE_MIGRATION_TIMEOUT_MS);
      assert.ok(after.slice(2).some(c => c.args[0] === command), `${command} ran after the open`);
    });
  }

  test('a caller on the new root does not join the old root\'s check', async () => {
    const adapter = makeAdapter(makeRoot('1.3.1'));
    let release!: () => void;
    versionGate = new Promise(resolve => { release = resolve; });
    const stale = adapter.getCapabilities();
    await new Promise(resolve => setImmediate(resolve));
    const newRoot = makeRoot('1.2.2');
    adapter.setWorkspaceRoot(newRoot);
    versionGate = undefined;
    const fresh = adapter.getBoardMinimal();
    release();
    await Promise.all([stale, fresh]);
    assert.deepStrictEqual(commands(), ['version', 'version', 'stats', 'list']);
    assert.strictEqual(preflightCalls()[2].cwd, newRoot);
  });

  test('a failed first open fails the load, keeps the bd error as cause and is retried next time', async () => {
    const adapter = makeAdapter(makeRoot('1.2.2'));
    statsFailure = new BdCommandError('bd command failed with exit code 1: boom', { exitCode: 1, stderr: 'boom', stdout: '', args: ['stats', '--json'] });
    await assert.rejects(adapter.getBoardMinimal(), (error: Error) => {
      assert.match(error.message, /^Failed to get minimal board data:/);
      assert.strictEqual(findBdCommandError(error), statsFailure);
      return true;
    });
    assert.ok(!commands().includes('list'));
    statsFailure = undefined;
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'stats', 'version', 'stats', 'list']);
  });

  test('a failed bd version fails the load and is retried next time', async () => {
    const adapter = makeAdapter(makeRoot('1.3.1'));
    versionFailure = new Error('spawn bd ENOENT');
    await assert.rejects(adapter.getBoardMinimal(), /Failed to get minimal board data: spawn bd ENOENT/);
    versionFailure = undefined;
    await adapter.getBoardMinimal();
    assert.deepStrictEqual(commands(), ['version', 'version', 'list']);
  });

  test('bd below 1.2.2 warns once per root and version and gets no 1.3 capabilities', async () => {
    bdVersion = '1.2.1';
    const adapter = makeAdapter(makeRoot('1.2.1'));
    await adapter.getBoardMinimal();
    assert.strictEqual((await adapter.getCapabilities()).ifStatus, false);
    await adapter.getBoardMinimal();
    assert.ok(showWarning.calledOnce);
    assert.match(showWarning.firstCall.args[0], /^bd 1\.2\.1 is older than 1\.2\.2, the oldest version Better Beads Kanban supports/);
  });

  test('capabilities follow the installed version and an unknown version gets none', async () => {
    const adapter = makeAdapter(makeRoot('1.3.1'));
    assert.strictEqual((await adapter.getCapabilities()).ifStatus, true);
    bdVersion = 'dev';
    const unknown = await adapter.getCapabilities();
    assert.deepStrictEqual(unknown, { version: null, closePolicy: false, ifStatus: false, briefDeps: false, leases: false, eventsJournal: false });
    assert.ok(showWarning.notCalled);
  });
});
