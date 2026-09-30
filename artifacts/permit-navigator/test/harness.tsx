import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { AIWorkspace } from '../src/components/AIWorkspace';
import { StaffPortal } from '../src/components/StaffPortal';
import type { StaffDesk } from '../src/prototypeStore';
import type { StaffApplicationFilters } from '../src/components/StaffSearchFilters';
import '../src/index.css';
import '../src/workspace.css';

// This page is served by Vite only in browser tests. It mounts the production
// components with a fresh query cache; API responses are supplied by Playwright.
const desk = new URLSearchParams(location.search).get('desk') as StaffDesk | null;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const emptyFilters: StaffApplicationFilters = {
  search: '', applicationId: '', businessName: '', businessCategory: '',
  requestType: '', status: '', assignedDepartment: '', applicantLanguage: '',
  submissionDate: '', descriptionOrNotes: '',
};

function Harness() {
  const [view, setView] = useState<'workspace' | 'portal'>('workspace');
  const [filters, setFilters] = useState(emptyFilters);

  return desk ? (
    <StaffPortal
      desk={desk}
      activeQueue={[]}
      catalog={[]}
      records={[]}
      filters={filters}
      onFiltersChange={setFilters}
      recordsLoading={false}
      recordsError=""
      onCompleteReview={() => {}}
      onUpdateActivePlan={() => {}}
      onReopenReview={() => {}}
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