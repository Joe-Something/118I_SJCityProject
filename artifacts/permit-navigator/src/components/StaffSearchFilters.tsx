import { useId, useState } from 'react';
import { ListFilter, Search, SlidersHorizontal, X } from 'lucide-react';

export type StaffApplicationFilters = {
  search: string;
  applicationId: string;
  businessName: string;
  businessCategory: string;
  requestType: string;
  status: string;
  assignedDepartment: string;
  applicantLanguage: string;
  submissionDate: string;
  descriptionOrNotes: string;
};

type StaffSearchFiltersProps = {
  filters: StaffApplicationFilters;
  onChange: (next: StaffApplicationFilters) => void;
  onClear: () => void;
};

const detailFields: { key: Exclude<keyof StaffApplicationFilters, 'search'>; label: string; placeholder: string }[] = [
  { key: 'applicationId', label: 'Application ID', placeholder: 'e.g. application number' },
  { key: 'businessName', label: 'Business name', placeholder: 'Search business name' },
  { key: 'businessCategory', label: 'Business category', placeholder: 'e.g. restaurant' },
  { key: 'requestType', label: 'Request type', placeholder: 'e.g. new business' },
  { key: 'status', label: 'Status', placeholder: 'e.g. in review' },
  { key: 'assignedDepartment', label: 'Assigned department', placeholder: 'e.g. Building' },
  { key: 'applicantLanguage', label: 'Applicant language', placeholder: 'e.g. Spanish' },
  { key: 'submissionDate', label: 'Submission date (UTC)', placeholder: 'YYYY-MM-DD' },
  { key: 'descriptionOrNotes', label: 'Description or notes', placeholder: 'Search project details' },
];

export function StaffSearchFilters({ filters, onChange, onClear }: StaffSearchFiltersProps) {
  const id = useId();
  const detailCount = detailFields.filter(({ key }) => filters[key].trim()).length;
  const activeCount = detailCount + (filters.search.trim() ? 1 : 0);
  const [expanded, setExpanded] = useState(() => detailCount > 0);

  const update = (key: keyof StaffApplicationFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <section className="staff-search-filters" aria-labelledby={`${id}-title`}>
      <div className="staff-search-filters__heading">
        <div className="staff-search-filters__identity">
          <span className="staff-search-filters__mark" aria-hidden="true"><ListFilter size={17} strokeWidth={2} /></span>
          <div>
            <h2 id={`${id}-title`}>Find applications</h2>
            <p>Search the queue by any detail. Filters work together.</p>
          </div>
        </div>
        {activeCount > 0 && (
          <span className="staff-search-filters__count" aria-live="polite" data-testid="text-active-staff-filter-count">
            {activeCount} active
          </span>
        )}
      </div>

      <div className="staff-search-filters__toolbar">
        <div className="staff-search-filters__search">
          <label htmlFor={`${id}-search`}>Search all applications</label>
          <div className="staff-search-filters__search-wrap">
            <Search size={17} aria-hidden="true" />
            <input
              id={`${id}-search`}
              type="search"
              value={filters.search}
              onChange={(event) => update('search', event.target.value)}
              placeholder="Search names, IDs, requests..."
              autoComplete="off"
              data-testid="input-staff-search"
            />
          </div>
        </div>
        <div className="staff-search-filters__actions">
          <button
            type="button"
            className={`staff-search-filters__toggle${expanded ? ' is-open' : ''}`}
            aria-expanded={expanded}
            aria-controls={`${id}-details`}
            onClick={() => setExpanded((previous) => !previous)}
            data-testid="button-toggle-staff-filters"
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            More filters{detailCount > 0 ? ` (${detailCount})` : ''}
          </button>
          <button
            type="button"
            className="staff-search-filters__clear"
            onClick={onClear}
            disabled={activeCount === 0}
            data-testid="button-clear-staff-filters"
          >
            <X size={14} aria-hidden="true" />
            Clear all
          </button>
        </div>
      </div>

      <div id={`${id}-details`} className="staff-search-filters__advanced" hidden={!expanded}>
        <div className="staff-search-filters__divider"><span>Refine by column</span></div>
        <div className="staff-search-filters__grid">
          {detailFields.map(({ key, label, placeholder }) => (
            <div className="staff-search-filters__field" key={key}>
              <label htmlFor={`${id}-${key}`}>{label}</label>
              <input
                id={`${id}-${key}`}
                  type={key === 'submissionDate' ? 'date' : 'text'}
                value={filters[key]}
                onChange={(event) => update(key, event.target.value)}
                placeholder={placeholder}
                autoComplete="off"
                data-testid={`input-staff-${key}`}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default StaffSearchFilters;