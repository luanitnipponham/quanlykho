---
name: gstack-code-review
description: Staff Engineer adversarial code review. Catches hidden race conditions, edge cases, memory leaks, performance traps, and production bugs.
---

# Staff Engineer Adversarial Code Review

Perform a deep, adversarial code review simulating a Staff/Principal Engineer reviewing PRs before merging to main.

## 5 Critical Review Dimensions

1. **Correctness & Edge Cases**:
   - What happens with `null`, `undefined`, empty array, NaN, invalid date?
   - Asynchronous ordering: can rapid user actions cause stale state overrides?
   - Unhandled promise rejections and silent catch blocks.
2. **Performance & Memory**:
   - Unnecessary re-renders (missing memoization, unstable callback/object references).
   - Unbounded memory growth (uncleaned event listeners, intervals, web sockets).
   - N+1 query patterns or unindexed queries against databases (Supabase, Postgres).
3. **Security & Data Integrity**:
   - Cross-Site Scripting (XSS), unescaped HTML injection.
   - SQL Injection or unsanitized DB filters.
   - Leakage of sensitive keys/tokens in client bundles (`VITE_` vs backend secrets).
   - Row-level security (RLS) enforcement.
4. **Maintainability & Simplicity**:
   - Over-engineering: did we write 200 lines when 20 would do?
   - Reuse ladder check: did we duplicate existing helpers?
5. **Auto-Fix vs Advisory**:
   - Flag obvious defects with immediate patch proposals.
   - Clearly delineate non-blocking style/simplification suggestions from blocking correctness issues.
