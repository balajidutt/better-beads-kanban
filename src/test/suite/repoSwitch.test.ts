import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Repository switch reaches the open board', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    let extensionTs: string;
    let boardJs: string;

    suiteSetup(() => {
        extensionTs = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
        boardJs = fs.readFileSync(path.join(root, 'src', 'webview', 'board.js'), 'utf8');
    });

    function functionBody(source: string, start: string): string {
        const from = source.indexOf(start);
        assert.ok(from >= 0, `missing ${start}`);
        return source.slice(from, source.indexOf('\n  };', from));
    }

    test('one retarget sequence rebinds watchers and reloads every attached board', () => {
        const body = functionBody(extensionTs, 'const retargetRepository = ');
        assert.match(body, /setWorkspaceRoot\(root\)/);
        assert.match(body, /for \(const board of attachedBoards\.values\(\)\) \{\s*board\.rebindWatchers\(root\);\s*board\.reload\(\);/);
    });

    test('each board registers itself for retargeting until it is disposed', () => {
        const wire = extensionTs.slice(extensionTs.indexOf('const wireBoardPanel = '), extensionTs.indexOf('const openCmd = '));
        assert.match(wire, /attachedBoards\.set\(panel, \{ rebindWatchers: attachWatchers, reload: resendBoard \}\)/);
        const dispose = wire.slice(wire.indexOf("output.appendLine('[Extension] Panel disposed')"));
        assert.match(dispose, /attachedBoards\.delete\(panel\)/);
    });

    test('the repository picker and the workspace-folder listener both use it', () => {
        assert.match(functionBody(extensionTs, 'const selectBeadsRepository = '), /retargetRepository\(folderPath\)/);
        assert.match(extensionTs, /onDidChangeWorkspaceFolders\([\s\S]{0,800}?retargetRepository\(resolution\.root\)/);
    });

    test('the toolbar repo.select handler leaves the reload to the shared path', () => {
        const start = extensionTs.indexOf('msg.type === "repo.select"');
        assert.ok(start >= 0, 'missing repo.select handler');
        const body = extensionTs.slice(start, extensionTs.indexOf('msg.type ===', start + 1));
        assert.match(body, /selectBeadsRepository\(\)/);
        assert.doesNotMatch(body, /getBoard\(|board\.data/);
    });

    test('board.data fills the card cache that Table and Tree read', () => {
        const handler = boardJs.slice(boardJs.indexOf('msg.type === "board.data"'), boardJs.indexOf('msg.type === "board.minimal"'));
        assert.match(handler, /cardCache\.clear\(\)/);
        assert.match(handler, /cardCache\.set\(card\.id, card\)/);
    });
});
