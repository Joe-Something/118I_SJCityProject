import { useEffect, useState } from 'react';
import { ClerkProvider, Show, useUser, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { Landmark, Sparkles, AlertCircle, ArrowLeft, Printer, Send, CheckCircle2, Languages, Lightbulb, MapPin, Building2, ClipboardCheck, FileText, X } from 'lucide-react';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';

import { ActivePlan, PlanStatus } from './types';
import { emptyIntake, getMatchedRequirements, generateId } from './utils/helpers';
import { generateRandomActionPlan, STAFF_REVIEWERS } from './utils/generators';
import { Intake, BusinessType, Modification } from './requirements';
import { Language, copy } from './copy';

import { LandingPage } from './components/LandingPage';
import { SignInPage, SignUpPage } from './components/Auth';
import { RoleSelector } from './components/RoleSelector';
import { ApplicantDashboard } from './components/ApplicantDashboard';
import { IntakeView } from './components/IntakeView';
import { StaffPortal } from './components/StaffPortal';
import { RequirementCard } from './components/RequirementCard';
import { Stepper } from './components/Stepper';
import { Chatbot } from './components/Chatbot';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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

function PortalRoute() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [prototypeRole, setPrototypeRole] = useState<'Applicant' | 'City Staff'>('Applicant');
  const planStorageKey = `permit-navigator-plans:${user?.id ?? 'anonymous'}`;
  const [plans, setPlans] = useState<ActivePlan[]>(() => {
    const stored = window.sessionStorage.getItem(planStorageKey);
    if (!stored) return [];
    try {
      return JSON.parse(stored) as ActivePlan[];
    } catch {
      window.sessionStorage.removeItem(planStorageKey);
      return [];
    }
  });
  
  const [applicantView, setApplicantView] = useState<'dashboard' | 'intake' | 'plan'>('dashboard');
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);

  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [language, setLanguage] = useState<Language>('en');
  const [customLanguage, setCustomLanguage] = useState('');
  const [simplified, setSimplified] = useState(false);
  const [loading, setLoading] = useState(false);

  const t = copy[language === 'other' ? 'en' : language];

  useEffect(() => {
    window.sessionStorage.setItem(planStorageKey, JSON.stringify(plans));
  }, [planStorageKey, plans]);

  const handleCreateNew = () => {
    setIntake(emptyIntake);
    setApplicantView('intake');
  };

  const handleResumePlan = (plan: ActivePlan) => {
    setCurrentPlanId(plan.id);
    setApplicantView('plan');
  };

  const handleLoadSample = () => {
    setLanguage('en');
    setCustomLanguage('');
    setIntake({
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

  const handleGenerateRandom = () => {
    if (!user) return;
    const { intake: randomIntake, reviewer } = generateRandomActionPlan(plans.length);
    const matched = getMatchedRequirements(randomIntake);
    const newPlan: ActivePlan = {
      id: generateId(),
      userId: user.id,
      reviewer,
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
    
    setPlans(prev => [...prev, newPlan]);
    toast({
      title: 'Success',
      description: 'Random action plan generated and sent to City Staff Active Review Queue!',
    });
  };

  const handleGeneratePlan = () => {
    setLoading(true);
    setTimeout(() => {
      const matched = getMatchedRequirements(intake);
      const newPlan: ActivePlan = {
        id: generateId(),
        userId: user?.id || 'unknown',
        intake,
        language,
        customLanguage,
        simplified,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'Draft',
        notes: {},
        overrides: {},
        rejected: [],
        matched,
      };
      setPlans(prev => [...prev, newPlan]);
      setCurrentPlanId(newPlan.id);
      setLoading(false);
      setApplicantView('plan');
    }, 1500);
  };

  const handleSubmitToStaff = () => {
    if (!currentPlanId) return;
    const submittedCount = plans.filter(plan => plan.submittedAt).length;
    const reviewer = STAFF_REVIEWERS[submittedCount % STAFF_REVIEWERS.length];
    setPlans(prev => prev.map(p => 
      p.id === currentPlanId 
        ? { ...p, reviewer, status: 'Draft — Requires Review', submittedAt: Date.now(), updatedAt: Date.now() }
        : p
    ));
    toast({
      title: 'Plan Submitted',
      description: 'Your plan has been sent to the City Staff review queue.',
    });
  };

  const handleStaffUpdate = (planId: string, updates: Partial<ActivePlan>) => {
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, ...updates } : p));
  };

  const handleStaffComplete = (planId: string, status: PlanStatus) => {
    setPlans(prev => prev.map(p => 
      p.id === planId 
        ? { ...p, status, completedAt: Date.now(), updatedAt: Date.now() }
        : p
    ));
    toast({
      title: 'Review Completed',
      description: `Plan has been marked as ${status}.`,
    });
  };

  const handleStaffReopen = (planId: string) => {
    setPlans(prev => prev.map(p => 
      p.id === planId 
        ? { ...p, status: 'In Review (Re-opened)', updatedAt: Date.now() }
        : p
    ));
  };

  const activePlan = currentPlanId ? plans.find(p => p.id === currentPlanId) : null;
  const activeQueue = plans.filter(p => ['Draft — Requires Review', 'In Review (Re-opened)'].includes(p.status));
  const catalog = plans.filter(p => ['Approved', 'Rejected', 'Modified via Staff Override'].includes(p.status));

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header className="topbar">
        <div className="brand" data-testid="brand-permit-navigator">
          <div className="brand-mark"><Landmark size={19} /></div>
          <div><div className="brand-name">Permit Navigator</div><div className="brand-sub">City of San José · Prototype</div></div>
        </div>

        <div className="top-actions">
          {prototypeRole === 'Applicant' && (
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
                  className={customLanguage.trim().split(/\\s+/).length > 50 ? 'error' : ''}
                  data-testid="input-custom-language"
                />
              )}
            </div>
          )}
          
          {prototypeRole === 'Applicant' && applicantView === 'plan' && (
            <button className={`button-tertiary simplify-toggle ${simplified ? 'active' : ''}`} onClick={() => setSimplified(!simplified)} data-testid="button-simplify-language">
              <Lightbulb size={14} /> {simplified ? t.fullDescriptions : t.simplifyLanguage}
            </button>
          )}

          <RoleSelector role={prototypeRole} setRole={setPrototypeRole} />

          <div className="signed-in-identity" data-testid="text-signed-in-user">
            {user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Signed-in user'}
          </div>
          
          <button className="button-secondary" style={{ padding: '6px 12px' }} onClick={() => signOut({ redirectUrl: basePath || "/" })} data-testid="button-logout">
            Log out
          </button>
        </div>
      </header>

      {prototypeRole === 'Applicant' && applicantView === 'intake' && <Stepper activeTab="applicant" hasPlan={false} reviewState="draft" />}
      {prototypeRole === 'Applicant' && applicantView === 'plan' && activePlan && (
        <Stepper activeTab="applicant" hasPlan={true} reviewState={activePlan.status === 'Draft' ? 'draft' : (['Approved', 'Rejected', 'Modified via Staff Override'].includes(activePlan.status) ? 'reviewed' : 'sent')} />
      )}

      {prototypeRole === 'City Staff' ? (
        <StaffPortal 
          activeQueue={activeQueue} 
          catalog={catalog} 
          onCompleteReview={handleStaffComplete} 
          onUpdateActivePlan={handleStaffUpdate} 
          onReopenReview={handleStaffReopen}
        />
      ) : prototypeRole === 'Applicant' ? (
        loading ? (
          <LoadingPlan language={language} />
        ) : applicantView === 'dashboard' ? (
          <ApplicantDashboard plans={plans} userId={user?.id || 'unknown'} onResume={handleResumePlan} onCreateNew={handleCreateNew} />
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
        ) : activePlan ? (
          <div className="plan-shell">
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
                <span className={`status-badge ${activePlan.status === 'Draft' ? '' : 'sent'}`} data-testid="status-plan">
                  {activePlan.status === 'Draft' ? 'Draft — Requires City Staff Review.' : activePlan.status}
                </span>
                <button className="button-tertiary" onClick={() => setApplicantView('dashboard')} data-testid="button-back-dashboard">
                  <ArrowLeft size={16} /> Back to Dashboard
                </button>
                <button className="button-secondary" onClick={() => window.print()} data-testid="button-print-plan">
                  <Printer size={16} /> {t.print}
                </button>
                {activePlan.status === 'Draft' ? (
                  <button className="button-primary" onClick={handleSubmitToStaff} data-testid="button-submit-review">
                    <Send size={16} /> Submit for Review
                  </button>
                ) : (
                  <button className="button-primary" disabled data-testid="button-submitted">
                    <CheckCircle2 size={16} /> Submitted
                  </button>
                )}
              </div>
            </div>

            {['Approved', 'Rejected', 'Modified via Staff Override'].includes(activePlan.status) ? (
               <div className="verification-notice" style={{ background: 'hsl(var(--primary) / 0.1)', borderColor: 'hsl(var(--primary) / 0.2)', color: 'hsl(var(--primary))' }} data-testid="notice-review-complete">
                 <CheckCircle2 size={18} />
                 <span>Review Complete: City staff have completed their simulation review for this plan.</span>
               </div>
            ) : activePlan.status !== 'Draft' ? (
              <div className="verification-notice" data-testid="notice-under-review">
                <AlertCircle size={18} />
                <span>Under Review: Your plan has been sent to City Staff. Expected turnaround is 2-3 business days.</span>
              </div>
            ) : null}

            {activePlan.matched.length === 0 ? (
               <div className="no-match" data-testid="no-match-state">
                 <AlertCircle size={42} color="hsl(var(--accent))" style={{ margin: '0 auto 16px' }} />
                 <h2>{t.noMatchTitle}</h2>
                 <p>{t.noMatchDesc}</p>
               </div>
            ) : (
              <div className="plan-grid">
                <div>
                  <div className="summary-bar">
                    <div className="summary-cell"><span className="summary-label">{t.projectLabel}</span><div className="summary-value">{activePlan.intake.description}</div></div>
                    <div className="summary-cell"><span className="summary-label">{t.businessTypeLabel}</span><div className="summary-value">{activePlan.intake.businessType === 'other' ? activePlan.intake.businessOther : t.businessLabels[activePlan.intake.businessType as BusinessType]}</div></div>
                    <div className="summary-cell"><span className="summary-label">{t.plannedChangesLabel}</span><div className="summary-value">{activePlan.intake.modifications.map(m => m === 'other' ? activePlan.intake.modificationOther : t.modificationLabels[m as Modification]).join(', ')}</div></div>
                  </div>

                  <div className="section-title">
                    <h2>{t.possibleRequirements}</h2>
                    <span>{activePlan.matched.length} {t.matched}</span>
                  </div>

                  {activePlan.matched.map(reqId => (
                    <div key={reqId} style={{ opacity: activePlan.rejected.includes(reqId) ? 0.4 : 1 }} data-testid={`wrap-requirement-${reqId}`}>
                       {activePlan.rejected.includes(reqId) && <div className="modified-notice" style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}><X size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Rejected by Staff</div>}
                       {activePlan.overrides[reqId] && <div className="modified-notice" style={{ marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> {t.modifiedNotice}</div>}
                       
                       <RequirementCard 
                         reqId={reqId} 
                         language={language} 
                         simplified={simplified} 
                         note={activePlan.notes[reqId]} 
                       />
                    </div>
                  ))}
                </div>
                
                <aside className="plan-sidebar">
                  <div className="sidebar-card">
                    <h3>{t.yourDetails}</h3>
                    <div className="contact-row"><MapPin size={15} /><div><strong>{t.locationLabel}</strong><span>{activePlan.intake.address}, {activePlan.intake.zip}</span></div></div>
                    {activePlan.intake.files.length > 0 && <div className="contact-row"><FileText size={15} /><div><strong>{t.filesAttached}</strong><span>{t.fileCount(activePlan.intake.files.length)}</span></div></div>}
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

      <Chatbot />
      <Toaster />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/portal" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function App() {
  const [, setLocation] = useLocation();

  return (
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
          Prototype Sample Data — Not official city advice.
        </div>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/portal">
            <Show when="signed-in">
              <PortalRoute />
            </Show>
            <Show when="signed-out">
              <Redirect to="/" />
            </Show>
          </Route>
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </ClerkProvider>
    </WouterRouter>
  );
}

export default App;