import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActivePlan, Department } from '../types';
import { ReviewCatalog } from './ReviewCatalog';
import { STAFF_REVIEWERS } from '../utils/generators';
import { AlertCircle, ClipboardCheck, Building2, CheckCircle2, Check, X, Plus, Pencil, FileText, MapPin, Calendar } from 'lucide-react';
import { copy } from '../copy';
import { RequirementId, BusinessType, Modification } from '../requirements';
import { deriveDepartments } from '../utils/helpers';
import { StaffDesk } from '../prototypeStore';
import { StaffSearchFilters, type StaffApplicationFilters } from './StaffSearchFilters';
import { getListWorkspaceEscalationsQueryKey, useAcknowledgeWorkspaceEscalation, useListApplicationHistory, useListWorkspaceEscalations, type ApplicationRecord } from '@workspace/api-client-react';

function StaffPlanReview({ 
  plan, 
  onUpdate, 
  onComplete 
}: { 
  plan: ActivePlan; 
  onUpdate: (updates: Partial<ActivePlan>) => void;
  onComplete: (status: ActivePlan['status']) => void;
}) {
  const [noteFor, setNoteFor] = useState<RequirementId | null>(null);
  const [noteText, setNoteText] = useState('');
  const [overrideFor, setOverrideFor] = useState<RequirementId | null>(null);
  const [overrideText, setOverrideText] = useState('');

  const hasUnsavedOverride = overrideFor !== null;
  const history = useListApplicationHistory(plan.id);

  const handleComplete = () => {
    let status: ActivePlan['status'] = 'Approved';
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
            const reqCopyEn = copy.en.requirements[reqId];
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
                {!noteFor && plan.notes[reqId] && (
                  <div className="modified-notice" style={{ marginTop: '10px' }} data-testid={`text-staff-note-${plan.id}-${reqId}`}>
                    Staff note: {plan.notes[reqId]}
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
           <h3>Status history</h3>
           {history.isLoading && <p>Loading audit history…</p>}
           {history.isError && <p role="alert">History unavailable. <button onClick={() => void history.refetch()}>Retry</button></p>}
           {history.data?.length === 0 && <p>No status events recorded yet.</p>}
           {history.data?.map(event => <div className="contact-row" key={event.id}>
             <ClipboardCheck size={15} />
             <div><strong>{event.status}</strong><span>{event.actor} · {new Date(event.createdAt).toLocaleString()} {event.synthetic ? '· Demo Data — Synthetic' : ''}</span></div>
           </div>)}
         </div>
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

export type StaffRole = 'Master City Queue' | Department;

export function StaffPortal({ 
  desk,
  activeQueue, 
  catalog,
  records,
  filters,
  onFiltersChange,
  recordsLoading,
  recordsError,
  recordsRefreshWarning,
  onCompleteReview, 
  onUpdateActivePlan,
  onReopenReview
}: { 
  desk: StaffDesk;
  activeQueue: ActivePlan[];
  catalog: ActivePlan[];
  records: ApplicationRecord[];
  filters: StaffApplicationFilters;
  onFiltersChange: (next: StaffApplicationFilters) => void;
  recordsLoading: boolean;
  recordsError: string;
  recordsRefreshWarning: string;
  onCompleteReview: (planId: string, finalStatus: ActivePlan['status']) => void;
  onUpdateActivePlan: (planId: string, updates: Partial<ActivePlan>) => void;
  onReopenReview: (recordId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [staffTab, setStaffTab] = useState<'queue' | 'catalog' | 'public'>('public');
  const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
  const [ackError, setAckError] = useState('');
  const acknowledge = useAcknowledgeWorkspaceEscalation();
  
  const staffRole: StaffRole = desk === 'Building Code Reviewer' ? 'Building' : desk === 'Fire Prevention' ? 'Fire' : 'Master City Queue';
  const escalations = useListWorkspaceEscalations({ query: {
    enabled: staffRole === 'Fire' || staffRole === 'Master City Queue',
    queryKey: getListWorkspaceEscalationsQueryKey(),
    refetchInterval: 30_000,
  } });
  const [reviewerFilter, setReviewerFilter] = useState<string>('All');

  const availableReviewers = useMemo(() => {
    if (staffRole === 'Master City Queue') return ['All', ...Object.values(STAFF_REVIEWERS).flat()];
    return ['All', ...STAFF_REVIEWERS[staffRole]];
  }, [staffRole]);

  const filteredQueue = useMemo(() => {
    let filtered = activeQueue;
    
    // Filter by department role
    if (staffRole !== 'Master City Queue') {
      filtered = filtered.filter(p => {
        const deps = p.departments || deriveDepartments(p.intake, p.matched);
        return deps.includes(staffRole as Department);
      });
    }

    // Filter by reviewer
    if (reviewerFilter !== 'All') {
      filtered = filtered.filter(p => {
        if (p.reviewer === reviewerFilter) return true;
        if (p.departmentAssignees && Object.values(p.departmentAssignees).includes(reviewerFilter)) return true;
        return false;
      });
    }

    return filtered;
  }, [activeQueue, staffRole, reviewerFilter]);

  const visibleCatalog = useMemo(() => staffRole === 'Master City Queue'
    ? catalog
    : catalog.filter(plan => (plan.departments || deriveDepartments(plan.intake, plan.matched)).includes(staffRole)),
  [catalog, staffRole]);
  const publicPermits = records.filter(record => record.sourceUrl && !record.synthetic);

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
      
      <div className="staff-banner">
        <div>
          <strong data-testid="staff-role-label">Selected desk: {staffRole === 'Master City Queue' ? 'Master Overview' : staffRole}</strong>
          <span>Reviewing {filteredQueue.length} active plans</span>
        </div>
        <span className="catalog-badge" data-testid="staff-desk-label">{desk} desk</span>
      </div>
      {(staffRole === 'Fire' || staffRole === 'Master City Queue') && (
        <section className="verification-notice" aria-label="High-urgency review queue">
          <AlertCircle size={18} />
          <div>
            <strong>High-urgency review queue (prototype)</strong>
            <p>Items are stored here only. The test address is not City-owned; opening an email draft does not send or confirm delivery. No City inbox, automatic retry, or emergency service is connected.</p>
            {escalations.isLoading && <p>Loading flagged items…</p>}
            {escalations.isError && <p role="alert">Review queue unavailable or your account lacks an administrator-assigned Fire or Economic Development staff role. <button onClick={() => void escalations.refetch()}>Retry</button></p>}
            {ackError && <p role="alert">{ackError}</p>}
            {escalations.data?.length === 0 && <p>No safety-flagged workspace items.</p>}
            {escalations.data?.map(item => (
              <div key={item.ticketId} style={{ marginTop: 12 }}>
                <strong>High-urgency flag</strong> · Ticket {item.ticketId} · {new Date(item.createdAt).toLocaleString()}
                <p>{item.status}{item.acknowledgedAt ? ` · ${new Date(item.acknowledgedAt).toLocaleString()}` : ''}
                  {item.acknowledgedBy && item.acknowledgedDepartment
                    ? ` · Acknowledged by ${item.acknowledgedBy} (${item.acknowledgedDepartment})`
                    : item.acknowledgedAt ? ' · Acknowledging staff not recorded (older ticket)' : ''}
                </p>
                <p>{item.departmentInbox} · {item.deliveryStatus}</p>
                {item.testRecipient && <a
                  href={`mailto:${encodeURIComponent(item.testRecipient)}?subject=${encodeURIComponent(`TEST ONLY - Permit Navigator urgent ticket ${item.ticketId}`)}&body=${encodeURIComponent(`TEST ONLY - Not City dispatch. A safety concern was flagged in the Permit Navigator prototype. Ticket: ${item.ticketId}. No resident details are included. Email sending and receipt are not tracked by this prototype.`)}`}
                >Open test email draft (does not confirm sending)</a>}
                {!item.acknowledgedAt && <button
                  className="button-secondary"
                  style={{ marginLeft: 12 }}
                  disabled={acknowledge.isPending}
                  onClick={async () => {
                    setAckError('');
                    try {
                      await acknowledge.mutateAsync({ id: item.ticketId });
                      await queryClient.invalidateQueries({ queryKey: getListWorkspaceEscalationsQueryKey() });
                    } catch {
                      setAckError('Acknowledgement could not be saved. Retry after checking your connection.');
                    }
                  }}
                >Acknowledge in prototype queue</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <StaffSearchFilters filters={filters} onChange={onFiltersChange} onClear={() => onFiltersChange({
        search: '', applicationId: '', businessName: '', businessCategory: '',
        requestType: '', status: '', assignedDepartment: '', applicantLanguage: '',
        submissionDate: '', descriptionOrNotes: '',
      })} />
      {recordsLoading && <p role="status">Searching database records…</p>}
      {recordsError && <div className="verification-notice" role="alert">{recordsError}</div>}
      {recordsRefreshWarning && <div className="verification-notice" role="status" data-testid="records-refresh-warning">{recordsRefreshWarning}</div>}

      <div className="staff-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingBottom: 12, marginBottom: 24, borderBottom: '1px solid hsl(var(--border))' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button 
            className={`tab-button ${staffTab === 'queue' ? 'active' : ''}`} 
            onClick={() => setStaffTab('queue')}
            data-testid="tab-staff-queue"
          >
            Active Review Queue ({filteredQueue.length})
          </button>
          <button 
            className={`tab-button ${staffTab === 'catalog' ? 'active' : ''}`} 
            onClick={() => setStaffTab('catalog')}
            data-testid="tab-staff-catalog"
          >
            Review Catalog & History
          </button>
          <button
            className={`tab-button ${staffTab === 'public' ? 'active' : ''}`}
            onClick={() => setStaffTab('public')}
            data-testid="tab-staff-public"
          >
            Public permits ({publicPermits.length})
          </button>
        </div>
        {staffTab === 'queue' && (
          <select 
            value={reviewerFilter} 
            onChange={(e) => setReviewerFilter(e.target.value)} 
            style={{ padding: '6px 12px', fontSize: 13, borderRadius: 8, border: '1px solid hsl(var(--input))', background: 'hsl(var(--background))' }}
            data-testid="select-reviewer-filter"
          >
            {availableReviewers.map(r => <option key={r} value={r}>{r === 'All' ? 'All Reviewers' : r}</option>)}
          </select>
        )}
      </div>

      {recordsError || recordsLoading ? null : staffTab === 'public' ? (
        <section aria-label="City open-data permit records">
          <p style={{ marginBottom: 16, color: 'hsl(var(--muted-foreground))' }}>
            Commercial/industrial building permits from the City of San José open-data portal. These are issued public records, not applicant submissions to this prototype and not items for staff review here. Business name, applicant language, submission date, and assigned reviewer are not supplied by this dataset.
          </p>
          {publicPermits.length === 0 ? <div className="no-match">No public permits match these filters. Try clearing the filters; if this is a new workspace, the City data may still be loading.</div> : (
            <div className="active-queue-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {publicPermits.map(record => (
                <article key={record.id} className="active-plan-card" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, padding: 18 }} data-testid={`public-permit-${record.id}`}>
                  <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <h2 style={{ fontSize: 17, margin: '0 0 4px' }}>{record.businessName}</h2>
                      <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>City permit {record.id.replace('SJ-OPEN-', '')} · {record.businessCategory} · {record.requestType}</div>
                    </div>
                    <span className="catalog-badge">Public City dataset · {record.status}</span>
                  </div>
                  <p style={{ margin: '12px 0 6px' }}>{record.description}</p>
                  <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>Issue date: {record.sourceDate ? new Date(record.sourceDate).toLocaleDateString('en-US', { timeZone: 'UTC' }) : 'Not provided'}</span>
                    <span>Imported: {record.sourceImportedAt ? new Date(record.sourceImportedAt).toLocaleDateString() : 'Not provided'}</span>
                    <a href={record.sourceUrl!} target="_blank" rel="noopener noreferrer">View City source dataset ↗</a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : staffTab === 'catalog' ? (
          <ReviewCatalog records={visibleCatalog} onReopen={handleReopen} />
      ) : filteredQueue.length === 0 ? (
        <div className="no-match" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <ClipboardCheck size={42} color="hsl(var(--muted-foreground))" style={{ margin: '0 auto 16px' }} />
          <h2>Queue Empty</h2>
          <p>No plan matching the current filter has been submitted for review yet.</p>
        </div>
      ) : (
        <div className="active-queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredQueue.map(plan => {
            const deps = plan.departments || deriveDepartments(plan.intake, plan.matched);
            const record = records.find(item => item.id === plan.id);
            return (
              <div key={plan.id} className="active-plan-card" style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '12px', overflow: 'hidden' }} data-testid={`active-plan-${plan.id}`}>
                <div 
                  className="active-plan-header" 
                  onClick={() => toggleExpand(plan.id)} 
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', padding: '16px', background: expandedPlans.includes(plan.id) ? 'hsl(var(--muted) / 0.3)' : 'transparent' }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '4px' }}>{record?.businessName || plan.intake.businessName || plan.intake.address}</div>
                    <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginBottom: 5 }}>
                      ID: {plan.id} · {record?.businessCategory || plan.intake.businessType} · {record?.requestType || 'Permit review'} · {record?.applicantLanguage || plan.language}
                      {record?.synthetic && <strong> · Applicant demo entry (not a City record)</strong>}
                    </div>
                    {record && <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginBottom: 5 }}>
                      Submitted (UTC): {record.submittedAt ? new Date(record.submittedAt).toLocaleDateString('en-US', { timeZone: 'UTC' }) : 'Not submitted'} · {record.description}
                      {record.notes && <> · Notes: {record.notes}</>}
                    </div>}
                    <div style={{ fontSize: '13px', color: 'hsl(var(--muted-foreground))', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <Building2 size={13} /> {copy[plan.language === 'other' ? 'en' : plan.language].businessLabels[plan.intake.businessType as BusinessType] || plan.intake.businessOther}
                      <span>&middot;</span>
                      {plan.intake.modifications.map(m => m === 'other' ? plan.intake.modificationOther : copy.en.modificationLabels[m as Modification]).join(', ')}
                      <span>&middot;</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={13} /> Submitted {new Date(plan.submittedAt!).toLocaleDateString()}</span>
                    </div>
                    
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {deps.map(d => {
                        const assignee = plan.departmentAssignees?.[d];
                        return (
                          <span key={d} className="catalog-badge" style={{ background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: '1px solid hsl(var(--border))' }} data-testid={`badge-dept-${d}`}>
                            {d} {assignee ? `(${assignee.split(' ')[0]})` : ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div className={`status-badge ${plan.status === 'In Review (Re-opened)' ? 'reviewed' : 'sent'}`}>
                      {plan.status}
                    </div>
                    <button className="button-tertiary" style={{ padding: '6px 12px' }}>
                      {expandedPlans.includes(plan.id) ? 'Collapse' : 'Review Plan'}
                    </button>
                  </div>
                </div>
                
                {expandedPlans.includes(plan.id) && (
                  <div className="active-plan-content" style={{ borderTop: '1px solid hsl(var(--border))', padding: '20px' }}>
                    <StaffPlanReview 
                      plan={plan} 
                      onUpdate={(updates) => onUpdateActivePlan(plan.id, updates)} 
                      onComplete={(status) => onCompleteReview(plan.id, status)} 
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}