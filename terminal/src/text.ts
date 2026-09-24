import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';

export function safeText(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return stripAnsi(text)
    .replace(/(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/gu, '')
    .replace(/(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[^\x1b\x9c]*(?:\x1b\\|\x9c|$)/gu, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]?/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\t/gu, '    ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu, '');
}

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function fitText(value: unknown, width: number): string {
  const limit = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const text = safeText(value).replace(/\n/gu, ' ');
  if (stringWidth(text) <= limit) { return text; }
  if (limit === 0) { return ''; }
  let result = '';
  let used = 0;
  for (const { segment } of segments.segment(text)) {
    const size = stringWidth(segment);
    if (used + size > limit - 1) { break; }
    result += segment;
    used += size;
  }
  return `${result}…`;
}
