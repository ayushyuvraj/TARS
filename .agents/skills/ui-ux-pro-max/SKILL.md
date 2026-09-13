---
name: ui-ux-pro-max
description: Elite UI/UX engineering and high-end enterprise design system craft skill. Fuses luxury typography, micro-interactions, Linear-style dark/light glass hierarchy, crisp typography contrast, calibrated status badges, frictionless card ergonomics, and tactile physics.
---

# UI/UX Pro Max — Elite Enterprise Craft & Aesthetic Engineering

## Core Design Principles for High-End Enterprise & Financial Workbenches

1. **Information Architecture & Scannability**:
   - High-density data must feel effortless to parse.
   - Primary attributes (e.g., Rule Name, Execution Order #, Core Status) lead with strong typographic contrast.
   - Secondary attributes (Audit lineage, timestamps, author, version) sit in muted neutral tokens (`#64748b`, `#94a3b8`) with subtle icons.
   - Badges and chips must use calibrated semantic palettes with subtle 1px translucent borders (`border: 1px solid rgba(..., 0.18)`), never loud solid saturated fills.

2. **Card Ergonomics & Visual Depth**:
   - Elevated background layers (`#ffffff` with `0 1px 3px rgba(0,0,0,0.05), 0 10px 25px -5px rgba(0,51,141,0.04)`).
   - Glassmorphic accents and subtle 1px border lines (`border: 1px solid rgba(226, 232, 240, 0.8)`).
   - Distinct active/expanded states: When a rule card expands, it should subtly glow with KPMG royal cobalt highlights (`box-shadow: 0 8px 30px -4px rgba(0, 51, 141, 0.12), inset 0 0 0 1.5px #005eb8`), elevating itself above resting cards.

3. **Interactive Control Ergonomics**:
   - **Checkboxes**: Custom animated checkboxes with smooth scale transitions and vibrant cerulean checks.
   - **Segmented Controls (Exact vs Tolerance)**: Pill toggles with sliding backgrounds or active shadow states (`background: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-radius: 8px`).
   - **Normalizer Chips**: Tactile toggle pills with icon indicators (✓ check when active, subtle plus when inactive), soft background transitions (`transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1)`), and hover lift.
   - **Action Buttons**: Clean ghost buttons with subtle hover backgrounds (`rgba(0, 51, 141, 0.06)` for edit, `rgba(220, 38, 38, 0.08)` for delete) and active press scales (`transform: scale(0.97)`).

4. **Typography & Hierarchy**:
   - Typography should feel intentional, using refined weights (400 regular, 500 medium, 600 semibold, 700 bold).
   - Concept mappings (e.g. `BillFromGstin ↔ BillFromGstin`) styled with sleek monospace badges (`font-family: var(--v2-font-mono)`, `#0f172a`, subtle background `#f1f5f9`).
   - Clean sectional dividers with hairline borders (`1px solid #f1f5f9`).

5. **Motion & Feedback**:
   - Expand/collapse transitions: smooth height and opacity transitions under 220ms with custom easing `cubic-bezier(0.16, 1, 0.3, 1)`.
   - Hover feedback: cards subtly lift by 1px on hover (`transform: translateY(-1px)`), with a soft drop shadow expansion.
