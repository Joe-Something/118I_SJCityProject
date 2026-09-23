import { useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Stepper } from './components/Stepper';
import { Chatbot } from './components/Chatbot';
import { ReviewCatalog, type ReviewRecord } from './components/ReviewCatalog';
import { checkLanguage, getLanguageBundle } from './utils/language';
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
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import {
  DISCLAIMER,
  requirementsConfig,
  type RequirementId,
  type BusinessType,
  type Modification,
  type Intake
} from './requirements';
import { copy, type Language } from './copy';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

const queryClient = new QueryClient();

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

type ActivePlan = {
  id: string;
  intake: Intake;
  language: Language;
  customLanguage: string;
  simplified: boolean;
  submittedAt: number;
  status: 'Draft — Requires Review' | 'In Review (Re-opened)';
  notes: Record<string, string>;
  overrides: Record<string, string>;
  rejected: RequirementId[];
  matched: RequirementId[];
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
    let exactMatch =
      ((reqId === 'business-registration' || reqId === 'zoning-clearance') && hasPredefinedBusiness) ||
      (reqId === 'health-safety' && foodBusinesses.includes(intake.businessType as BusinessType)) ||
      (reqId === 'building-permits' && buildingChanges.some(change => intake.modifications.includes(change))) ||
      (reqId === 'sign-permits' && (intake.modifications.includes('signage') || intake.modifications.includes('exterior')));
    
    let keywordMatch = false;
    if (reqId === 'health-safety') {
      keywordMatch = /\b(food|cook|kitchen|eat|bake|meat|drink|beverage|cafe|restaurant|boba)\b/i.test(customText);
    } else if (reqId === 'building-permits') {
      keywordMatch = /\b(build|construct|wall|walls|plumb|plumbing|pipe|water|electric|electrical|wire|hvac|air|heat|cool|vent)\b/i.test(customText);
    } else if (reqId === 'sign-permits') {
      keywordMatch = /\b(sign|signs|signage|banner|display|exterior|outside|awning)\b/i.test(customText);
    } else if (reqId === 'business-registration' || reqId === 'zoning-clearance') {
      keywordMatch = /\b(open|store|shop|sell|service|office|business|company|location)\b/i.test(customText);
    }

    return exactMatch || keywordMatch;
  });

  const hasSpecifics = matches.some(m => !['business-registration', 'zoning-clearance'].includes(m));
  if (hasSpecifics) {
    if (!matches.includes('business-registration')) matches.push('business-registration');
    if (!matches.includes('zoning-clearance')) matches.push('zoning-clearance');
  }

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
            <option value="other">{copy.en.languageOther}</option>
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

function IntakeForm({ intake, setIntake, onGenerate, language, setLanguage, customLanguage, setCustomLanguage }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; setLanguage: (l: Language) => void; customLanguage: string; setCustomLanguage: (v: string) => void }) {
  const t = copy[language === 'other' ? 'en' : language];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [languageCorrection, setLanguageCorrection] = useState<{ original: string, corrected: string, bundle: Language | 'other' } | null>(null);
  
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
    
    if (language === 'other' && customLanguage.trim()) {
      const correction = checkLanguage(customLanguage);
      if (correction) {
        setLanguageCorrection(correction);
        return;
      }
      const exactBundle = getLanguageBundle(customLanguage);
      if (exactBundle) {
        setLanguage(exactBundle);
        setCustomLanguage('');
      }
    }

    onGenerate();
  };

  const handleConfirmCorrection = () => {
    if (!languageCorrection) return;
    if (languageCorrection.bundle !== 'other') {
      setLanguage(languageCorrection.bundle);
      setCustomLanguage('');
    } else {
      setCustomLanguage(languageCorrection.corrected);
    }
    setLanguageCorrection(null);
    onGenerate();
  };

  const handleKeepOriginal = () => {
    setLanguageCorrection(null);
    onGenerate();
  };
  
  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (selected.some((file) => !allowed.includes(file.type))) {
      setErrors({ files: t.errorFileFormat || 'Please choose PDF, PNG, or JPG files only.' });
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
    
    {!languageCorrection ? (
      <button className="button-primary" onClick={validateAndGenerate} data-testid="button-generate-plan">{t.generate} <ArrowRight size={16} /></button>
    ) : (
      <div className="language-correction-prompt" style={{ marginTop: '22px', padding: '16px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--primary))', borderRadius: '8px' }} data-testid="prompt-language-correction">
        <p style={{ margin: '0 0 12px', fontSize: '14px' }}>Did you mean <strong>{languageCorrection.corrected}</strong>?</p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="button-primary" style={{ marginTop: 0, width: 'auto' }} onClick={handleConfirmCorrection} data-testid="button-confirm-language">Confirm</button>
          <button className="button-secondary" style={{ marginTop: 0 }} onClick={handleKeepOriginal} data-testid="button-keep-original-language">Keep Original</button>
        </div>
      </div>
    )}
    <Disclaimer className="intake-disclaimer" />
  </section>;
}

