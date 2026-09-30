import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getApplicationErrorStatus, hasConfirmedLiveQueue, isSampleFallbackRows } from '../src/hooks/useApplicationRecords';
import { isDemoSeedApplicationId } from '../src/utils/applicationResilience';

const record = (id: string, source: unknown = 'sample-fallback') => ({
  id,
  businessName: 'Sample application',
  plan: { _dataSource: source },
});

test('accepts a complete marked sample fallback response', () => {
  assert.equal(isSampleFallbackRows([record('SAMPLE-1'), record('SAMPLE-2')]), true);
});

test('does not classify live, empty, malformed, or mixed record lists as a sample fallback', () => {
  assert.equal(isSampleFallbackRows([]), false);
  assert.equal(isSampleFallbackRows([record('LIVE-1', 'live')]), false);
  assert.equal(isSampleFallbackRows([record('SAMPLE-1'), record('LIVE-1', 'live')]), false);
  assert.equal(isSampleFallbackRows([{ id: 'SAMPLE-1', plan: {} }]), false);
  assert.equal(isSampleFallbackRows(null), false);
});

test('recognizes only explicit authorization response statuses', () => {
  assert.equal(getApplicationErrorStatus({ status: 401 }), 401);
  assert.equal(getApplicationErrorStatus({ status: 403 }), 403);
  assert.equal(getApplicationErrorStatus(new Error('network unavailable')), undefined);
  assert.equal(getApplicationErrorStatus({ status: '403' }), undefined);
});

test('recognizes only persisted demonstration seed IDs as seeded records', () => {
  assert.equal(isDemoSeedApplicationId('DEMO-D2-0001'), true);
  assert.equal(isDemoSeedApplicationId('DEMO-D2-24'), false);
  assert.equal(isDemoSeedApplicationId('DEMO-D3-0001'), false);
  assert.equal(isDemoSeedApplicationId('application-uuid-1'), false);
});

test('a confirmed empty live queue remains confirmed for outage handling', () => {
  const emptyLiveQueue = { records: [], lastConfirmedAt: 1_700_000_000_000 };
  assert.equal(hasConfirmedLiveQueue(emptyLiveQueue), true);
  assert.equal(hasConfirmedLiveQueue({ lastConfirmedAt: null }), false);
  assert.equal(hasConfirmedLiveQueue(null), false);
});