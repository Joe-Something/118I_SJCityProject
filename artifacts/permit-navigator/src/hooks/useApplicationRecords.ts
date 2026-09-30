import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMyApplications,
  searchStaffApplications,
  type ApplicationRecord,
} from '@workspace/api-client-react';
import type { Persona } from '../prototypeStore';
import type { StaffApplicationFilters } from '../components/StaffSearchFilters';

export function useApplicationRecords(persona: Persona, filters: StaffApplicationFilters) {
  const [records, setRecords] = useState<ApplicationRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState('');
  const [recordsRefreshWarning, setRecordsRefreshWarning] = useState('');
  const hasSuccessfulLoad = useRef(false);

  const loadRecords = useCallback(() => {
    if (persona.kind === 'applicant') {
      return listMyApplications({ applicantKey: persona.key });
    }
    return searchStaffApplications(
      Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim())) as Partial<StaffApplicationFilters>,
    );
  }, [persona, filters]);

  const reportLoadError = useCallback((error: unknown) => {
    const accessDenied = error && typeof error === 'object' && 'status' in error && error.status === 403;
    if (persona.kind === 'staff' && hasSuccessfulLoad.current && !accessDenied) {
      setRecordsError('');
      setRecordsRefreshWarning('Could not refresh the staff queue. Showing the last successfully loaded review state.');
      return;
    }

    setRecordsRefreshWarning('');
    setRecordsError(accessDenied
      ? 'Staff access requires an administrator-assigned Clerk role and department. Selecting a desk does not grant access.'
      : 'Could not load applications from the database. Please try again.');
  }, [persona.kind]);

  const refreshRows = useCallback(async () => {
    try {
      const rows = await loadRecords();
      setRecords(rows);
      hasSuccessfulLoad.current = true;
      setRecordsError('');
      setRecordsRefreshWarning('');
    } catch (error) {
      reportLoadError(error);
      throw error;
    }
  }, [loadRecords, reportLoadError]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const rows = await loadRecords();
        if (mounted) {
          setRecords(rows);
          hasSuccessfulLoad.current = true;
          setRecordsError('');
          setRecordsRefreshWarning('');
        }
      } catch (error) {
        if (mounted) reportLoadError(error);
      } finally {
        if (mounted) setRecordsLoading(false);
      }
    };

    setRecordsLoading(true);
    void load();
    const interval = window.setInterval(load, 15000);
    window.addEventListener('focus', load);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, [loadRecords, persona.kind, reportLoadError]);

  return { records, recordsLoading, recordsError, recordsRefreshWarning, refreshRows };
}