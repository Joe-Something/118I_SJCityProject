import { useState } from 'react';
import type { ActivePlan } from '../types';
import { isStaleWrite } from '../utils/writeErrors';
import { normalizeContactValues, validateContactValues, type ContactErrors, type ContactValues } from '../utils/contact';

export function DraftContactDetails({ plan, onSave, onBusyChange }: { plan: ActivePlan; onSave: (values: ContactValues) => Promise<boolean>; onBusyChange: (busy: boolean) => void }) {
  const [values, setValues] = useState<ContactValues>(() => ({
    applicantName: plan.intake.applicantName ?? '',
    applicantEmail: plan.intake.applicantEmail ?? '',
    applicantPhone: plan.intake.applicantPhone ?? '',
    notificationConsent: plan.intake.notificationConsent === true,
  }));
  const [errors, setErrors] = useState<ContactErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const update = (key: keyof ContactValues, value: string | boolean) => {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
    setMessage('');
  };
  const title = plan.status === 'Draft' ? 'Applicant contact · saved draft' : 'Applicant contact · saved application';
  return <form className="document-controls" noValidate onSubmit={async event => {
    event.preventDefault();
    const normalized = normalizeContactValues(values);
    const nextErrors = validateContactValues(normalized);
    // Preserve previously accepted contact strings; validate only fields the owner changes.
    for (const field of ['applicantName', 'applicantEmail', 'applicantPhone'] as const) {
      if (values[field] === (plan.intake[field] ?? '')) {
        normalized[field] = values[field];
        delete nextErrors[field];
      }
    }
    if (values.notificationConsent) {
      const destinationErrors = validateContactValues({ ...values, notificationConsent: false });
      const hasValidDestination = (values.applicantEmail.trim() && !destinationErrors.applicantEmail)
        || (values.applicantPhone.trim() && !destinationErrors.applicantPhone);
      if (!hasValidDestination) nextErrors.notificationConsent = 'Add a valid email address or phone number before giving contact permission.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setMessage('Review the contact details below.');
      return;
    }
    setValues(normalized);
    setBusy(true); onBusyChange(true); setMessage('');
    try { setMessage(await onSave(normalized) ? 'Contact details saved to this application.' : 'Could not save contact details. Please retry.'); }
    catch (error) { setMessage(isStaleWrite(error) ? 'This application changed elsewhere. Your edits remain here. Refresh the application before saving again.' : 'Could not save contact details. Please retry.'); }
    finally { setBusy(false); onBusyChange(false); }
  }} data-testid={`form-draft-contact-${plan.id}`}>
    <h3>{title}</h3>
    <p>Optional contact details. You can update or clear them later. Email, SMS, and push notifications are not configured; saving consent does not send a message.</p>
    <div className="input-row">
      <div className="field">
        <label htmlFor={`draft-name-${plan.id}`}>Full name</label>
        <input id={`draft-name-${plan.id}`} maxLength={200} value={values.applicantName} onChange={event => update('applicantName', event.target.value)} aria-invalid={!!errors.applicantName} aria-describedby={errors.applicantName ? `draft-name-error-${plan.id}` : undefined} data-testid={`input-draft-name-${plan.id}`} />
        {errors.applicantName && <p id={`draft-name-error-${plan.id}`} className="field-error" role="alert">{errors.applicantName}</p>}
      </div>
      <div className="field">
        <label htmlFor={`draft-phone-${plan.id}`}>Phone</label>
        <input id={`draft-phone-${plan.id}`} type="tel" maxLength={40} value={values.applicantPhone} onChange={event => update('applicantPhone', event.target.value)} aria-invalid={!!errors.applicantPhone} aria-describedby={errors.applicantPhone ? `draft-phone-error-${plan.id}` : undefined} data-testid={`input-draft-phone-${plan.id}`} />
        {errors.applicantPhone && <p id={`draft-phone-error-${plan.id}`} className="field-error" role="alert">{errors.applicantPhone}</p>}
      </div>
    </div>
    <div className="field">
      <label htmlFor={`draft-email-${plan.id}`}>Email</label>
      <input id={`draft-email-${plan.id}`} type="email" maxLength={254} value={values.applicantEmail} onChange={event => update('applicantEmail', event.target.value)} aria-invalid={!!errors.applicantEmail} aria-describedby={errors.applicantEmail ? `draft-email-error-${plan.id}` : undefined} data-testid={`input-draft-email-${plan.id}`} />
      {errors.applicantEmail && <p id={`draft-email-error-${plan.id}`} className="field-error" role="alert">{errors.applicantEmail}</p>}
    </div>
    <div className="field">
      <div className="choice">
        <input id={`draft-consent-${plan.id}`} type="checkbox" checked={values.notificationConsent} onChange={event => update('notificationConsent', event.target.checked)} aria-invalid={!!errors.notificationConsent} aria-describedby={`draft-consent-help-${plan.id}${errors.notificationConsent ? ` draft-consent-error-${plan.id}` : ''}`} data-testid={`checkbox-draft-consent-${plan.id}`} />
        <label htmlFor={`draft-consent-${plan.id}`}>I give permission to contact me about application updates using the email or phone above.</label>
      </div>
      <p id={`draft-consent-help-${plan.id}`}>This records your preference for possible future notifications. Email, SMS, and push delivery are not configured, and this consent does not send anything. Uncheck and save to withdraw permission.</p>
      {errors.notificationConsent && <p id={`draft-consent-error-${plan.id}`} className="field-error" role="alert">{errors.notificationConsent}</p>}
    </div>
    <button className="button-secondary" type="submit" disabled={busy} data-testid={`button-save-draft-contact-${plan.id}`}>{busy ? 'Saving…' : 'Save contact details'}</button>
    {message && <p role="status" data-testid={`status-draft-contact-${plan.id}`}>{message}</p>}
  </form>;
}