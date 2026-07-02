import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokingResource } from '../src/lib/invoker.ts';

test('returns undefined off the FXServer runtime (no GetInvokingResource native)', () => {
  // The native isn't defined under node --test, so attribution is best-effort.
  assert.equal(typeof (globalThis as any).GetInvokingResource, 'undefined');
  assert.equal(invokingResource(), undefined);
});

test('returns the native result, treating empty string as undefined', () => {
  const g = globalThis as any;
  try {
    g.GetInvokingResource = () => 'esx_banking';
    assert.equal(invokingResource(), 'esx_banking');
    g.GetInvokingResource = () => '';
    assert.equal(invokingResource(), undefined); // '' (no caller) collapses to undefined
  } finally {
    delete g.GetInvokingResource;
  }
});
