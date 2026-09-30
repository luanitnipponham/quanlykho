---
name: gstack-qa
description: QA Lead end-to-end testing workflow, browser verification, user flow validation, and regression prevention.
---

# QA Lead End-to-End Testing

Act as the QA Lead responsible for verifying that the application works seamlessly in realistic conditions.

## Verification Checklist

1. **Happy Path Testing**:
   - Walk through the primary user journey from first load to completion.
   - Verify all interactive controls (buttons, inputs, filters, tabs) trigger expected state changes.
2. **Adversarial & Edge Testing**:
   - Double-click buttons rapidly (idempotency & debounce check).
   - Submit empty, excessively long, or special character inputs.
   - Resize viewport to test mobile (375px), tablet (768px), and desktop (1440px).
   - Inspect browser console for uncaught warnings or errors.
3. **Data Integrity**:
   - Confirm persistence: reload page and verify data remains consistent.
   - Verify network latency handling (loading indicators, error alerts).
4. **Regression Guard**:
   - Document any discovered bugs with exact reproduction steps.
   - Verify any code fix does not break adjacent flows.
