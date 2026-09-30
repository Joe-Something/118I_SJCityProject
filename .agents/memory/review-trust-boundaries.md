---
name: Review trust boundaries
description: Product wording and testing controls must not imply unimplemented City authority
---

Removing prototype or demo branding does not remove the need to identify synthetic references and distinguish internal review actions from official City decisions. Browser role controls alone must never authorize server access.

**Why:** The workspace has synthetic reference material and independently saved submissions, not an authenticated City permit-issuance, hearing-scheduling, dispatch, or email-delivery connection. Relabeling those capabilities as operational would misrepresent what actually occurred.

**How to apply:** Keep sample-data and non-official-decision disclosures even when improving enterprise-facing language. Use server-stored Clerk private metadata for staff authorization, including the explicit self-enrollment policy below. Describe in-app messages separately from external delivery.

Any signed-in account that explicitly chooses City Staff may enroll itself for automatic cross-department administrator access. There is no Administrator Role toggle or prior staff approval requirement. Signed-out visitors cannot enroll.

**Why:** The user explicitly confirmed that any signed-in account choosing City Staff should receive administrator access, after being warned that any registered user could then access submitted applicant records and documents. This replaces the earlier staff-approval requirement.

**How to apply:** Use an authenticated, same-origin enrollment request for the current account; never accept a client-supplied identity. Store staff eligibility server-side and verify it on protected requests. Preserve the assigned department for attribution. Applicant saved-plan endpoints remain owner-scoped even for enrolled staff; unsubmitted drafts and sample-write protections remain intact.