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
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import {
  DISCLAIMER,
  businessLabels,
  modificationLabels,
  requirements,
  type BusinessType,
  type Modification,
  type Requirement,
} from './requirements';

const queryClient = new QueryClient();

type Intake = {
  businessType: BusinessType | '';
  address: string;
  zip: string;
  description: string;
  modifications: Modification[];
  files: File[];
};

type Language = 'en' | 'es';
type ReviewState = 'draft' | 'sent' | 'reviewed' | 'rejected';

const emptyIntake: Intake = { businessType: '', address: '', zip: '', description: '', modifications: [], files: [] };

const copy = {
  en: {
    newGuide: 'New business permit guide',
    eyebrow: 'San José · Small business navigator',
    title: <>A clearer first step for your <em>new business.</em></>,
    intro: 'Tell us a little about your project. We’ll organize possible city touchpoints into a practical plan you can review with City Staff.',
    trust1: 'Built for first-time owners',
    trust2: 'Plain-language steps',
    trust3: 'City Staff review built in',
    startKicker: 'Start here',
    startTitle: 'Tell us about your project',
    startBody: 'A few details help us find the right starting points. This takes about two minutes.',
    business: 'What are you opening?',
    location: 'Where will it be located?',
    address: 'Street address',
    zip: 'ZIP code',
    description: 'Project description',
    descriptionPlaceholder: 'Briefly tell us what you plan to do at this location...',
    preferredLanguage: 'Preferred language',
    modifications: 'What changes are planned?',
    documents: 'Have documents already?',
    upload: 'Add plans, lease, or other files',
    generate: 'Build my action plan',
    noFiles: 'No file chosen',
    planTitle: 'Your action plan',
    planIntro: 'A starting point organized from the details you shared.',
    review: 'Requires review',
    print: 'Print / save plan',
    staff: 'Send to City Staff',
    startOver: 'Start over',
    matched: 'possible starting points',
    nextSteps: 'Suggested next steps',
    docs: 'Have ready',
    source: 'Source',
    contact: 'Questions? Start with the department listed on each item.',
  },
  es: {
    newGuide: 'Guía para nuevos negocios',
    eyebrow: 'San José · Guía para pequeños negocios',
    title: <>Un primer paso más claro para su <em>nuevo negocio.</em></>,
    intro: 'Cuéntenos un poco sobre su proyecto. Organizaremos posibles trámites en un plan práctico para revisar con el personal de la Ciudad.',
    trust1: 'Para dueños primerizos',
    trust2: 'Pasos en lenguaje sencillo',
    trust3: 'Revisión del personal incluida',
    startKicker: 'Comience aquí',
    startTitle: 'Cuéntenos sobre su proyecto',
    startBody: 'Unos detalles nos ayudan a encontrar los puntos de partida correctos. Toma aproximadamente dos minutos.',
    business: '¿Qué va a abrir?',
    location: '¿Dónde estará ubicado?',
    address: 'Dirección',
    zip: 'Código postal',
    description: 'Descripción del proyecto',
    descriptionPlaceholder: 'Describa brevemente lo que planea hacer en esta ubicación...',
    preferredLanguage: 'Idioma preferido',
    modifications: '¿Qué cambios planea?',
    documents: '¿Ya tiene documentos?',
    upload: 'Agregue planos, contrato u otros archivos',
    generate: 'Crear mi plan de acción',
    noFiles: 'No se eligió archivo',
    planTitle: 'Su plan de acción',
    planIntro: 'Un punto de partida organizado con los detalles que compartió.',
    review: 'Requiere revisión',
    print: 'Imprimir / guardar plan',
    staff: 'Enviar al personal',
    startOver: 'Comenzar de nuevo',
    matched: 'posibles puntos de partida',
    nextSteps: 'Siguientes pasos sugeridos',
    docs: 'Tenga listo',
    source: 'Fuente',
    contact: '¿Preguntas? Comience con el departamento indicado en cada tema.',
  },
};

