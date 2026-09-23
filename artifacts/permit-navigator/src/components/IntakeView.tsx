import { useState, useRef } from 'react';
import { ArrowRight, FileText, ShieldCheck, Lightbulb, ClipboardCheck } from 'lucide-react';
import { Intake, BusinessType, Modification } from '../requirements';
import { Language, copy } from '../copy';
import { checkLanguage, getLanguageBundle } from '../utils/language';
import { Disclaimer } from './Disclaimer';

export function IntakeForm({ intake, setIntake, onGenerate, language, setLanguage, customLanguage, setCustomLanguage }: { intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; language: Language; setLanguage: (l: Language) => void; customLanguage: string; setCustomLanguage: (v: string) => void }) {
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
        const words = trimmed.split(/\\s+/).length;
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
        <div><input id="zip" inputMode="numeric" maxLength={5} placeholder={t.zip} value={intake.zip} onChange={(event) => update('zip', event.target.value.replace(/\\D/g, ''))} data-testid="input-zip" aria-label={t.zip} />{errors.zip && <div className="field-error">{errors.zip}</div>}</div>
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

export function IntakeView({ 
  intake, setIntake, onGenerate, language, setLanguage, 
  customLanguage, setCustomLanguage, onLoadSample, onGenerateRandom 
}: { 
  intake: Intake; setIntake: (next: Intake) => void; onGenerate: () => void; 
  language: Language; setLanguage: (l: Language) => void; 
  customLanguage: string; setCustomLanguage: (v: string) => void; 
  onLoadSample: () => void; onGenerateRandom: () => void 
}) {
  const t = copy[language === 'other' ? 'en' : language];
  return (
    <>
      <div className="hero-wrap">
        <main className="hero">
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
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              Load Sample Application
            </button>
            <button 
              className="button-secondary" 
              onClick={onGenerateRandom}
              data-testid="button-generate-random"
              style={{ width: '100%', marginTop: 12, justifyContent: 'flex-start' }}
            >
              Generate Random Action Plan for Staff Review
            </button>
          </div>
          <IntakeForm 
            intake={intake} 
            setIntake={setIntake} 
            onGenerate={onGenerate} 
            language={language} 
            setLanguage={setLanguage} 
            customLanguage={customLanguage} 
            setCustomLanguage={setCustomLanguage} 
          />
        </main>
      </div>
      <section className="footer">
        <div className="footer-inner">
          <span>Permit Navigator · San José</span>
          <Disclaimer />
        </div>
      </section>
    </>
  );
}