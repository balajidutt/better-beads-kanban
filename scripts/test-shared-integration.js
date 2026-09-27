'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createScratchWorkspace, BD, SPAWN_DEFAULTS } = require('./lib/bd-scratch-workspace');
const { buildSharedTests } = require('./lib/shared-test-build');

async function main() {
  const version = spawnSync(BD, ['version'], SPAWN_DEFAULTS);
  if (version.error || version.status !== 0) {
    throw new Error(`Real bd is required: ${version.error?.message || version.stderr}`);
  }
  console.log(version.stdout.trim());
  const build = buildSharedTests(false);
  let workspace;
  try {
    const { BeadsReader, executeBd } = require(path.join(build.output, 'shared/node.js'));
    assert.equal(typeof executeBd, 'function', 'Public Node entry must export executeBd');
    workspace = createScratchWorkspace('shared');
    const seed = (...args) => {
      const result = spawnSync(BD, [...workspace.bdArgs, '--sandbox', ...args], {
        ...SPAWN_DEFAULTS, cwd: workspace.dir
      });
      if (result.error || result.status !== 0) {
        throw new Error(`Scratch fixture setup failed (${args[0]}): ${result.error?.message || result.stderr}`);
      }
      return result.stdout.trim();
    };
    const create = (title, ...args) => seed('create', '--title', title, '--silent', ...args);
    const description = 'First paragraph with unicode: café.\n\nSecond paragraph with **Markdown**, "quotes" and a literal $HOME.';
    const design = 'Design line one\nDesign line two';
    const acceptance = 'Acceptance line one\nAcceptance line two';
    const notes = 'Notes with `code` and an ampersand &.';
    const comment = 'Shared integration comment\nwith a second line.';
    const parent = create('Parent fixture', '--type', 'epic');
    const blocker = create('Blocking fixture');
    const child = create('Child fixture', '--parent', parent,
      '--description', description, '--design', design, '--acceptance', acceptance,
      '--notes', notes, '--labels', 'shared-fixture,read-contract');
    seed('dep', 'add', child, blocker);
    seed('comments', 'add', child, comment);
    const seededComments = JSON.parse(seed('comments', child, '--json'));
    assert.deepEqual(seededComments.map(value => ({ text: value.text, issue_id: value.issue_id })),
      [{ text: comment, issue_id: child }]);
    const closedParent = create('Closed parent fixture', '--type', 'epic');
    seed('close', closedParent, '--reason', 'Closed parent fixture');
    const activeChild = create('Active child fixture', '--parent', closedParent);
    const calls = [];
    const responses = [];
    const reader = new BeadsReader(async args => {
      calls.push(args);
      assert.ok(args[0] === 'list' || args[0] === 'show', 'Reader must issue only list/show');
      const result = await executeBd(['--sandbox', '--readonly', '--dolt-auto-commit', 'off', ...args], {
        executable: BD, cwd: workspace.dir, timeoutMs: 30000, jsonPolicy: 'strict'
      });
      responses.push(result);
      return result;
    }, { strict: true });

    const board = await reader.getBoardMinimal(100);
    assert.deepEqual(calls[0], ['list', '--json', '--all', '--limit', '100']);
    assert.deepEqual(board.map(card => card.id).sort(), [parent, blocker, child, closedParent, activeChild].sort());
    const listed = id => {
      const card = board.find(card => card.id === id);
      assert.ok(card, `Expected board issue ${id}`);
      return card;
    };
    assert.equal(listed(child).parent?.id, parent);
    assert.ok(listed(child).blocked_by.some(ref => ref.id === blocker));
    assert.ok(listed(blocker).blocks.some(ref => ref.id === child));
    assert.ok(listed(parent).children.some(ref => ref.id === child));
    assert.deepEqual([...listed(child).labels].sort(), ['read-contract', 'shared-fixture']);
    assert.equal(listed(closedParent).status, 'closed');
    assert.equal(listed(activeChild).status, 'open');
    assert.equal(listed(activeChild).parent?.id, closedParent);

    const full = await reader.getIssueFull(child);
    assert.deepEqual(calls[1], ['show', '--json', child]);
    assert.equal(full.id, child);
    assert.equal(full.description, description);
    assert.equal(full.design, design);
    assert.equal(full.acceptance_criteria, acceptance);
    assert.equal(full.notes, notes);
    assert.deepEqual([...full.labels].sort(), ['read-contract', 'shared-fixture']);
    assert.equal(full.parent?.id, parent);
    assert.deepEqual(full.blocked_by.map(ref => ref.id), [blocker]);
    if (responses[1][0].comments === undefined) {
      assert.deepEqual(full.comments, []);
      console.log('CLI contract limitation: show omits comment bodies; seeded comment verified separately during fixture setup');
    } else {
      assert.deepEqual(full.comments.map(value => ({ text: value.text, issue_id: value.issue_id })),
        [{ text: comment, issue_id: child }]);
    }
    const fullParent = await reader.getIssueFull(parent);
    const fullBlocker = await reader.getIssueFull(blocker);
    const fullClosedParent = await reader.getIssueFull(closedParent);
    assert.equal(fullClosedParent.status, 'closed');
    for (const [index, refs, expected] of [
      [2, fullParent.children, child], [3, fullBlocker.blocks, child],
      [4, fullClosedParent.children, activeChild]
    ]) {
      if (responses[index][0].dependents === undefined) {
        assert.deepEqual(refs, []);
        console.log('CLI contract limitation: show omits reverse-edge details; list snapshot relationships verified');
      } else {
        assert.ok(refs.some(ref => ref.id === expected));
      }
    }
    const fullActiveChild = await reader.getIssueFull(activeChild);
    assert.equal(fullActiveChild.status, 'open');
    assert.equal(fullActiveChild.parent?.id, closedParent);
    assert.deepEqual(calls, [
      ['list', '--json', '--all', '--limit', '100'],
      ...[child, parent, blocker, closedParent, activeChild].map(id => ['show', '--json', id])
    ]);
    console.log('Shared real-bd integration passed: exact list/show, relationships, closed parent/active child, labels, comments and full text');
  } finally {
    workspace?.destroy();
    build.cleanup();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
