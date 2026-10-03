import * as assert from 'assert';
import {
  capabilitiesFor, compareBdVersions, isBelowMinimumBdVersion, mayMigrateOnOpen, parseBdVersion
} from '../../shared/node';
import { RECORDED_BD_VERSIONS, loadFixture } from './bdFixtures';

const v = (text: string) => {
  const parsed = parseBdVersion(text);
  assert.ok(parsed, text);
  return parsed;
};

suite('bd version parsing and capabilities', () => {
  test('parses plain, v-prefixed, prerelease and build forms', () => {
    assert.deepStrictEqual(parseBdVersion('1.3.1'), { major: 1, minor: 3, patch: 1, prerelease: null, raw: '1.3.1' });
    assert.strictEqual(parseBdVersion('v1.2.2')?.patch, 2);
    assert.strictEqual(parseBdVersion('1.3.1-rc.2')?.prerelease, 'rc.2');
    assert.strictEqual(parseBdVersion('1.3.1+build.7')?.prerelease, null);
    assert.strictEqual(parseBdVersion(' 1.3.1\n')?.raw, '1.3.1');
  });

  test('rejects anything that is not a version', () => {
    for (const value of ['', 'dev', '1.3', '1.3.x', null, undefined, 42, {}, { version: 7 }, []]) {
      assert.strictEqual(parseBdVersion(value), undefined, JSON.stringify(value));
    }
  });

  test('reads the recorded bd version --json output of each version', () => {
    for (const version of RECORDED_BD_VERSIONS) {
      assert.strictEqual(parseBdVersion(loadFixture(version, 'version.json'))?.raw, version);
    }
  });

  test('orders by number, with a prerelease before its release', () => {
    assert.ok(compareBdVersions(v('1.2.2'), v('1.3.0')) < 0);
    assert.ok(compareBdVersions(v('1.10.0'), v('1.9.9')) > 0);
    assert.ok(compareBdVersions(v('1.3.0-rc.2'), v('1.3.0')) < 0);
    assert.ok(compareBdVersions(v('1.3.0-rc.1'), v('1.3.0-rc.2')) < 0);
    assert.ok(compareBdVersions(v('1.3.0-rc.9'), v('1.3.0-rc.10')) < 0);
    assert.ok(compareBdVersions(v('1.3.0-1'), v('1.3.0-alpha')) < 0);
    assert.ok(compareBdVersions(v('1.3.0-rc'), v('1.3.0-rc.1')) < 0);
    assert.strictEqual(compareBdVersions(v('v1.3.1'), v('1.3.1')), 0);
  });

  test('1.3-only capabilities start at the 1.3.0 release', () => {
    const none = { closePolicy: false, ifStatus: false, briefDeps: false, leases: false, eventsJournal: false };
    const all = { closePolicy: true, ifStatus: true, briefDeps: true, leases: true, eventsJournal: true };
    assert.deepStrictEqual(capabilitiesFor(v('1.2.2')), { version: '1.2.2', ...none });
    assert.deepStrictEqual(capabilitiesFor(v('1.3.0-rc.2')), { version: '1.3.0-rc.2', ...none });
    assert.deepStrictEqual(capabilitiesFor(v('1.3.0')), { version: '1.3.0', ...all });
    assert.deepStrictEqual(capabilitiesFor(v('1.3.1')), { version: '1.3.1', ...all });
    assert.deepStrictEqual(capabilitiesFor(undefined), { version: null, ...none });
  });

  test('only a parsed version below 1.2.2 is below the floor', () => {
    assert.ok(isBelowMinimumBdVersion(v('1.2.1')));
    assert.ok(isBelowMinimumBdVersion(v('1.2.2-rc.1')));
    assert.ok(!isBelowMinimumBdVersion(v('1.2.2')));
    assert.ok(!isBelowMinimumBdVersion(v('1.3.1')));
    assert.ok(!isBelowMinimumBdVersion(undefined));
  });

  test('a store may migrate unless .local_version names the installed bd', () => {
    assert.ok(!mayMigrateOnOpen(v('1.3.1'), '1.3.1'));
    assert.ok(mayMigrateOnOpen(v('1.3.1'), '1.2.2'));
    assert.ok(mayMigrateOnOpen(v('1.3.1'), null));
    assert.ok(mayMigrateOnOpen(v('1.3.1'), 'garbage'));
    assert.ok(mayMigrateOnOpen(undefined, '1.3.1'));
  });
});
