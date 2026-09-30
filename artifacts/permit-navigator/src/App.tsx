import { useCallback, useEffect, useRef, useState } from 'react';
import { ClerkProvider, Show, useUser, useClerk } from '@clerk/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';
import { Landmark, Sparkles, AlertCircle, ArrowLeft, ArrowUpRight, Printer, Send, CheckCircle2, Languages, Lightbulb, MapPin, FileText, X } from 'lucide-react';
import './workspace.css';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';

import { ActivePlan, PlanStatus, Department } from './types';
import { emptyIntake, getMatchedRequirements, generateId, deriveDepartments } from './utils/helpers';
import { generateRandomActionPlan, STAFF_REVIEWERS } from './utils/generators';
import { Intake, BusinessType, Modification } from './requirements';
import { Language, copy } from './copy';

import { SignInPage, SignUpPage } from './components/Auth';
import { PersonaLogin } from './components/PersonaLogin';
import { ApplicantDashboard } from './components/ApplicantDashboard';
import { IntakeView } from './components/IntakeView';
import { StaffPortal } from './components/StaffPortal';
import { ApplicationDocuments, uploadApplicationFiles, type DocumentStatus, type PendingUpload } from './components/ApplicationDocuments';
import { DraftContactDetails } from './components/DraftContactDetails';
import { RequirementCard } from './components/RequirementCard';
import { AIWorkspace, PublicWorkspace } from './components/AIWorkspace';
import { StaffApplicationFilters } from './components/StaffSearchFilters';
import { applicantId, readPersona, personaKey, PENDING_PERSONA_KEY, readPlans, Persona } from './prototypeStore';
import { createApplication, getListApplicationHistoryQueryKey, getStaffAccess, postApplicationResponse, reviewApplication, updateMyApplication, type StaffAccess as StaffAccessProfile } from '@workspace/api-client-react';
import { saveAndRefresh, useApplicationRecords } from './hooks/useApplicationRecords';
import { isStaleWrite } from './utils/writeErrors';
import { isDemoSeedApplicationId } from './utils/applicationResilience';
import { shouldApplyStaffAccessResponse, staffPermissionsChanged } from './utils/staffAccess';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const queryClient = new QueryClient();
const staffDepartments = ['Planning', 'Building', 'Fire', 'Economic Development'] as const;
type StaffDepartment = typeof staffDepartments[number];
type StaffDepartmentView = StaffDepartment | 'Master City Queue';
type StaffAccess = StaffAccessProfile;

function isStaffAccess(value: unknown): value is StaffAccess {
  if (!value || typeof value !== 'object') return false;
  const access = value as Record<string, unknown>;
  return typeof access.administratorEnabled === 'boolean'
    && staffDepartments.includes(access.assignedDepartment as StaffDepartment)
    && Array.isArray(access.accessibleDepartments)
    && access.accessibleDepartments.every(department => staffDepartments.includes(department as StaffDepartment));
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(224 64% 33%)",
    colorForeground: "hsl(222 47% 11%)",
    colorMutedForeground: "hsl(215 16% 47%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(220 13% 96%)",
    colorInputForeground: "hsl(222 47% 11%)",
    colorNeutral: "hsl(220 13% 85%)",
    fontFamily: "var(--app-font-sans)",
    borderRadius: "0.8rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg border border-border",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[24px] font-bold font-serif tracking-tight text-foreground",
    headerSubtitle: "text-[13px] text-muted-foreground",
    socialButtonsBlockButtonText: "text-[13px] font-semibold text-foreground",
    formFieldLabel: "text-[13px] font-bold text-foreground",
    footerActionLink: "text-[13px] font-semibold text-primary",
    footerActionText: "text-[13px] text-muted-foreground",
    dividerText: "text-[12px] text-muted-foreground",
    identityPreviewEditButton: "text-[13px] text-primary",
    formFieldSuccessText: "text-[12px] text-primary",
    alertText: "text-[13px] font-medium text-foreground",
    logoBox: "h-12 w-auto mb-4",
    logoImage: "h-full w-auto object-contain object-left",
    socialButtonsBlockButton: "rounded-lg border-border",
    formButtonPrimary: "bg-primary text-primary-foreground rounded-lg h-10 font-bold",
    formFieldInput: "rounded-lg border-input bg-background text-[13px] text-foreground",
    footerAction: "bg-secondary rounded-lg p-4",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive/25 text-destructive rounded-lg",
    otpCodeFieldInput: "border-input bg-background rounded-md text-foreground",
    formFieldRow: "gap-2",
    main: "gap-6",
  },
};

function LoadingPlan({ language }: { language: Language }) {
  const t = copy[language === 'other' ? 'en' : language];
  return (
    <div className="plan-shell loading-plan">
      <div className="loading-inner">
        <div className="loading-mark"><Sparkles size={25} /></div>
        <h2>{t.loadingTitle}</h2>
        <p>{t.loadingDesc}</p>
        <div className="loading-track" />
      </div>
    </div>
  );
}

