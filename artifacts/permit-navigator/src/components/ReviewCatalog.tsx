import { useState } from 'react';
import { Search, Filter, History, MapPin, Building2, CheckCircle2, Clock3 } from 'lucide-react';
import { type BusinessType, type RequirementId } from '../requirements';

export type ReviewRecord = {
  id: string; // The Intake address or a generated ID
  timestamp: number;
  address: string;
  businessType: BusinessType | 'other';
  businessOther: string;
  status: 'Approved' | 'Rejected' | 'Modified via Staff Override';
  notes: Record<string, string>;
  overrides: Record<string, string>;
  rejected: RequirementId[];
  matched: RequirementId[];
};

export function ReviewCatalog({ records }: { records: ReviewRecord[] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'All' | 'Approved' | 'Rejected' | 'Modified via Staff Override'>('All');

  const filteredRecords = records.filter(record => {
    if (filter !== 'All' && record.status !== filter) return false;
    
    if (search.trim()) {
      const q = search.toLowerCase();
      const addrMatch = record.address.toLowerCase().includes(q);
      const bizTypeMatch = record.businessType.toLowerCase().includes(q);
      const bizOtherMatch = record.businessOther.toLowerCase().includes(q);
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
                  <div className="catalog-card-title">{record.address}</div>
                  <div className="catalog-card-sub">
                    <MapPin size={12} /> {record.address} &middot; <Building2 size={12} /> {record.businessType === 'other' ? record.businessOther : record.businessType}
                  </div>
                </div>
                <div className={`catalog-badge status-${record.status.replace(/\s+/g, '-').toLowerCase()}`}>
                  {record.status === 'Approved' ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                  {record.status}
                </div>
              </div>
              <div className="catalog-card-body">
                <div className="catalog-detail">
                  <strong>Reviewed on:</strong> {new Date(record.timestamp).toLocaleString()}
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
                        {requirement}: {record.rejected.includes(requirement) ? 'Rejected' : record.overrides[requirement] ? 'Modified via Staff Override' : 'Approved'}
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