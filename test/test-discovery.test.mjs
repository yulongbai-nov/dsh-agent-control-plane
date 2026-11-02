import test from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('root test command covers every root and package test filename', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const command = pkg.scripts.test;
  assert.match(command, /^node --test /, 'update this discovery check if the runner changes');
  const patterns = command.slice('node --test '.length).split(/\s+/);
  const discovered = new Set(patterns.flatMap(pattern => globSync(pattern, { cwd: root })));
  const expected = globSync('{test,packages/*/test}/**/*.test.{js,cjs,mjs}', { cwd: root });
  assert.ok(expected.length > 0, 'test inventory unexpectedly empty');
  const omitted = expected.filter(path => !discovered.has(path));
  assert.deepEqual(omitted, [], `root test command omits: ${omitted.join(', ')}`);
});
