import { useCallback, useEffect, useState } from 'react';
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

  const loadRecords = useCallback(() => {
    if (persona.kind === 'applicant') {
      return listMyApplications({ applicantKey: persona.key });
    }
    return searchStaffApplications(
      Object.fromEntries(Object.entries(filters).filter(([, value]) => value.trim())) as Partial<StaffApplicationFilters>,
    );
  }, [persona, filters]);

  const refreshRows = useCallback(async () => {
    const rows = await loadRecords();
    setRecords(rows);
    setRecordsError('');
  }, [loadRecords]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const rows = await loadRecords();
        if (mounted) {
          setRecords(rows);
          setRecordsError('');
        }
      } catch (error) {
        if (mounted) {
          setRecordsError(persona.kind === 'staff' && error && typeof error === 'object' && 'status' in error && error.status === 403
            ? 'Staff access requires an administrator-assigned Clerk role and department. Selecting a desk does not grant access.'
            : 'Could not load applications from the database. Please try again.');
        }
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
  }, [loadRecords, persona.kind]);

  return { records, recordsLoading, recordsError, refreshRows };
}