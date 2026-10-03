import * as assert from 'assert';
import { BEADS_WATCH_PATTERNS, shouldTriggerRefresh } from '../../beadsWatch';

// bd 1.x replaced SQLite with Dolt, so the old `.beads/**\/*.{db,sqlite,sqlite3}`
// glob could never match anything in a Dolt-backed repository and auto-refresh
// never fired. The patterns below are the contract; the predicate keeps the
// server's own churn from triggering a reload on every log line.

suite('BEADS_WATCH_PATTERNS', () => {
    test('watches both the bd-level files and the Dolt journal', () => {
        // Locks the contract: a regression back to a SQLite-only glob fails here.
        assert.deepStrictEqual([...BEADS_WATCH_PATTERNS], [
            '.beads/*',
            '.beads/{dolt,embeddeddolt}/*/.dolt/noms/*'
        ]);
    });

    test('the top-level pattern is present for Windows client mode', () => {
        // On Windows bd talks to a Dolt server hosted elsewhere and there is no
        // local dolt/ directory, so only the top-level pattern can ever fire.
        assert.ok(BEADS_WATCH_PATTERNS.includes('.beads/*'));
    });
});

suite('shouldTriggerRefresh', () => {
    const shouldRefresh = [
        '/repo/.beads/last-touched',
        '/repo/.beads/interactions.jsonl',
        '/repo/.beads/issues.jsonl',
        '/repo/.beads/beads.db',
        '/repo/.beads/dolt/dots/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
        '/repo/.beads/dolt/dots/.dolt/noms/manifest'
    ];

    for (const fsPath of shouldRefresh) {
        test(`refreshes on ${fsPath}`, () => {
            assert.strictEqual(shouldTriggerRefresh(fsPath), true);
        });
    }

    const shouldIgnore = [
        '/repo/.beads/dolt-server.log',
        '/repo/.beads/dolt-server.pid',
        '/repo/.beads/dolt-server.port',
        '/repo/.beads/dolt-server.lock',
        '/repo/.beads/.exclusive-lock',
        '/repo/.beads/.local_version',
        '/repo/.beads/bd.sock',
        '/repo/.beads/export-state.json',
        '/repo/.beads/in-progress-claude.json',
        '/repo/.beads/beads.db-wal',
        '/repo/.beads/beads.db-shm',
        '/repo/.beads/beads.db-journal',
        '/repo/.beads/dolt/dots/.dolt/noms/LOCK',
        '/repo/.beads/dolt/dots/.dolt/git-remote-cache/x/repo.git/objects/ab/cdef',
        '/repo/.beads/dolt/.dolt/stats/.dolt/noms/manifest',
        '/repo/.beads/dolt/dots/.dolt/noms/temptf/scratch',
        '/repo/.beads/dolt/dots/.dolt/noms/oldgen/chunk'
    ];

    for (const fsPath of shouldIgnore) {
        test(`ignores ${fsPath}`, () => {
            assert.strictEqual(shouldTriggerRefresh(fsPath), false);
        });
    }

    test('applies the same rules to Windows separators', () => {
        assert.strictEqual(shouldTriggerRefresh('C:\\repo\\.beads\\last-touched'), true);
        assert.strictEqual(shouldTriggerRefresh('C:\\repo\\.beads\\dolt-server.log'), false);
        assert.strictEqual(
            shouldTriggerRefresh('C:\\repo\\.beads\\dolt\\dots\\.dolt\\noms\\manifest'),
            true
        );
    });
});

/** Workspace-relative paths, matched the way VS Code's RelativePattern globs treat these two patterns. */
function matchesWatchPattern(relativePath: string): boolean {
    return BEADS_WATCH_PATTERNS.some((pattern) => {
        const source = pattern
            .replace(/[.+^$()|[\]\\]/g, '\\$&')
            .replace(/\{([^}]*)\}/g, (_, options: string) => `(?:${options.split(',').join('|')})`)
            .replace(/\*/g, '[^/]*');
        return new RegExp(`^${source}$`).test(relativePath);
    });
}

