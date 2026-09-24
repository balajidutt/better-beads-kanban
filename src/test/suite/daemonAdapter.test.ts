import * as assert from 'assert';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';

const FIXTURE_PREFIX = 'bktest';
let fixtureDir: string;
let originalEnvironment: NodeJS.ProcessEnv | undefined;
const fixtureEnvironmentKey = (name: string): boolean => /^(BD_|BEADS_|DOLT_|GIT_|XDG_)/i.test(name)
    || ['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH'].includes(name);

suite('DaemonBeadsAdapter Integration Tests', () => {
    let adapter: DaemonBeadsAdapter;
    let output: vscode.OutputChannel;
    let workspaceRoot: string;

    /** True when the bd CLI is callable at all. */
    function bdAvailable(): boolean {
        const probe = cp.spawnSync('bd', ['version'], { cwd: fixtureDir, encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 });
        return !probe.error && probe.status === 0;
    }

    function bd(args: string[]): string {
        const result = cp.spawnSync('bd', args[0] === 'init' ? args : ['-C', fixtureDir, ...args], {
            cwd: fixtureDir,
            encoding: 'utf8',
            timeout: args[0] === 'init' ? 120000 : 30000,
            maxBuffer: 50 * 1024 * 1024,
            shell: false
        });
        if (result.error) {
            throw new Error(`bd fixture subprocess failed (${result.error.name})`);
        }
        if (result.status !== 0) {
            throw new Error(
                `bd fixture ${args[0]} failed (${result.status})`
            );
        }
        return (result.stdout || '').trim();
    }

    /**
     * Skip test when the environment can't support it: no bd CLI on PATH, or no
     * beads database in the workspace. These are integration tests against a real
     * bd, so an absent database is "can't run here", not a failure.
     *
     * 'daemon is not running' is a leftover from pre-1.0 bd, which had a daemon.
     * It is kept so the guard still works against an old CLI.
     */
    function skipIfNoBd(err: unknown, ctx: Mocha.Context): void {
        if (!(err instanceof Error)) {
            return;
        }
        const unavailable = [
            'daemon is not running',
            'ENOENT',
            'no beads database found'
        ];
        if (unavailable.some(marker => err.message.includes(marker))) {
            ctx.skip();
        }
    }

    suiteSetup(async function() {
        // bd init pulls up an embedded Dolt engine and seeding is a handful of
        // subprocess calls, so this needs far more than the default 2s.
        this.timeout(180000);

        fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-kanban-test-'));
        originalEnvironment = { ...process.env };
        for (const name of Object.keys(process.env)) {
            if (fixtureEnvironmentKey(name)) {
                delete process.env[name];
            }
        }
        const home = path.join(fixtureDir, 'home');
        fs.mkdirSync(home);
        const gitConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(gitConfig, '');
        Object.assign(process.env, {
            HOME: home, USERPROFILE: home,
            XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
            XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_STATE_HOME: path.join(home, '.local', 'state'),
            GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_SYSTEM: gitConfig, GIT_TERMINAL_PROMPT: '0'
        });

        // CI does not install bd. Skip the whole suite rather than reporting a
        // wall of failures for something the environment simply can't run.
        if (!bdAvailable()) {
            this.skip();
        }

        bd(['init', '--non-interactive', '--quiet', '--skip-agents', '--skip-hooks', '--prefix', FIXTURE_PREFIX]);
        const context = JSON.parse(bd(['--readonly', 'context', '--json'])) as { beads_dir?: unknown };
        assert.strictEqual(typeof context.beads_dir, 'string');
        const relative = path.relative(fs.realpathSync(fixtureDir), fs.realpathSync(context.beads_dir as string));
        assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'bd context must resolve inside its owned fixture');
        bd(['config', 'set', 'routing.mode', 'maintainer']);
        assert.strictEqual(bd(['--readonly', 'config', 'get', 'routing.mode']), 'maintainer');

        // Seed enough for the board assertions to actually run. Most of them are
        // guarded by `if (cards.length > 0)`, so an empty database would let the
        // suite pass without checking anything.
        //
        // Seeding goes through the bd CLI rather than DaemonBeadsAdapter on
        // purpose: the fixture must not depend on the class under test, or an
        // adapter regression turns into a skipped suite instead of a red test.
        const seeds: Array<{
            title: string;
            type: string;
            priority: string;
            status?: string;
        }> = [
            { title: 'Seed: open task', type: 'task', priority: '2' },
            { title: 'Seed: open bug', type: 'bug', priority: '1' },
            { title: 'Seed: work in progress', type: 'feature', priority: '0', status: 'in_progress' },
            { title: 'Seed: blocked chore', type: 'chore', priority: '3', status: 'blocked' },
            { title: 'Seed: closed epic', type: 'epic', priority: '4', status: 'closed' },
            { title: 'Seed: second open task', type: 'task', priority: '2' }
        ];

        for (const seed of seeds) {
            const id = bd([
                'create', '--silent',
                '--title', seed.title,
                '--description', `Fixture issue for ${seed.type} coverage.`,
                '--type', seed.type,
                '--priority', seed.priority
            ]);
            if (seed.status) {
                bd(['update', id, '--status', seed.status]);
            }
        }
    });

    suiteTeardown(() => {
        if (originalEnvironment) {
            for (const name of new Set([...Object.keys(process.env), ...Object.keys(originalEnvironment)])) {
                if (fixtureEnvironmentKey(name)) {
                    if (originalEnvironment[name] === undefined) {
                        delete process.env[name];
                    } else {
                        process.env[name] = originalEnvironment[name];
                    }
                }
            }
        }
        if (fixtureDir) {
            fs.rmSync(fixtureDir, { recursive: true, force: true });
        }
    });

    setup(() => {
        output = vscode.window.createOutputChannel('Test');
        workspaceRoot = fixtureDir;
        adapter = new DaemonBeadsAdapter(workspaceRoot, output);
    });

    teardown(function() {
        try { adapter.dispose(); } catch { /* ignore */ }
        try { output.dispose(); } catch { /* ignore */ }
    });

    test('Daemon connection check', async function() {
        this.timeout(10000);

        try {
            await adapter.ensureConnected();
            assert.ok(true, 'Should connect to daemon without errors');
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    test('Get board data from daemon', async function() {
        this.timeout(10000);

        try {
            const board = await adapter.getBoard();

            assert.ok(board, 'Should return board data');
            assert.ok(Array.isArray(board.columns), 'Should have columns array');
            assert.ok(Array.isArray(board.cards), 'Should have cards array');
            assert.strictEqual(board.columns.length, 4, 'Should have 4 columns');

            // Verify column structure
            const columnKeys = board.columns.map(c => c.key);
            assert.ok(columnKeys.includes('ready'), 'Should have ready column');
            assert.ok(columnKeys.includes('in_progress'), 'Should have in_progress column');
            assert.ok(columnKeys.includes('blocked'), 'Should have blocked column');
            assert.ok(columnKeys.includes('closed'), 'Should have closed column');

            // Verify cards have required fields
            if (board.cards.length > 0) {
                const card = board.cards[0];
                assert.ok(card.id, 'Card should have id');
                assert.ok(card.title, 'Card should have title');
                assert.ok(card.status, 'Card should have status');
            }
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    test('Create issue via daemon', async function() {
        this.timeout(10000);

        try {
            const result = await adapter.createIssue({
                title: 'Test Daemon Adapter Issue',
                description: 'Testing DaemonBeadsAdapter createIssue',
                priority: 2,
                issue_type: 'task'
            });

            assert.ok(result.id, 'Should return an issue ID');
            assert.strictEqual(typeof result.id, 'string');
            assert.ok(result.id.length > 0, 'ID should be non-empty');

            // Clean up - close the test issue
            await adapter.setIssueStatus(result.id, 'closed');
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    test('Get minimal board data (fast loading)', async function() {
        this.timeout(10000);

        try {
            const cards = await adapter.getBoardMinimal();

            assert.ok(Array.isArray(cards), 'Should return array of minimal cards');
            
            // Verify MinimalCard structure if there are cards
            if (cards.length > 0) {
                const card = cards[0];
                
                // Check all MinimalCard required fields
                assert.ok(card.id, 'MinimalCard should have id');
                assert.ok(typeof card.title === 'string', 'MinimalCard should have title string');
                assert.ok(typeof card.description === 'string', 'MinimalCard should have description string');
                assert.ok(card.status, 'MinimalCard should have status');
                assert.ok(typeof card.priority === 'number', 'MinimalCard should have priority number');
                assert.ok(card.issue_type, 'MinimalCard should have issue_type');
                assert.ok(card.created_at, 'MinimalCard should have created_at');
                assert.ok(card.created_by, 'MinimalCard should have created_by');
                assert.ok(card.updated_at, 'MinimalCard should have updated_at');
                assert.ok(typeof card.dependency_count === 'number', 'MinimalCard should have dependency_count number');
                assert.ok(typeof card.dependent_count === 'number', 'MinimalCard should have dependent_count number');
                
                // Verify MinimalCard does NOT have full card fields (optional check)
                // These fields should not be present in MinimalCard
                assert.strictEqual((card as any).acceptance_criteria, undefined, 'MinimalCard should not have acceptance_criteria');
                assert.strictEqual((card as any).design, undefined, 'MinimalCard should not have design');
                assert.strictEqual((card as any).notes, undefined, 'MinimalCard should not have notes');
                assert.strictEqual((card as any).comments, undefined, 'MinimalCard should not have comments');
            }
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    test('Get full issue details', async function() {
        this.timeout(10000);

        try {
            // First create a test issue to load
            const createResult = await adapter.createIssue({
                title: 'Test Full Issue Load',
                description: 'Testing getIssueFull method',
                acceptance_criteria: 'Test criteria',
                design: 'Test design',
                notes: 'Test notes',
                priority: 2,
                issue_type: 'task'
            });

            assert.ok(createResult.id, 'Should create test issue');

            // Now load the full issue
            const fullCard = await adapter.getIssueFull(createResult.id);

            // Verify FullCard has all MinimalCard fields
            assert.ok(fullCard.id, 'FullCard should have id');
            assert.strictEqual(fullCard.title, 'Test Full Issue Load', 'FullCard should have correct title');
            assert.strictEqual(fullCard.description, 'Testing getIssueFull method', 'FullCard should have correct description');
            assert.ok(fullCard.status, 'FullCard should have status');
            assert.strictEqual(fullCard.priority, 2, 'FullCard should have correct priority');
            assert.strictEqual(fullCard.issue_type, 'task', 'FullCard should have correct issue_type');
            assert.ok(fullCard.created_at, 'FullCard should have created_at');
            assert.ok(fullCard.created_by, 'FullCard should have created_by');
            assert.ok(fullCard.updated_at, 'FullCard should have updated_at');
            assert.ok(typeof fullCard.dependency_count === 'number', 'FullCard should have dependency_count');
            assert.ok(typeof fullCard.dependent_count === 'number', 'FullCard should have dependent_count');

            // Verify FullCard has extended fields
            assert.strictEqual(fullCard.acceptance_criteria, 'Test criteria', 'FullCard should have acceptance_criteria');
            assert.strictEqual(fullCard.design, 'Test design', 'FullCard should have design');
            assert.strictEqual(fullCard.notes, 'Test notes', 'FullCard should have notes');
            
            // Verify FullCard has relationship arrays (even if empty)
            assert.ok(Array.isArray(fullCard.children), 'FullCard should have children array');
            assert.ok(Array.isArray(fullCard.blocks), 'FullCard should have blocks array');
            assert.ok(Array.isArray(fullCard.blocked_by), 'FullCard should have blocked_by array');
            assert.ok(Array.isArray(fullCard.comments), 'FullCard should have comments array');

            // Clean up - close the test issue
            await adapter.setIssueStatus(createResult.id, 'closed');
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    // Regression: pinned/is_template were missing from IssueUpdateSchema, so the
    // edit dialog's checkboxes never persisted. A schema-only test would not have
    // caught it - the values were valid, just unknown, and Zod dropped them
    // silently. This drives the real bd round trip instead.
    test('Update round-trips pinned and is_template', async function() {
        this.timeout(30000);

        try {
            const created = await adapter.createIssue({
                title: 'Test flag round trip',
                priority: 2,
                issue_type: 'task'
            });

            const initial = await adapter.getIssueFull(created.id);
            assert.strictEqual(initial.pinned, false, 'Should start unpinned');
            assert.strictEqual(initial.is_template, false, 'Should start as a non-template');

            await adapter.updateIssue(created.id, { pinned: true, is_template: true });
            const set = await adapter.getIssueFull(created.id);
            assert.strictEqual(set.pinned, true, 'pinned should persist through update');
            assert.strictEqual(set.is_template, true, 'is_template should persist through update');

            await adapter.updateIssue(created.id, { pinned: false, is_template: false });
            const cleared = await adapter.getIssueFull(created.id);
            assert.strictEqual(cleared.pinned, false, 'pinned should clear through update');
            assert.strictEqual(cleared.is_template, false, 'is_template should clear through update');

            await adapter.setIssueStatus(created.id, 'closed');
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    // Separate from the pair above: ephemeral is a first-class bd field rather
    // than metadata, and --persistent (the inverse) promotes a wisp back to a
    // regular issue, so the read-back is asserted rather than assumed symmetric.
    test('Update round-trips ephemeral', async function() {
        this.timeout(30000);

        try {
            const created = await adapter.createIssue({
                title: 'Test ephemeral round trip',
                priority: 2,
                issue_type: 'task'
            });

            // ephemeral on its own: the main bd call is skipped entirely, since
            // 'update <id>' with no flags would be a no-op invocation.
            await adapter.updateIssue(created.id, { ephemeral: true });
            const marked = await adapter.getIssueFull(created.id);
            assert.strictEqual(marked.ephemeral, true, 'ephemeral should persist through update');

            await adapter.updateIssue(created.id, { ephemeral: false });
            const promoted = await adapter.getIssueFull(created.id);
            assert.strictEqual(promoted.ephemeral, false, 'ephemeral should clear via --persistent');

            // ephemeral alongside a normal field: two separate bd calls, both applied.
            // The split exists so a bd-side wisp failure cannot discard the title.
            await adapter.updateIssue(created.id, {
                title: 'Renamed while toggling ephemeral',
                ephemeral: true
            });
            const combined = await adapter.getIssueFull(created.id);
            assert.strictEqual(combined.title, 'Renamed while toggling ephemeral', 'title should persist alongside ephemeral');
            assert.strictEqual(combined.ephemeral, true, 'ephemeral should persist alongside a field update');

            await adapter.setIssueStatus(created.id, 'closed');
        } catch (err) {
            skipIfNoBd(err, this);
            throw err;
        }
    });

    test('Get full issue for non-existent ID should fail', async function() {
        this.timeout(10000);
        let threw = false;
        try {
            await adapter.getIssueFull('beads-non-existent-12345');
        } catch (err) {
            skipIfNoBd(err, this);
            threw = true;
            assert.ok(
                err instanceof Error && /Issue not found/.test(err.message),
                'Should reject with Issue not found error'
            );
        }
        if (!threw) {
            assert.fail('getIssueFull should have thrown for non-existent ID');
        }
    });
});
