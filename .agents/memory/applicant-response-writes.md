---
name: Applicant response writes
description: Why staff response posting must be independent from review decisions
---

Keep applicant-visible staff responses separate from full-plan reviewer decisions and preserve them when other review changes are saved.

**Why:** Completed reviews are intentionally locked against decision edits, but staff may still need to respond to the applicant. Reusing a full-plan review write for a response either fails on completed cases or allows an overlapping review save to overwrite the message.

**How to apply:** When adding new applicant-facing messages or staff review actions, do not make message delivery depend on reopening a completed decision. Preserve the latest posted response during other review writes, and describe in-app visibility separately from email or external delivery.

Collecting contact permission does not authorize configuring an external delivery provider or sending messages. External delivery requires explicit user approval of both provider and destination.

**Why:** Contact preferences prepare the application for possible future delivery; they are not proof of an approved service or a successful notification.

**How to apply:** Keep external delivery disabled until approval is obtained. Later delivery work must distinguish provider acceptance, delivery confirmation, and failure, rather than treating an in-app response as a sent notification.

Stricter contact validation must apply to changed contact values, not retroactively to stored records, unrelated staff review writes, or consent withdrawal.

**Why:** Earlier versions accepted whitespace-padded emails and phone text with extensions. Strict read validation can make an entire application list fail, preventing owners from correcting the data or withdrawing permission.

**How to apply:** Preserve existing strings without silently erasing them. Keep read contracts backward-compatible and allow unchanged legacy contacts during contact-only updates; validate new values and any destination used for future delivery.