function PortalWorkspace({ persona, userId, onLogout }: { persona: Persona; userId: string; onLogout: () => void }) {
  const { signOut } = useClerk();
  const { toast } = useToast();
  const applicationQueryClient = useQueryClient();
  const [staffDepartment, setStaffDepartment] = useState<StaffDepartmentView>('Master City Queue');
  const [staffAccess, setStaffAccess] = useState<StaffAccess | null>(null);
  const [staffAccessLoading, setStaffAccessLoading] = useState(persona.kind === 'staff');
  const [staffAccessError, setStaffAccessError] = useState('');
  const accessRequestId = useRef(0);
  const staffAccessController = useRef<AbortController | null>(null);
  const staffAccessSnapshot = useRef<StaffAccess | null>(null);

  const clearStaffScopedQueries = useCallback(() => {
    const isStaffScopedQuery = (query: { queryKey: readonly unknown[] }) =>
      typeof query.queryKey[0] === 'string'
      && (query.queryKey[0].startsWith('/api/applications/')
        || query.queryKey[0].startsWith('/api/workspace/'));
    applicationQueryClient.removeQueries({ predicate: isStaffScopedQuery });
    void applicationQueryClient.invalidateQueries({ predicate: isStaffScopedQuery });
  }, [applicationQueryClient]);

  const loadStaffAccess = useCallback(async (signal?: AbortSignal) => {
    staffAccessController.current?.abort();
    const controller = new AbortController();
    staffAccessController.current = controller;
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const requestId = ++accessRequestId.current;
    try {
      const value: unknown = await getStaffAccess({ signal: controller.signal });
      if (!isStaffAccess(value)) throw new Error('The server returned an invalid staff access profile.');
      if (!shouldApplyStaffAccessResponse(requestId, accessRequestId.current, false, controller.signal.aborted)) return;
      if (staffPermissionsChanged(staffAccessSnapshot.current, value)) clearStaffScopedQueries();
      staffAccessSnapshot.current = value;
      setStaffAccess(value);
      setStaffDepartment(current => (
        current === 'Master City Queue' && value.administratorEnabled
          || value.accessibleDepartments.includes(current as StaffDepartment)
          ? current
          : value.assignedDepartment
      ));
      setStaffAccessError('');
    } catch (error) {
      if (!shouldApplyStaffAccessResponse(requestId, accessRequestId.current, false, controller.signal.aborted)) return;
      staffAccessSnapshot.current = null;
      setStaffAccess(null);
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      setStaffAccessError(status === 403
        ? 'Staff access requires an administrator-approved reviewer account.'
        : status === 401 ? 'Your sign-in has expired. Sign in again.'
          : status === 503 ? 'The server could not verify your permissions. The staff workspace is temporarily unavailable; retry to reconnect.'
            : error instanceof Error ? error.message : 'Could not verify your staff permissions. Try again.');
      clearStaffScopedQueries();
    } finally {
      if (staffAccessController.current === controller) staffAccessController.current = null;
      if (!controller.signal.aborted && requestId === accessRequestId.current) setStaffAccessLoading(false);
    }
  }, [clearStaffScopedQueries]);

  useEffect(() => {
    if (persona.kind !== 'staff') {
      setStaffAccess(null);
      setStaffAccessLoading(false);
      return;
    }
    setStaffAccessLoading(true);
    void loadStaffAccess();
    const refreshOnFocus = () => void loadStaffAccess();
    const interval = window.setInterval(refreshOnFocus, 30_000);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      staffAccessController.current?.abort();
      accessRequestId.current += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [loadStaffAccess, persona.kind, userId]);

  useEffect(() => () => {
    applicationQueryClient.removeQueries({
      predicate: query => typeof query.queryKey[0] === 'string'
        && query.queryKey[0].startsWith('/api/applications/'),
    });
  }, [applicationQueryClient, userId, persona, staffDepartment]);

  const [filters, setFilters] = useState<StaffApplicationFilters>({
    search: '', applicationId: '', businessName: '', businessCategory: '',
    requestType: '', status: '', assignedDepartment: '', applicantLanguage: '',
    submissionDate: '', descriptionOrNotes: '',
  });
  const {
    records,
    recordsLoading,
    recordsError,
    recordsRefreshWarning,
    recordsReadOnly,
    recordsLastConfirmedAt,
    refreshRows,
    acceptRecord,
  } = useApplicationRecords(
    persona,
    filters,
    `${userId}:${persona.kind === 'staff' ? `${staffDepartment}:${staffAccess?.administratorEnabled ? 'administrator' : 'reviewer'}:${staffAccess?.accessibleDepartments.join(',') ?? 'unverified'}` : ''}`,
  );

  const plans: ActivePlan[] = records.map(record => ({
    ...(record.plan as unknown as ActivePlan),
    id: record.id,
    status: record.status as PlanStatus,
    submittedAt: record.submittedAt ? new Date(record.submittedAt).getTime() : undefined,
    updatedAt: new Date(record.updatedAt).getTime(),
    createdAt: new Date(record.createdAt).getTime(),
    intake: { ...(record.plan.intake as Intake), businessName: record.businessName, files: [] },
  }));
  const currentApplicantId = persona.kind === 'applicant' ? applicantId(userId, persona.key) : null;
  const myPlans = plans.filter(plan => plan.userId === currentApplicantId);
  
  const [applicantView, setApplicantView] = useState<'intake' | 'draft-review' | 'dashboard' | 'plan-detail'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'action-plan'
      ? 'dashboard'
      : 'intake',
  );
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);

  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [language, setLanguage] = useState<Language>('en');
  const [customLanguage, setCustomLanguage] = useState('');
  const [simplified, setSimplified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failedFiles, setFailedFiles] = useState<PendingUpload[]>([]);
  const [documentStatus, setDocumentStatus] = useState<DocumentStatus | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [staleDraft, setStaleDraft] = useState(false);
  const onDocumentStatus = useCallback((next: DocumentStatus) => {
    setDocumentStatus(current => current?.id === next.id && current.busy === next.busy && current.pending === next.pending && current.ready === next.ready ? current : next);
  }, []);
  const t = copy[language === 'other' ? 'en' : language];

  useEffect(() => {
    if (!currentApplicantId) return;
    const legacyKey = `permit-navigator-plans:${userId}`;
    const marker = `permit-navigator:db-imported:${currentApplicantId}`;
    let previousSession: ActivePlan[] = [];
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(legacyKey) || '[]');
      if (Array.isArray(parsed)) previousSession = parsed.filter((plan): plan is ActivePlan => plan?.userId === userId && typeof plan.id === 'string');
    } catch { /* Skip corrupt session data. */ }
    const oldPlans = [...readPlans().filter(plan => plan.userId === currentApplicantId), ...previousSession.map(plan => ({ ...plan, userId: currentApplicantId }))];
    if (!oldPlans.length) return;
    let cancelled = false;
    const importPlans = async () => {
      try {
        const imported = new Set<string>(JSON.parse(localStorage.getItem(marker) || '[]') as string[]);
        for (const plan of oldPlans) {
          if (cancelled || imported.has(plan.id)) continue;
          await createApplication({ applicantKey: persona.kind === 'applicant' ? persona.key : '', plan: JSON.parse(JSON.stringify(plan)) });
          imported.add(plan.id);
          localStorage.setItem(marker, JSON.stringify([...imported]));
        }
        if (!cancelled) await refreshRows();
      } catch {
        if (!cancelled) toast({ title: 'Import incomplete', description: 'Your older browser plans were kept locally. Try reloading to import them.', variant: 'destructive' });
      }
    };
    void importPlans();
    return () => { cancelled = true; };
  }, [currentApplicantId, userId]);

  const handleCreateNew = () => {
    setIntake(emptyIntake);
    setFailedFiles([]);
    setDocumentStatus(null);
    setStaleDraft(false);
    setCurrentPlanId(null);
    setApplicantView('intake');
  };

  const openDraftReview = () => {
    const selectedDraft = currentPlanId
      ? myPlans.find(plan => plan.id === currentPlanId && plan.status === 'Draft')
      : undefined;
    const latestDraft = [...myPlans]
      .filter(plan => plan.status === 'Draft')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (!selectedDraft && latestDraft) {
      setCurrentPlanId(latestDraft.id);
    } else if (!selectedDraft) {
      setCurrentPlanId(null);
    }
    setApplicantView('draft-review');
  };

  const handleResumePlan = (plan: ActivePlan) => {
    setFailedFiles([]);
    setDocumentStatus(null);
    setStaleDraft(false);
    setCurrentPlanId(plan.id);
    if (plan.status === 'Draft') {
      setApplicantView('draft-review');
    } else {
      setApplicantView('plan-detail');
    }
  };

  const handleLoadSample = () => {
    setLanguage('en');
    setCustomLanguage('');
    setIntake({
      businessName: 'Business at 150 South First Street, San Jose, CA',
      applicantName: 'Sample applicant',
      applicantEmail: '',
      applicantPhone: '',
      businessType: 'restaurant',
      businessOther: '',
      address: '150 South First Street, San Jose, CA',
      zip: '95113',
      description: 'Opening a first restaurant and remodeling the leased space',
      modifications: ['walls', 'signage'],
      modificationOther: '',
      files: []
    });
  };

  const handleGenerateRandom = async () => {
    if (!currentApplicantId) return;
    const { intake: randomIntake, reviewer } = generateRandomActionPlan(plans.length);
    const matched = getMatchedRequirements(randomIntake);
    
    const deps = deriveDepartments(randomIntake, matched);
    const assignees: Partial<Record<Department, string>> = {};
    deps.forEach(d => {
      const departmentReviewers = STAFF_REVIEWERS[d];
      assignees[d] = departmentReviewers[plans.length % departmentReviewers.length];
    });
    
    const newPlan: ActivePlan = {
      id: generateId(),
      userId: currentApplicantId,
      reviewer, // legacy
      departments: deps,
      departmentAssignees: assignees,
      intake: randomIntake,
      language: 'en',
      customLanguage: '',
      simplified: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      submittedAt: Date.now(),
      status: 'Draft — Requires Review',
      notes: {},
      overrides: {},
      rejected: [],
      matched,
    };
    
    try {
      await createApplication({ applicantKey: persona.kind === 'applicant' ? persona.key : '', plan: JSON.parse(JSON.stringify(newPlan)) });
      await refreshRows();
       toast({ title: 'Sample application created', description: 'Synthetic example saved to your application list and review queue.' });
    } catch {
      toast({ title: 'Could not save sample', description: 'Please try again.', variant: 'destructive' });
    }
  };

  const handleGeneratePlan = async () => {
    if (!currentApplicantId) return;
    const ownerId = currentApplicantId;
    const draftIntake = intake;
    const draftLanguage = language;
    const draftCustomLanguage = customLanguage;
    const draftSimplified = simplified;
    setLoading(true);
    try {
      const matched = getMatchedRequirements(draftIntake);
      const newPlan: ActivePlan = {
        id: generateId(),
        userId: ownerId,
         intake: { ...draftIntake, files: [] },
        language: draftLanguage,
        customLanguage: draftCustomLanguage,
        simplified: draftSimplified,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'Draft',
        notes: {},
        overrides: {},
        rejected: [],
        matched,
      };
      const saved = await createApplication({ applicantKey: persona.kind === 'applicant' ? persona.key : '', plan: JSON.parse(JSON.stringify(newPlan)) });
      acceptRecord(saved);
      setCurrentPlanId(saved.id);
      setDocumentStatus(null);
      setApplicantView('draft-review');
       if (draftIntake.files.length) {
         const failed = await uploadApplicationFiles(saved.id, draftIntake.files);
         setFailedFiles(failed);
         if (failed.length) toast({ title: 'Application saved; files need attention', description: `${failed.map(item => item.file.name).join(', ')} did not finish uploading. Retry the same reservation or discard it before submitting.`, variant: 'destructive' });
       }
       try { await refreshRows(); } catch { toast({ title: 'Draft saved', description: 'The list could not refresh. Reload to retrieve the saved draft.' }); }
    } catch {
       toast({ title: 'Application could not be saved', description: 'Please retry. If a draft was created, check your saved applications before creating another.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitToStaff = async () => {
    if (!currentPlanId) return;
    if (submitting || contactBusy || documentStatus?.id !== currentPlanId || documentStatus.busy || documentStatus.pending || !documentStatus.ready || failedFiles.length) {
      toast({ title: 'Draft is not ready to submit', description: 'Finish contact saves and document uploads, then retry. Pending reservations must be finalized or discarded.', variant: 'destructive' }); return;
    }
    
    const draftPlan = myPlans.find(p => p.id === currentPlanId && p.status === 'Draft');
    if (!draftPlan) return;
    
    const deps = deriveDepartments(draftPlan.intake, draftPlan.matched);
    const assignees: Partial<Record<Department, string>> = {};
    deps.forEach(d => {
      const departmentReviewers = STAFF_REVIEWERS[d];
      const submittedCount = plans.filter(plan => plan.submittedAt).length;
      assignees[d] = departmentReviewers[submittedCount % departmentReviewers.length];
    });
    
    setSubmitting(true);
    try {
      const saved = await updateMyApplication(currentPlanId, { applicantKey: persona.kind === 'applicant' ? persona.key : '',
        expectedUpdatedAt: new Date(draftPlan.updatedAt).toISOString(),
        plan: JSON.parse(JSON.stringify({ ...draftPlan, status: 'Draft — Requires Review', submittedAt: Date.now(), updatedAt: Date.now(), departments: deps, departmentAssignees: assignees })) });
      acceptRecord(saved);
      setApplicantView('dashboard');
      toast({ title: 'Submission saved', description: 'Your application was accepted by the server for staff review. This is not a permit decision.' });
      try { await refreshRows(); } catch { toast({ title: 'Submission saved; list may be out of date', description: 'The server accepted the submission, but the application list could not refresh. Reload to confirm the latest queue state.' }); }
    } catch (error) {
      if (isStaleWrite(error)) setStaleDraft(true);
      toast({ title: isStaleWrite(error) ? 'Draft changed elsewhere' : 'Submission not confirmed', description: isStaleWrite(error) ? 'Refresh this application before submitting. Your local draft has not replaced the newer version.' : 'The server did not confirm submission. Refresh your applications before retrying.', variant: 'destructive' });
    } finally { setSubmitting(false); }
  };

  const saveStaffReview = async (planId: string, updates: Partial<ActivePlan>, showErrorToast = true) => {
    if (recordsReadOnly || isDemoSeedApplicationId(planId)) return { saved: false, refreshed: false };
    const current = plans.find(plan => plan.id === planId);
    if (!current) return { saved: false, refreshed: false };
    try {
      const refreshed = await saveAndRefresh(
        async () => { const saved = await reviewApplication(planId, { expectedUpdatedAt: new Date(current.updatedAt).toISOString(), plan: JSON.parse(JSON.stringify({ ...current, ...updates })) }); acceptRecord(saved); return saved; },
        refreshRows,
      );
      if (!refreshed) {
        toast({
          title: 'Review saved',
          description: 'Your change was saved, but the staff queue could not be refreshed. The warning on this page explains that the displayed data may be out of date.',
        });
      }
      return { saved: true, refreshed };
    } catch (error) {
      if (showErrorToast || isStaleWrite(error)) {
        toast({ title: isStaleWrite(error) ? 'Case changed elsewhere' : 'Review not saved', description: isStaleWrite(error) ? 'Refresh the review queue and reapply your edit to the current version.' : 'Please retry your change.', variant: 'destructive' });
      }
      return { saved: false, refreshed: false };
    }
  };

  const postStaffResponse = async (planId: string, text: string): Promise<boolean> => {
    if (recordsReadOnly || isDemoSeedApplicationId(planId)) return false;
    try {
      const saved = await postApplicationResponse(planId, { text });
      acceptRecord(saved);
      void queryClient.invalidateQueries({ queryKey: getListApplicationHistoryQueryKey(planId) });
    } catch {
      toast({ title: 'Response not saved', description: 'Please retry after checking your connection.', variant: 'destructive' });
      return false;
    }
    try {
      await refreshRows();
    } catch {
      toast({ title: 'Response saved', description: 'The latest plan could not be refreshed. Reload the page to see the posted response.' });
    }
    return true;
  };

  const handleStaffComplete = (planId: string, status: PlanStatus) => {
    void saveStaffReview(planId, { status, completedAt: Date.now(), updatedAt: Date.now() }).then(({ saved, refreshed }) => {
      if (saved && refreshed) toast({ title: 'Review recommendation recorded', description: `Case marked ${status} for internal review only. No permit decision was issued.` });
    });
  };

  const handleStaffReopen = async (planId: string) =>
    (await saveStaffReview(planId, { status: 'In Review (Re-opened)', updatedAt: Date.now() }, false)).saved;

  const currentDraft = currentPlanId ? myPlans.find(p => p.id === currentPlanId && p.status === 'Draft') : null;
  const activePlan = currentPlanId ? myPlans.find(p => p.id === currentPlanId) : null;
  const planToShow = applicantView === 'draft-review' ? currentDraft : (applicantView === 'plan-detail' ? activePlan : null);

  const activeQueue = plans.filter(p => p.submittedAt && ['Draft — Requires Review', 'In Review (Re-opened)'].includes(p.status));
  const catalog = plans.filter(p => p.submittedAt && ['Approved', 'Rejected', 'Modified via Staff Override'].includes(p.status));

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header className="topbar">
        <Link href="/welcome" className="brand" data-testid="brand-permit-navigator" aria-label="Permit Navigator Home">
          <div className="brand-mark"><Landmark size={19} /></div>
           <div><div className="brand-name">Permit Navigator</div><div className="brand-sub">San José · Case workspace</div></div>
        </Link>

        <div className="top-actions">
          <Link href="/workspace" className="portal-workspace-link" data-testid="link-workspace-topbar"><Sparkles size={15} /> AI Workspace <ArrowUpRight size={14}/></Link>
          {persona.kind === 'applicant' && (
            <div className="language-controls">
              <Languages size={15} className="text-muted-foreground" />
              <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} data-testid="select-language-global" aria-label="Select Language">
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="vi">Tiếng Việt</option>
                <option value="zh">中文</option>
                <option value="tl">Tagalog</option>
                <option value="other">{copy.en.languageOther}</option>
              </select>
              {language === 'other' && (
                <input
                  type="text"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                  placeholder={t.customLanguagePlaceholder}
                  aria-label={t.customLanguageLabel}
                  className={customLanguage.trim().split(/\s+/).length > 50 ? 'error' : ''}
                  data-testid="input-custom-language"
                />
              )}
            </div>
          )}
          
          {persona.kind === 'applicant' && ['draft-review', 'plan-detail'].includes(applicantView) && (
            <button className={`button-tertiary simplify-toggle ${simplified ? 'active' : ''}`} onClick={() => setSimplified(!simplified)} data-testid="button-simplify-language">
              <Lightbulb size={14} /> {simplified ? t.fullDescriptions : t.simplifyLanguage}
            </button>
          )}

          <div className="signed-in-identity" data-testid="text-signed-in-user">
            {persona.kind === 'applicant' ? `Applicant · ${persona.key}` : `City Staff · ${persona.desk}`}
          </div>
           {persona.kind === 'staff' && <div className="staff-context-controls">
             <label htmlFor="staff-department">Department <select
               id="staff-department"
               value={staffDepartment}
               disabled={staffAccessLoading || !staffAccess || staffAccess.accessibleDepartments.length <= 1}
               onChange={event => setStaffDepartment(event.target.value as StaffDepartmentView)}
               data-testid="select-staff-department"
             >
               {staffAccess?.administratorEnabled && <option value="Master City Queue">All departments</option>}
               {staffAccess?.accessibleDepartments.map(department => (
                 <option key={department} value={department}>{department === 'Planning' ? 'Planning & Zoning' : department === 'Building' ? 'Building Safety' : department === 'Fire' ? 'Fire Prevention' : 'Economic Development'}</option>
               ))}
             </select></label>
           </div>}
          
          <button className="button-secondary" style={{ padding: '6px 12px' }} onClick={() => { onLogout(); void signOut({ redirectUrl: `${basePath}/welcome` }); }} data-testid="button-logout">
            Log out
          </button>
        </div>
      </header>

      {persona.kind === 'applicant' && (
        <div className="applicant-top-nav-container">
          <div className="applicant-top-nav" data-testid="applicant-top-nav">
            <button 
              className={`top-nav-tab ${applicantView === 'intake' ? 'active' : ''}`}
              onClick={() => setApplicantView('intake')}
              aria-current={applicantView === 'intake' ? 'page' : undefined}
              data-testid="tab-nav-intake"
            >
              Input
            </button>
            <button 
              className={`top-nav-tab ${applicantView === 'draft-review' ? 'active' : ''}`}
              onClick={openDraftReview}
              aria-current={applicantView === 'draft-review' ? 'page' : undefined}
              data-testid="tab-nav-submit"
            >
              Submit for Review
            </button>
            <button 
              className={`top-nav-tab ${['dashboard', 'plan-detail'].includes(applicantView) ? 'active' : ''}`}
              onClick={() => setApplicantView('dashboard')}
              aria-current={['dashboard', 'plan-detail'].includes(applicantView) ? 'page' : undefined}
              data-testid="tab-nav-action-plan"
            >
              Action Plan
            </button>
          </div>
        </div>
      )}

      {persona.kind === 'applicant' && recordsRefreshWarning && (
        <div className="plan-shell">
          <div className="verification-notice" role="status" data-testid="records-refresh-warning">
            {recordsRefreshWarning}
          </div>
        </div>
      )}

      {persona.kind === 'staff' && (staffAccessLoading || !staffAccess) ? (
        <main className="plan-shell">
          <div className="verification-notice" role={staffAccessError ? 'alert' : 'status'} data-testid="staff-access-status">
            {staffAccessLoading ? 'Verifying your server-assigned staff permissions…' : staffAccessError || 'Staff access is unavailable until the server confirms your role.'}
          </div>
          {!staffAccessLoading && <button className="button-secondary" type="button" onClick={() => { setStaffAccessLoading(true); void loadStaffAccess(); }} data-testid="button-retry-staff-access">Retry permission check</button>}
        </main>
      ) : persona.kind === 'staff' ? (
        <StaffPortal 
          key={`${userId}:${staffAccess?.assignedDepartment}:${staffAccess?.administratorEnabled}:${staffAccess?.accessibleDepartments.join(',')}:${staffDepartment}`}
          desk={persona.desk}
           selectedDepartment={staffDepartment}
           administratorEnabled={Boolean(staffAccess?.administratorEnabled)}
           assignedDepartment={staffAccess?.assignedDepartment ?? staffDepartment}
          activeQueue={activeQueue} 
          catalog={catalog}
          records={records}
          filters={filters}
          onFiltersChange={setFilters}
          recordsLoading={recordsLoading}
          recordsError={recordsError}
          recordsRefreshWarning={recordsRefreshWarning}
          recordsReadOnly={recordsReadOnly}
          recordsLastConfirmedAt={recordsLastConfirmedAt}
           onRefreshRecords={refreshRows}
          onCompleteReview={handleStaffComplete} 
          onUpdateActivePlan={async (id, updates) => (await saveStaffReview(id, updates)).saved}
          onPostResponse={postStaffResponse}
          onReopenReview={handleStaffReopen}
        />
      ) : persona.kind === 'applicant' ? (
        loading ? (
          <LoadingPlan language={language} />
        ) : recordsError ? (
          <div className="plan-shell" role="alert"><div className="verification-notice">{recordsError}</div><button className="button-secondary" onClick={() => void refreshRows()}>Try again</button></div>
        ) : recordsLoading ? (
          <LoadingPlan language={language} />
        ) : applicantView === 'dashboard' ? (
          <ApplicantDashboard plans={myPlans} userId={currentApplicantId!} onResume={handleResumePlan} onCreateNew={handleCreateNew} />
        ) : applicantView === 'intake' ? (
          <IntakeView 
            intake={intake} 
            setIntake={setIntake} 
            onGenerate={handleGeneratePlan} 
            language={language} 
            setLanguage={setLanguage} 
            customLanguage={customLanguage} 
            setCustomLanguage={setCustomLanguage} 
            onLoadSample={handleLoadSample}
            onGenerateRandom={handleGenerateRandom}
          />
        ) : applicantView === 'draft-review' && !currentDraft ? (
          <div className="plan-shell" data-testid="empty-state-draft">
            <div className="no-match" style={{ textAlign: 'center', padding: '60px 20px' }}>
              <FileText size={42} color="hsl(var(--muted-foreground))" style={{ margin: '0 auto 16px' }} />
              <h2>No Draft to Review</h2>
              <p>Fill out the input form to generate your initial plan.</p>
              <button className="button-primary" style={{ width: 'auto', marginTop: 16 }} onClick={() => setApplicantView('intake')} data-testid="button-back-to-input">
                Back to Input
              </button>
            </div>
          </div>
        ) : planToShow ? (
          <div className="plan-shell">
            {planToShow.notes?._staff_response && (
              <section className="verification-notice" aria-label="Response on your plan" data-testid={`notice-applicant-response-${planToShow.id}`}>
                <FileText size={18} aria-hidden="true" />
                <div><strong>Response posted to your plan</strong><p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{planToShow.notes._staff_response}</p><small>This response appears in the app only; no email was sent.</small></div>
              </section>
            )}
             <ApplicationDocuments key={`documents-${planToShow.id}`} id={planToShow.id} editable={planToShow.status === 'Draft'} pending={failedFiles} onPendingChange={setFailedFiles} onStatusChange={onDocumentStatus} />
             {staleDraft && <div className="verification-notice" role="alert" data-testid="warning-stale-draft">This draft changed elsewhere. Review the newest version before saving again. <button className="button-secondary" type="button" onClick={async () => { try { await refreshRows(); setStaleDraft(false); } catch { toast({ title: 'Refresh failed', description: 'Your local edits remain visible. Retry refreshing before saving.', variant: 'destructive' }); } }} data-testid="button-refresh-stale-draft">Refresh application</button></div>}
             {planToShow.status === 'Draft' && <DraftContactDetails key={`contact-${planToShow.id}`} plan={planToShow} onBusyChange={setContactBusy} onSave={async values => {
               try {
                 const saved = await updateMyApplication(planToShow.id, { applicantKey: persona.key, expectedUpdatedAt: new Date(planToShow.updatedAt).toISOString(), plan: JSON.parse(JSON.stringify({ ...planToShow, intake: { ...planToShow.intake, ...values, files: [] } })) });
                 acceptRecord(saved);
                 try { await refreshRows(); } catch { toast({ title: 'Contact saved', description: 'The application list could not refresh. Reload to confirm the latest information.' }); }
                 return true;
               } catch (error) { if (isStaleWrite(error)) { setStaleDraft(true); throw error; } return false; }
             }} />}
            {/\b(?:chemical spill|hazmat|toxic leak|gas leak|active fire|electrical fire|immediate danger|safety hazard|derrame qu[ií]mico|fuga de gas|incendio activo)\b/i.test(planToShow.intake.description) && (
              <div className="verification-notice" role="alert">
                <AlertCircle size={18} />
                 <span><strong>High-urgency concern detected.</strong> This plan has not been sent to City staff, dispatch, or emergency responders. Leave the area and call emergency services if there is immediate danger.</span>
              </div>
            )}
            <div className="verification-notice" data-testid="text-verification-notice">
              <AlertCircle size={18} />
              <span>Notice: City staff review is required. Business owners must verify all information directly with the appropriate City department before starting work or signing lease agreements.</span>
            </div>
            <div className="plan-header">
              <div>
                <h1>{t.planTitle}</h1>
                <p>{t.planIntro}</p>
              </div>
              <div className="plan-actions">
                <span className={`status-badge ${planToShow.status === 'Draft' ? '' : 'sent'}`} data-testid="status-plan">
                  {planToShow.status === 'Draft' ? 'Draft — Requires City Staff Review.' : planToShow.status}
                </span>
                <button className="button-tertiary" onClick={() => setApplicantView('dashboard')} data-testid="button-back-dashboard">
                  <ArrowLeft size={16} /> Back to Action Plan
                </button>
                <button className="button-secondary" onClick={() => window.print()} data-testid="button-print-plan">
                  <Printer size={16} /> {t.print}
                </button>
                {planToShow.status === 'Draft' ? (
                  <button className="button-primary" onClick={handleSubmitToStaff} disabled={staleDraft || submitting || contactBusy || documentStatus?.id !== planToShow.id || documentStatus.busy || documentStatus.pending || !documentStatus.ready || failedFiles.length > 0} data-testid="button-submit-review">
                    <Send size={16} /> {submitting ? 'Submitting…' : 'Send to City Staff'}
                  </button>
                ) : (
                  <button className="button-primary" disabled data-testid="button-submitted">
                    <CheckCircle2 size={16} /> Submitted
                  </button>
                )}
              </div>
            </div>

            {['Approved', 'Rejected', 'Modified via Staff Override'].includes(planToShow.status) ? (
               <div className="verification-notice" style={{ background: 'hsl(var(--primary) / 0.1)', borderColor: 'hsl(var(--primary) / 0.2)', color: 'hsl(var(--primary))' }} data-testid="notice-review-complete">
                 <CheckCircle2 size={18} />
                  <span>Staff recommendation recorded. This is not a permit approval, denial, or authorization to begin work.</span>
               </div>
            ) : planToShow.status !== 'Draft' ? (
              <div className="verification-notice" data-testid="notice-under-review">
                <AlertCircle size={18} />
                 <span>Under Review: Your plan has been sent to the staff queue. No turnaround time or permit outcome is guaranteed.</span>
              </div>
            ) : null}

            {planToShow.matched.length === 0 ? (
               <div className="no-match" data-testid="no-match-state">
                 <AlertCircle size={42} color="hsl(var(--accent))" style={{ margin: '0 auto 16px' }} />
                 <h2>{t.noMatchTitle}</h2>
                 <p>{t.noMatchDesc}</p>
               </div>
            ) : (
              <div className="plan-grid">
                <div>
                  <div className="summary-bar">
                    <div className="summary-cell"><span className="summary-label">{t.projectLabel}</span><div className="summary-value">{planToShow.intake.description}</div></div>
                    <div className="summary-cell"><span className="summary-label">{t.businessTypeLabel}</span><div className="summary-value">{planToShow.intake.businessType === 'other' ? planToShow.intake.businessOther : t.businessLabels[planToShow.intake.businessType as BusinessType]}</div></div>
                    <div className="summary-cell"><span className="summary-label">{t.plannedChangesLabel}</span><div className="summary-value">{planToShow.intake.modifications.map(m => m === 'other' ? planToShow.intake.modificationOther : t.modificationLabels[m as Modification]).join(', ')}</div></div>
                  </div>

                  <div className="section-title">
                    <h2>{t.possibleRequirements}</h2>
                    <span>{planToShow.matched.length} {t.matched}</span>
                  </div>

                  {planToShow.matched.map(reqId => (
                    <div key={reqId} style={{ opacity: planToShow.rejected.includes(reqId) ? 0.4 : 1 }} data-testid={`wrap-requirement-${reqId}`}>
                       {planToShow.rejected.includes(reqId) && <div className="modified-notice" style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}><X size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Rejected by Staff</div>}
                       {planToShow.overrides[reqId] && <div className="modified-notice" style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t.modifiedNotice}</div>}
                       
                       <RequirementCard 
                         reqId={reqId} 
                         language={language} 
                         simplified={simplified} 
                         note={planToShow.notes[reqId]} 
                       />
                    </div>
                  ))}
                </div>
                
                <aside className="plan-sidebar">
                  <div className="sidebar-card">
                    <h3>{t.yourDetails}</h3>
                    <div className="contact-row"><MapPin size={15} /><div><strong>{t.locationLabel}</strong><span>{planToShow.intake.address}, {planToShow.intake.zip}</span></div></div>
                    {planToShow.intake.files.length > 0 && <div className="contact-row"><FileText size={15} /><div><strong>{t.filesAttached}</strong><span>{t.fileCount(planToShow.intake.files.length)}</span></div></div>}
                  </div>
                  
                  <div className="sidebar-card">
                    <h3>{t.makeEasierToRead}</h3>
                    <p>{t.makeEasierDesc}</p>
                    <button className={`button-secondary simplify-toggle ${simplified ? 'active' : ''}`} onClick={() => setSimplified(!simplified)} style={{ width: '100%', justifyContent: 'center' }}>
                      <Lightbulb size={14} /> {simplified ? t.fullDescriptions : t.simplifyLanguage}
                    </button>
                  </div>
                </aside>
              </div>
            )}
          </div>
        ) : null
      ) : null}

      <Link href="/workspace" className="chatbot-fab" data-testid="link-open-workspace" aria-label="Open full AI Workspace">
        <Sparkles size={18}/><span className="chatbot-fab-text">Open AI Workspace</span><ArrowUpRight size={15}/>
      </Link>
      <Toaster />
    </div>
  );
}

