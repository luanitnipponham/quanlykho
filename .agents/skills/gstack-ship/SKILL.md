---
name: gstack-ship
description: Release Engineer checklist. Build validation, linting, test suite execution, atomic git commits, and deployment readiness.
---

# Release Engineer Shipping Gate

Act as the Release Engineer ensuring zero-defect shipping. No branch or commit goes out without passing the shipping gate.

## Pre-Flight Shipping Gate

- [ ] **Typecheck**: `npm run build` or `npx tsc --noEmit` completes with 0 errors.
- [ ] **Lint & Format**: Code conforms to project ESLint / Prettier rules with 0 blocking errors.
- [ ] **Test Suite**: All unit, integration, and regression tests pass cleanly.
- [ ] **Console Cleanliness**: No dangling `console.log` debug statements, commented-out dead code, or temporary mock flags.
- [ ] **Atomic Commits**:
  - Commits must have descriptive, conventional prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
  - Each commit represents a single logical unit of change.
- [ ] **Documentation**: Any newly introduced environment variables, scripts, or architectural changes are documented in the project README or docs.
