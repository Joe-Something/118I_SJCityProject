import { useState } from 'react';
import { Search, History, MapPin, Building2, CheckCircle2, Clock3, Pencil } from 'lucide-react';
import { ActivePlan } from '../types';
import { deriveDepartments } from '../utils/helpers';

export function ReviewCatalog({ records, onReopen }: { records: ActivePlan[], onReopen: (id: string) => Promise<boolean> }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Approved' | 'Rejected' | 'Modified via Staff Override'>('All');
  const [reopenErrors, setReopenErrors] = useState<Record<string, string>>({});
  const [reopeningIds, setReopeningIds] = useState<Set<string>>(() => new Set());

  const handleReopen = async (id: string) => {
    setReopenErrors(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setReopeningIds(current => new Set(current).add(id));
    try {
      const reopened = await onReopen(id);
      if (!reopened) {
        setReopenErrors(current => ({
          ...current,
          [id]: "We couldn't save this plan's reopening. It remains in the review catalog. Try again.",
        }));
      }
    } catch {
      setReopenErrors(current => ({
        ...current,
        [id]: "We couldn't save this plan's reopening. It remains in the review catalog. Try again.",
      }));
    } finally {
      setReopeningIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const filteredRecords = records.filter(record => {
    if (filter !== 'All' && record.status !== filter) return false;
    
    if (search.trim()) {
      const q = search.toLowerCase();
      const addrMatch = record.intake.address.toLowerCase().includes(q);
      const bizTypeMatch = record.intake.businessType.toLowerCase().includes(q);
      const bizOtherMatch = record.intake.businessOther.toLowerCase().includes(q);
      if (!addrMatch && !bizTypeMatch && !bizOtherMatch) return false;
    }
    
    return true;
  });

  return (
    <div className="review-catalog" data-testid="review-catalog">
      <div className="catalog-header">
        <div>
          <h2>Review Catalog & History</h2>
          <p>Previously reviewed plans and staff decisions.</p>
        </div>
        <div className="catalog-controls">
          <div className="search-box">
            <Search size={16} />
            <input 
              type="text" 
              placeholder="Search address or category..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-catalog-search"
            />
          </div>
          <select 
            value={filter} 
            onChange={e => setFilter(e.target.value as any)}
            className="filter-select"
            data-testid="select-catalog-filter"
          >
            <option value="All">All Statuses</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Modified via Staff Override">Modified via Staff Override</option>
          </select>
        </div>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="catalog-empty" data-testid="catalog-empty-state">
          <History size={42} />
          <h3>No records found</h3>
          <p>No reviewed plans match your current search or filters.</p>
        </div>
      ) : (
        <div className="catalog-list">
          {filteredRecords.map(record => (
            <div key={record.id} className="catalog-card" data-testid={`catalog-record-${record.id}`}>
              <div className="catalog-card-header">
                <div>
                  <div className="catalog-card-title">{record.intake.businessName || record.intake.address} <span className="catalog-badge">Applicant demo entry</span></div>
                  <div className="catalog-card-sub">Application ID: {record.id}</div>
                  <div className="catalog-card-sub">
                    <MapPin size={12} /> {record.intake.address} &middot; <Building2 size={12} /> {record.intake.businessType === 'other' ? record.intake.businessOther : record.intake.businessType}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(record.departments || deriveDepartments(record.intake, record.matched)).map(d => (
                      <span key={d} className="catalog-badge" style={{ background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))', border: '1px solid hsl(var(--border))' }}>
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div className={`catalog-badge status-${record.status.replace(/\\s+/g, '-').toLowerCase()}`}>
                    {record.status === 'Approved' ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                    {record.status}
                  </div>
                  <button
                    className="button-secondary"
                    onClick={() => void handleReopen(record.id)}
                    disabled={reopeningIds.has(record.id)}
                    data-testid={`button-reopen-${record.id}`}
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                  >
                    <Pencil size={13}/> {reopeningIds.has(record.id) ? 'Saving…' : reopenErrors[record.id] ? 'Retry Re-open for Review' : 'Re-open for Review'}
                  </button>
                </div>
              </div>
              {reopenErrors[record.id] && (
                <div role="alert" data-testid={`reopen-error-${record.id}`} style={{ padding: '10px 14px', color: 'hsl(var(--destructive))' }}>
                  {reopenErrors[record.id]}
                </div>
              )}
              <div className="catalog-card-body">
                <div className="catalog-detail">
                  <strong>Reviewed on:</strong> {record.completedAt ? new Date(record.completedAt).toLocaleString() : 'N/A'}
                </div>
                <div className="catalog-detail">
                  <strong>Decisions:</strong> {record.matched.length} items reviewed.
                  {record.rejected.length > 0 && ` (${record.rejected.length} rejected)`}
                  {Object.keys(record.overrides).length > 0 && ` (${Object.keys(record.overrides).length} overridden)`}
                </div>
                <div className="catalog-detail">
                  <strong>Requirement decisions:</strong>
                  <ul className="catalog-detail-list">
                    {record.matched.map(requirement => (
                      <li key={requirement}>
                        {requirement}: {record.rejected.includes(requirement as any) ? 'Rejected' : record.overrides[requirement] ? 'Modified via Staff Override' : 'Approved'}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="catalog-detail">
                  <strong>Staff reviewer notes:</strong>
                  {Object.keys(record.notes).length ? (
                    <ul className="catalog-detail-list">
                      {Object.entries(record.notes).map(([requirement, note]) => (
                        <li key={requirement}><span>{requirement}:</span> {note || 'No written note provided.'}</li>
                      ))}
                    </ul>
                  ) : <span className="catalog-none"> No notes recorded.</span>}
                </div>
                <div className="catalog-detail">
                  <strong>Staff modifications:</strong>
                  {Object.keys(record.overrides).length ? (
                    <ul className="catalog-detail-list">
                      {Object.entries(record.overrides).map(([requirement, modification]) => (
                        <li key={requirement}><span>{requirement}:</span> {modification}</li>
                      ))}
                    </ul>
                  ) : <span className="catalog-none"> No modifications recorded.</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}