function PortalRoute() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [persona, setPersona] = useState<Persona | null>(() => user
    ? readPersona(sessionStorage.getItem(personaKey(user.id))) || readPersona(sessionStorage.getItem(PENDING_PERSONA_KEY))
    : null);

  useEffect(() => {
    if (!user) return;
    const pending = readPersona(sessionStorage.getItem(PENDING_PERSONA_KEY));
    if (pending) {
      sessionStorage.setItem(personaKey(user.id), JSON.stringify(pending));
      sessionStorage.removeItem(PENDING_PERSONA_KEY);
      setPersona(pending);
    }
  }, [user]);

  if (!user) return null;
  if (!persona) return <PersonaLogin signedIn onLogin={selected => {
    sessionStorage.setItem(personaKey(user.id), JSON.stringify(selected));
    setPersona(selected);
  }} />;
  return <PortalWorkspace key={`${user.id}:${JSON.stringify(persona)}`} userId={user.id} persona={persona} onLogout={() => {
    sessionStorage.removeItem(personaKey(user.id));
    sessionStorage.removeItem(PENDING_PERSONA_KEY);
    setPersona(null);
  }} />;
}

function WelcomeRoute() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (user && sessionStorage.getItem(PENDING_PERSONA_KEY)) setLocation('/portal');
  }, [user, setLocation]);
  return <PersonaLogin signedIn={!!user} onLogin={selected => {
    if (user) {
      sessionStorage.setItem(personaKey(user.id), JSON.stringify(selected));
      setLocation('/portal');
    } else {
      sessionStorage.setItem(PENDING_PERSONA_KEY, JSON.stringify(selected));
      setLocation('/sign-in');
    }
  }} />;
}

