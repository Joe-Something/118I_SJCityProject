# San Jose Permit Navigator

A bilingual prototype that helps first-time small-business owners assemble a permit action plan and route it through a simulated City staff review.

## Run & Operate

- `pnpm --filter @workspace/permit-navigator run dev` — run the web app through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, Vite, Tailwind CSS
- Permit guidance rules are local to the web artifact; application records are stored in the Replit PostgreSQL database

## Where things live

- `artifacts/permit-navigator/src/App.tsx` — applicant and staff-review workflows
- `artifacts/permit-navigator/src/requirements.ts` — prototype permit knowledge base
- `artifacts/permit-navigator/src/index.css` — visual system and responsive/print styles

## Architecture decisions

- This prototype uses synthetic database application records; it does not claim to provide official permit determinations.
- Clerk signs in real users. Applicant queries are scoped by Clerk user and applicant key. Choosing a staff desk is only a UI preference; staff API reads, reviews, audit history, and the escalation queue now require administrator-assigned Clerk `privateMetadata.staffRole = "reviewer"` and `privateMetadata.staffDepartment = "Planning" | "Building" | "Fire" | "Economic Development"`. Access denies by default. Department restrictions are enforced on the server. Do not enter sensitive information or present this prototype as a City system.
- Older browser-local plans are imported to the database on the applicant's next login; new plans use the database as their source of truth.
- The read-only Public permits tab imports commercial/industrial building permit metadata from the City of San José open-data CSV on API startup and periodically thereafter. Each record links to its source. The dataset does not provide business names, applicant languages, assigned reviewers, or submission dates; never present invented values for those. Public permits are not prototype applications or staff-review work items. Applicant/owner/contractor names and parcel numbers from the CSV are deliberately not imported.
- The full-screen AI workspace uses a simulated, allowlisted tool boundary. Research mode exposes PII-free District 2 synthetic demonstrations; online-reference mode uses the periodically refreshed public City permit cache, not live City infrastructure or real-time browsing. Safety escalations are stored in a prototype high-urgency queue visible only to authorized Fire/Economic Development reviewers; no City inbox or emergency dispatcher is connected. Never imply an actual City handoff has happened.
- Unsupported combinations return a no-match message rather than generating unverified rules.
- Staff editing blocks final submission until the reviewed change is saved.

## Product

- Collects business location, category, planned modifications, project description, language, and optional documents.
- Generates a structured permit action plan from a local five-category knowledge base.
- Supports English/Spanish UI, plain-language descriptions, printing, and simulated staff submission.
- Provides City staff approval, rejection, notes, and recommendation overrides.
- Provides signed-in AI conversations and a publicly searchable, explicitly labeled synthetic reference desk.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
