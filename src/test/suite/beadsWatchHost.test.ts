import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BEADS_WATCH_PATTERNS } from '../../beadsWatch';

const EVENT_TIMEOUT_MS = 8000;
const REWRITE_INTERVAL_MS = 1000;

const EMBEDDED_JOURNAL = '.beads/embeddeddolt/wx/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv';
const LAST_TOUCHED = '.beads/last-touched';
const PROXIED_JOURNAL = '.beads/dolt/px/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv';

suite('VS Code delivers watcher events for bd 1.3.1 layouts', function () {
    this.timeout(30000);
    let root: string;
    let watchers: vscode.FileSystemWatcher[];
    let seen: Array<{ kind: 'create' | 'change'; path: string }>;

    const absolute = (relativePath: string) => path.join(root, ...relativePath.split('/'));

    setup(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bbk-watch-host-')));
        seen = [];
        watchers = BEADS_WATCH_PATTERNS.map((pattern) => {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(root), pattern)
            );
            const record = (kind: 'create' | 'change') => (uri: vscode.Uri) => {
                seen.push({ kind, path: path.relative(root, uri.fsPath).split(path.sep).join('/') });
            };
            watcher.onDidCreate(record('create'));
            watcher.onDidChange(record('change'));
            return watcher;
        });
    });

    teardown(() => {
        for (const watcher of watchers) { watcher.dispose(); }
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Keeps writing until an event for the path arrives, so a watcher that starts late is not a failure. */
    async function writeUntilSeen(
        relativePath: string,
        write: (target: string) => void,
        kind?: 'create' | 'change'
    ): Promise<void> {
        const target = absolute(relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const deadline = Date.now() + EVENT_TIMEOUT_MS;
        let nextWrite = 0;
        while (!seen.some((event) => event.path === relativePath && (!kind || event.kind === kind))) {
            if (Date.now() > deadline) {
                assert.fail(`no watcher event for ${relativePath}; saw ${JSON.stringify(seen)}`);
            }
            if (Date.now() >= nextWrite) {
                write(target);
                nextWrite = Date.now() + REWRITE_INTERVAL_MS;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    const create = (relativePath: string) =>
        writeUntilSeen(relativePath, (target) => fs.writeFileSync(target, String(Date.now())));

    /** bd appends to an existing journal and rewrites an existing last-touched, which arrives as a change. */
    async function createThenAppend(relativePath: string): Promise<void> {
        await create(relativePath);
        await new Promise((resolve) => setTimeout(resolve, 500));
        seen = [];
        await writeUntilSeen(relativePath, (target) => fs.appendFileSync(target, 'x'), 'change');
    }

    test('an embedded store journal write is delivered', async () => {
        await createThenAppend(EMBEDDED_JOURNAL);
    });

    test('an embedded store last-touched write is delivered', async () => {
        await createThenAppend(LAST_TOUCHED);
    });

    test('a proxied-server store journal write is delivered', async () => {
        await createThenAppend(PROXIED_JOURNAL);
    });

    test('proxy logs and the server stats store produce no event', async () => {
        await create(PROXIED_JOURNAL);
        const quiet = [
            '.beads/dolt/proxy.log',
            '.beads/dolt/server.log',
            '.beads/dolt/.dolt/stats/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'
        ];
        for (const relativePath of quiet) {
            fs.mkdirSync(path.dirname(absolute(relativePath)), { recursive: true });
            fs.writeFileSync(absolute(relativePath), 'x');
        }
        seen = [];
        await writeUntilSeen(PROXIED_JOURNAL, (target) => fs.appendFileSync(target, 'x'));
        await new Promise((resolve) => setTimeout(resolve, 1000));
        assert.deepStrictEqual(seen.filter((event) => quiet.includes(event.path)), []);
    });
});
