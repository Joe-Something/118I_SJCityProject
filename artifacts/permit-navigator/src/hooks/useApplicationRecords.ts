import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  listMyApplications,
  searchStaffApplications,
  type ApplicationRecord,
} from '@workspace/api-client-react';
import type { Persona } from '../prototypeStore';
import type { StaffApplicationFilters } from '../components/StaffSearchFilters';
import { isDemoSeedApplicationId } from '../utils/applicationResilience';

type RecordsState = {
  scope: string;
  records: ApplicationRecord[];
  error: string;
  warning: string;
  readOnly: boolean;
  lastConfirmedAt: number | null;
};

export function hasConfirmedLiveQueue(state: Pick<RecordsState, 'lastConfirmedAt'> | null): boolean {
  return state?.lastConfirmedAt !== null && state?.lastConfirmedAt !== undefined;
}

export function isSampleFallbackRows(rows: unknown): rows is ApplicationRecord[] {
  return Array.isArray(rows)
    && rows.length > 0
    && rows.every(row => row && typeof row === 'object'
      && typeof row.id === 'string'
      && row.plan && typeof row.plan === 'object'
      && row.plan._dataSource === 'sample-fallback');
}

export function getApplicationErrorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

export async function saveAndRefresh(
  save: () => Promise<unknown>,
  refresh: () => Promise<unknown>,
): Promise<boolean> {
  await save();
  try {
    await refresh();
    return true;
  } catch {
    // The refresh hook has already recorded a stale-data warning. Its failure
    // must not change the result of a save that the server accepted.
    return false;
  }
}

