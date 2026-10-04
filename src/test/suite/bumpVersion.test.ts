import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BUMP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'bump-version.js');
const RELEASE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'release-fork-vsix.sh');

interface Fixture {
    dir: string;
    pkgPath: string;
    lockPath: string;
    webviewPath: string;
}

const fixtures: string[] = [];

// PROJECT_ROOT is path.resolve(__dirname, '..'), so a copy of the script under
// <fixture>/scripts targets the fixture instead of this repo. That is why the
// script is copied rather than invoked in place, and why it needs no test hook.
function makeFixture(opts: {
    pkgVersion?: string;
    webviewVersion?: string;
    changelogHeadings?: string[];
    lockVersion?: string;
    lockRaw?: string;
} = {}): Fixture {
    const pkgVersion = opts.pkgVersion ?? '2.2.0';
    const webviewVersion = opts.webviewVersion ?? pkgVersion;
    const headings = opts.changelogHeadings ?? ['2.2.1', '2.2.0'];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-kanban-bump-'));
    fixtures.push(dir);

    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.copyFileSync(BUMP_SCRIPT, path.join(dir, 'scripts', 'bump-version.js'));

    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'better-beads-kanban', version: pkgVersion }, null, 2) + '\n'
    );
    fs.writeFileSync(
        path.join(dir, 'package-lock.json'),
        opts.lockRaw ?? JSON.stringify({
            name: 'better-beads-kanban',
            version: opts.lockVersion ?? pkgVersion,
            lockfileVersion: 3,
            requires: true,
            packages: {
                '': { name: 'better-beads-kanban', version: opts.lockVersion ?? pkgVersion, license: 'MIT' },
                'node_modules/dep': { version: pkgVersion, resolved: 'https://example.invalid/dep.tgz' }
            }
        }, null, 2) + '\n'
    );
    fs.writeFileSync(
        path.join(dir, 'src', 'webview.ts'),
        'export function getHtml(): string {\n' +
        `    const version = "${webviewVersion}";\n` +
        '    return version;\n' +
        '}\n'
    );
    fs.writeFileSync(
        path.join(dir, 'CHANGELOG.md'),
        '# Changelog\n\n' +
        headings.map(v => `## [${v}] - 2026-09-11\n\n- an entry\n`).join('\n')
    );

    return {
        dir,
        pkgPath: path.join(dir, 'package.json'),
        lockPath: path.join(dir, 'package-lock.json'),
        webviewPath: path.join(dir, 'src', 'webview.ts')
    };
}

function runBump(fx: Fixture, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = cp.spawnSync(
        process.execPath,
        [path.join(fx.dir, 'scripts', 'bump-version.js'), ...args],
        { encoding: 'utf8' }
    );
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
    };
}

function snapshot(fx: Fixture): { pkg: string; lock: string; webview: string } {
    return {
        pkg: fs.readFileSync(fx.pkgPath, 'utf8'),
        lock: fs.readFileSync(fx.lockPath, 'utf8'),
        webview: fs.readFileSync(fx.webviewPath, 'utf8')
    };
}

function pkgVersionOf(fx: Fixture): string {
    return JSON.parse(fs.readFileSync(fx.pkgPath, 'utf8')).version;
}

function webviewVersionOf(fx: Fixture): string {
    const match = fs.readFileSync(fx.webviewPath, 'utf8').match(/const\s+version\s*=\s*"([^"]+)"/);
    if (!match) {
        assert.fail('fixture src/webview.ts lost its `const version = "..."` line');
    }
    return match[1];
}