function HomeRedirect() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  
  useEffect(() => {
    // If mounted on root "/", redirect to portal if signed in, or /welcome if not
    if (user) {
      setLocation('/portal');
    } else {
      setLocation('/welcome');
    }
  }, [user, setLocation]);

  return null;
}

function App() {
  const [, setLocation] = useLocation();

  return (
    <QueryClientProvider client={queryClient}>
    <WouterRouter base={basePath}>
      <ClerkProvider
        publishableKey={clerkPubKey}
        proxyUrl={clerkProxyUrl}
        appearance={clerkAppearance}
        signInUrl={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        routerPush={(to) => setLocation(stripBase(to))}
        routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      >
        <div className="global-safety-banner" data-testid="global-safety-banner">
          Preliminary guidance is not official City advice or a legal permit decision. Public permit records are linked to their source.
        </div>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/welcome" component={WelcomeRoute} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/portal">
            <Show when="signed-in">
              <PortalRoute />
            </Show>
            <Show when="signed-out">
              <Redirect to="/welcome" />
            </Show>
          </Route>
          <Route path="/workspace">
            <Show when="signed-in">
              <AIWorkspace />
            </Show>
            <Show when="signed-out">
              <PublicWorkspace />
            </Show>
          </Route>
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </ClerkProvider>
    </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;