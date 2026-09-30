import { useState } from 'react';
import type { ActivePlan } from '../types';
import { isStaleWrite } from '../utils/writeErrors';

export function DraftContactDetails({ plan, onSave, onBusyChange }: { plan: ActivePlan; onSave: (values: { applicantName: string; applicantEmail: string; applicantPhone: string }) => Promise<boolean>; onBusyChange: (busy: boolean) => void }) {
  const [values, setValues] = useState({ applicantName: plan.intake.applicantName || '', applicantEmail: plan.intake.applicantEmail || '', applicantPhone: plan.intake.applicantPhone || '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return <form className="document-controls" onSubmit={async event => {
    event.preventDefault();
    setBusy(true); onBusyChange(true); setMessage('');
    try { setMessage(await onSave(values) ? 'Contact details saved to this draft.' : 'Could not save contact details. Please retry.'); }
    catch (error) { setMessage(isStaleWrite(error) ? 'This draft changed elsewhere. Your edits remain here. Refresh the application before saving again.' : 'Could not save contact details. Please retry.'); }
    finally { setBusy(false); onBusyChange(false); }
  }} data-testid={`form-draft-contact-${plan.id}`}>
    <h3>Applicant contact · saved draft</h3>
    <p>Optional details for staff review. No email or phone notification is sent.</p>
    <div className="input-row">
      <div className="field"><label htmlFor={`draft-name-${plan.id}`}>Full name</label><input id={`draft-name-${plan.id}`} value={values.applicantName} onChange={event => setValues(v => ({ ...v, applicantName: event.target.value }))} data-testid={`input-draft-name-${plan.id}`} /></div>
      <div className="field"><label htmlFor={`draft-phone-${plan.id}`}>Phone</label><input id={`draft-phone-${plan.id}`} type="tel" value={values.applicantPhone} onChange={event => setValues(v => ({ ...v, applicantPhone: event.target.value }))} data-testid={`input-draft-phone-${plan.id}`} /></div>
    </div>
    <div className="field"><label htmlFor={`draft-email-${plan.id}`}>Email</label><input id={`draft-email-${plan.id}`} type="email" value={values.applicantEmail} onChange={event => setValues(v => ({ ...v, applicantEmail: event.target.value }))} data-testid={`input-draft-email-${plan.id}`} /></div>
    <button className="button-secondary" type="submit" disabled={busy} data-testid={`button-save-draft-contact-${plan.id}`}>{busy ? 'Saving…' : 'Save contact details'}</button>
    {message && <p role="status" data-testid={`status-draft-contact-${plan.id}`}>{message}</p>}
  </form>;
}