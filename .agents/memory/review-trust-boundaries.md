---
name: Review trust boundaries
description: Product wording and testing controls must not imply unimplemented City authority
---

Removing prototype or demo branding does not remove the need to identify synthetic references and distinguish internal review actions from official City decisions. Browser role controls alone must never authorize server access.

**Why:** The workspace has synthetic reference material and independently saved submissions, not an authenticated City permit-issuance, hearing-scheduling, dispatch, or email-delivery connection. Relabeling those capabilities as operational would misrepresent what actually occurred.

**How to apply:** Keep sample-data and non-official-decision disclosures even when improving enterprise-facing language. Use administrator-managed Clerk private-metadata eligibility for private staff operations. Describe in-app messages separately from external delivery.

The user explicitly chose to let all server-approved staff reviewers activate cross-department administrator mode, not just separately designated administrators. Applicants and unapproved accounts remain ineligible. Turning mode off restores the account's assigned-department rules.

**Why:** The user requested an operational Administrator Role toggle and chose all approved reviewers when asked who should be eligible. This replaces the earlier UI-only simulation policy, without permitting arbitrary signed-in accounts to elevate themselves.

**How to apply:** Verify reviewer eligibility server-side on every request, persist activation server-side, preserve the assigned department, and have the browser reflect confirmed permissions rather than grant them itself.