---
name: Review trust boundaries
description: Requested notice policy, factual source labels, and staff self-enrollment boundaries
---

Do not reintroduce general preliminary-guidance or unofficial-City-advice banners and boilerplate. Preserve factual synthetic/sample, read-only, source, and delivery-status labels, and do not add affirmative claims of City ownership or permit issuance.

**Why:** The user explicitly requested removal of all preliminary-guidance and unofficial-advice flags and notices. The workspace still has synthetic references and independently saved submissions, not an authenticated City permit-issuance, hearing-scheduling, dispatch, or email-delivery connection.

**How to apply:** Remove general guidance disclaimers without relabeling workspace actions as externally completed City actions. Keep sample-data and operational-status disclosures. Use server-stored Clerk private metadata for staff authorization, including the explicit self-enrollment policy below. Describe in-app messages separately from external delivery.

Any signed-in account that explicitly chooses City Staff may enroll itself for automatic cross-department administrator access. There is no Administrator Role toggle or prior staff approval requirement. Signed-out visitors cannot enroll.

**Why:** The user explicitly confirmed that any signed-in account choosing City Staff should receive administrator access, after being warned that any registered user could then access submitted applicant records and documents. This replaces the earlier staff-approval requirement.

**How to apply:** Use an authenticated, same-origin enrollment request for the current account; never accept a client-supplied identity. Store staff eligibility server-side and verify it on protected requests. Preserve the assigned department for attribution. Applicant saved-plan endpoints remain owner-scoped even for enrolled staff; unsubmitted drafts and sample-write protections remain intact.