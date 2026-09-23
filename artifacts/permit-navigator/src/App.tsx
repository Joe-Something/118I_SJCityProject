import { useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  Lightbulb,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  Languages,
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import {
  DISCLAIMER,
  requirementsConfig,
  type RequirementId,
  type BusinessType,
  type Modification,
} from './requirements';
import { copy, type Language } from './copy';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

const queryClient = new QueryClient();

type Intake = {
  businessType: BusinessType | '';
  businessOther: string;
  address: string;
  zip: string;
  description: string;
  modifications: Modification[];
  modificationOther: string;
  files: File[];
};

type ReviewState = 'draft' | 'sent' | 'reviewed';

const emptyIntake: Intake = {
  businessType: '',
  businessOther: '',
  address: '',
  zip: '',
  description: '',
  modifications: [],
  modificationOther: '',
  files: []
};

function Disclaimer({ className = '' }: { className?: string }) {
  return <div className={`disclaimer ${className}`} data-testid="text-prototype-disclaimer"><Info size={13} /> <span>{DISCLAIMER}</span></div>;
}

function getMatchedRequirements(intake: Intake): RequirementId[] {
  const customText = `${intake.businessOther} ${intake.modificationOther} ${intake.description}`.toLowerCase();
  const hasPredefinedBusiness = intake.businessType !== '' && intake.businessType !== 'other';
  const foodBusinesses: BusinessType[] = ['boba', 'cafe', 'restaurant', 'kitchen'];
  const buildingChanges: Modification[] = ['plumbing', 'walls', 'hvac', 'electrical', 'exterior'];
  
  const matches = (Object.keys(requirementsConfig) as RequirementId[]).filter(reqId => {
    // Deterministic matching from selected structured inputs.
    let exactMatch =
      ((reqId === 'business-registration' || reqId === 'zoning-clearance') && hasPredefinedBusiness) ||
      (reqId === 'health-safety' && foodBusinesses.includes(intake.businessType as BusinessType)) ||
      (reqId === 'building-permits' && buildingChanges.some(change => intake.modifications.includes(change))) ||
      (reqId === 'sign-permits' && (intake.modifications.includes('signage') || intake.modifications.includes('exterior')));
    
    // Keyword fallback matching with word boundaries
    let keywordMatch = false;
    if (reqId === 'health-safety') {
      keywordMatch = /\b(food|cook|kitchen|eat|bake|meat|drink|beverage|cafe|restaurant|boba)\b/i.test(customText);
    } else if (reqId === 'building-permits') {
      keywordMatch = /\b(build|construct|wall|walls|plumb|plumbing|pipe|water|electric|electrical|wire|hvac|air|heat|cool|vent)\b/i.test(customText);
    } else if (reqId === 'sign-permits') {
      keywordMatch = /\b(sign|signs|signage|banner|display|exterior|outside|awning)\b/i.test(customText);
    } else if (reqId === 'business-registration' || reqId === 'zoning-clearance') {
      // Broadly applicable if there's any sign of a business
      keywordMatch = /\b(open|store|shop|sell|service|office|business|company|location)\b/i.test(customText);
    }

    return exactMatch || keywordMatch;
  });

  // If there are matches but no general ones, add them if applicable
  const hasSpecifics = matches.some(m => !['business-registration', 'zoning-clearance'].includes(m));
  if (hasSpecifics) {
    if (!matches.includes('business-registration')) matches.push('business-registration');
    if (!matches.includes('zoning-clearance')) matches.push('zoning-clearance');
  }

  // Preserve original order based on config definition
  return (Object.keys(requirementsConfig) as RequirementId[]).filter(id => matches.includes(id));
}

function Topbar({
  language,
  setLanguage,
  customLanguage,
  setCustomLanguage,
  simplified,
  setSimplified,
  activeTab,
  setActiveTab,
}: {
  language: Language;
  setLanguage: (lang: Language) => void;
  customLanguage: string;
  setCustomLanguage: (val: string) => void;
  simplified: boolean;
  setSimplified: (val: boolean) => void;
  activeTab: 'applicant' | 'staff';
  setActiveTab: (tab: 'applicant' | 'staff') => void;
}) {
  const t = copy[language === 'other' ? 'en' : language];
  const wordCount = customLanguage.trim() ? customLanguage.trim().split(/\s+/).length : 0;
  
  return (
    <header className="topbar">
      <div className="brand" data-testid="brand-permit-navigator">
        <div className="brand-mark"><Landmark size={19} /></div>
        <div><div className="brand-name">Permit Navigator</div><div className="brand-sub">City of San José · Prototype</div></div>
      </div>
      
      <div className="topbar-tabs">
        <button className={`tab-button ${activeTab === 'applicant' ? 'active' : ''}`} onClick={() => setActiveTab('applicant')} data-testid="tab-applicant">{t.applicantView}</button>
        <button className={`tab-button ${activeTab === 'staff' ? 'active' : ''}`} onClick={() => setActiveTab('staff')} data-testid="tab-staff">{t.staffPortal}</button>
      </div>

      <div className="top-actions">
        <button className={`button-tertiary simplify-toggle ${simplified ? 'active' : ''}`} onClick={() => setSimplified(!simplified)} data-testid="button-simplify-language">
          <Lightbulb size={14} /> {simplified ? t.fullDescriptions : t.simplifyLanguage}
        </button>

        <div className="language-controls">
          <Languages size={15} className="text-muted-foreground" />
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} data-testid="select-language-global" aria-label="Select Language">
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="vi">Tiếng Việt</option>
            <option value="zh">中文</option>
            <option value="tl">Tagalog</option>
            <option value="other">Something else</option>
          </select>
          {language === 'other' && (
            <input
              type="text"
              value={customLanguage}
              onChange={(e) => setCustomLanguage(e.target.value)}
              placeholder={t.customLanguagePlaceholder}
              aria-label={t.customLanguageLabel}
              className={wordCount > 50 ? 'error' : ''}
              data-testid="input-custom-language"
            />
          )}
        </div>
      </div>
    </header>
  );
}

