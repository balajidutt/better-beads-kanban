import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Read-only mode and the detail dialog', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    let extensionTs: string;
    let boardJs: string;

    suiteSetup(() => {
        extensionTs = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
        boardJs = fs.readFileSync(path.join(root, 'src', 'webview', 'board.js'), 'utf8');
    });

    test('the discard confirmation is answered before the read-only mutation gate', () => {
        const confirm = extensionTs.indexOf('msg.type === "ui.confirmDiscard"');
        const gate = extensionTs.indexOf('error: "Extension is in read-only mode."');
        assert.ok(confirm > 0 && gate > 0, 'handler or gate not found');
        assert.ok(confirm < gate, 'ui.confirmDiscard must be handled before the read-only gate, or a dirty dialog cannot close');
    });

    test('both board.minimal posts tell the webview whether it is read-only', () => {
        const posts = extensionTs.match(/post\(\{ type: "board\.minimal"[^\n]*/g) ?? [];
        assert.strictEqual(posts.length, 2);
        for (const post of posts) {
            assert.match(post, /\{ cards, readOnly, uiState \} : \{ cards, readOnly \}/, post);
        }
    });

    test('the webview applies readOnly from board.minimal', () => {
        assert.match(boardJs, /msg\.type === "board\.minimal"[\s\S]{0,3000}?readOnly = msg\.payload\.readOnly/);
    });

    test('a failed discard confirmation settles instead of throwing', () => {
        assert.match(boardJs, /function confirmDiscard\(\)[\s\S]{0,600}?reject: \(\) => resolve\(false\)/);
    });

    test('the new-issue shortcut respects read-only mode', () => {
        assert.match(boardJs, /e\.key\.toLowerCase\(\) === 'n'[\s\S]{0,120}?if \(!readOnly\) \{\s*newBtn\.click\(\);/);
    });
});
