# GStack Rules & Behavioral Guidelines

Apply these rules continuously during all development tasks:

1. **Boil the Ocean**: Ensure comprehensive test coverage, edge cases, and explicit error handling. No half-finished solutions or hidden shortcuts.
2. **The Reuse Ladder**: Before creating new utilities or components, first check existing project code, then standard framework primitives (React, Tailwind, Supabase), before adding any new code.
3. **Iron Law of Investigation**: Do not apply blind fixes to bugs. Reproduce, trace data flow to the root cause, verify the hypothesis, and add regression guards.
4. **Anti-Slop Standard**: Reject generic, unpolished UI. Ensure high visual polish, smooth transitions, responsive behavior, and clean loading/error states.
5. **Quality Gate**: Validate TypeScript types (`npm run build` or `tsc`), linting, and run tests before considering any task complete.