suite('scripts/bump-version.js', () => {
    suiteTeardown(() => {
        for (const dir of fixtures) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('bumps package.json and src/webview.ts to the same version', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 0, run.stderr);
        assert.strictEqual(pkgVersionOf(fx), '2.2.1');
        assert.strictEqual(webviewVersionOf(fx), '2.2.1');
        assert.strictEqual(webviewVersionOf(fx), pkgVersionOf(fx));
    });

    test('sets only the two root versions in package-lock.json', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });
        const before = JSON.parse(fs.readFileSync(fx.lockPath, 'utf8'));

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 0, run.stderr);
        const after = JSON.parse(fs.readFileSync(fx.lockPath, 'utf8'));
        assert.strictEqual(after.version, '2.2.1');
        assert.strictEqual(after.packages[''].version, '2.2.1');
        before.version = '2.2.1';
        before.packages[''].version = '2.2.1';
        assert.deepStrictEqual(after, before);
        assert.strictEqual(after.packages['node_modules/dep'].version, '2.2.0');
        assert.strictEqual(fs.readFileSync(fx.lockPath, 'utf8'), JSON.stringify(before, null, 2) + '\n');
    });

    test('refuses a lockfile outside npm layout, and writes nothing', () => {
        const fx = makeFixture({
            pkgVersion: '2.2.0',
            lockRaw: JSON.stringify({ name: 'better-beads-kanban', version: '2.2.0', packages: { '': { version: '2.2.0' } } }) + '\n'
        });
        const before = snapshot(fx);

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 1);
        assert.ok(run.stderr.includes("not in npm's layout"), `expected the layout complaint: ${run.stderr}`);
        assert.deepStrictEqual(snapshot(fx), before);
    });

    test('repairs lockfile root versions that already lag package.json', () => {
        const fx = makeFixture({ pkgVersion: '2.2.2', lockVersion: '2.2.1', changelogHeadings: ['2.2.3', '2.2.2'] });

        const run = runBump(fx, '2.2.3');

        assert.strictEqual(run.status, 0, run.stderr);
        const lock = JSON.parse(fs.readFileSync(fx.lockPath, 'utf8'));
        assert.strictEqual(lock.version, '2.2.3');
        assert.strictEqual(lock.packages[''].version, '2.2.3');
        assert.strictEqual(lock.packages['node_modules/dep'].version, '2.2.2');
    });

    test('keeps CRLF line endings in a CRLF lockfile', () => {
        const lf = makeFixture({ pkgVersion: '2.2.0' });
        const crlfRaw = fs.readFileSync(lf.lockPath, 'utf8').replace(/\n/g, '\r\n');
        const fx = makeFixture({ pkgVersion: '2.2.0', lockRaw: crlfRaw });

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 0, run.stderr);
        const lock = JSON.parse(crlfRaw);
        lock.version = '2.2.1';
        lock.packages[''].version = '2.2.1';
        const expected = JSON.stringify(lock, null, 2).replace(/\n/g, '\r\n') + '\r\n';
        assert.strictEqual(fs.readFileSync(fx.lockPath, 'utf8'), expected);
    });

    test('refuses when package-lock.json is missing, and writes nothing', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });
        fs.rmSync(fx.lockPath);
        const pkg = fs.readFileSync(fx.pkgPath, 'utf8');
        const webview = fs.readFileSync(fx.webviewPath, 'utf8');

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 1);
        assert.ok(run.stderr.includes('package-lock.json not found'), `expected the missing-lockfile complaint: ${run.stderr}`);
        assert.strictEqual(fs.readFileSync(fx.pkgPath, 'utf8'), pkg);
        assert.strictEqual(fs.readFileSync(fx.webviewPath, 'utf8'), webview);
    });

    test('success output names the fork release script, not the marketplace path', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 0, run.stderr);
        assert.ok(
            run.stdout.includes('scripts/release-fork-vsix.sh'),
            `success output should name the fork release path: ${run.stdout}`
        );
        assert.ok(
            !run.stdout.includes('release:package'),
            `success output should not name the marketplace path: ${run.stdout}`
        );
    });

    test('accepts the legacy X.Y.Z-bd.N fork shape', () => {
        const fx = makeFixture({
            pkgVersion: '2.1.4-bd.4',
            changelogHeadings: ['2.1.4-bd.5', '2.1.4-bd.4']
        });

        const run = runBump(fx, '2.1.4-bd.5');

        assert.strictEqual(run.status, 0, run.stderr);
        assert.strictEqual(pkgVersionOf(fx), '2.1.4-bd.5');
        assert.strictEqual(webviewVersionOf(fx), '2.1.4-bd.5');
        assert.strictEqual(JSON.parse(fs.readFileSync(fx.lockPath, 'utf8')).packages[''].version, '2.1.4-bd.5');
    });

    test('rejects a pre-release tag the marketplace would bounce', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });
        const before = snapshot(fx);

        const run = runBump(fx, '2.1.4-beta.1');

        assert.strictEqual(run.status, 1);
        assert.ok(
            run.stderr.includes('is not major.minor.patch'),
            `expected the semver shape complaint: ${run.stderr}`
        );
        assert.deepStrictEqual(snapshot(fx), before);
    });

    test('refuses to reuse the version package.json already carries', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });
        const before = snapshot(fx);

        const run = runBump(fx, '2.2.0');

        assert.strictEqual(run.status, 1);
        assert.ok(
            run.stderr.includes('already at 2.2.0'),
            `expected the reuse complaint: ${run.stderr}`
        );
        assert.deepStrictEqual(snapshot(fx), before);
    });

    test('refuses to bump without a CHANGELOG heading, and writes nothing', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0', changelogHeadings: ['2.2.0'] });
        const before = snapshot(fx);

        const run = runBump(fx, '2.3.0');

        assert.strictEqual(run.status, 1);
        assert.ok(
            run.stderr.includes('missing a "## [2.3.0]" heading'),
            `expected the CHANGELOG complaint: ${run.stderr}`
        );
        assert.deepStrictEqual(snapshot(fx), before);
    });

    test('requires a version argument', () => {
        const fx = makeFixture({ pkgVersion: '2.2.0' });
        const before = snapshot(fx);

        const run = runBump(fx);

        assert.strictEqual(run.status, 1);
        assert.ok(
            run.stderr.includes('missing version argument'),
            `expected the missing-argument complaint: ${run.stderr}`
        );
        assert.deepStrictEqual(snapshot(fx), before);
    });

    test('matches the CHANGELOG heading literally, not as a wildcard', () => {
        // The dots are escaped before the heading regex is built. Drop that and
        // "## [22219]" satisfies a bump to 2.2.1.
        const fx = makeFixture({ pkgVersion: '2.2.0', changelogHeadings: ['22219'] });

        const run = runBump(fx, '2.2.1');

        assert.strictEqual(run.status, 1);
        assert.ok(
            run.stderr.includes('missing a "## [2.2.1]" heading'),
            `expected the CHANGELOG complaint: ${run.stderr}`
        );
    });

    test('SEMVER_RE accepts exactly what release-fork-vsix.sh accepts', () => {
        const jsMatch = fs.readFileSync(BUMP_SCRIPT, 'utf8')
            .match(/const SEMVER_RE = \/(.+)\/;/);
        if (!jsMatch) {
            assert.fail('could not find SEMVER_RE in scripts/bump-version.js');
        }
        const shMatch = fs.readFileSync(RELEASE_SCRIPT, 'utf8')
            .match(/\[\[ "\$VERSION" =~ (\S+) \]\]/);
        if (!shMatch) {
            assert.fail('could not find the version test in scripts/release-fork-vsix.sh');
        }

        const js = new RegExp(jsMatch[1]);
        const sh = new RegExp(shMatch[1]);

        assert.ok(js.test('2.2.1'), 'the shared shape must accept a plain X.Y.Z');
        assert.ok(!js.test('2.1.4-beta.1'), 'the shared shape must reject a pre-release tag');

        const samples = [
            '2.2.1', '0.0.0', '10.20.30', '02.2.1',
            '2.1.4-bd.0', '2.1.4-bd.5',
            '2.1.4-beta.1', '2.1.4-rc.1', '2.2.1-bd', '2.2.1-bd.', '2.2.1-BD.1',
            '2.2', '2.2.1.1', 'v2.2.1', 'abc', ''
        ];
        for (const sample of samples) {
            assert.strictEqual(
                js.test(sample),
                sh.test(sample),
                `the two copies disagree on "${sample}"`
            );
        }
    });
});
