---
name: Staff review test fixtures
description: Keep browser test staff state aligned with the reviewer portal's access-aware filtering
---

Staff portal browser harnesses should provide a concrete selected department and explicit access/read-only state so fixture applications pass the same view filtering as production data. These props only simulate the UI in tests; they do not grant server access.

**Why:** A browser test silently rendered an empty review queue when its harness omitted the department selection. The artifact typecheck excludes test files, so this mismatch was not caught by the normal TypeScript check.

**How to apply:** When StaffPortal's props or filtering changes, update the staff browser harness to supply realistic state and verify the target application is visible before exercising reviewer actions.