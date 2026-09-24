'use strict';

const Mocha = require('mocha');
const { buildSharedTests } = require('./lib/shared-test-build');

const build = buildSharedTests();
const mocha = new Mocha({ ui: 'tdd', timeout: 10000, failZero: true });
for (const file of build.tests) { mocha.addFile(file); }
try {
  mocha.run(failures => {
    build.cleanup();
    process.exitCode = failures ? 1 : 0;
  });
} catch (error) {
  build.cleanup();
  throw error;
}