function Disclaimer({ className = '' }: { className?: string }) {
  return <div className={`disclaimer ${className}`} data-testid="text-prototype-disclaimer"><Info size={13} /> <span>{DISCLAIMER}</span></div>;
}

function Topbar({ language, setLanguage, onStartOver, canStartOver }: { language: Language; setLanguage: (lang: Language) => void; onStartOver: () => void; canStartOver: boolean }) {
  return (
    <header className="topbar">
      <div className="brand" data-testid="brand-permit-navigator">
        <div className="brand-mark"><Landmark size={19} /></div>
        <div><div className="brand-name">Permit Navigator</div><div className="brand-sub">City of San José · Prototype</div></div>
      </div>
      <div className="top-actions">
        {canStartOver && <button className="text-button" onClick={onStartOver} data-testid="button-start-over-top"><ArrowLeft size={14} /> {copy[language].startOver}</button>}
        <div className="language-toggle" aria-label="Choose language">
          <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} data-testid="button-language-en">EN</button>
          <button className={language === 'es' ? 'active' : ''} onClick={() => setLanguage('es')} data-testid="button-language-es">ES</button>
        </div>
      </div>
    </header>
  );
}

function Steps({ plan }: { plan: boolean }) {
  return <div className="steps-strip"><div className="steps-inner">
    <div className={`step ${!plan ? 'current' : ''}`}><span className="step-number">{plan ? <Check size={13} /> : '1'}</span> Tell us about your project</div>
    <div className="step-line" />
    <div className={`step ${plan ? 'current' : ''}`}><span className="step-number">2</span> Review your action plan</div>
    <div className="step-line" />
    <div className="step"><span className="step-number">3</span> Talk with City Staff</div>
  </div></div>;
}