export function useApplicationRecords(
  persona: Persona,
  filters: StaffApplicationFilters,
  identity: string,
) {
  const scope = JSON.stringify([identity, persona, filters]);
  const applicationQueryClient = useQueryClient();
  const [state, setState] = useState<RecordsState>({
    scope: '',
    records: [],
    error: '',
    warning: '',
    readOnly: false,
    lastConfirmedAt: null,
  });
  const [scopeLoading, setScopeLoading] = useState(true);
  const requestNumber = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const acceptRecord = useCallback((record: ApplicationRecord) => {
    setState(current => current.scope !== scope ? current : {
      ...current,
      records: current.records.some(item => item.id === record.id)
        ? current.records.map(item => item.id === record.id ? record : item)
        : [...current.records, record],
    });
  }, [scope]);

  const loadRecords = useCallback(() => {
    if (persona.kind === 'applicant') {
      return listMyApplications({ applicantKey: persona.key });
    }
    return searchStaffApplications(
      Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim())) as Partial<StaffApplicationFilters>,
    );
  }, [persona, filters]);

  const runRefresh = useCallback(async (scopeAtRequest: string) => {
    const requestId = ++requestNumber.current;
    try {
      const rows = await loadRecords();
      if (requestId !== requestNumber.current) return false;
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !row.plan || typeof row.plan !== 'object')) {
        throw new Error('Applications response did not contain a valid record list.');
      }

      const isStaff = persona.kind === 'staff';
      const sampleFallback = isStaff && isSampleFallbackRows(rows);
      const hasSampleMarker = isStaff && rows.some(row => row.plan._dataSource === 'sample-fallback');
      if (hasSampleMarker && !sampleFallback) throw new Error('Applications response contained an incomplete sample fallback.');
      const current = stateRef.current.scope === scopeAtRequest ? stateRef.current : null;
      if (sampleFallback && hasConfirmedLiveQueue(current) && current && !isSampleFallbackRows(current.records)) {
        setState({
          ...current,
          warning: `The database is unavailable. Showing the last confirmed staff queue from ${current.lastConfirmedAt ? new Date(current.lastConfirmedAt).toLocaleString() : 'an earlier successful refresh'}; edits are disabled until the live queue returns.`,
          readOnly: true,
        });
        return false;
      } else if (sampleFallback) {
        setState({
          scope: scopeAtRequest,
          records: rows,
          error: '',
          warning: 'The database is unavailable. These clearly labeled sample records are for browsing only; staff edits, history, and documents are unavailable until the live database returns.',
          readOnly: true,
          lastConfirmedAt: null,
        });
        return false;
      } else {
        setState({
          scope: scopeAtRequest,
          records: rows,
          error: '',
          warning: '',
          readOnly: false,
          lastConfirmedAt: Date.now(),
        });
        return true;
      }
    } catch (error) {
      if (requestId !== requestNumber.current) return false;
      const status = getApplicationErrorStatus(error);
      if (status === 401 || status === 403) {
        applicationQueryClient.removeQueries({
          predicate: query => typeof query.queryKey[0] === 'string'
            && query.queryKey[0].startsWith('/api/applications/'),
        });
        setState({
          scope: scopeAtRequest,
          records: [],
          error: status === 401
            ? 'Your sign-in has expired. Sign in again to access applications.'
            : 'Staff access requires an administrator-assigned Clerk role and department. Selecting a desk does not grant access.',
          warning: '',
          readOnly: true,
          lastConfirmedAt: null,
        });
        return false;
      }

      const current = stateRef.current.scope === scopeAtRequest ? stateRef.current : null;
      const lastConfirmedAt = current?.lastConfirmedAt ?? null;
      if (hasConfirmedLiveQueue(current)) {
        setState({
          ...current!,
          error: '',
          warning: persona.kind === 'applicant'
            ? `Could not refresh your saved plans. Showing the last confirmed data from ${new Date(current!.lastConfirmedAt!).toLocaleString()}; it may be out of date.`
            : `Could not refresh the staff queue. Showing the last confirmed queue from ${new Date(current!.lastConfirmedAt!).toLocaleString()}; editing is disabled until the live queue returns.`,
          readOnly: true,
        });
      } else if (current?.records.length) {
        const warning = persona.kind === 'applicant'
          ? `Could not refresh your saved plans. Showing the last confirmed data from ${lastConfirmedAt ? new Date(lastConfirmedAt).toLocaleString() : 'an earlier successful refresh'}; it may be out of date.`
          : isSampleFallbackRows(current.records)
            ? 'The database is unavailable. Showing clearly labeled sample records for browsing only; history, documents, and edits are unavailable until the live queue returns.'
            : `Could not refresh the staff queue. Showing the last confirmed queue from ${lastConfirmedAt ? new Date(lastConfirmedAt).toLocaleString() : 'an earlier successful refresh'}; editing is disabled until the live queue returns.`;
        setState({
          ...current,
          error: '',
          warning,
          readOnly: true,
        });
      } else {
        setState({
          scope: scopeAtRequest,
          records: [],
          error: 'Could not load applications. The database could not be reached; retry to reconnect.',
          warning: '',
          readOnly: true,
          lastConfirmedAt,
        });
      }
      return false;
    } finally {
      if (requestId === requestNumber.current) setScopeLoading(false);
    }
  }, [applicationQueryClient, loadRecords, persona.kind]);

  const refreshRows = useCallback(async () => {
    if (!await runRefresh(scope)) {
      const latest = stateRef.current;
      throw new Error(latest.scope === scope && latest.error
        ? latest.error
        : 'The staff queue is still read-only. Retry after database access recovers.');
    }
  }, [runRefresh, scope]);

  useEffect(() => {
    requestNumber.current += 1;
    setScopeLoading(true);
    setState({
      scope,
      records: [],
      error: '',
      warning: '',
      readOnly: false,
      lastConfirmedAt: null,
    });
    void runRefresh(scope);
    const interval = window.setInterval(() => void runRefresh(scope), 15000);
    const refreshOnFocus = () => void runRefresh(scope);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      requestNumber.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [runRefresh, scope]);

  const stateMatchesScope = state.scope === scope;
  return {
    records: stateMatchesScope ? state.records : [],
    recordsLoading: !stateMatchesScope || scopeLoading,
    recordsError: stateMatchesScope ? state.error : '',
    recordsRefreshWarning: stateMatchesScope ? state.warning : '',
    recordsReadOnly: stateMatchesScope && state.readOnly,
    recordsLastConfirmedAt: stateMatchesScope ? state.lastConfirmedAt : null,
    refreshRows,
    acceptRecord,
  };
}