const refreshes = (relativePath: string) =>
    matchesWatchPattern(relativePath) && shouldTriggerRefresh(`/repo/${relativePath}`);

// Files changed by one external bd 1.3.1 command, recorded with `find -newer`
// against scratch stores.
const observedBd131: Array<{ layout: string; command: string; changed: string[] }> = [
    {
        layout: 'embedded', command: 'update --priority',
        changed: [
            '.beads/embeddeddolt/wx/.dolt/noms/journal.idx',
            '.beads/embeddeddolt/wx/.dolt/noms/manifest',
            '.beads/embeddeddolt/wx/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/last-touched'
        ]
    },
    {
        layout: 'embedded', command: 'comments add',
        changed: [
            '.beads/embeddeddolt/wx/.dolt/noms/journal.idx',
            '.beads/embeddeddolt/wx/.dolt/noms/manifest',
            '.beads/embeddeddolt/wx/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'
        ]
    },
    {
        layout: 'embedded', command: 'close',
        changed: [
            '.beads/embeddeddolt/wx/.dolt/noms/journal.idx',
            '.beads/embeddeddolt/wx/.dolt/noms/manifest',
            '.beads/embeddeddolt/wx/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/last-touched'
        ]
    },
    {
        layout: 'proxied-server', command: 'update --priority',
        changed: [
            '.beads/dolt/proxy.log',
            '.beads/dolt/px/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/dolt/server.log'
        ]
    },
    {
        layout: 'proxied-server', command: 'comments add',
        changed: [
            '.beads/dolt/.dolt/stats/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/dolt/proxy.log',
            '.beads/dolt/px/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/dolt/server.log'
        ]
    },
    {
        layout: 'proxied-server', command: 'close',
        changed: [
            '.beads/dolt/.dolt/stats/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/dolt/proxy.log',
            '.beads/dolt/px/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/dolt/server.log'
        ]
    }
];

suite('bd 1.3.1 layouts trigger a refresh on external mutations', () => {
    for (const { layout, command, changed } of observedBd131) {
        test(`${layout}: an external bd ${command} changes at least one watched path`, () => {
            assert.ok(changed.some(refreshes), changed.join(', '));
        });
    }

    test('the proxied-server data journal is watched and its logs and stats store are not', () => {
        assert.ok(refreshes('.beads/dolt/px/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'));
        assert.ok(!matchesWatchPattern('.beads/dolt/proxy.log'));
        assert.ok(!matchesWatchPattern('.beads/dolt/server.log'));
        assert.ok(!matchesWatchPattern('.beads/dolt/.dolt/stats/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'));
    });

    test('an embedded list run by another process (a read) refreshes the board', () => {
        const listRead = [
            '.beads/embeddeddolt/wx/.dolt/noms/journal.idx',
            '.beads/embeddeddolt/wx/.dolt/noms/manifest',
            '.beads/embeddeddolt/wx/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'
        ];
        assert.ok(listRead.some(refreshes));
    });

    test('a proxied-server list run (a read) changes no watched path', () => {
        const listRead = [
            '.beads/dolt/.dolt/stats/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv',
            '.beads/dolt/proxy.log',
            '.beads/dolt/server.log'
        ];
        assert.ok(!listRead.some(refreshes));
    });

    test('the gate lock bd 1.3 creates is a watched path but never refreshes', () => {
        assert.ok(matchesWatchPattern('.beads/embeddeddolt.gate.lock'));
        assert.ok(!refreshes('.beads/embeddeddolt.gate.lock'));
    });

    test('the pattern matcher used here agrees with the existing contract', () => {
        assert.ok(matchesWatchPattern('.beads/last-touched'));
        assert.ok(matchesWatchPattern('.beads/dolt/dots/.dolt/noms/manifest'));
        assert.ok(!matchesWatchPattern('.beads/dolt/.dolt/noms/manifest'));
        assert.ok(!matchesWatchPattern('.beads/embeddeddolt/wx/.dolt/noms/oldgen/chunk'));
    });
});
