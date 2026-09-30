import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { AIWorkspace } from '../src/components/AIWorkspace';
import { ApplicantDashboard } from '../src/components/ApplicantDashboard';
import { StaffPortal } from '../src/components/StaffPortal';
import type { ActivePlan, PlanStatus } from '../src/types';
import type { Intake } from '../src/requirements';
import { reviewApplication } from '@workspace/api-client-react';
import { saveAndRefresh, useApplicationRecords } from '../src/hooks/useApplicationRecords';
import { applicantId, type StaffDesk, type Persona } from '../src/prototypeStore';
import type { StaffApplicationFilters } from '../src/components/StaffSearchFilters';
import { useToast } from '../src/hooks/use-toast';
import { Toaster } from '../src/components/ui/toaster';
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
const testApplicantKey = 'test-applicant@example.com';
const testApplicantUserId = 'test-browser-user';
const testApplicantId = applicantId(testApplicantUserId, testApplicantKey);
const testApplicantPersona: Persona = { kind: 'applicant', key: testApplicantKey };

function StaffQueueHarness() {
  const [filters, setFilters] = useState(emptyFilters);
  const { toast } = useToast();
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
    if (!current) return { saved: false, refreshed: false };
    try {
      const refreshed = await saveAndRefresh(
        () => reviewApplication(planId, { plan: JSON.parse(JSON.stringify({ ...current, ...updates })) }),
        refreshRows,
      );
      if (!refreshed) {
        toast({
          title: 'Review saved',
          description: 'Your change was saved, but the staff queue could not be refreshed. The warning on this page explains that the displayed data may be out of date.',
        });
      }
      return { saved: true, refreshed };
    } catch {
      toast({ title: 'Review not saved', description: 'Please retry your change.', variant: 'destructive' });
      return { saved: false, refreshed: false };
    }
  };

  return (
    <>
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
        onCompleteReview={(id, status) => {
          void saveReview(id, { status, completedAt: Date.now(), updatedAt: Date.now() }).then(({ saved, refreshed }) => {
            if (saved && refreshed) toast({ title: 'Review Completed', description: `Plan has been marked as ${status}.` });
          });
        }}
        onUpdateActivePlan={async (id, updates) => (await saveReview(id, updates)).saved}
        onReopenReview={async id => (await saveReview(id, { status: 'In Review (Re-opened)', updatedAt: Date.now() })).saved}
      />
      <Toaster />
    </>
  );
}

function ApplicantRecordsHarness() {
  const [selectedPlan, setSelectedPlan] = useState<ActivePlan | null>(null);
  const { records, recordsLoading, recordsError, recordsRefreshWarning } = useApplicationRecords(testApplicantPersona, emptyFilters);
  const plans: ActivePlan[] = records.map(record => ({
    ...(record.plan as unknown as ActivePlan),
    id: record.id,
    status: record.status as PlanStatus,
    submittedAt: record.submittedAt ? new Date(record.submittedAt).getTime() : undefined,
    updatedAt: new Date(record.updatedAt).getTime(),
    createdAt: new Date(record.createdAt).getTime(),
    intake: { ...(record.plan.intake as Intake), businessName: record.businessName, files: [] },
  })).filter(plan => plan.userId === testApplicantId);

  return (
    <main>
      {recordsRefreshWarning && (
        <div className="verification-notice" role="status" data-testid="records-refresh-warning">
          {recordsRefreshWarning}
        </div>
      )}
      {recordsError ? (
        <div role="alert">{recordsError}</div>
      ) : recordsLoading ? (
        <p>Loading saved plans…</p>
      ) : selectedPlan ? (
        <section data-testid="applicant-plan-detail">
          <h1>{selectedPlan.intake.businessName}</h1>
          <p>{selectedPlan.status}</p>
          <button onClick={() => setSelectedPlan(null)}>Back to saved plans</button>
        </section>
      ) : (
        <ApplicantDashboard plans={plans} userId={testApplicantId} onResume={setSelectedPlan} onCreateNew={() => {}} />
      )}
    </main>
  );
}

function Harness() {
  const [view, setView] = useState<'workspace' | 'portal'>('workspace');
  const [filters, setFilters] = useState(emptyFilters);
  const applicantHarness = new URLSearchParams(location.search).get('applicant') === 'records';

  return applicantHarness ? (
    <ApplicantRecordsHarness />
  ) : queueHarness ? (
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