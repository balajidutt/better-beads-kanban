import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Source checks only: the webview has no DOM test environment, so rendering is covered in the Chrome mock harness.
suite('A refused compare-and-set drag is shown as information', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    let boardJs: string;
    let stylesCss: string;

    suiteSetup(() => {
        boardJs = fs.readFileSync(path.join(root, 'src', 'webview', 'board.js'), 'utf8');
        stylesCss = fs.readFileSync(path.join(root, 'media', 'styles.css'), 'utf8');
    });

    const mutationErrorHandler = () => {
        const start = boardJs.indexOf('if (msg.type === "mutation.error") {');
        const end = boardJs.indexOf('if (msg.type === "table.pageData")', start);
        assert.ok(start > 0 && end > start, 'mutation.error handler not found');
        return boardJs.slice(start, end);
    };

    test('every toast sets or clears the info style, so it never carries over to the next one', () => {
        assert.match(boardJs, /function toast\(msg, actionName, actionCb, kind\) \{\s*clearTimeout\(toastHideTimer\);\s*toastEl\.replaceChildren\(\);\s*toastEl\.classList\.toggle\("toast-info", kind === "info"\);/);
    });

    test('status_changed with no pending request gets an info toast with no action, before the failure toast', () => {
        const handler = mutationErrorHandler();
        const branch = handler.match(/if \(msg\.code === "status_changed" && !pending\) \{\s*toast\(([^;]*)\);\s*return;\s*\}/);
        assert.ok(branch, 'status_changed branch not found');
        assert.match(branch[1], /, null, null, "info"$/);
        assert.ok(handler.indexOf(branch[0]) < handler.indexOf('toast(msg.error || "Operation failed.")'));
    });

    test('close_refused drags keep their Close anyway retry', () => {
        assert.match(mutationErrorHandler(), /toast\(msg\.error \|\| "Close refused\.", "Close anyway", \(\) => \{/);
    });

    test('the info style has its own accent', () => {
        assert.match(stylesCss, /\.toast\.toast-info \{[^}]*border-left: 4px solid var\(--vscode-notificationsInfoIcon-foreground/);
    });
});
