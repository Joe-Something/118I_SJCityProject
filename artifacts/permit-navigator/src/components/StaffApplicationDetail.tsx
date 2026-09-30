import { useState, type ReactNode } from 'react';
import { Clipboard, FileX2 } from 'lucide-react';
import { useListApplicationHistory, type ApplicationRecord } from '@workspace/api-client-react';
import type { ActivePlan } from '../types';
import type { BusinessType, Modification, RequirementId } from '../requirements';
import { requirementsConfig } from '../requirements';
import { copy } from '../copy';
import './StaffApplicationDetail.css';

type Workflow = 'clarification' | 'internal' | 'hearing' | 'permit-decision' | 'escalation' | 'next-steps';
type DraftState = { planId: string; workflow: Workflow; text: string };
type CopyState = { planId: string; message: string };

const requirementIds: RequirementId[] = [
  'business-registration',
  'zoning-clearance',
  'building-permits',
  'sign-permits',
  'health-safety',
];

function provided(value: string | null | undefined): string {
  return value?.trim() || 'Not provided';
}

function dateLabel(value: string | number | null | undefined): string {
  if (!value) return 'Not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not provided'
    : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function changesLabel(plan: ActivePlan): string {
  if (!plan.intake.modifications?.length) return 'None selected';
  return plan.intake.modifications.map(item =>
    item === 'other'
      ? provided(plan.intake.modificationOther)
      : copy.en.modificationLabels[item as Modification]
  ).join(', ');
}

function buildDraft(plan: ActivePlan, workflow: Workflow, record?: ApplicationRecord): string {
  const name = provided(record?.businessName || plan.intake.businessName);
  const location = [plan.intake.address?.trim(), plan.intake.zip?.trim()].filter(Boolean).join(', ') || 'location not provided';
  const suggested = plan.matched
    .filter(id => !plan.rejected.includes(id))
    .map(id => copy.en.requirements[id].name);
  const topics = suggested.length ? suggested.join(', ') : 'the proposed use and scope of work';
  const opening = `Permit Navigator prototype entry ${plan.id}\nBusiness: ${name}\nLocation: ${location}\n\n`;
  if (workflow === 'clarification') {
    return opening + `Hello,\n\nTo help review this prototype entry, please clarify the proposed use at this address and the planned changes (${changesLabel(plan)}). If available, describe the scope of work and any drawings you can share through an appropriate channel.\n\nThe local guide surfaced ${topics} as possible starting points. These are not findings or permit approvals. Please verify requirements directly with the relevant City department before work begins.\n\nThis is draft wording only; it has not been sent.`;
  }
  if (workflow === 'internal') {
    return opening + `Internal handoff draft\n\nPlease verify the proposed use, address, and scope of changes (${changesLabel(plan)}). The local prototype guide surfaced ${topics} for follow-up. Confirm the applicable rules and whether another department needs to be consulted. Do not treat a local match or a removed item as a zoning, building, fire, health, or utilities decision.\n\nThis text is a local draft only; it has not been routed or sent.`;
  }
  if (workflow === 'hearing') {
    return opening + `Hearing coordination draft\n\nConfirm whether a public hearing is required for this project under current City rules. If so, identify the responsible department, required notices, accessibility needs, and scheduling process. No hearing has been scheduled by this application.\n\nThis text is a local draft only; it has not been routed or sent.`;
  }
  if (workflow === 'permit-decision') {
    return opening + `Permit decision preparation draft\n\nReview the submitted scope, supporting documents, and current agency requirements before recommending any outcome. The local guide surfaced ${topics} for further verification. This prototype cannot issue, deny, or condition a City permit.\n\nThis text is a local draft only; it has not been routed or sent.`;
  }
  if (workflow === 'escalation') {
    return opening + `Department-head consultation draft\n\nRequest an authorized department-head review of the proposed use and planned changes (${changesLabel(plan)}). Include any verified facts, unresolved questions, and urgency when routing through approved internal channels. This prototype has not sent or routed this draft.\n\nThis text is a local draft only; it has not been routed or sent.`;
  }
  return opening + `Hello,\n\nFor this project, start by confirming the proposed use at the location and describing the planned changes (${changesLabel(plan)}). Ask the relevant department about ${topics}, and what documents they would need to review. Keep any guidance you receive with your project records.\n\nPermit Navigator offers preliminary, local rules-of-thumb only. It does not determine which permits are required or authorize work. Verify next steps directly with the appropriate City or county office.\n\nThis is draft wording only; it has not been sent.`;
}

export function StaffApplicationDetail({
  plan,
  record,
  onPostResponse,
  children,
}: {
  plan: ActivePlan;
  record?: ApplicationRecord;
  onPostResponse: (text: string) => Promise<boolean>;
  children?: ReactNode;
}) {
  const history = useListApplicationHistory(plan.id);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [copyState, setCopyState] = useState<CopyState | null>(null);
  const [postState, setPostState] = useState<{ planId: string; message: string; busy: boolean } | null>(null);
  const workflow = draftState?.planId === plan.id ? draftState.workflow : 'clarification';
  const draftText = draftState?.planId === plan.id ? draftState.text : buildDraft(plan, 'clarification', record);
  const feedback = copyState?.planId === plan.id ? copyState.message : '';
  const postFeedback = postState?.planId === plan.id ? postState.message : '';
  const posting = postState?.planId === plan.id && postState.busy;
  const businessType = plan.intake.businessType === 'other'
    ? provided(plan.intake.businessOther)
    : plan.intake.businessType
      ? copy.en.businessLabels[plan.intake.businessType as BusinessType]
      : provided(record?.businessCategory);
  const location = [plan.intake.address?.trim(), plan.intake.zip?.trim()].filter(Boolean).join(', ');
  const openItems = plan.matched.filter(id => !plan.rejected.includes(id));
  const triage = plan.matched.length === 0
    ? 'Manual routing needed'
    : plan.rejected.length > 0
      ? 'Staff-adjusted checklist · verify remaining items'
      : 'Possible review topics identified';

  const changeWorkflow = (next: Workflow) => {
    setDraftState({ planId: plan.id, workflow: next, text: buildDraft(plan, next, record) });
    setCopyState(null);
    setPostState(null);
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draftText);
      setCopyState({ planId: plan.id, message: 'Copied to clipboard. Copying did not send a notification.' });
    } catch {
      setCopyState({ planId: plan.id, message: 'Could not copy. Select the text above and copy it manually.' });
    }
  };

  const postResponse = async () => {
    const text = draftText.trim().replace(/\n\nThis is draft wording only; it has not been sent\.$/, '').trim();
    if (!text) return;
    setPostState({ planId: plan.id, message: '', busy: true });
    try {
      const saved = await onPostResponse(text);
      setPostState({
        planId: plan.id,
        message: saved ? 'Response saved to the applicant’s plan. No email was sent.' : 'The response was not saved. Please try again.',
        busy: false,
      });
    } catch {
      setPostState({ planId: plan.id, message: 'The response was not saved. Please try again.', busy: false });
    }
  };

  return (
    <article className="staff-application-detail" data-testid={`staff-application-detail-${plan.id}`} aria-labelledby={`staff-detail-title-${plan.id}`}>
      <header className="staff-application-detail__mast">
        <div>
          <p className="staff-application-detail__eyebrow">Review dossier / prototype casework</p>
          <h2 id={`staff-detail-title-${plan.id}`} data-testid={`text-detail-business-${plan.id}`}>
            {provided(record?.businessName || plan.intake.businessName)}
          </h2>
          <p className="staff-application-detail__subtitle">
            Application detail · {provided(record?.requestType)} · Current prototype status: <strong data-testid={`status-detail-${plan.id}`}>{record?.status || plan.status}</strong>
          </p>
        </div>
        <span className="staff-application-detail__id" data-testid={`text-detail-id-${plan.id}`}>ID {plan.id}</span>
      </header>

      <p className="staff-application-detail__notice" data-testid={`notice-detail-prototype-${plan.id}`}>
        <strong>Prototype review, not a live City workflow.</strong> This record and its local recommendations are not an official application, permit determination, zoning clearance, or notice to an applicant. A person must verify each item with the appropriate agency.
        {record?.synthetic && ' This entry is synthetic demonstration data.'}
      </p>

      <section className="staff-application-detail__section" aria-labelledby={`detail-intake-${plan.id}`}>
        <div className="staff-application-detail__section-heading">
          <span className="staff-application-detail__section-number">01</span>
          <h3 id={`detail-intake-${plan.id}`}>Submission record</h3>
          <span className="staff-application-detail__section-hint">Submitted fields, derived routing & audit trail</span>
        </div>
        <div className="staff-application-detail__grid">
          <div>
            <div className="staff-application-detail__panel">
              <h4>Applicant & project</h4>
              <dl className="staff-application-detail__facts">
                <div><dt>Business name</dt><dd data-testid={`text-detail-name-${plan.id}`}>{provided(record?.businessName || plan.intake.businessName)}</dd></div>
                <div><dt>Business type</dt><dd data-testid={`text-detail-type-${plan.id}`}>{businessType}</dd></div>
                <div><dt>Applicant name</dt><dd>Not provided</dd></div>
                <div><dt>Email / phone</dt><dd>Not provided</dd></div>
                <div><dt>Location</dt><dd data-testid={`text-detail-location-${plan.id}`}>{provided(location)}</dd></div>
                <div><dt>Preferred language</dt><dd data-testid={`text-detail-language-${plan.id}`}>{provided(record?.applicantLanguage || (plan.language === 'other' ? plan.customLanguage : plan.language))}</dd></div>
                <div><dt>Suggested request type (derived)</dt><dd>{provided(record?.requestType)}</dd></div>
                <div><dt>Staff routing (derived)</dt><dd>{provided(record?.assignedDepartment || plan.departments?.join(', '))}</dd></div>
                <div><dt>Submitted</dt><dd data-testid={`text-detail-submitted-${plan.id}`}>{dateLabel(record?.submittedAt || plan.submittedAt)}</dd></div>
                <div><dt>Last updated</dt><dd>{dateLabel(record?.updatedAt || plan.updatedAt)}</dd></div>
              </dl>
              <div className="staff-application-detail__rule" />
              <dl className="staff-application-detail__stack">
                <div><dt>Project description</dt><dd data-testid={`text-detail-description-${plan.id}`}>{provided(record?.description || plan.intake.description)}</dd></div>
                <div><dt>Planned changes</dt><dd data-testid={`text-detail-changes-${plan.id}`}>{changesLabel(plan)}</dd></div>
              </dl>
            </div>
            <div className="staff-application-detail__panel">
              <h4>Document list</h4>
              <div className="staff-application-detail__file-state" data-testid={`empty-detail-documents-${plan.id}`}>
                <FileX2 size={18} aria-hidden="true" />
                <span><strong>No persisted files.</strong> Upload bytes are discarded by this prototype. There are no documents available here to preview or download.</span>
              </div>
            </div>
          </div>
          <aside className="staff-application-detail__panel" aria-labelledby={`detail-history-${plan.id}`}>
            <h4 id={`detail-history-${plan.id}`}>Activity & status history</h4>
            {history.isLoading ? (
              <div role="status" aria-label="Loading status history" data-testid={`loading-detail-history-${plan.id}`}>
                <div className="staff-application-detail__skeleton" /><div className="staff-application-detail__skeleton" /><div className="staff-application-detail__skeleton" />
              </div>
            ) : history.isError ? (
              <div className="staff-application-detail__error" role="alert" data-testid={`error-detail-history-${plan.id}`}>
                Audit history is unavailable. <button className="staff-application-detail__inline-button" type="button" onClick={() => void history.refetch()} data-testid={`button-retry-detail-history-${plan.id}`}>Retry</button>
              </div>
            ) : !history.data?.length ? (
              <p className="staff-application-detail__muted" data-testid={`empty-detail-history-${plan.id}`}>No status events recorded yet.</p>
            ) : (
              <ol className="staff-application-detail__history" data-testid={`list-detail-history-${plan.id}`}>
                {history.data.map(event => (
                  <li key={event.id} data-testid={`item-detail-history-${event.id}`}>
                    <span className="staff-application-detail__history-dot" aria-hidden="true" />
                    <div><strong>{event.status}</strong><small>{dateLabel(event.createdAt)} · Actor: {provided(event.actor)}{event.synthetic ? ' · Synthetic event' : ''}</small></div>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        </div>
      </section>

      <section className="staff-application-detail__section" aria-labelledby={`detail-recommendations-${plan.id}`}>
        <div className="staff-application-detail__section-heading">
          <span className="staff-application-detail__section-number">02</span>
          <h3 id={`detail-recommendations-${plan.id}`}>Recommendations & checks</h3>
          <span className="staff-application-detail__section-hint">Human verification required</span>
        </div>
        <p className="staff-application-detail__intro">
          These five standardized topics are a local rules-of-thumb checklist, not official PASS/FAIL tests. A match identifies a possible conversation; an unmatched or removed item does not establish that a requirement is unnecessary.
        </p>
        <div className="staff-application-detail__assessment" data-testid={`status-detail-triage-${plan.id}`}>
          <strong>Preliminary triage: {triage}</strong>
          <span>{openItems.length} possible {openItems.length === 1 ? 'topic' : 'topics'} remain. No compliance score or permit decision can be calculated from the data currently collected.</span>
        </div>
        <div className="staff-application-detail__checks">
          {requirementIds.map(id => {
            const item = copy.en.requirements[id];
            const matched = plan.matched.includes(id);
            const removed = plan.rejected.includes(id);
            const status = removed ? 'Removed locally · verify' : matched ? 'Pending verification' : 'Scope not matched · verify';
            return (
              <div className="staff-application-detail__check" key={id} data-testid={`check-detail-${plan.id}-${id}`}>
                <div className="staff-application-detail__check-head">
                  <div><h4>{item.name}</h4><span className="staff-application-detail__muted">{item.dept}</span></div>
                  <span className={`staff-application-detail__tag ${!matched || removed ? 'staff-application-detail__tag--neutral' : ''}`} data-testid={`status-detail-check-${plan.id}-${id}`}>{status}</span>
                </div>
                <p>{item.desc}</p>
                {matched && !removed && <p><strong>Ask / verify:</strong> {item.steps[0]}. {item.steps[1]}.</p>}
                {removed && <p className="staff-application-detail__annotation">Removed from this prototype plan by a reviewer. This is not a finding that the requirement does not apply.</p>}
                {plan.overrides[id] && <p className="staff-application-detail__annotation"><strong>Reviewer-edited recommendation:</strong> {plan.overrides[id]}</p>}
                {plan.notes[id] && <p className="staff-application-detail__annotation"><strong>Reviewer note:</strong> {plan.notes[id]}</p>}
                <a className="staff-application-detail__source" href={requirementsConfig[id].source_url} target="_blank" rel="noopener noreferrer" data-testid={`link-detail-source-${plan.id}-${id}`}>View source: {item.sourceTitle} <span aria-hidden="true">↗</span></a>
              </div>
            );
          })}
        </div>
        {children && <div className="staff-application-detail__controls" data-testid={`region-detail-decisions-${plan.id}`}>
          <h4>Reviewer decisions</h4>
          <p>Review the intake and sources before recording any change. These controls update this prototype record only; they do not issue a legal or agency determination.</p>
          <div className="staff-application-detail__controls-inner">{children}</div>
        </div>}
      </section>

      <section className="staff-application-detail__section" aria-labelledby={`detail-next-${plan.id}`}>
        <div className="staff-application-detail__section-heading">
          <span className="staff-application-detail__section-number">03</span>
          <h3 id={`detail-next-${plan.id}`}>Next steps & draft response</h3>
          <span className="staff-application-detail__section-hint">Local draft · not sent</span>
        </div>
        <div className="staff-application-detail__grid">
          <div className="staff-application-detail__panel">
            <h4>Suggested review path</h4>
            <ol className="staff-application-detail__guidance">
              <li>{['Approved', 'Rejected', 'Modified via Staff Override'].includes(plan.status) ? 'Review the recorded prototype decision before any further correspondence.' : 'Confirm the proposed use and application type before making a recommendation.'} Project: <strong>{provided(record?.requestType)}</strong> at <strong>{provided(location)}</strong>; described changes: {changesLabel(plan)}.</li>
              <li>{openItems.length ? <>Use the {openItems.map(id => copy.en.requirements[id].name).join(', ')} {openItems.length === 1 ? 'topic' : 'topics'} to frame questions for the relevant agencies.</> : 'No local topics remain on this plan. Ask the appropriate agency to identify the applicable path; do not assume no review is needed.'}</li>
              <li>Request appropriate scope details or drawings through an authorized channel if needed; this prototype has no persisted files.</li>
              <li>Verify the current process directly with the relevant City or county office before anyone relies on this guidance to start work.</li>
            </ol>
          </div>
          <div className="staff-application-detail__panel">
            <h4>Draft workspace</h4>
            <p className="staff-application-detail__intro">Choose a workflow and edit the wording. Switching workflows replaces your unsaved draft. Drafts exist only in this open view.</p>
            <div className="staff-application-detail__draft">
              <label htmlFor={`detail-workflow-${plan.id}`}>Workflow type</label>
              <select id={`detail-workflow-${plan.id}`} value={workflow} onChange={event => changeWorkflow(event.target.value as Workflow)} data-testid={`select-detail-workflow-${plan.id}`}>
                <option value="clarification">Request clarification</option>
                <option value="internal">Internal review handoff</option>
                <option value="hearing">Prepare hearing coordination</option>
                <option value="permit-decision">Prepare permit decision (not issued)</option>
                <option value="escalation">Prepare department-head escalation</option>
                <option value="next-steps">Suggested next steps</option>
              </select>
            </div>
            <div className="staff-application-detail__draft">
              <label htmlFor={`detail-draft-${plan.id}`}>Editable draft text</label>
              <textarea id={`detail-draft-${plan.id}`} value={draftText} maxLength={3000} onChange={event => { setDraftState({ planId: plan.id, workflow, text: event.target.value }); setCopyState(null); setPostState(null); }} data-testid={`textarea-detail-draft-${plan.id}`} />
            </div>
            <div className="staff-application-detail__draft-footer">
              <span data-testid={`status-detail-draft-${plan.id}`}>Editable draft · not emailed or sent outside the app</span>
              <button type="button" className="staff-application-detail__copy" onClick={() => void copyDraft()} disabled={!draftText.trim()} data-testid={`button-copy-detail-draft-${plan.id}`}><Clipboard size={14} aria-hidden="true" /> Copy draft</button>
            </div>
            {feedback && <p role="status" className="staff-application-detail__subtitle" data-testid={`feedback-detail-copy-${plan.id}`}>{feedback}</p>}
            {(workflow === 'clarification' || workflow === 'next-steps') && (
              <div className="staff-application-detail__post">
                <p>Post this edited response inside the applicant’s saved plan. This does not send an email or alert the applicant outside the app.</p>
                <button type="button" className="staff-application-detail__copy" disabled={!draftText.trim() || posting} onClick={() => void postResponse()} data-testid={`button-post-detail-response-${plan.id}`}>
                  {posting ? 'Saving response…' : 'Post to applicant plan'}
                </button>
              </div>
            )}
            {postFeedback && <p role="status" className="staff-application-detail__subtitle" data-testid={`feedback-detail-post-${plan.id}`}>{postFeedback}</p>}
            {plan.notes?._staff_response && (
              <div className="staff-application-detail__posted" data-testid={`text-detail-posted-response-${plan.id}`}>
                <strong>Response currently visible on the applicant’s plan</strong>
                <p>{plan.notes._staff_response}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </article>
  );
}