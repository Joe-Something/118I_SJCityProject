# San Jose Permit Navigator

A bilingual prototype that helps first-time small-business owners assemble a permit action plan and route it through a simulated City staff review.

## Run & Operate

- `pnpm --filter @workspace/permit-navigator run dev` — run the web app through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, Vite, Tailwind CSS
- Permit sample data and prototype plans are local to the web artifact and browser

## Where things live

- `artifacts/permit-navigator/src/App.tsx` — applicant and staff-review workflows
- `artifacts/permit-navigator/src/requirements.ts` — prototype permit knowledge base
- `artifacts/permit-navigator/src/index.css` — visual system and responsive/print styles

## Architecture decisions

- This prototype intentionally uses browser-local plan data; it does not claim to provide official permit determinations.
- Clerk signs in real users, but applicant keys and staff desks are self-selected prototype personas, not verified permissions. Plans are not synchronized across browsers or protected from a person with access to the same browser's storage.
- Unsupported combinations return a no-match message rather than generating unverified rules.
- Staff editing blocks final submission until the reviewed change is saved.

## Product

- Collects business location, category, planned modifications, project description, language, and optional documents.
- Generates a structured permit action plan from a local five-category knowledge base.
- Supports English/Spanish UI, plain-language descriptions, printing, and simulated staff submission.
- Provides City staff approval, rejection, notes, and recommendation overrides.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
