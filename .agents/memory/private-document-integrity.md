---
name: Private document integrity
description: Presigned upload URL lifetime and accepted document immutability
---

A document marked accepted or ready in the database is still replaceable if its storage object has an unexpired signed PUT URL. Validation must accept immutable bytes rather than just an object name.

**Why:** Presigned PUT URLs remain reusable until expiration; marking a reservation ready or submitting the application does not revoke them. Serving the latest generation of that same object allows post-validation changes.

**How to apply:** Upload to staging, validate a specific generation, and promote accepted bytes to a final object that has never been exposed through a signed PUT URL. Read the accepted generation and keep storage cleanup outside transactions whose metadata changes could roll back. Cancellation also cannot revoke a signed PUT: retain discoverable cleanup markers through the actual link expiry and an in-flight grace period, with periodic cleanup rather than relying on a future page visit.