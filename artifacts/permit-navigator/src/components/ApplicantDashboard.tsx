import { useState } from 'react';
import { ActivePlan } from '../types';
import { Clock3, FileText, ChevronRight, Plus } from 'lucide-react';
import { copy } from '../copy';
import { deriveDepartments } from '../utils/helpers';

export function ApplicantDashboard({
  plans,
  userId,
  onResume,
  onCreateNew
}: {
  plans: ActivePlan[];
  userId: string;
  onResume: (plan: ActivePlan) => void;
  onCreateNew: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'open' | 'edited' | 'closing' | 'closed'>('open');

  const myPlans = plans.filter(p => p.userId === userId);
  
  const openPlans = myPlans.filter(p => ['Draft — Requires Review', 'In Review (Re-opened)'].includes(p.status));
  const editedPlans = [...myPlans].sort((a, b) => b.updatedAt - a.updatedAt);
  const closingPlans = myPlans.filter(p => ['Draft — Requires Review', 'In Review (Re-opened)'].includes(p.status));
  const closedPlans = myPlans.filter(p => ['Approved', 'Rejected', 'Modified via Staff Override'].includes(p.status));

  const renderPlanCard = (plan: ActivePlan, showEst: boolean = false) => {
    const t = copy[plan.language === 'other' ? 'en' : plan.language];
    const departments = plan.departments || deriveDepartments(plan.intake, plan.matched);
    
    return (
      <div key={plan.id} className="catalog-card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }} data-testid={`dashboard-plan-card-${plan.id}`}>
        <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{plan.intake.businessName || plan.intake.address || 'Untitled Project'}</div>
            <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>Application ID: {plan.id} · Synthetic prototype data</div>
           <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
             {plan.intake.businessType ? (t.businessLabels[plan.intake.businessType] || plan.intake.businessOther || 'Unknown Type') : 'Draft'} &middot; {new Date(plan.updatedAt).toLocaleDateString()}
             <div style={{ display: 'inline-block', marginLeft: 8 }} className="catalog-badge">
                {plan.status}
             </div>
           </div>
           
           <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
             {departments.map(d => (
               <span key={d} className="catalog-badge" style={{ background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: '1px solid hsl(var(--border))' }} data-testid={`badge-dept-${d}`}>
                 {d}
               </span>
             ))}
           </div>
           
           {showEst && (
             <div style={{ marginTop: 8, fontSize: 12, color: 'hsl(var(--primary))', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
               <Clock3 size={14} /> Est. 2–3 business days for staff verification
             </div>
           )}
        </div>
        <div style={{ alignSelf: 'center' }}>
          <button className="button-secondary" onClick={() => onResume(plan)} data-testid={`button-resume-plan-${plan.id}`}>
            {plan.status === 'Draft' ? 'Resume Draft' : 'Open Plan'} <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  };

  const getActiveList = () => {
    switch(activeTab) {
      case 'open': return openPlans;
      case 'edited': return editedPlans;
      case 'closing': return closingPlans;
      case 'closed': return closedPlans;
    }
  };

  const activeList = getActiveList();

  return (
    <div className="plan-shell" data-testid="applicant-dashboard">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--app-font-serif)', fontSize: 32, margin: '0 0 8px' }}>Action Plan Catalog</h1>
          <p style={{ color: 'hsl(var(--muted-foreground))', margin: 0 }}>Manage your business permit action plans and review staff feedback.</p>
        </div>
        <button className="button-primary" style={{ marginTop: 0, width: 'auto' }} onClick={onCreateNew} data-testid="button-create-new-plan">
          <Plus size={16} /> New Action Plan
        </button>
      </div>

      <div className="staff-tabs">
        <button className={`tab-button ${activeTab === 'open' ? 'active' : ''}`} onClick={() => setActiveTab('open')} data-testid="tab-dashboard-open">Currently Open Plans</button>
        <button className={`tab-button ${activeTab === 'edited' ? 'active' : ''}`} onClick={() => setActiveTab('edited')} data-testid="tab-dashboard-edited">Last Edited Plans</button>
        <button className={`tab-button ${activeTab === 'closing' ? 'active' : ''}`} onClick={() => setActiveTab('closing')} data-testid="tab-dashboard-closing">Estimated Closing Plans</button>
        <button className={`tab-button ${activeTab === 'closed' ? 'active' : ''}`} onClick={() => setActiveTab('closed')} data-testid="tab-dashboard-closed">Closed Action Plans</button>
      </div>

      {activeList.length === 0 ? (
        <div className="no-match" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <FileText size={42} color="hsl(var(--muted-foreground))" style={{ margin: '0 auto 16px' }} />
          <h2>No plans found</h2>
          <p>You have no plans in this category. Click "New Action Plan" to get started.</p>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {activeList.map(p => renderPlanCard(p, activeTab === 'closing'))}
        </div>
      )}
    </div>
  );
}