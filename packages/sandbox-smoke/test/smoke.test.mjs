import test from 'node:test';
import assert from 'node:assert/strict';
import { guardedBytes, slotCoreSource } from '../smoke.mjs';

const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('accepts only the exact known artifact fingerprint', () => {
  assert.equal(guardedBytes(Buffer.from('abc'), expected, 'fixture'), 'abc');
  assert.throws(() => guardedBytes(Buffer.from('abd'), expected, 'fixture'), /fingerprint mismatch.*fixture/u);
});

test('refuses absent, duplicate and changed SlotCore segments', () => {
  assert.throws(() => slotCoreSource('no known markers'), /boundaries/u);
  assert.throws(() => slotCoreSource('function kI(e){} function kI(e){} const jI='), /boundaries/u);
  assert.throws(() => slotCoreSource('function kI(e){} const jI='), /fingerprint mismatch.*SlotCore/u);
});
