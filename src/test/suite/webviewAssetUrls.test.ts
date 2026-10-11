import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getWebviewHtml } from '../../webview';

suite('Webview asset URLs change when the file is rebuilt', () => {
    let root: string;
    let panel: vscode.WebviewPanel;
    let webview: vscode.Webview;

    setup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'bbk-assets-'));
        fs.mkdirSync(path.join(root, 'out', 'webview'), { recursive: true });
        fs.writeFileSync(path.join(root, 'out', 'webview', 'board.js'), '');
        panel = vscode.window.createWebviewPanel('test', 'Test', vscode.ViewColumn.One, { enableScripts: true });
        webview = panel.webview;
    });

    teardown(() => {
        panel.dispose();
        fs.rmSync(root, { recursive: true, force: true });
    });

    const boardSrc = () => {
        const html = getWebviewHtml(webview, vscode.Uri.file(root));
        const src = /<script nonce="[^"]+" src="([^"]*board\.js[^"]*)"><\/script>/.exec(html)?.[1];
        assert.ok(src, 'board.js script tag not found');
        return src;
    };

    test('the board script URL keeps the release version and gains the file time', () => {
        const board = path.join(root, 'out', 'webview', 'board.js');
        fs.utimesSync(board, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
        assert.match(boardSrc(), /board\.js\?v=\d+\.\d+\.\d+\.1700000000000$/);
    });

    test('a rebuilt board script gets a different URL', () => {
        const board = path.join(root, 'out', 'webview', 'board.js');
        fs.utimesSync(board, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
        const before = boardSrc();
        fs.utimesSync(board, new Date(1_700_000_005_000), new Date(1_700_000_005_000));
        assert.notStrictEqual(boardSrc(), before);
    });

    test('a missing asset still gets the release version alone', () => {
        const html = getWebviewHtml(webview, vscode.Uri.file(root));
        assert.match(html, /graph-view\.js\?v=\d+\.\d+\.\d+"/);
    });
});
