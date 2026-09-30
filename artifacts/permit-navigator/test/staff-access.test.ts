import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchesStaffDepartmentView, shouldApplyStaffAccessResponse, staffPermissionsChanged, type StaffPermissionSnapshot } from '../src/utils/staffAccess';

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