function IntakeForm({ intake, setIntake, onGenerate, language, setLanguage }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; setLanguage: (lang: Language) => void }) {
  const t = copy[language];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (key: keyof Intake, value: Intake[keyof Intake]) => setIntake({ ...intake, [key]: value });
  const toggleModification = (mod: Modification) => update('modifications', intake.modifications.includes(mod) ? intake.modifications.filter((item) => item !== mod) : [...intake.modifications, mod]);
  const validateAndGenerate = () => {
    const next: Record<string, string> = {};
    if (!intake.businessType) next.business = language === 'es' ? 'Elija el tipo de negocio más cercano.' : 'Choose the closest business type.';
    if (!intake.address.trim()) next.address = language === 'es' ? 'Ingrese la dirección del proyecto.' : 'Enter the project street address.';
    if (!/^\d{5}$/.test(intake.zip)) next.zip = language === 'es' ? 'Ingrese un código postal de 5 dígitos.' : 'Enter a 5-digit ZIP code.';
    if (!intake.description.trim()) next.description = language === 'es' ? 'Proporcione una breve descripción del proyecto.' : 'Please provide a brief project description.';
    if (intake.modifications.length === 0) next.modifications = language === 'es' ? 'Seleccione al menos un cambio planeado.' : 'Please select at least one planned change.';
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
      <label htmlFor="preferred-language">{t.preferredLanguage} <span className="required">*</span></label>
      <select id="preferred-language" value={language} onChange={(event) => setLanguage(event.target.value as Language)} data-testid="select-preferred-language">
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
    </div>
    <div className="field">
      <label htmlFor="business-type">{t.business} <span className="required">*</span></label>
      <select id="business-type" value={intake.businessType} onChange={(event) => update('businessType', event.target.value as BusinessType)} data-testid="select-business-type">
        <option value="">Select one</option>
        {Object.entries(businessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {errors.business && <div className="field-error" data-testid="error-business">{errors.business}</div>}
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
      {Object.entries(modificationLabels).map(([value, label]) => <div className="choice" key={value}>
        <input type="checkbox" id={`mod-${value}`} checked={intake.modifications.includes(value as Modification)} onChange={() => toggleModification(value as Modification)} data-testid={`checkbox-modification-${value}`} />
        <label htmlFor={`mod-${value}`}>{label}</label>
      </div>)}
    </div>
    {errors.modifications && <div className="field-error" style={{ marginTop: '8px' }} data-testid="error-modifications">{errors.modifications}</div>}
    <div className="field">
      <label>{t.documents}</label>
      <div className="upload-zone"><FileText size={17} /><span>{t.upload}</span><input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" multiple onChange={handleFiles} data-testid="input-documents" /></div>
      {intake.files.length > 0 && <div className="file-list" data-testid="text-uploaded-files">{intake.files.map((file) => file.name).join(', ')}</div>}
      {errors.files && <div className="field-error">{errors.files}</div>}
    </div>
    <button className="button-primary" onClick={validateAndGenerate} data-testid="button-generate-plan">{t.generate} <ArrowRight size={16} /></button>
    <Disclaimer className="intake-disclaimer" />
  </section>;
}

function IntakeView({ intake, setIntake, onGenerate, language, setLanguage }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; setLanguage: (lang: Language) => void }) {
  const t = copy[language];
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
    <IntakeForm intake={intake} setIntake={setIntake} onGenerate={onGenerate} language={language} setLanguage={setLanguage} />
  </main></div><Steps plan={false} /><section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section></>;
}

function LoadingPlan({ language }: { language: Language }) {
  return <div className="plan-shell loading-plan"><div className="loading-inner"><div className="loading-mark"><Sparkles size={25} /></div><h2>{language === 'es' ? 'Organizando su plan' : 'Organizing your plan'}</h2><p>{language === 'es' ? 'Estamos revisando los detalles del proyecto…' : 'We’re reviewing the project details and finding useful starting points…'}</p><div className="loading-track" /></div></div>;
}

function RequirementCard({ requirement, language, note, onEdit }: { requirement: Requirement; language: Language; note?: string; onEdit?: () => void }) {
  const simplified = language === 'es' ? `Versión sencilla: ${requirement.simplified_description}` : requirement.simplified_description;
  return <article className="requirement-card" data-testid={`card-requirement-${requirement.id}`}>
    <div className="requirement-top"><div className="req-icon"><Building2 size={18} /></div><div><h3>{requirement.requirement_name}</h3><p>{simplified}</p></div><span className="req-department">{requirement.city_department}</span></div>
    <div className="req-body"><div><h4>{language === 'es' ? 'Documentos' : 'Documents'}</h4><ul>{requirement.required_documents.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h4>{copy[language].nextSteps}</h4><ul>{requirement.suggested_next_steps.map((item) => <li key={item}>{item}</li>)}</ul><a className="source-link" href={requirement.source_url} target="_blank" rel="noreferrer" data-testid={`link-source-${requirement.id}`}>{copy[language].source}: {requirement.source_title} <ExternalLink size={12} /></a></div></div>
    {note && <div className="req-note"><strong>City Staff note:</strong> {note}</div>}
    {onEdit && <div style={{ padding: '0 20px 16px' }}><button className="button-tertiary" onClick={onEdit} data-testid={`button-edit-requirement-${requirement.id}`}><Pencil size={13} /> Edit recommendation</button></div>}
    <Disclaimer className="req-note" />
  </article>;
}

function StaffReview({ requirementsToShow, notes, onApprove, onReject, onAddNote, onOverride, override, language }: {
  requirementsToShow: Requirement[]; notes: Record<string, string>; onApprove: (id: string) => void; onReject: (id: string) => void; onAddNote: (id: string, note: string) => void; onOverride: (id: string, description: string) => void; override: { id: string; description: string } | null; language: Language;
}) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [overrideText, setOverrideText] = useState(override?.description ?? '');
  const t = copy[language];
  return <div className="staff-panel" data-testid="panel-staff-review">
    <div className="staff-panel-header"><div><h2>City Staff Review Mode</h2><p>Confirm, adjust, or explain each suggested starting point before the plan is sent back.</p></div><div className="staff-tools"><span className="status-badge"><Clock3 size={13} /> Review in progress</span></div></div>
    {requirementsToShow.map((requirement) => <div className="staff-edit" key={requirement.id}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><strong style={{ fontSize: 13 }}>{requirement.requirement_name}</strong><div style={{ display: 'flex', gap: 6 }}><button className="button-secondary" onClick={() => onApprove(requirement.id)} data-testid={`button-approve-${requirement.id}`}><Check size={13} /> Approve</button><button className="button-danger" onClick={() => onReject(requirement.id)} data-testid={`button-reject-${requirement.id}`}><X size={13} /> Reject</button><button className="button-tertiary" onClick={() => { setNoteFor(noteFor === requirement.id ? null : requirement.id); setNoteText(notes[requirement.id] ?? ''); }} data-testid={`button-note-${requirement.id}`}><Plus size={13} /> Note</button></div></div>
      {noteFor === requirement.id && <div className="staff-edit-actions" style={{ justifyContent: 'stretch' }}><input style={{ flex: 1 }} value={noteText} placeholder="Add a note for the applicant" onChange={(event) => setNoteText(event.target.value)} data-testid={`input-note-${requirement.id}`} /><button className="button-primary" style={{ width: 'auto', marginTop: 0 }} onClick={() => { onAddNote(requirement.id, noteText); setNoteFor(null); }} data-testid={`button-save-note-${requirement.id}`}>Save note</button></div>}
    </div>)}
    {requirementsToShow.length > 0 && <div className="staff-edit" style={{ marginTop: 17 }}><strong style={{ fontSize: 13 }}>Override AI recommendation</strong><p style={{ margin: '5px 0 10px', fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>Use this when the generated language needs a city-reviewed correction. Final send stays blocked until you save.</p><div className="input-row"><div><label>Requirement</label><select value={override?.id ?? ''} onChange={(event) => { const selected = requirementsToShow.find((item) => item.id === event.target.value); if (selected) { setOverrideText(selected.description); onOverride(selected.id, selected.description); } }} data-testid="select-override-requirement"><option value="">Choose a recommendation</option>{requirementsToShow.map((item) => <option value={item.id} key={item.id}>{item.requirement_name}</option>)}</select></div><div><label>Reviewed description</label><textarea value={override?.id ? overrideText : ''} disabled={!override?.id} onChange={(event) => setOverrideText(event.target.value)} data-testid="textarea-override" /></div></div><div className="staff-edit-actions"><button className="button-primary" style={{ width: 'auto', marginTop: 0 }} disabled={!override?.id || !overrideText.trim()} onClick={() => override && onOverride(override.id, overrideText)} data-testid="button-save-override">Save reviewed change</button></div></div>}
    <Disclaimer className="intake-disclaimer" />
  </div>;
}

function PlanView({ intake, language, onStartOver }: { intake: Intake; language: Language; onStartOver: () => void }) {
  const t = copy[language];
  const [reviewState, setReviewState] = useState<ReviewState>('draft');
  const [staffMode, setStaffMode] = useState(false);
  const [simplified, setSimplified] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [override, setOverride] = useState<{ id: string; description: string } | null>(null);
  const [savedOverride, setSavedOverride] = useState(false);
  const matched = useMemo(() => requirements.filter((item) => intake.businessType !== 'other' && item.applies_to.includes(intake.businessType as BusinessType) && (!item.modifications || item.modifications.some((mod) => intake.modifications.includes(mod)) || !intake.modifications.length)), [intake]);
  const visible = matched.filter((item) => !rejected.includes(item.id));
  const sendToStaff = () => { setReviewState('sent'); setStaffMode(true); };
  const saveOverride = (id: string, description: string) => { setOverride({ id, description }); setSavedOverride(true); setReviewState('reviewed'); };
  return <><Steps plan /><main className="plan-shell">
    <div className="plan-header"><div><div className="eyebrow">San José · {language === 'es' ? 'Plan de acción' : 'Action plan'}</div><h1>{t.planTitle}</h1><p>{t.planIntro}</p><Disclaimer className="intake-disclaimer" /></div><div className="plan-actions"><span className={`status-badge ${reviewState === 'reviewed' ? 'reviewed' : reviewState === 'sent' ? 'sent' : ''}`} data-testid="status-plan">{reviewState === 'reviewed' ? 'Reviewed by City Staff' : reviewState === 'sent' ? 'Sent to City Staff' : 'Draft — Requires City Staff Review'}</span><button className="button-tertiary" onClick={() => window.print()} data-testid="button-print-plan"><Printer size={14} /> {t.print}</button><button className="button-secondary" onClick={onStartOver} data-testid="button-start-over"><ArrowLeft size={14} /> {t.startOver}</button></div></div>
    {savedOverride && <div className="modified-notice" data-testid="notice-modified-by-staff"><CheckCircle2 size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Modified by City Staff · Reviewed language has been applied. Sources and prototype disclaimer remain attached.</div>}
    {staffMode && <StaffReview requirementsToShow={visible} notes={notes} onApprove={(id) => setNotes((current) => ({ ...current, [id]: current[id] ?? 'Approved by City Staff.' }))} onReject={(id) => setRejected((current) => [...current, id])} onAddNote={(id, note) => setNotes((current) => ({ ...current, [id]: note }))} onOverride={(id, description) => { if (description !== requirements.find((item) => item.id === id)?.description) saveOverride(id, description); else setOverride({ id, description }); }} override={override} language={language} />}
    <div className="plan-grid"><div>
      <div className="summary-bar"><div className="summary-cell"><span className="summary-label">{language === 'es' ? 'Negocio' : 'Business'}</span><span className="summary-value" data-testid="text-plan-business">{businessLabels[intake.businessType as BusinessType]}</span></div><div className="summary-cell"><span className="summary-label">{language === 'es' ? 'Ubicación' : 'Project location'}</span><span className="summary-value" data-testid="text-plan-address"><MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 3 }} /> {intake.address}, {intake.zip}</span></div><div className="summary-cell"><span className="summary-label">{language === 'es' ? 'Coincidencias' : 'Matched'}</span><span className="summary-value">{visible.length} {t.matched}</span></div></div>
      <div className="section-title"><h2>{language === 'es' ? 'Posibles requisitos' : 'Possible requirements'}</h2><span>{visible.length} {t.matched}</span></div>
      {visible.length === 0 ? <div className="no-match" data-testid="empty-no-match"><AlertCircle size={21} color="hsl(var(--accent))" /><h2>{language === 'es' ? 'Todavía no encontramos una coincidencia local.' : 'We don’t have a local match yet.'}</h2><p>{language === 'es' ? 'No podemos sugerir responsablemente un camino de permisos con estos datos. Comience con el equipo general de asistencia para negocios de la Ciudad y comparta su dirección, uso propuesto y planos. El personal puede ayudarle a identificar el siguiente paso.' : 'We can’t responsibly suggest a permit path from these details. Start with the City’s general business assistance team and share your address, proposed use, and any plans. City Staff can help identify the right next step.'}</p><Disclaimer /></div> : visible.map((item) => <RequirementCard key={item.id} requirement={override?.id === item.id ? { ...item, description: override.description, simplified_description: override.description } : item} language={simplified ? 'en' : language} note={notes[item.id]} onEdit={staffMode ? () => setOverride({ id: item.id, description: item.description }) : undefined} />)}
      <div className="section-title"><h2>{language === 'es' ? 'Mantenga clara la conversación' : 'Keep the conversation clear'}</h2></div>
      <div className="sidebar-card"><p>{t.contact}</p><div className="disclaimer"><Info size={13} /><span>{DISCLAIMER}</span></div></div>
    </div><aside className="plan-sidebar">
      <div className="sidebar-card"><h3>{language === 'es' ? 'Sus detalles' : 'Your details'}</h3><div className="contact-row"><FileText size={15} /><div><strong>{language === 'es' ? 'Proyecto' : 'Project'}</strong><span>{intake.description}</span></div></div><div className="contact-row"><MapPin size={15} /><div><strong>{language === 'es' ? 'Ubicación' : 'Location'}</strong><span>{intake.address}, {intake.zip}</span></div></div><div className="contact-row"><Building2 size={15} /><div><strong>{language === 'es' ? 'Tipo de negocio' : 'Business type'}</strong><span>{businessLabels[intake.businessType as BusinessType]}</span></div></div><div className="contact-row"><ClipboardCheck size={15} /><div><strong>{language === 'es' ? 'Cambios planeados' : 'Planned changes'}</strong><span>{intake.modifications.length ? intake.modifications.map((item) => modificationLabels[item]).join(', ') : (language === 'es' ? 'Ninguno' : 'None selected')}</span></div></div>{intake.files.length > 0 && <div className="contact-row"><FileText size={15} /><div><strong>{language === 'es' ? 'Archivos adjuntos' : 'Files attached'}</strong><span>{intake.files.length} local file(s)</span></div></div>}</div>
      <div className="sidebar-card"><h3>{language === 'es' ? 'Hágalo más fácil de leer' : 'Make it easier to read'}</h3><p>{language === 'es' ? 'Use descripciones más cortas mientras revisa el plan. Puede volver al texto completo.' : 'Use shorter descriptions while you scan the plan. You can switch back at any time.'}</p><button className={`button-tertiary ${simplified ? 'active' : ''}`} style={simplified ? { borderColor: 'hsl(var(--primary))', color: 'hsl(var(--primary))' } : {}} onClick={() => setSimplified(!simplified)} data-testid="button-simplify-language"><Lightbulb size={14} /> {simplified ? (language === 'es' ? 'Usar descripciones completas' : 'Use full descriptions') : (language === 'es' ? 'Simplificar lenguaje' : 'Simplify language')}</button></div>
      <div className="sidebar-card"><h3>{language === 'es' ? '¿Listo para otra revisión?' : 'Ready for a second look?'}</h3><p>{language === 'es' ? 'Envíe este borrador al personal para una simulación de revisión. No es un envío oficial.' : 'Send this draft to City Staff for a review simulation. It is not an official submission.'}</p><button className="button-primary" onClick={sendToStaff} disabled={reviewState === 'sent' || reviewState === 'reviewed'} data-testid="button-send-city-staff"><Send size={14} /> {reviewState === 'sent' || reviewState === 'reviewed' ? (language === 'es' ? 'Enviado al personal' : 'Sent to City Staff') : t.staff}</button><Disclaimer className="intake-disclaimer" /></div>
    </aside></div>
  </main><section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section></>;
}

function Home() {
  const [intake, setIntake] = useState<Intake>(emptyIntake);
  const [language, setLanguage] = useState<Language>('en');
  const [hasPlan, setHasPlan] = useState(false);
  const [loading, setLoading] = useState(false);
  const startOver = () => { setHasPlan(false); setLoading(false); setIntake(emptyIntake); };
  const generate = () => { setLoading(true); window.setTimeout(() => { setLoading(false); setHasPlan(true); }, 1050); };
  return <div className="app-shell"><Topbar language={language} setLanguage={setLanguage} onStartOver={startOver} canStartOver={hasPlan} />{loading ? <LoadingPlan language={language} /> : hasPlan ? <PlanView intake={intake} language={language} onStartOver={startOver} /> : <IntakeView intake={intake} setIntake={setIntake} onGenerate={generate} language={language} setLanguage={setLanguage} />}</div>;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
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
