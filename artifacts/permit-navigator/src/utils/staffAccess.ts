export type StaffPermissionSnapshot = {
  administratorEnabled: boolean;
  assignedDepartment: string;
  accessibleDepartments: readonly string[];
};

export type StaffDepartmentView = string | 'Master City Queue';

export function shouldApplyStaffAccessResponse(
  requestId: number,
  latestRequestId: number,
  mutationInProgress: boolean,
  requestAborted: boolean,
): boolean {
  return requestId === latestRequestId && !mutationInProgress && !requestAborted;
}

export function staffPermissionsChanged(
  previous: StaffPermissionSnapshot | null,
  next: StaffPermissionSnapshot,
): boolean {
  if (!previous) return false;
  return previous.administratorEnabled !== next.administratorEnabled
    || previous.assignedDepartment !== next.assignedDepartment
    || [...previous.accessibleDepartments].sort().join('|')
      !== [...next.accessibleDepartments].sort().join('|');
}

/** A staff selection explicitly enrolls this account only after an authenticated read denies access. */
export async function readOrEnterStaffWorkspace<T>(
  read: () => Promise<T>,
  enter: () => Promise<T>,
  canEnter: () => boolean,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    if (status !== 403 || !canEnter()) throw error;
    return enter();
  }
}

export function matchesStaffDepartmentView(
  departments: readonly string[],
  selectedDepartment: StaffDepartmentView,
): boolean {
  if (selectedDepartment === 'Master City Queue') return true;
  return departments.includes(selectedDepartment)
    || (selectedDepartment === 'Economic Development' && departments.includes('Environmental Services'));
}