import { Building2, ExternalLink, Pencil } from 'lucide-react';
import { RequirementId, requirementsConfig, PROTOTYPE_REQUIREMENT_VERSION, PROTOTYPE_REQUIREMENT_REVISED } from '../requirements';
import { Language, copy } from '../copy';
import { Disclaimer } from './Disclaimer';

export function RequirementCard({ reqId, language, simplified, note, onEdit }: { reqId: RequirementId; language: Language; simplified: boolean; note?: string; onEdit?: () => void }) {
  const t = copy[language === 'other' ? 'en' : language];
  const reqCopy = t.requirements[reqId];
  const config = requirementsConfig[reqId];
  
  const displayedDesc = simplified ? reqCopy.simpDesc : reqCopy.desc;
  const displayedDocs = simplified ? reqCopy.simpDocs : reqCopy.docs;
  const displayedSteps = simplified ? reqCopy.simpSteps : reqCopy.steps;
  
  return <article className="requirement-card" data-testid={`card-requirement-${reqId}`}>
    <div className="requirement-top">
      <div className="req-icon"><Building2 size={18} /></div>
      <div><h3>{reqCopy.name}</h3><p>Synthetic example · {PROTOTYPE_REQUIREMENT_VERSION} · sample revised {PROTOTYPE_REQUIREMENT_REVISED}</p><p>{displayedDesc}</p></div>
      <span className="req-department">{reqCopy.dept}</span>
    </div>
    <div className="req-body">
      <div><h4>{t.documentsLabel}</h4><ul>{displayedDocs.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div><h4>{t.nextSteps}</h4><ul>{displayedSteps.map((item) => <li key={item}>{item}</li>)}</ul><a className="source-link" href={config.source_url} target="_blank" rel="noopener noreferrer" data-testid={`link-source-${reqId}`}>Real City page to verify independently: {reqCopy.sourceTitle} <ExternalLink size={12} /></a></div>
    </div>
    {note && <div className="req-note"><strong>{t.cityStaffNote}</strong> {note}</div>}
    {onEdit && <div style={{ padding: '0 20px 16px' }}><button className="button-tertiary" onClick={onEdit} data-testid={`button-edit-requirement-${reqId}`}><Pencil size={13} /> {t.editRecommendation}</button></div>}
    <Disclaimer className="req-note" />
  </article>;
}