---
name: Application outage behavior
description: Trust and continuity rules for staff application queues during database outages
---

During a database outage, preserve a same-user, same-filter confirmed queue, including a confirmed empty result. Only authorized staff without a confirmed result may receive clearly labeled read-only examples. Never fabricate applicant saved plans, claim a sample is a saved submission, or acknowledge a write against fallback data.

**Why:** The user requested automatic sample fallback to keep staff browsing available, but substituting samples for real submissions would misrepresent the review queue and risk lost work. An empty confirmed queue is still confirmed data.

**How to apply:** Keep authorization before fallback, clear private data when identity or access changes, disable changes while viewing stale data, and distinguish training examples from genuine submissions independently of general synthetic-data labeling.

Database timeout classification must account for uncoded driver timeout errors as well as PostgreSQL error codes.

**Why:** Connection-pool and query timeouts can lack a code, so code-only classification misses precisely the outages introduced by bounded timeout settings.

**How to apply:** Recognize narrowly identified driver timeout shapes and nested causes; do not treat arbitrary programming errors or unrelated cancellation as successful fallback.