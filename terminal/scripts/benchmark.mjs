import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildHarness, runReal, settle } from './integration.mjs';

const harness = await buildHarness();
const timed = action => {
  const start = performance.now();
  action();
  return performance.now() - start;
};

function fixture(count, depth, statusCount) {
  return Array.from({ length: count }, (_, index) => ({
    id: `bench-${index}`, title: `Synthetic issue ${index}`, description: `Description ${index}`,
    status: index % statusCount === 0 ? 'open' : `custom_${index % statusCount}`,
    issue_type: 'task', priority: 2, labels: ['benchmark'],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    parent: index > 0 && index < depth ? { id: `bench-${index - 1}`, title: `Synthetic issue ${index - 1}` } : undefined,
    children: [], blocked_by: [], blocks: [],
  }));
}

async function synthetic(count, depth, statusCount) {
  const cards = fixture(count + 1, depth, statusCount);
  let live = 0;
  let maxLive = 0;
  let detailCount = 0;
  const listLimits = [];
  const listMs = [];
  const service = {
    async list(limit) {
      listLimits.push(limit);
      const start = performance.now();
      await new Promise(resolve => setTimeout(resolve, 15));
      const result = structuredClone(cards.slice(0, limit));
      listMs.push(performance.now() - start);
      return result;
    },
    async detail(id) {
      detailCount++;
      maxLive = Math.max(maxLive, ++live);
      try {
        await new Promise(resolve => setTimeout(resolve, 25));
        return { ...cards.find(card => card.id === id), comments: [] };
      } finally { live--; }
    },
    dispose() {},
  };
  const heapBefore = process.memoryUsage().heapUsed;
  const controller = new harness.BrowserController(service, count);
  try {
    const start = performance.now();
    await controller.refresh();
    await settle(controller);
    const startupMs = performance.now() - start;
    assert.deepEqual(listLimits, [count + 1]);
    assert.equal(detailCount, 1);
    assert.equal(controller.getState().truncated, true);
    const projectionMs = timed(() => controller.setFilters({ statuses: controller.project().statuses }));
    await settle(controller);
    const projection = controller.project();
    assert.equal(projection.matching.length, count);
    assert.deepEqual(projection.columns.flatMap(column => column.cards.map(card => card.id)).sort(),
      projection.matching.map(card => card.id).sort());
    assert.ok(projection.columns.some(column => column.status === 'custom_1'));
    const views = {};
    controller.setView('kanban');
    for (const view of ['tree', 'table', 'kanban']) {
      const before = detailCount;
      const selected = controller.getState().selectedId;
      const switchMs = timed(() => controller.setView(view));
      assert.equal(controller.getState().selectedId, selected);
      assert.equal(detailCount, before);
      const cachedProjectionMs = timed(() => controller.project());
      const navigationMs = timed(() => {
        for (let index = 0; index < 100; index++) { controller.move(1); controller.project(); }
      });
      await settle(controller);
      assert.ok(detailCount - before <= 2, 'Rapid navigation coalesces to active and newest pending detail');
      assert.equal(controller.getState().detail.id, controller.getState().selectedId);
      views[view] = { switchMs, cachedProjectionMs, navigation100KeysMs: navigationMs,
        detailRequests: detailCount - before };
    }
    assert.equal(maxLive, 1);
    assert.deepEqual(listLimits, [count + 1]);
    console.log(JSON.stringify({ syntheticBenchmark: { count, depth, statusCount,
      mockListDelayMs: 15, mockDetailDelayMs: 25, startupMs, listMs, projectionMs, views,
      maxLiveControllerDetails: maxLive, detailCount, bdProcesses: 0,
      memoryMeasurement: 'Process heap snapshots, without forced GC; deltas include GC and harness allocations',
      heapBeforeBytes: heapBefore, heapAfterBytes: process.memoryUsage().heapUsed,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore } }, null, 2));
  } finally { controller.dispose(); }
}

async function rejectedHierarchy() {
  const good = fixture(10, 2, 1);
  const rejected = fixture(5000, 5000, 1);
  let snapshot = good;
  const listLimits = [];
  const unhandled = [];
  const onUnhandled = reason => { unhandled.push(String(reason)); };
  const controller = new harness.BrowserController({
    async list(limit) { listLimits.push(limit); return snapshot.slice(0, limit); },
    async detail(id) {
      await new Promise(resolve => setTimeout(resolve, 25));
      return { ...good.find(card => card.id === id), comments: [] };
    },
    dispose() {},
  }, 5000);
  process.on('unhandledRejection', onUnhandled);
  try {
    await controller.refresh();
    await settle(controller);
    controller.toggle();
    controller.setViewport('tree', 2);
    const before = controller.getState();
    const projection = controller.project();
    snapshot = rejected;
    const started = performance.now();
    const deadline = started + 60000;
    let refreshSettled = false;
    const refresh = controller.refresh().finally(() => { refreshSettled = true; });
    while (!refreshSettled || controller.getState().loading || controller.getState().detailLoading) {
      assert.ok(performance.now() < deadline, 'Rejected hierarchy refresh did not settle within 60 seconds');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await refresh;
    await new Promise(resolve => setImmediate(resolve));
    const rejectionAndDetailMs = performance.now() - started;
    const after = controller.getState();
    assert.equal(after.stale, true);
    assert.equal(after.error, harness.HIERARCHY_DEPTH_ERROR);
    assert.equal(after.loading, false);
    assert.equal(after.detailLoading, false);
    assert.equal(after.detailError, null);
    assert.equal(after.cards, before.cards, 'Rejected snapshot must not replace last good cards');
    for (const field of ['selectedId', 'lastRefresh', 'truncated', 'view']) {
      assert.equal(after[field], before[field], `Preserve ${field}`);
    }
    for (const field of ['filters', 'expanded', 'viewports', 'detail']) {
      assert.deepEqual(after[field], before[field], `Preserve ${field}`);
    }
    assert.deepEqual(controller.project(), projection);
    assert.deepEqual(listLimits, [5001, 5001]);
    assert.deepEqual(unhandled, [], 'Hierarchy rejection must not produce unhandled rejections');
    console.log(JSON.stringify({ rejectedHierarchyBenchmark: {
      count: rejected.length, loadedAncestors: rejected.length - 1,
      maxLoadedAncestors: harness.MAX_LOADED_ANCESTORS, rejectionAndDetailMs,
      error: after.error, stale: after.stale, preservedCards: after.cards.length,
      preservedSelection: after.selectedId, unhandledRejections: unhandled.length,
    } }, null, 2));
  } finally {
    controller.dispose();
    process.off('unhandledRejection', onUnhandled);
  }
}

try {
  assert.equal(harness.MAX_LOADED_ANCESTORS, 512);
  assert.equal(typeof harness.HIERARCHY_DEPTH_ERROR, 'string');
  await runReal(harness);
  const supportedChainNodes = harness.MAX_LOADED_ANCESTORS + 1;
  for (const [count, depth, statuses] of [[1000, 1, 5], [5000, 1, 5],
    [supportedChainNodes, supportedChainNodes, 5], [5000, 100, 64]]) {
    await synthetic(count, depth, statuses);
  }
  await rejectedHierarchy();
} finally { harness.cleanup(); }
