import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchesStaffDepartmentView, readOrEnterStaffWorkspace, shouldApplyStaffAccessResponse, staffPermissionsChanged, type StaffPermissionSnapshot } from '../src/utils/staffAccess';

const reviewer: StaffPermissionSnapshot = {
  administratorEnabled: false,
  assignedDepartment: 'Fire',
  accessibleDepartments: ['Fire'],
};

test('detects server-confirmed permission changes independently of department array order', () => {
  assert.equal(staffPermissionsChanged(null, reviewer), false);
  assert.equal(staffPermissionsChanged(reviewer, { ...reviewer, accessibleDepartments: ['Fire'] }), false);
  assert.equal(staffPermissionsChanged(reviewer, {
    ...reviewer,
    administratorEnabled: true,
    accessibleDepartments: ['Building', 'Economic Development', 'Fire', 'Planning'],
  }), true);
  assert.equal(staffPermissionsChanged({
    ...reviewer,
    administratorEnabled: true,
    accessibleDepartments: ['Building', 'Fire'],
  }, {
    ...reviewer,
    administratorEnabled: true,
    accessibleDepartments: ['Fire', 'Building'],
  }), false);
});

test('ignores stale, aborted, and in-flight-toggle permission poll results', () => {
  assert.equal(shouldApplyStaffAccessResponse(4, 4, false, false), true);
  assert.equal(shouldApplyStaffAccessResponse(3, 4, false, false), false);
  assert.equal(shouldApplyStaffAccessResponse(4, 4, true, false), false);
  assert.equal(shouldApplyStaffAccessResponse(4, 4, false, true), false);
});

test('filters a staff queue to its selected department or explicit administrator-wide view', () => {
  assert.equal(matchesStaffDepartmentView(['Fire', 'Building'], 'Fire'), true);
  assert.equal(matchesStaffDepartmentView(['Fire', 'Building'], 'Planning'), false);
  assert.equal(matchesStaffDepartmentView(['Environmental Services'], 'Economic Development'), true);
  assert.equal(matchesStaffDepartmentView(['Building'], 'Master City Queue'), true);
});

test('entering City Staff enrolls the signed-in account when the server denies an unassigned role', async () => {
  let enrollments = 0;
  const profile = { administratorEnabled: true, accessibleDepartments: ['Planning', 'Building', 'Fire', 'Economic Development'] };
  const result = await readOrEnterStaffWorkspace(
    async () => { throw { status: 403 }; },
    async () => { enrollments += 1; return profile; },
    () => true,
  );
  assert.equal(result, profile);
  assert.equal(enrollments, 1);
});

test('existing City Staff permissions do not trigger another enrollment', async () => {
  let enrollments = 0;
  const result = await readOrEnterStaffWorkspace(
    async () => 'confirmed',
    async () => { enrollments += 1; return 'new'; },
    () => true,
  );
  assert.equal(result, 'confirmed');
  assert.equal(enrollments, 0);
});

test('signed-out, unavailable, and abandoned requests cannot trigger staff enrollment', async () => {
  for (const [status, active] of [[401, true], [503, true], [403, false]] as const) {
    let enrollments = 0;
    const error = { status };
    await assert.rejects(readOrEnterStaffWorkspace(
      async () => { throw error; },
      async () => { enrollments += 1; return 'unexpected'; },
      () => active,
    ), candidate => candidate === error);
    assert.equal(enrollments, 0);
  }
});