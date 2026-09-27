import * as assert from 'assert';
import {
    buildDisplayTree, flattenVisibleRows, defaultExpanded, DEFAULT_TREE_SORT,
    TreeCardInput, TreeSortSpec
} from '../../shared/model';
import * as tree from '../../shared/treeBuilder';
import * as legacy from '../../webview/treeBuilder';

suite('shared tree public API', () => {
    test('public model and legacy entry points expose the same implementation', () => {
        assert.strictEqual(buildDisplayTree, tree.buildDisplayTree);
        assert.strictEqual(flattenVisibleRows, tree.flattenVisibleRows);
        assert.strictEqual(defaultExpanded, tree.defaultExpanded);
        assert.strictEqual(DEFAULT_TREE_SORT, tree.DEFAULT_TREE_SORT);
        assert.deepStrictEqual(legacy, tree);
    });

    test('duplicate input IDs use the last card for both parent and sort fields', () => {
        const cards: TreeCardInput[] = [
            { id: 'duplicate', parent: { id: 'old' }, priority: 0 },
            { id: 'old' },
            { id: 'new' },
            { id: 'sibling', parent: { id: 'new' }, priority: 1 },
            { id: 'duplicate', parent: { id: 'new' }, priority: 3 }
        ];
        const roots = buildDisplayTree(cards, new Set(cards.map(c => c.id)), { id: 'priority', dir: 'asc' });
        assert.deepStrictEqual(roots.map(n => n.id), ['new', 'old']);
        assert.deepStrictEqual(roots[0].children.map(n => n.id), ['sibling', 'duplicate']);
        assert.deepStrictEqual(roots[1].children, []);
        assert.deepStrictEqual(flattenVisibleRows(roots, () => true, false).map(r => r.id),
            ['new', 'sibling', 'duplicate', 'old']);
    });

    for (const id of ['title', 'priority', 'created_at', 'updated_at'] as const) {
        for (const dir of ['asc', 'desc'] as const) {
            test(`${id} ${dir} uses missing-field defaults and ascending ID ties`, () => {
                const cards: TreeCardInput[] = [
                    { id: 'z-missing' },
                    { id: 'a-default', title: '', priority: 2,
                        created_at: '1970-01-01T00:00:00Z', updated_at: '1970-01-01T00:00:00Z' },
                    { id: 'value', title: 'value', priority: 3,
                        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
                ];
                const roots = buildDisplayTree(cards, new Set(cards.map(c => c.id)), { id, dir });
                assert.deepStrictEqual(roots.map(n => n.id), dir === 'asc'
                    ? ['a-default', 'z-missing', 'value']
                    : ['value', 'a-default', 'z-missing']);
            });
        }
    }

    test('filter auto-expansion leaves cards, matches, sort, tree and overrides intact', () => {
        const cards: readonly TreeCardInput[] = Object.freeze([
            Object.freeze({ id: 'leaf', parent: Object.freeze({ id: 'child' }) }),
            Object.freeze({ id: 'root' }),
            Object.freeze({ id: 'child', parent: Object.freeze({ id: 'root' }) }),
            Object.freeze({ id: 'excluded', parent: Object.freeze({ id: 'root' }) })
        ]);
        const matched = new Set(['leaf', 'unknown']);
        const sort: TreeSortSpec = Object.freeze({ id: 'title', dir: 'asc' });
        const overrides: Readonly<Record<string, boolean>> = Object.freeze({ root: false, child: false });
        const beforeCards = JSON.stringify(cards);
        const roots = buildDisplayTree(cards, matched, sort);
        const beforeTree = JSON.stringify(roots);
        const expanded = (id: string, depth: number): boolean => overrides[id] ?? defaultExpanded(depth);
        const rows = flattenVisibleRows(roots, expanded, true);
        assert.deepStrictEqual(rows.map(r => [r.id, r.matches, r.expanded]), [
            ['root', false, true], ['child', false, true], ['leaf', true, false]
        ]);
        assert.deepStrictEqual(flattenVisibleRows(roots, expanded, false).map(r => r.id), ['root']);
        assert.strictEqual(JSON.stringify(cards), beforeCards);
        assert.strictEqual(JSON.stringify(roots), beforeTree);
        assert.deepStrictEqual([...matched], ['leaf', 'unknown']);
        assert.deepStrictEqual(sort, { id: 'title', dir: 'asc' });
        assert.deepStrictEqual(overrides, { root: false, child: false });
    });
});
