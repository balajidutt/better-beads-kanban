import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('Board panel survives an extension host restart', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    let extensionTs: string;
    let manifest: { activationEvents?: string[] };

    suiteSetup(() => {
        extensionTs = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
        manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    });

    test('the extension activates when VS Code restores a board panel', () => {
        assert.ok(manifest.activationEvents?.includes('onWebviewPanel:beadsKanban.board'));
    });

    test('a serializer for the board view type re-wires the restored panel', () => {
        const start = extensionTs.indexOf('registerWebviewPanelSerializer("beadsKanban.board"');
        assert.ok(start >= 0, 'no serializer registered for beadsKanban.board');
        const body = extensionTs.slice(start, extensionTs.indexOf('}));', start));
        assert.match(body, /wireBoardPanel\(panel, resolution, adapter\)/);
        assert.match(body, /panel\.dispose\(\)/, 'a panel that cannot be wired must be closed, not left inert');
    });

    test('opening a board and restoring one share the same wiring', () => {
        const open = extensionTs.slice(extensionTs.indexOf('registerCommand("beadsKanban.openBoard"'), extensionTs.indexOf('context.subscriptions.push(openCmd)'));
        assert.match(open, /createWebviewPanel\(\s*"beadsKanban\.board"/);
        assert.match(open, /wireBoardPanel\(panel, resolution, adapter\)/);
        assert.doesNotMatch(open, /onDidReceiveMessage/, 'panel wiring belongs in wireBoardPanel, not inline in openBoard');
    });

    test('a restored board warns about a missing or ambiguous repository like an opened one', () => {
        const restore = extensionTs.slice(extensionTs.indexOf('registerWebviewPanelSerializer("beadsKanban.board"'), extensionTs.indexOf('const replaceStaleBoards = '));
        const open = extensionTs.slice(extensionTs.indexOf('registerCommand("beadsKanban.openBoard"'), extensionTs.indexOf('context.subscriptions.push(openCmd)'));
        assert.match(restore, /warnAboutResolution\(resolution\)/);
        assert.match(open, /warnAboutResolution\(resolution\)/);
    });

    test('every wired panel is counted while it lives', () => {
        const wire = extensionTs.slice(extensionTs.indexOf('const wireBoardPanel = '), extensionTs.indexOf('panel.webview.options'));
        assert.match(wire, /livePanels\.add\(panel\)/);
        assert.match(wire, /panel\.onDidDispose\(\(\) => livePanels\.delete\(panel\)\)/);
    });

    test('board tabs without a live panel are closed and replaced by one fresh board', () => {
        const start = extensionTs.indexOf('const replaceStaleBoards = ');
        assert.ok(start >= 0, 'no stale-board replacement');
        const body = extensionTs.slice(start, extensionTs.indexOf('\n  };', start));
        assert.match(body, /if \(boardTabs\.length === 0 \|\| livePanels\.size > 0\) \{\s*return;/, 'a revived board means hidden tabs are still revivable');
        assert.match(body, /tabGroups\.close\(boardTabs\)/);
        assert.match(body, /executeCommand\("beadsKanban\.openBoard"\)/);
        assert.match(extensionTs, /setTimeout\(\(\) => \{\s*replaceStaleBoards\(\)/, 'the check must run after activation');
    });

    test('webview tabs report the prefixed view type the stale-board filter matches', async () => {
        assert.match(extensionTs, /"mainThreadWebview-beadsKanban\.board"/);
        const panel = vscode.window.createWebviewPanel('beadsKanbanTabProbe', 'probe', vscode.ViewColumn.One, {});
        try {
            let webviewTypes: string[] = [];
            for (let attempt = 0; attempt < 40 && webviewTypes.length === 0; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                const inputs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => tab.input);
                webviewTypes = inputs.filter((input): input is vscode.TabInputWebview => input instanceof vscode.TabInputWebview).map((input) => input.viewType);
            }
            assert.ok(webviewTypes.includes('mainThreadWebview-beadsKanbanTabProbe'), `webview tab types: ${webviewTypes.join(', ')}`);
        } finally {
            panel.dispose();
        }
    });
});
