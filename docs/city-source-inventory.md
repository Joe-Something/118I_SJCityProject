# San José permit source inventory

The prototype's document-reference mode uses **fictional, locally versioned
stand-ins** for rules, fees, status and notices. They are not published,
endorsed or approved by the City. Real City links are provided only for
independent verification. There is no City-provided real-time requirements
integration; approval for automated reuse, authenticated permit status access,
and machine-readable rules/fees/alerts has not been established.

| Topic | Official source | What it can establish |
| --- | --- | --- |
| Planning rules | [Planning online permits](https://www.sanjoseca.gov/business/development-services-permit-center/online-permits-at-sjpermits-org/planning-online-permits) | Published general application guidance; no project determination or machine-readable effective date. |
| Building rules | [Building Division](https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-division) | Published general guidance and linked handouts; not a complete rule feed. |
| Fees | [Building permit fees](https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-division/building-permit-fees) | Links to the City's fee schedule and estimator; actual fees depend on project details. The app does not compute them. |
| Individual status | [SJPermits public search](https://permits.sanjoseca.gov/search/) | Human-readable public search; applicant-only application status requires sign-in. The app does not query individual permits. |
| Aggregate status | [Active building permits](https://data.sanjoseca.gov/dataset/active-building-permits) | Daily open-data snapshot with CKAN metadata; not real-time status. |
| Notices/alerts | [Development Services Permit Center](https://www.sanjoseca.gov/business/development-services-permit-center) | Public notices on a City page; no comprehensive alert feed or assurance that no notice exists elsewhere. |
| Historical examples | [Last 30 days building permits](https://data.sanjoseca.gov/dataset/last-30-days-building-permits) | Periodically imported issued-permit metadata only; not current requirements. |

The local fixtures in `artifacts/api-server/src/lib/prototype-sources.ts`
carry an example revision date and version. Their local integrity/age check
is shown in the saved answer; an outdated or unavailable fixture stops the
demo answer rather than silently using old content. The reference desk lists
the same fixtures. The portal's five requirement cards are also labeled as
versioned synthetic examples; their City links are independent verification
destinations, not citations proving the examples. The City website rejected server requests with HTTP 403
when this prototype was built, so there is **no live City page check** in this
mode. The daily open-data import remains separately labeled as historical
issued-permit metadata, not a source of current requirements. Users must
verify all real requirements directly with the City before acting.