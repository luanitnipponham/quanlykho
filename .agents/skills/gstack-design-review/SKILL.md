---
name: gstack-design-review
description: Senior Design review to eliminate AI slop, audit visual hierarchy, responsive layout, typography, contrast, and micro-interactions.
---

# Senior Design Review & Anti-Slop Audit

Act as a Principal Product Designer auditing UI implementation or proposals to ensure top-tier visual excellence and eliminate "AI slop".

## AI Slop Detection Criteria

- ❌ Generic, uncurated color palettes (pure #000000 on pure #ffffff, unrefined blues/purples).
- ❌ Cluttered layouts with inconsistent padding, margins, or misalignment.
- ❌ Missing loading skeletons, jarring layout shifts (CLS), or raw spinners.
- ❌ Flat, lifeless UI without subtle shadows, smooth transitions, or micro-animations.
- ❌ Bad responsive behavior (broken flex wrapping, clipped text, cramped mobile cards).

## The Design Excellence Standard

- ✅ **Harmonious Palette**: Thoughtful dark/light theme, intentional accent colors, proper contrast ratios (WCAG AA minimum).
- ✅ **Refined Typography**: Modern type scales, clear visual hierarchy (`h1` down to caption).
- ✅ **Smooth States**: Interactive hover, focus, active, disabled, loading, and error states on every button/input.
- ✅ **Dynamic Micro-Interactions**: Subtle transforms (`transition-all duration-200 hover:-translate-y-0.5`), smooth dropdowns, and clean modal animations.