function IntakeView({ intake, setIntake, onGenerate, language, setLanguage, customLanguage, setCustomLanguage, onLoadSample }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; setLanguage: (l: Language) => void; customLanguage: string; setCustomLanguage: (v: string) => void; onLoadSample: () => void }) {
  const t = copy[language === 'other' ? 'en' : language];
  return <><div className="hero-wrap"><main className="hero">
    <div>
      <div className="eyebrow">{t.eyebrow}</div>
      <h1>{t.title}</h1>
      <p className="hero-intro">{t.intro}</p>
      <div className="hero-trust" style={{ marginBottom: 24 }}>
        <span className="trust-item"><ShieldCheck size={15} /> {t.trust1}</span>
        <span className="trust-item"><Lightbulb size={15} /> {t.trust2}</span>
        <span className="trust-item"><ClipboardCheck size={15} /> {t.trust3}</span>
      </div>
      <button 
        className="button-secondary" 
        onClick={onLoadSample}
        data-testid="button-load-sample"
      >
        Load Sample Application
      </button>
    </div>
    <IntakeForm intake={intake} setIntake={setIntake} onGenerate={onGenerate} language={language} setLanguage={setLanguage} customLanguage={customLanguage} setCustomLanguage={setCustomLanguage} />
  </main></div><section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section></>;
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

function StaffPlanReview({ 
  plan, 
  onUpdate, 
  onComplete 
}: { 
  plan: ActivePlan; 
  onUpdate: (updates: Partial<ActivePlan>) => void;
  onComplete: (status: ReviewRecord['status']) => void;
}) {
  const [noteFor, setNoteFor] = useState<RequirementId | null>(null);
  const [noteText, setNoteText] = useState('');
  const [overrideFor, setOverrideFor] = useState<RequirementId | null>(null);
  const [overrideText, setOverrideText] = useState('');

  const hasUnsavedOverride = overrideFor !== null;

  const handleComplete = () => {
    let status: ReviewRecord['status'] = 'Approved';
    if (plan.rejected.length > 0) status = 'Rejected';
    else if (Object.keys(plan.overrides).length > 0) status = 'Modified via Staff Override';
    onComplete(status);
  };

  const updateNotes = (reqId: string, val: string) => {
    onUpdate({ notes: { ...plan.notes, [reqId]: val } });
  };

  const updateOverrides = (reqId: string, val: string) => {
    onUpdate({ overrides: { ...plan.overrides, [reqId]: val } });
  };

  const toggleReject = (reqId: RequirementId) => {
    if (plan.rejected.includes(reqId)) {
      onUpdate({ rejected: plan.rejected.filter(id => id !== reqId) });
    } else {
      onUpdate({ rejected: [...plan.rejected, reqId] });
    }
  };

  return (
    <div className="plan-grid">
      <div>
        <div className="staff-panel" data-testid={`panel-staff-review-${plan.id}`}>
          <div className="staff-panel-header">
            <div>
              <h2>City Staff Review Mode</h2>
              <p>Confirm, adjust, or explain each suggested starting point before the plan is marked as reviewed.</p>
            </div>
            <div className="staff-tools">
               <button 
                  className="button-primary" 
                  onClick={handleComplete} 
                  disabled={hasUnsavedOverride} 
                  data-testid={`button-complete-review-${plan.id}`}
                  style={{ marginTop: 0 }}
                >
                  <CheckCircle2 size={16} /> Complete Review
                </button>
            </div>
          </div>

          {plan.matched.map((reqId) => {
            const isRejected = plan.rejected.includes(reqId);
            const reqCopyEn = copy['en'].requirements[reqId];
            const defaultDesc = reqCopyEn.desc;
            
            return (
              <div className="staff-edit" key={reqId} style={{ opacity: isRejected ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, textDecoration: isRejected ? 'line-through' : 'none' }}>{reqCopyEn.name}</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isRejected ? (
                      <button className="button-secondary" onClick={() => toggleReject(reqId)} data-testid={`button-reapprove-${plan.id}-${reqId}`}><Check size={13} /> Re-approve</button>
                    ) : (
                      <>
                        <button className="button-secondary" onClick={() => updateNotes(reqId, plan.notes[reqId] ?? 'Approved by City Staff.')} data-testid={`button-approve-${plan.id}-${reqId}`}><Check size={13} /> Approve</button>
                        <button className="button-danger" onClick={() => toggleReject(reqId)} data-testid={`button-reject-${plan.id}-${reqId}`}><X size={13} /> Reject</button>
                      </>
                    )}
                    <button className="button-tertiary" onClick={() => { setNoteFor(noteFor === reqId ? null : reqId); setNoteText(plan.notes[reqId] ?? ''); }} data-testid={`button-note-${plan.id}-${reqId}`}><Plus size={13} /> Note</button>
                    <button className="button-tertiary" onClick={() => { setOverrideFor(overrideFor === reqId ? null : reqId); setOverrideText(plan.overrides[reqId] ?? defaultDesc); }} data-testid={`button-override-${plan.id}-${reqId}`}><Pencil size={13} /> Edit</button>
                  </div>
                </div>
                
                {noteFor === reqId && (
                  <div className="staff-edit-actions" style={{ justifyContent: 'stretch' }}>
                    <input style={{ flex: 1 }} value={noteText} placeholder="Add a note for the applicant" onChange={(event) => setNoteText(event.target.value)} data-testid={`input-note-${plan.id}-${reqId}`} />
                    <button className="button-primary" style={{ width: 'auto', marginTop: 0 }} onClick={() => { updateNotes(reqId, noteText); setNoteFor(null); }} data-testid={`button-save-note-${plan.id}-${reqId}`}>Save note</button>
                  </div>
                )}

                {overrideFor === reqId && (
                  <div style={{ marginTop: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Override Recommendation Text</label>
                    <textarea value={overrideText} onChange={e => setOverrideText(e.target.value)} style={{ width: '100%', minHeight: '60px', padding: '8px', marginTop: '4px' }} data-testid={`textarea-override-${plan.id}-${reqId}`} />
                    <div className="staff-edit-actions">
                      <button className="button-primary" disabled={!overrideText.trim()} style={{ width: 'auto', marginTop: 0 }} onClick={() => { updateOverrides(reqId, overrideText); setOverrideFor(null); }} data-testid={`button-save-override-${plan.id}-${reqId}`}>Save Override</button>
                    </div>
                  </div>
                )}
                
                {!overrideFor && plan.overrides[reqId] && (
                  <div className="modified-notice" style={{ marginTop: '10px' }}><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Overridden: {plan.overrides[reqId]}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <aside className="plan-sidebar">
         <div className="sidebar-card">
          <h3>Intake Details</h3>
          <div className="contact-row"><FileText size={15} /><div><strong>Project</strong><span>{plan.intake.description}</span></div></div>
          <div className="contact-row"><MapPin size={15} /><div><strong>Location</strong><span>{plan.intake.address}, {plan.intake.zip}</span></div></div>
          <div className="contact-row"><Building2 size={15} /><div><strong>Business type</strong><span>{plan.intake.businessType === 'other' ? plan.intake.businessOther : (plan.intake.businessType ? copy.en.businessLabels[plan.intake.businessType as BusinessType] : '')}</span></div></div>
          <div className="contact-row"><ClipboardCheck size={15} /><div><strong>Planned changes</strong><span>{plan.intake.modifications.length ? plan.intake.modifications.map((item) => item === 'other' ? plan.intake.modificationOther : copy.en.modificationLabels[item as Modification]).join(', ') : 'None selected'}</span></div></div>
          {plan.intake.files.length > 0 && <div className="contact-row"><FileText size={15} /><div><strong>Files attached</strong><span>{plan.intake.files.length} local file(s)</span></div></div>}
        </div>
      </aside>
    </div>
  );
}

function StaffPortal({ 
  activeQueue, 
  catalog, 
  onCompleteReview, 
  onUpdateActivePlan,
  onReopenReview
}: { 
  activeQueue: ActivePlan[];
  catalog: ReviewRecord[];
  onCompleteReview: (planId: string, finalStatus: ReviewRecord['status']) => void;
  onUpdateActivePlan: (planId: string, updates: Partial<ActivePlan>) => void;
  onReopenReview: (recordId: string) => void;
}) {
  const [staffTab, setStaffTab] = useState<'queue' | 'catalog'>('queue');
  const [expandedPlans, setExpandedPlans] = useState<string[]>([]);

  const handleReopen = (id: string) => {
    onReopenReview(id);
    setStaffTab('queue');
    setExpandedPlans(prev => Array.from(new Set([...prev, id])));
  };

  const toggleExpand = (id: string) => {
    setExpandedPlans(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  return (
    <main className="plan-shell">
      <div className="verification-notice" data-testid="notice-staff-verification">
        <AlertCircle size={18} />
        <span>Notice: City staff review is required. Business owners must verify all information directly with the appropriate City department before starting work or signing lease agreements.</span>
      </div>
      <div className="staff-tabs">
        <button 
          className={`tab-button ${staffTab === 'queue' ? 'active' : ''}`} 
          onClick={() => setStaffTab('queue')}
          data-testid="tab-staff-queue"
        >
          Active Review Queue ({activeQueue.length})
        </button>
        <button 
          className={`tab-button ${staffTab === 'catalog' ? 'active' : ''}`} 
          onClick={() => setStaffTab('catalog')}
          data-testid="tab-staff-catalog"
        >
          Review Catalog & History
        </button>
      </div>

      {staffTab === 'catalog' ? (
        <ReviewCatalog records={catalog} onReopen={handleReopen} />
      ) : activeQueue.length === 0 ? (
        <div className="no-match" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <ClipboardCheck size={42} color="hsl(var(--muted-foreground))" style={{ margin: '0 auto 16px' }} />
          <h2>Queue Empty</h2>
          <p>No plan has been submitted for review yet.</p>
        </div>
      ) : (
        <div className="active-queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeQueue.map(plan => (
            <div key={plan.id} className="active-plan-card" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', overflow: 'hidden' }} data-testid={`active-plan-${plan.id}`}>
              <div 
                className="active-plan-header" 
                onClick={() => toggleExpand(plan.id)} 
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', padding: '16px', background: expandedPlans.includes(plan.id) ? 'hsl(var(--muted) / 0.3)' : 'transparent' }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>{plan.intake.address}</div>
                  <div style={{ fontSize: '13px', color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <Building2 size={13} /> {copy[plan.language === 'other' ? 'en' : plan.language].businessLabels[plan.intake.businessType as BusinessType] || plan.intake.businessOther}
                    <span>&middot;</span>
                    {plan.intake.modifications.map(m => m === 'other' ? plan.intake.modificationOther : copy.en.modificationLabels[m]).join(', ')}
                    <span>&middot;</span>
                    <Clock3 size={13} /> {new Date(plan.submittedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span className={`status-badge`} style={{ backgroundColor: plan.status.includes('Re-opened') ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--accent) / 0.15)', color: plan.status.includes('Re-opened') ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}>{plan.status}</span>
                  <div style={{ padding: '4px', background: 'hsl(var(--border) / 0.5)', borderRadius: '6px', color: 'hsl(var(--muted-foreground))' }}>
                    {expandedPlans.includes(plan.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
              </div>
              
              {expandedPlans.includes(plan.id) && (
                <div className="active-plan-body" style={{ padding: '0 20px 20px', borderTop: '1px solid hsl(var(--border))' }}>
                  <StaffPlanReview 
                    plan={plan} 
                    onUpdate={(updates) => onUpdateActivePlan(plan.id, updates)} 
                    onComplete={(status) => {
                       onCompleteReview(plan.id, status);
                       setExpandedPlans(prev => prev.filter(p => p !== plan.id));
                    }} 
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function PlanView({ 
  intake, 
  language, 
  simplified,
  onStartOver,
  reviewState,
  rejected,
  notes,
  overrides,
  onSendToStaff,
  setActiveTab
}: { 
  intake: Intake; 
  language: Language; 
  simplified: boolean;
  onStartOver: () => void;
  reviewState: 'draft' | 'sent' | 'reviewed';
  rejected: RequirementId[];
  notes: Record<string, string>;
  overrides: Record<string, string>;
  onSendToStaff: () => void;
  setActiveTab: (t: 'applicant'|'staff') => void;
}) {
  const t = copy[language === 'other' ? 'en' : language];
  const matched = useMemo(() => getMatchedRequirements(intake), [intake]);
  const visible = matched.filter((reqId) => !rejected.includes(reqId));
  
  const statusText = reviewState === 'reviewed' ? t.reviewedStatus : reviewState === 'sent' ? t.sentStatus : t.draftStatus;
  const hasOverrides = Object.keys(overrides).length > 0;

  return <><main className="plan-shell">
    <div className="verification-notice" data-testid="text-verification-notice">
      Notice: City staff review is required. Business owners must verify all information directly with the appropriate City department before starting work or signing lease agreements.
    </div>

    {language === 'other' && (
      <div className="verification-notice" style={{ backgroundColor: 'hsl(var(--muted))', color: 'hsl(var(--foreground))', border: '1px solid hsl(var(--border))', marginTop: '-12px' }}>
        <Info size={16} style={{ display: 'inline-block', verticalAlign: 'text-bottom', marginRight: '8px' }} />
        <span>Content remains in English for this prototype.</span>
      </div>
    )}
    
    <div className="plan-header" style={{ marginTop: '20px' }}>
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
      <div className="modified-notice" data-testid="notice-modified">
        <CheckCircle2 size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} /> {t.modifiedNotice}
      </div>
    )}
    
    {visible.length === 0 ? (
      <div className="no-match" data-testid="no-match-state">
        <AlertCircle size={32} color="hsl(var(--accent))" style={{ marginBottom: 12 }} />
        <h2>{t.noMatchTitle}</h2>
        <p>{t.noMatchDesc}</p>
      </div>
    ) : (
      <div className="plan-grid">
        <div>
          <div className="summary-bar" aria-label={t.yourDetails}>
            <div className="summary-cell"><span className="summary-label">{t.projectLabel}</span><span className="summary-value" data-testid="summary-project">{intake.description}</span></div>
            <div className="summary-cell"><span className="summary-label">{t.locationLabel}</span><span className="summary-value" data-testid="summary-location">{intake.address}, {intake.zip}</span></div>
            <div className="summary-cell"><span className="summary-label">{t.businessTypeLabel}</span><span className="summary-value" data-testid="summary-business">{intake.businessType === 'other' ? intake.businessOther : (intake.businessType ? t.businessLabels[intake.businessType as BusinessType] : '')}</span></div>
          </div>
          <div className="section-title">
            <h2>{t.possibleRequirements}</h2>
            <span>{visible.length} {t.matched}</span>
          </div>
          {visible.map((reqId) => (
            <RequirementCard 
              key={reqId} 
              reqId={reqId} 
              language={language} 
              simplified={simplified} 
              note={reviewState === 'reviewed' ? notes[reqId] : undefined}
            />
          ))}
        </div>
        <aside className="plan-sidebar">
          <div className="sidebar-card">
            <h3>{t.readyForSecondLook}</h3>
            <p>{t.sendToStaffDesc}</p>
            {reviewState === 'draft' ? (
              <button className="button-primary" onClick={onSendToStaff} data-testid="button-send-staff"><Send size={14} /> {t.staff}</button>
            ) : (
              <button className="button-secondary" disabled data-testid="button-sent-staff" style={{ width: '100%', marginTop: 22 }}><CheckCircle2 size={14} /> {statusText}</button>
            )}
          </div>
          <div className="sidebar-card">
            <h3>{t.makeEasierToRead}</h3>
            <p>{t.makeEasierDesc}</p>
          </div>
        </aside>
      </div>
    )}
  </main>
  <section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section></>;
}

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const [customLanguage, setCustomLanguage] = useState('');
  const [simplified, setSimplified] = useState(false);
  const [activeTab, setActiveTab] = useState<'applicant' | 'staff'>('applicant');

  const [activeQueue, setActiveQueue] = useState<ActivePlan[]>([]);
  const [catalog, setCatalog] = useState<ReviewRecord[]>([]);

  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [applicantPlanId, setApplicantPlanId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const applicantPlanInCatalog = applicantPlanId ? catalog.find(p => p.id === applicantPlanId) : null;
  const applicantPlanInQueue = applicantPlanId ? activeQueue.find(p => p.id === applicantPlanId) : null;

  const currentReviewState: 'draft' | 'sent' | 'reviewed' = applicantPlanInCatalog ? 'reviewed' 
    : applicantPlanInQueue ? 'sent' 
    : 'draft';

  const currentRejected = applicantPlanInCatalog?.rejected || applicantPlanInQueue?.rejected || [];
  const currentOverrides = applicantPlanInCatalog?.overrides || applicantPlanInQueue?.overrides || {};
  const currentNotes = applicantPlanInCatalog?.notes || applicantPlanInQueue?.notes || {};

  const handleGenerate = () => {
    if (!applicantPlanId) {
      setIsGenerating(true);
      setTimeout(() => {
        setIsGenerating(false);
        setApplicantPlanId(`plan-${Date.now()}`);
      }, 1200);
    }
  };

  const handleStartOver = () => {
    setIntake(emptyIntake);
    setApplicantPlanId(null);
  };

  const loadSample = () => {
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

  const handleSendToStaff = () => {
    if (!applicantPlanId || currentReviewState !== 'draft') return;
    const newPlan: ActivePlan = {
      id: applicantPlanId,
      intake,
      language,
      customLanguage,
      simplified,
      submittedAt: Date.now(),
      status: 'Draft — Requires Review',
      notes: {},
      overrides: {},
      rejected: [],
      matched: getMatchedRequirements(intake)
    };
    setActiveQueue(prev => [...prev, newPlan]);
    
    toast({
      title: "Success",
      description: "Plan successfully submitted to City Staff queue.",
      duration: 10000,
      action: <ToastAction altText="View in City Staff Portal" onClick={() => setActiveTab('staff')}>View in City Staff Portal</ToastAction>
    });
  };

  const handleUpdateActivePlan = (planId: string, updates: Partial<ActivePlan>) => {
    setActiveQueue(prev => prev.map(p => p.id === planId ? { ...p, ...updates } : p));
  };

  const handleCompleteReview = (planId: string, status: ReviewRecord['status']) => {
    const plan = activeQueue.find(p => p.id === planId);
    if (!plan) return;
    
    const record: ReviewRecord = {
      ...plan,
      completedAt: Date.now(),
      status
    };
    
    setActiveQueue(prev => prev.filter(p => p.id !== planId));
    setCatalog(prev => [record, ...prev]);
  };

  const handleReopenReview = (recordId: string) => {
    const record = catalog.find(r => r.id === recordId);
    if (!record) return;
    
    const reopenedPlan: ActivePlan = {
      id: record.id,
      intake: record.intake,
      language: record.language,
      customLanguage: record.customLanguage,
      simplified: record.simplified,
      submittedAt: record.submittedAt,
      status: 'In Review (Re-opened)',
      notes: record.notes,
      overrides: record.overrides,
      rejected: record.rejected,
      matched: record.matched
    };
    
    setCatalog(prev => prev.filter(r => r.id !== recordId));
    setActiveQueue(prev => [reopenedPlan, ...prev]);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider>
          <div className="global-safety-banner" data-testid="banner-global-safety">
            Prototype Sample Data — Not official city advice.
          </div>
          <div className="app-shell">
            <Topbar 
              language={language} setLanguage={setLanguage} 
              customLanguage={customLanguage} setCustomLanguage={setCustomLanguage} 
              simplified={simplified} setSimplified={setSimplified} 
              activeTab={activeTab} setActiveTab={setActiveTab} 
            />
            <Stepper activeTab={activeTab} hasPlan={applicantPlanId !== null} reviewState={currentReviewState} />
            
            {activeTab === 'applicant' ? (
              isGenerating ? (
                <LoadingPlan language={language} />
              ) : !applicantPlanId ? (
                <IntakeView 
                  intake={intake} setIntake={setIntake} 
                  onGenerate={handleGenerate} 
                  language={language} setLanguage={setLanguage}
                  customLanguage={customLanguage} setCustomLanguage={setCustomLanguage}
                  onLoadSample={loadSample}
                />
              ) : (
                <PlanView 
                  intake={intake} 
                  language={language} 
                  simplified={simplified} 
                  onStartOver={handleStartOver}
                  reviewState={currentReviewState}
                  rejected={currentRejected}
                  notes={currentNotes}
                  overrides={currentOverrides}
                  onSendToStaff={handleSendToStaff}
                  setActiveTab={setActiveTab}
                />
              )
            ) : (
              <StaffPortal 
                activeQueue={activeQueue}
                catalog={catalog}
                onCompleteReview={handleCompleteReview}
                onUpdateActivePlan={handleUpdateActivePlan}
                onReopenReview={handleReopenReview}
              />
            )}
            
            <Chatbot />
          </div>
          <Toaster />
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
