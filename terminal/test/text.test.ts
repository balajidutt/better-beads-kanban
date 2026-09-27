import assert from 'node:assert/strict';
import test from 'node:test';
import stringWidth from 'string-width';
import { safeText, fitText } from '../src/text';

test('terminal sequences, controls, bidi and incomplete escapes cannot reach output', () => {
  const hostile = 'hello\x1b[31mred\x1b[0m\x1b]52;c;cHduZWQ=\x07world\x9b2J\x00\x08\x7f\u202eevil\u2066';
  assert.equal(safeText(hostile), 'helloredworldevil');
  for (const text of ['\x1b[', '\x1b]52;c;unfinished', '\x9d52;c;secret\x9c', '\x1bPpayload\x1b\\', '\x1b\x1b[2J']) {
    assert.doesNotMatch(safeText(text), /[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u);
  }
  assert.equal(safeText('a\r\nb\rc\td'), 'a\nb\nc    d');
  assert.equal(safeText(null), '');
  assert.equal(safeText(42), '42');
});

test('fitText respects display cells and preserves whole Unicode graphemes', () => {
  assert.equal(fitText('你好世界', 5), '你好…');
  assert.equal(fitText('e\u0301e\u0301e\u0301', 2), 'e\u0301…');
  assert.equal(fitText('👩‍💻👩‍💻', 3), '👩‍💻…');
  assert.equal(fitText('abc', 0), '');
  assert.equal(fitText('abc', 1), '…');
  assert.equal(fitText('abc', -1), '');
  assert.equal(fitText('abc', NaN), '');
  assert.equal(fitText('a\nb', 3), 'a b');
  for (let width = 0; width < 30; width++) {
    const fitted = fitText('你好 👨‍👩‍👧‍👦 e\u0301 🇯🇵 \x1b[31mred\x1b[0m', width);
    assert.ok(stringWidth(fitted) <= width);
    assert.doesNotMatch(fitted, /\x1b/u);
  }
});
