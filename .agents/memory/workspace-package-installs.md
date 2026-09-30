---
name: Workspace package installs
description: Dependency installation can rewrite the workspace configuration unexpectedly
---

When adding a package with pnpm, inspect the workspace configuration diff and restore unrelated formatting and comments after installation.

**Why:** A package add reserialized the workspace YAML, dropping explanatory supply-chain safety comments and reordering a long overrides list even though those settings did not need to change.

**How to apply:** Keep changes to the intended package manifest and lockfile; compare the workspace configuration against its original form and preserve the minimum release age and override policies.