function Steps({ plan, language }: { plan: boolean; language: Language }) {
  const t = copy[language === 'other' ? 'en' : language];
  return <div className="steps-strip"><div className="steps-inner">
    <div className={`step ${!plan ? 'current' : ''}`}><span className="step-number">{plan ? <Check size={13} /> : '1'}</span> {t.step1}</div>
    <div className="step-line" />
    <div className={`step ${plan ? 'current' : ''}`}><span className="step-number">2</span> {t.step2}</div>
    <div className="step-line" />
    <div className="step"><span className="step-number">3</span> {t.step3}</div>
  </div></div>;
}

function IntakeForm({ intake, setIntake, onGenerate, language, customLanguage }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; customLanguage: string }) {
  const t = copy[language === 'other' ? 'en' : language];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  
  const update = (key: keyof Intake, value: Intake[keyof Intake]) => setIntake({ ...intake, [key]: value });
  const toggleModification = (mod: Modification) => update('modifications', intake.modifications.includes(mod) ? intake.modifications.filter((item) => item !== mod) : [...intake.modifications, mod]);
  
  const validateAndGenerate = () => {
    const next: Record<string, string> = {};
    if (!intake.businessType) next.business = t.errorBusiness;
    if (intake.businessType === 'other' && !intake.businessOther.trim()) next.businessOther = t.errorCustomBusiness;
    if (!intake.address.trim()) next.address = t.errorAddress;
    if (!/^\d{5}$/.test(intake.zip)) next.zip = t.errorZip;
    if (!intake.description.trim()) next.description = t.errorDescription;
    if (intake.modifications.length === 0) next.modifications = t.errorModifications;
    if (intake.modifications.includes('other') && !intake.modificationOther.trim()) next.modificationOther = t.errorCustomMod;
    
    if (language === 'other') {
      const trimmed = customLanguage.trim();
      if (!trimmed) {
        next.language = t.errorCustomLangRequired;
      } else {
        const words = trimmed.split(/\s+/).length;
        if (words > 50) next.language = t.errorLanguage;
      }
    }

    if (Object.keys(next).length) { setErrors(next); return; }
    setErrors({});
    onGenerate();
  };
  
  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (selected.some((file) => !allowed.includes(file.type))) {
      setErrors({ files: 'Please choose PDF, PNG, or JPG files only.' });
      return;
    }
    setErrors((current) => ({ ...current, files: '' }));
    update('files', [...intake.files, ...selected]);
  };
  
  return <section className="intake-card" aria-labelledby="intake-title">
    <div className="card-kicker">{t.startKicker}</div>
    <h2 id="intake-title">{t.startTitle}</h2>
    <p>{t.startBody}</p>
    
    <div className="field">
      <label htmlFor="business-type">{t.business} <span className="required">*</span></label>
      <select id="business-type" value={intake.businessType} onChange={(event) => update('businessType', event.target.value as BusinessType)} data-testid="select-business-type">
        <option value="">{t.selectOne}</option>
        {Object.entries(t.businessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {errors.business && <div className="field-error" data-testid="error-business">{errors.business}</div>}
      
      {intake.businessType === 'other' && (
        <div style={{ marginTop: '8px' }}>
          <textarea placeholder={t.businessOtherDesc} value={intake.businessOther} onChange={e => update('businessOther', e.target.value)} data-testid="textarea-business-other" style={{ minHeight: '60px' }} />
          {errors.businessOther && <div className="field-error">{errors.businessOther}</div>}
        </div>
      )}
    </div>
    
    <div className="field">
      <label>{t.location} <span className="required">*</span></label>
      <div className="input-row">
        <div><input id="address" placeholder={t.address} value={intake.address} onChange={(event) => update('address', event.target.value)} data-testid="input-address" aria-label={t.address} />{errors.address && <div className="field-error">{errors.address}</div>}</div>
        <div><input id="zip" inputMode="numeric" maxLength={5} placeholder={t.zip} value={intake.zip} onChange={(event) => update('zip', event.target.value.replace(/\D/g, ''))} data-testid="input-zip" aria-label={t.zip} />{errors.zip && <div className="field-error">{errors.zip}</div>}</div>
      </div>
    </div>
    
    <div className="field">
      <label htmlFor="description">{t.description} <span className="required">*</span></label>
      <textarea id="description" placeholder={t.descriptionPlaceholder} value={intake.description} onChange={(event) => update('description', event.target.value)} data-testid="textarea-description" />
      {errors.description && <div className="field-error" data-testid="error-description">{errors.description}</div>}
    </div>
    
    <span className="mod-label">{t.modifications} <span className="required">*</span></span>
    <div className="choice-grid">
      {Object.entries(t.modificationLabels).map(([value, label]) => <div className="choice" key={value}>
        <input type="checkbox" id={`mod-${value}`} checked={intake.modifications.includes(value as Modification)} onChange={() => toggleModification(value as Modification)} data-testid={`checkbox-modification-${value}`} />
        <label htmlFor={`mod-${value}`}>{label}</label>
      </div>)}
    </div>
    {errors.modifications && <div className="field-error" style={{ marginTop: '8px' }} data-testid="error-modifications">{errors.modifications}</div>}
    
    {intake.modifications.includes('other') && (
      <div className="field" style={{ marginTop: '12px' }}>
        <textarea placeholder={t.modOtherDesc} value={intake.modificationOther} onChange={e => update('modificationOther', e.target.value)} data-testid="textarea-modification-other" style={{ minHeight: '60px' }} />
        {errors.modificationOther && <div className="field-error">{errors.modificationOther}</div>}
      </div>
    )}
    
    <div className="field">
      <label>{t.documents}</label>
      <div className="upload-zone"><FileText size={17} /><span>{t.upload}</span><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple onChange={handleFiles} data-testid="input-documents" /></div>
      {intake.files.length > 0 && <div className="file-list" data-testid="text-uploaded-files">{intake.files.map((file) => file.name).join(', ')}</div>}
      {errors.files && <div className="field-error">{errors.files}</div>}
    </div>
    
    {errors.language && <div className="field-error" style={{ marginTop: '16px' }}>{errors.language}</div>}
    
    <button className="button-primary" onClick={validateAndGenerate} data-testid="button-generate-plan">{t.generate} <ArrowRight size={16} /></button>
    <Disclaimer className="intake-disclaimer" />
  </section>;
}

function IntakeView({ intake, setIntake, onGenerate, language, customLanguage }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; customLanguage: string }) {
  const t = copy[language === 'other' ? 'en' : language];
  return <><div className="hero-wrap"><main className="hero">
    <div>
      <div className="eyebrow">{t.eyebrow}</div>
      <h1>{t.title}</h1>
      <p className="hero-intro">{t.intro}</p>
      <div className="hero-trust">
        <span className="trust-item"><ShieldCheck size={15} /> {t.trust1}</span>
        <span className="trust-item"><Lightbulb size={15} /> {t.trust2}</span>
        <span className="trust-item"><ClipboardCheck size={15} /> {t.trust3}</span>
      </div>
    </div>
    <IntakeForm intake={intake} setIntake={setIntake} onGenerate={onGenerate} language={language} customLanguage={customLanguage} />
  </main></div><Steps plan={false} language={language} /><section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section></>;
}

