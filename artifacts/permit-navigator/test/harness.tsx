import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { AIWorkspace } from '../src/components/AIWorkspace';
import { StaffPortal } from '../src/components/StaffPortal';
import type { ActivePlan, PlanStatus } from '../src/types';
import type { Intake } from '../src/requirements';
import { reviewApplication } from '@workspace/api-client-react';
import { useApplicationRecords } from '../src/hooks/useApplicationRecords';
import type { StaffDesk, Persona } from '../src/prototypeStore';
import type { StaffApplicationFilters } from '../src/components/StaffSearchFilters';
import '../src/index.css';
import '../src/workspace.css';

// This page is served by Vite only in browser tests. It mounts the production
// components with a fresh query cache; API responses are supplied by Playwright.
const desk = new URLSearchParams(location.search).get('desk') as StaffDesk | null;
const queueHarness = new URLSearchParams(location.search).get('queue') === 'staff';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const emptyFilters: StaffApplicationFilters = {
  search: '', applicationId: '', businessName: '', businessCategory: '',
  requestType: '', status: '', assignedDepartment: '', applicantLanguage: '',
  submissionDate: '', descriptionOrNotes: '',
};

const testStaffPersona: Persona = { kind: 'staff', desk: 'Building Code Reviewer' };

function StaffQueueHarness() {
  const [filters, setFilters] = useState(emptyFilters);
  const { records, recordsLoading, recordsError, recordsRefreshWarning, refreshRows } = useApplicationRecords(testStaffPersona, filters);

  const plans: ActivePlan[] = records.map(record => ({
    ...(record.plan as unknown as ActivePlan),
    id: record.id,
    status: record.status as PlanStatus,
    submittedAt: record.submittedAt ? new Date(record.submittedAt).getTime() : undefined,
    updatedAt: new Date(record.updatedAt).getTime(),
    createdAt: new Date(record.createdAt).getTime(),
    intake: { ...(record.plan.intake as Intake), businessName: record.businessName, files: [] },
  }));
  const activeQueue = plans.filter(plan => plan.submittedAt && ['Draft — Requires Review', 'In Review (Re-opened)'].includes(plan.status));
  const catalog = plans.filter(plan => plan.submittedAt && ['Approved', 'Rejected', 'Modified via Staff Override'].includes(plan.status));

  const saveReview = async (planId: string, updates: Partial<ActivePlan>) => {
    const current = plans.find(plan => plan.id === planId);
    if (!current) return false;
    try {
      await reviewApplication(planId, { plan: JSON.parse(JSON.stringify({ ...current, ...updates })) });
      await refreshRows();
      return true;
    } catch {
      return false;
    }
  };

  return (
    <StaffPortal
      desk="Building Code Reviewer"
      activeQueue={activeQueue}
      catalog={catalog}
      records={records}
      filters={filters}
      onFiltersChange={setFilters}
      recordsLoading={recordsLoading}
      recordsError={recordsError}
      recordsRefreshWarning={recordsRefreshWarning}
      onCompleteReview={(id, status) => { void saveReview(id, { status, completedAt: Date.now(), updatedAt: Date.now() }); }}
      onUpdateActivePlan={(id, updates) => { void saveReview(id, updates); }}
      onReopenReview={id => saveReview(id, { status: 'In Review (Re-opened)', updatedAt: Date.now() })}
    />
  );
}

function Harness() {
  const [view, setView] = useState<'workspace' | 'portal'>('workspace');
  const [filters, setFilters] = useState(emptyFilters);

  return queueHarness ? (
    <StaffQueueHarness />
  ) : desk ? (
    <StaffPortal
      desk={desk}
      activeQueue={[]}
      catalog={[]}
      records={[]}
      filters={filters}
      onFiltersChange={setFilters}
      recordsLoading={false}
      recordsError=""
      recordsRefreshWarning=""
      onCompleteReview={() => {}}
      onUpdateActivePlan={() => {}}
       onReopenReview={async () => false}
    />
  ) : (
    <>
      <button data-testid="harness-navigate" onClick={() => setView(view === 'workspace' ? 'portal' : 'workspace')}>
        {view === 'workspace' ? 'Leave workspace' : 'Return to workspace'}
      </button>
      {view === 'workspace' ? <Router><AIWorkspace /></Router> : <main>Permit portal</main>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><Harness /></QueryClientProvider>,
);