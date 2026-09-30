import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normalizeApplicationPlan } from '../src/utils/newplan-normalizer';

const record = {
  id: 'SJ-APP-1001',
  businessName: 'Existing storefront',
  status: 'Approved',
  createdAt: '2026-02-03T10:00:00Z',
  updatedAt: '2026-02-03T11:00:00Z',
  submittedAt: '2026-02-03T10:30:00Z',
};

const intake = {
  businessName: 'Existing storefront',
  businessType: 'restaurant',
  businessOther: '',
  address: '123 Main Street',
  zip: '95113',
  description: 'Update the existing storefront.',
  modifications: ['signage'],
  modificationOther: '',
  legacyIntakeField: 'preserved',
};

test('normalizes old approved records with missing review collections without changing source data', () => {
  const original = { status: 'Approved', intake: { ...intake }, notes: { existing: 'kept' }, customPlanField: 42 };
  const before = structuredClone(original);
  const { plan, detailIssue } = normalizeApplicationPlan(original, record);

  assert.equal(detailIssue, null);
  assert.deepEqual(plan.matched, []);
  assert.deepEqual(plan.rejected, []);
  assert.deepEqual(plan.overrides, {});
  assert.deepEqual(plan.notes, { existing: 'kept' });
  assert.equal(plan.customPlanField, 42);
  assert.equal(plan.intake.legacyIntakeField, 'preserved');
  assert.deepEqual(original, before);
});

test('preserves existing requirement decisions, notes, and overrides', () => {
  const original = {
    intake: { ...intake },
    matched: ['zoning-clearance', 'building-permits'],
    rejected: ['building-permits'],
    notes: { 'zoning-clearance': 'Reviewed' },
    overrides: { 'building-permits': 'Use revised plans.' },
  };
  const { plan } = normalizeApplicationPlan(original, record);

  assert.deepEqual(plan.matched, original.matched);
  assert.deepEqual(plan.rejected, original.rejected);
  assert.deepEqual(plan.notes, original.notes);
  assert.deepEqual(plan.overrides, original.overrides);
});

test('keeps the authoritative application ID when a legacy plan contains a different local ID', () => {
  const original = { id: 'old-local-plan-id', intake: { ...intake } };
  const { plan } = normalizeApplicationPlan(original, record);
  assert.equal(plan.id, record.id);
  assert.equal(original.id, 'old-local-plan-id');
});

test('safely defaults missing and malformed decision collections for catalog rendering', () => {
  const { plan } = normalizeApplicationPlan({
    intake: { ...intake, modifications: undefined },
    matched: undefined,
    rejected: null,
    notes: [],
    overrides: undefined,
  }, record);

  assert.deepEqual(plan.matched, []);
  assert.deepEqual(plan.rejected, []);
  assert.deepEqual(plan.notes, {});
  assert.deepEqual(plan.overrides, {});
  assert.deepEqual(plan.intake.modifications, []);
});

test('reports incomplete required intake explicitly instead of inventing details', () => {
  const original = { intake: { ...intake, address: undefined, description: undefined } };
  const before = structuredClone(original);
  const { plan, detailIssue } = normalizeApplicationPlan(original, record);

  assert.match(detailIssue ?? '', /details are incomplete/);
  assert.equal(plan.intake.address, '');
  assert.equal(plan.intake.description, '');
  assert.notEqual(detailIssue, null);
  assert.deepEqual(original, before);
});