function LoadingPlan({ language }: { language: Language }) {
  const t = copy[language === 'other' ? 'en' : language];
  return <div className="plan-shell loading-plan"><div className="loading-inner"><div className="loading-mark"><Sparkles size={25} /></div><h2>{t.loadingTitle}</h2><p>{t.loadingDesc}</p><div className="loading-track" /></div></div>;
}

function RequirementCard({ reqId, language, simplified, note, onEdit }: { reqId: RequirementId; language: Language; simplified: boolean; note?: string; onEdit?: () => void }) {
  const t = copy[language === 'other' ? 'en' : language];
  const reqCopy = t.requirements[reqId];
  const config = requirementsConfig[reqId];
  
  const displayedDesc = simplified ? reqCopy.simpDesc : reqCopy.desc;
  const displayedDocs = simplified ? reqCopy.simpDocs : reqCopy.docs;
  const displayedSteps = simplified ? reqCopy.simpSteps : reqCopy.steps;
  
  return <article className="requirement-card" data-testid={`card-requirement-${reqId}`}>
    <div className="requirement-top">
      <div className="req-icon"><Building2 size={18} /></div>
      <div><h3>{reqCopy.name}</h3><p>{displayedDesc}</p></div>
      <span className="req-department">{reqCopy.dept}</span>
    </div>
    <div className="req-body">
      <div><h4>{t.documentsLabel}</h4><ul>{displayedDocs.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div><h4>{t.nextSteps}</h4><ul>{displayedSteps.map((item) => <li key={item}>{item}</li>)}</ul><a className="source-link" href={config.source_url} target="_blank" rel="noreferrer" data-testid={`link-source-${reqId}`}>{t.source}: {reqCopy.sourceTitle} <ExternalLink size={12} /></a></div>
    </div>
    {note && <div className="req-note"><strong>{t.cityStaffNote}</strong> {note}</div>}
    {onEdit && <div style={{ padding: '0 20px 16px' }}><button className="button-tertiary" onClick={onEdit} data-testid={`button-edit-requirement-${reqId}`}><Pencil size={13} /> {t.editRecommendation}</button></div>}
    <Disclaimer className="req-note" />
  </article>;
}

function StaffPortal({ 
  intake, 
  reviewState, 
  setReviewState, 
  rejected, 
  setRejected,
  notes, 
  setNotes,
  overrides,
  setOverrides
}: { 
  intake: Intake;
  reviewState: ReviewState;
  setReviewState: (state: ReviewState) => void;
  rejected: RequirementId[];
  setRejected: (val: RequirementId[]) => void;
  notes: Record<string, string>;
  setNotes: (val: (c: Record<string, string>) => Record<string, string>) => void;
  overrides: Record<string, string>;
  setOverrides: (val: (c: Record<string, string>) => Record<string, string>) => void;
}) {
  const matched = useMemo(() => getMatchedRequirements(intake), [intake]);
  const [noteFor, setNoteFor] = useState<RequirementId | null>(null);
  const [noteText, setNoteText] = useState('');
  const [overrideFor, setOverrideFor] = useState<RequirementId | null>(null);
  const [overrideText, setOverrideText] = useState('');

  if (reviewState === 'draft') {
    return (
      <main className="plan-shell">
        <div className="no-match" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <ClipboardCheck size={42} color="hsl(var(--muted-foreground))" style={{ margin: '0 auto 16px' }} />
          <h2>Queue Empty</h2>
          <p>No plan has been submitted for review yet.</p>
        </div>
      </main>
    );
  }

  const isLocked = reviewState === 'reviewed';
  const hasUnsavedOverride = overrideFor !== null; // Blocks Complete Review if any override form is open (dirty or blank)

  return (
    <main className="plan-shell">
      <div className="plan-header">
        <div>
          <div className="eyebrow">City Staff Portal</div>
          <h1>Plan Review</h1>
          <p>Reviewing submitted action plan for {intake.address}</p>
        </div>
        <div className="plan-actions">
          {isLocked ? (
            <button className="button-secondary" onClick={() => setReviewState('sent')} data-testid="button-reopen-review">
              <Pencil size={16} /> Reopen Review
            </button>
          ) : (
            <button 
              className="button-primary" 
              onClick={() => setReviewState('reviewed')} 
              disabled={hasUnsavedOverride} 
              data-testid="button-complete-review"
            >
              <CheckCircle2 size={16} /> Complete Review
            </button>
          )}
        </div>
      </div>

      <div className="plan-grid">
        <div>
          <div className="staff-panel" data-testid="panel-staff-review">
            <div className="staff-panel-header">
              <div>
                <h2>City Staff Review Mode</h2>
                <p>Confirm, adjust, or explain each suggested starting point before the plan is marked as reviewed.</p>
              </div>
              <div className="staff-tools">
                <span className={`status-badge ${isLocked ? 'reviewed' : ''}`}><Clock3 size={13} /> {isLocked ? 'Review Completed' : 'Review in progress'}</span>
              </div>
            </div>

            {matched.map((reqId) => {
              const isRejected = rejected.includes(reqId);
              // Fallback to English for Staff Portal
              const reqCopyEn = copy['en'].requirements[reqId];
              const defaultDesc = reqCopyEn.desc;
              
              return (
                <div className="staff-edit" key={reqId} style={{ opacity: isRejected ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <strong style={{ fontSize: 13, textDecoration: isRejected ? 'line-through' : 'none' }}>{reqCopyEn.name}</strong>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {isRejected ? (
                        <button className="button-secondary" disabled={isLocked} onClick={() => setRejected(rejected.filter(id => id !== reqId))} data-testid={`button-reapprove-${reqId}`}><Check size={13} /> Re-approve</button>
                      ) : (
                        <>
                          <button className="button-secondary" disabled={isLocked} onClick={() => setNotes(c => ({ ...c, [reqId]: c[reqId] ?? 'Approved by City Staff.' }))} data-testid={`button-approve-${reqId}`}><Check size={13} /> Approve</button>
                          <button className="button-danger" disabled={isLocked} onClick={() => setRejected([...rejected, reqId])} data-testid={`button-reject-${reqId}`}><X size={13} /> Reject</button>
                        </>
                      )}
                      <button className="button-tertiary" disabled={isLocked} onClick={() => { setNoteFor(noteFor === reqId ? null : reqId); setNoteText(notes[reqId] ?? ''); }} data-testid={`button-note-${reqId}`}><Plus size={13} /> Note</button>
                      <button className="button-tertiary" disabled={isLocked} onClick={() => { setOverrideFor(overrideFor === reqId ? null : reqId); setOverrideText(overrides[reqId] ?? defaultDesc); }} data-testid={`button-override-${reqId}`}><Pencil size={13} /> Edit</button>
                    </div>
                  </div>
                  
                  {noteFor === reqId && (
                    <div className="staff-edit-actions" style={{ justifyContent: 'stretch' }}>
                      <input style={{ flex: 1 }} value={noteText} placeholder="Add a note for the applicant" onChange={(event) => setNoteText(event.target.value)} data-testid={`input-note-${reqId}`} />
                      <button className="button-primary" style={{ width: 'auto', marginTop: 0 }} onClick={() => { setNotes(c => ({ ...c, [reqId]: noteText })); setNoteFor(null); }} data-testid={`button-save-note-${reqId}`}>Save note</button>
                    </div>
                  )}

                  {overrideFor === reqId && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Override Recommendation Text</label>
                      <textarea value={overrideText} onChange={e => setOverrideText(e.target.value)} style={{ width: '100%', minHeight: '60px', padding: '8px', marginTop: '4px' }} />
                      <div className="staff-edit-actions">
                        <button className="button-primary" disabled={!overrideText.trim()} style={{ width: 'auto', marginTop: 0 }} onClick={() => { setOverrides(c => ({ ...c, [reqId]: overrideText })); setOverrideFor(null); }} data-testid={`button-save-override-${reqId}`}>Save Override</button>
                      </div>
                    </div>
                  )}
                  
                  {!overrideFor && overrides[reqId] && (
                    <div className="modified-notice" style={{ marginTop: '10px' }}><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Overridden: {overrides[reqId]}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="plan-sidebar">
           <div className="sidebar-card">
            <h3>Intake Details</h3>
            <div className="contact-row"><FileText size={15} /><div><strong>Project</strong><span>{intake.description}</span></div></div>
            <div className="contact-row"><MapPin size={15} /><div><strong>Location</strong><span>{intake.address}, {intake.zip}</span></div></div>
            <div className="contact-row"><Building2 size={15} /><div><strong>Business type</strong><span>{intake.businessType === 'other' ? intake.businessOther : (intake.businessType ? copy.en.businessLabels[intake.businessType as BusinessType] : '')}</span></div></div>
            <div className="contact-row"><ClipboardCheck size={15} /><div><strong>Planned changes</strong><span>{intake.modifications.length ? intake.modifications.map((item) => item === 'other' ? intake.modificationOther : copy.en.modificationLabels[item as Modification]).join(', ') : 'None selected'}</span></div></div>
            {intake.files.length > 0 && <div className="contact-row"><FileText size={15} /><div><strong>Files attached</strong><span>{intake.files.length} local file(s)</span></div></div>}
          </div>
        </aside>
      </div>
    </main>
  );
}

function PlanView({ 
  intake, 
  language, 
  simplified,
  onStartOver,
  reviewState,
  setReviewState,
  rejected,
  notes,
  overrides,
  setActiveTab
}: { 
  intake: Intake; 
  language: Language; 
  simplified: boolean;
  onStartOver: () => void;
  reviewState: ReviewState;
  setReviewState: (s: ReviewState) => void;
  rejected: RequirementId[];
  notes: Record<string, string>;
  overrides: Record<string, string>;
  setActiveTab: (t: 'applicant'|'staff') => void;
}) {
  const t = copy[language === 'other' ? 'en' : language];
  const matched = useMemo(() => getMatchedRequirements(intake), [intake]);
  const visible = matched.filter((reqId) => !rejected.includes(reqId));
  
  const sendToStaff = () => { 
    setReviewState('sent'); 
    toast({
      title: "Success",
      description: "Plan successfully submitted to City Staff queue.",
      duration: 10000,
      action: <ToastAction altText="View in City Staff Portal" onClick={() => setActiveTab('staff')}>View in City Staff Portal</ToastAction>
    });
  };

  const statusText = reviewState === 'reviewed' ? t.reviewedStatus : reviewState === 'sent' ? t.sentStatus : t.draftStatus;
  const hasOverrides = Object.keys(overrides).length > 0;

  return <><Steps plan language={language} /><main className="plan-shell">
    <div className="plan-header">
      <div>
        <div className="eyebrow">San José · {t.planTitle}</div>
        <h1>{t.planTitle}</h1>
        <p>{t.planIntro}</p>
        <Disclaimer className="intake-disclaimer" />
      </div>
      <div className="plan-actions">
        <span className={`status-badge ${reviewState === 'reviewed' ? 'reviewed' : reviewState === 'sent' ? 'sent' : ''}`} data-testid="status-plan">{statusText}</span>
        <button className="button-tertiary" onClick={() => window.print()} data-testid="button-print-plan"><Printer size={14} /> {t.print}</button>
        <button className="button-secondary" onClick={onStartOver} data-testid="button-start-over"><ArrowLeft size={14} /> {t.startOver}</button>
      </div>
    </div>
    
    {hasOverrides && reviewState === 'reviewed' && (
      <div className="modified-notice" data-testid="notice-modified-by-staff">
        <CheckCircle2 size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} /> 
        {t.modifiedNotice}
      </div>
    )}
    
    <div className="plan-grid">
      <div>
        <div className="summary-bar">
          <div className="summary-cell">
            <span className="summary-label">{t.businessTypeLabel}</span>
            <span className="summary-value" data-testid="text-plan-business">{intake.businessType === 'other' ? intake.businessOther : (intake.businessType ? t.businessLabels[intake.businessType as BusinessType] : '')}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">{t.locationLabel}</span>
            <span className="summary-value" data-testid="text-plan-address"><MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 3 }} /> {intake.address}, {intake.zip}</span>
          </div>
          <div className="summary-cell">
            <span className="summary-label">{t.matched}</span>
            <span className="summary-value">{visible.length} {t.matched}</span>
          </div>
        </div>
        
        <div className="section-title">
          <h2>{t.possibleRequirements}</h2>
          <span>{visible.length} {t.matched}</span>
        </div>
        
        {visible.length === 0 ? (
          <div className="no-match" data-testid="empty-no-match">
            <AlertCircle size={21} color="hsl(var(--accent))" />
            <h2>{t.noMatchTitle}</h2>
            <p>{t.noMatchDesc}</p>
            <Disclaimer />
          </div>
        ) : (
          visible.map((reqId) => {
            const overrideText = overrides[reqId];
            const isOverridden = reviewState === 'reviewed' && !!overrideText;
            
            // If it's overridden and marked reviewed, we simulate the 'overridden' structure directly
            // Otherwise, normal localized card
            if (isOverridden) {
              const reqCopy = t.requirements[reqId];
              const config = requirementsConfig[reqId];
              return (
                 <article className="requirement-card" key={reqId} data-testid={`card-requirement-${reqId}`}>
                  <div className="requirement-top"><div className="req-icon"><Building2 size={18} /></div><div><h3>{reqCopy.name}</h3><p>{overrideText}</p></div><span className="req-department">{reqCopy.dept}</span></div>
                  <div className="req-body"><div><h4>{t.documentsLabel}</h4><ul>{reqCopy.docs.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h4>{t.nextSteps}</h4><ul>{reqCopy.steps.map((item) => <li key={item}>{item}</li>)}</ul><a className="source-link" href={config.source_url} target="_blank" rel="noreferrer" data-testid={`link-source-${reqId}`}>{t.source}: {reqCopy.sourceTitle} <ExternalLink size={12} /></a></div></div>
                  {notes[reqId] && <div className="req-note"><strong>{t.cityStaffNote}</strong> {notes[reqId]}</div>}
                  <Disclaimer className="req-note" />
                </article>
              );
            }

            return (
              <RequirementCard 
                key={reqId} 
                reqId={reqId} 
                language={language} 
                simplified={simplified}
                note={reviewState === 'reviewed' ? notes[reqId] : undefined} 
              />
            )
          })
        )}
        
        <div className="section-title"><h2>{t.keepConversationClear}</h2></div>
        <div className="sidebar-card"><p>{t.contact}</p><div className="disclaimer"><Info size={13} /><span>{DISCLAIMER}</span></div></div>
      </div>
      
      <aside className="plan-sidebar">
        <div className="sidebar-card">
          <h3>{t.yourDetails}</h3>
          <div className="contact-row"><FileText size={15} /><div><strong>{t.projectLabel}</strong><span>{intake.description}</span></div></div>
          <div className="contact-row"><MapPin size={15} /><div><strong>{t.locationLabel}</strong><span>{intake.address}, {intake.zip}</span></div></div>
          <div className="contact-row"><Building2 size={15} /><div><strong>{t.businessTypeLabel}</strong><span>{intake.businessType === 'other' ? intake.businessOther : (intake.businessType ? t.businessLabels[intake.businessType as BusinessType] : '')}</span></div></div>
          <div className="contact-row"><ClipboardCheck size={15} /><div><strong>{t.plannedChangesLabel}</strong><span>{intake.modifications.length ? intake.modifications.map((item) => item === 'other' ? intake.modificationOther : t.modificationLabels[item]).join(', ') : t.noneSelected}</span></div></div>
          {intake.files.length > 0 && <div className="contact-row"><FileText size={15} /><div><strong>{t.filesAttached}</strong><span>{t.fileCount(intake.files.length)}</span></div></div>}
        </div>
        
        <div className="sidebar-card">
          <h3>{t.readyForSecondLook}</h3>
          <p>{t.sendToStaffDesc}</p>
          <button className="button-primary" onClick={sendToStaff} disabled={reviewState === 'sent' || reviewState === 'reviewed'} data-testid="button-send-city-staff">
            <Send size={14} /> {reviewState === 'sent' || reviewState === 'reviewed' ? t.sentStatus : t.staff}
          </button>
          <Disclaimer className="intake-disclaimer" />
        </div>
      </aside>
    </div>
  </main><section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section></>;
}

function Home() {
  const [activeTab, setActiveTab] = useState<'applicant' | 'staff'>('applicant');
  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [language, setLanguage] = useState<Language>('en');
  const [customLanguage, setCustomLanguage] = useState('');
  const [simplified, setSimplified] = useState(false);
  const [hasPlan, setHasPlan] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Shared state for the plan
  const [reviewState, setReviewState] = useState<ReviewState>('draft');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<RequirementId[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const startOver = () => { 
    setHasPlan(false); 
    setLoading(false); 
    setIntake(emptyIntake); 
    setReviewState('draft');
    setNotes({});
    setRejected([]);
    setOverrides({});
  };
  
  const generate = () => { 
    setLoading(true); 
    window.setTimeout(() => { 
      setLoading(false); 
      setHasPlan(true); 
    }, 1050); 
  };
  
  return (
    <div className="app-shell">
      <Topbar 
        language={language} 
        setLanguage={setLanguage} 
        customLanguage={customLanguage}
        setCustomLanguage={setCustomLanguage}
        simplified={simplified}
        setSimplified={setSimplified}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
      
      {activeTab === 'staff' ? (
        <StaffPortal 
          intake={intake}
          reviewState={reviewState}
          setReviewState={setReviewState}
          rejected={rejected}
          setRejected={setRejected}
          notes={notes}
          setNotes={setNotes}
          overrides={overrides}
          setOverrides={setOverrides}
        />
      ) : (
        loading ? (
          <LoadingPlan language={language} />
        ) : hasPlan ? (
          <PlanView 
            intake={intake} 
            language={language} 
            simplified={simplified}
            onStartOver={startOver}
            reviewState={reviewState}
            setReviewState={setReviewState}
            rejected={rejected}
            notes={notes}
            overrides={overrides}
            setActiveTab={setActiveTab}
          />
        ) : (
          <IntakeView 
            intake={intake} 
            setIntake={setIntake} 
            onGenerate={generate} 
            language={language} 
            customLanguage={customLanguage}
          />
        )
      )}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
