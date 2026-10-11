'use strict';

/** esbuild's column is a 0-based UTF-8 byte offset; VS Code wants a 1-based UTF-16 column. */
function columnOf(location) {
  return Buffer.from(location.lineText, 'utf8').subarray(0, location.column).toString('utf8').length + 1;
}

/**
 * esbuild plugin that prints each error and warning as `file:line:column: severity: message`,
 * the one-line form the watch tasks' problem matcher in .vscode/tasks.json reads. esbuild's own
 * report puts the location on a separate line, which that matcher cannot see.
 */
function problemLines(write = line => console.log(line)) {
  return {
    name: 'problem-lines',
    setup(build) {
      build.onEnd(result => {
        for (const [severity, messages] of [['error', result.errors], ['warning', result.warnings]]) {
          for (const { text, location } of messages) {
            if (!location) { continue; }
            write(`${location.file}:${location.line}:${columnOf(location)}: ${severity}: ${text.replace(/\s*\n\s*/g, ' ')}`);
          }
        }
      });
    }
  };
}

module.exports = { problemLines };
