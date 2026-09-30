---
name: gstack-investigate
description: Root-cause debugging following the Iron Law of Investigation. No fixes without reproducing, observing logs/state, and validating hypotheses.
---

# Iron Law of Investigation (Root Cause Debugging)

**The Iron Law**: No fixes without investigation. Never guess, never apply "try this and see" band-aids.

## The 4-Step Debug Protocol

1. **Reproduction & Observation**:
   - Determine exact inputs and environmental conditions causing the failure.
   - Inspect console logs, network payloads, call stacks, and runtime state.
   - Verify: Is this a deterministic bug or a timing/concurrency issue?
2. **Data Flow Tracing**:
   - Trace the error backward from the point of failure:
     `Sink (Error display)` ⬅️ `State/Hook` ⬅️ `Controller/Service` ⬅️ `API/Source of truth`
   - Pinpoint the exact line where reality diverged from expectations.
3. **Hypothesis & Proof**:
   - Formulate a clear hypothesis: *"Component X fails because when prop Y is undefined, method Z evaluates to NaN"*.
   - Prove the hypothesis with targeted logs or isolated test cases before writing the fix.
4. **Permanent Resolution & Regression Guard**:
   - Apply the clean, minimal root-cause fix.
   - Add a test or assertion so this exact bug cannot regress silently in the future.
   - Limit rule: If 3 consecutive fix attempts fail, **stop immediately**, step back, re-evaluate architectural assumptions, and consult the user.
