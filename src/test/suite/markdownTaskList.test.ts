import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Markdown task-list checkboxes', () => {
    const stylesPath = path.resolve(__dirname, '..', '..', '..', 'media', 'styles.css');

    let styles: string;

    suiteSetup(() => {
        styles = fs.readFileSync(stylesPath, 'utf8');
    });

    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
        assert.ok(match, `missing CSS rule for ${selector}`);
        return match[1];
    }

    test('task-list checkboxes opt out of the full-width dialog input style', () => {
        const body = ruleBody('.markdown-body li > input[type="checkbox"]');
        assert.match(body, /width:\s*auto/, 'checkbox must not inherit .dialogForm input width: 100%');
        assert.match(body, /margin:\s*0\b/, 'checkbox must not inherit the dialog input vertical margins');
        assert.match(body, /border:\s*0/, 'checkbox must not inherit the dialog input border');
    });

    test('task-list items drop the bullet the checkbox replaces', () => {
        assert.match(ruleBody('.markdown-body li:has(> input[type="checkbox"])'), /list-style:\s*none/);
    });
});
