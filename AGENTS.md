# GStack Workflow & Engineering Standards

This project follows the **gstack** methodology (created by Garry Tan / Y Combinator) for high-velocity, high-rigor AI-assisted software engineering.

---

## 1. Core Ethos

- **Boil the Ocean**: AI makes completeness inexpensive. Do the complete job: comprehensive edge cases, test coverage, error handling, and type safety. Never take silent shortcuts; any compromise must be explicitly documented and approved.
- **Search Before Building**: Know what exists in the codebase and modern ecosystem before creating new abstractions. Do not reinvent what standard libraries or existing project utilities already solve well.
- **User Sovereignty**: Models propose, challenge, and advise; the human user decides. Cross-model or AI confidence is a signal, never unilateral permission to deviate from user goals.
- **Build for Yourself**: Concrete problems with real examples and user empathy beat generic hypothetical abstractions every time.
- **Iron Law of Investigation**: When a bug or failure occurs, **NEVER** guess or apply speculative patches. Always trace data flow, inspect state, find the root cause, and verify hypotheses before touching code.

---

## 2. The Reuse Ladder

Before writing any new function, component, or utility, evaluate the ladder from top to bottom and stop at the first rung that satisfies the requirement:
1. **Existing helper / component in project**: Re-use without duplication.
2. **Standard library / framework primitive**: React, Vite, Supabase, Tailwind primitives.
3. **Established, vetted dependency**: Add only if strictly necessary and lightweight.
4. **New custom abstraction**: If none of the above fit, write clean, well-tested code following project conventions.

---

## 3. The gstack Sprint Lifecycle

Every feature or non-trivial change should traverse the pipeline:

```
[Office Hours] ➜ [CEO Review] ➜ [Eng & Design Review] ➜ [Implementation] ➜ [Staff Code Review] ➜ [QA Audit] ➜ [Ship]
```

- **Think (`gstack-office-hours`)**: Interrogate the problem with forcing questions before writing a single line of code.
- **Strategy (`gstack-ceo-review`)**: Evaluate scope modes (Expansion, Selective Expansion, Hold Scope, Reduction) and identify the "10-star product" wedge.
- **Architecture (`gstack-eng-review`)**: Lock data flow, error paths, state machines, and test matrix.
- **Design (`gstack-design-review`)**: Eliminate AI slop, maintain visual polish and responsive typography/spacing.
- **Review (`gstack-code-review`)**: Staff Engineer adversarial lens catching edge cases, race conditions, and production traps.
- **Debug (`gstack-investigate`)**: Systematic root-cause debugging.
- **Verify (`gstack-qa`)**: Real-world browser verification and regression testing.
- **Release (`gstack-ship`)**: Git hygiene, build checks, and release readiness.
