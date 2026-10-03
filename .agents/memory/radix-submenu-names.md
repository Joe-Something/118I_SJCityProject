---
name: Radix submenu accessible names
description: Accessible naming behavior for Radix dropdown submenus and stable browser-test locators.
---

Radix dropdown submenu content is labelled by its submenu trigger, so the submenu's accessible name follows the trigger rather than a custom label on the content.

**Why:** Browser tests could see the nested menu in the accessibility tree but could not locate it by the content's `aria-label`, because the trigger's `aria-labelledby` takes precedence.

**How to apply:** In Playwright, locate a submenu by the current accessible name of its trigger. When the trigger's label includes mutable status, query using the updated status after refetch.