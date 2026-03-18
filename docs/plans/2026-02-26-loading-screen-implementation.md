# Loading Screen Progressive Startup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Start the loading experience immediately on first load, show progressively smoothed real preload progress, and shorten minimum splash duration.

**Architecture:** Keep preload accounting in `App.tsx` unchanged, but reduce minimum splash gate duration. In `LoadScreen.tsx`, replace delayed stage-gated visibility with always-visible content and introduce a lightweight smoothing state that eases visual progress toward real preload progress.

**Tech Stack:** React, TypeScript, CSS animations.

---

### Task 1: Reduce minimum splash duration

**Files:**
- Modify: `src/components/layout/LoadScreen.tsx`
- Test: Manual startup verification

**Step 1: Write expected behavior checklist**

- Minimum splash duration is shorter than current 2800 ms.
- App still avoids flash-on/flash-off when preload is very fast.

**Step 2: Implement minimal change**

- Change `MIN_LOAD_DISPLAY_MS` to `1400`.

**Step 3: Run app and verify**

Run: `npm run dev`
Expected: startup feels faster while splash still appears briefly.

### Task 2: Immediate loader visibility

**Files:**
- Modify: `src/components/layout/LoadScreen.tsx`
- Test: Manual startup verification

**Step 1: Define acceptance**

- Logo, title/subtitle, and progress region render immediately.

**Step 2: Implement minimal change**

- Remove staged visibility state/effects and delayed class toggles.
- Render existing elements with static classes.

**Step 3: Run app and verify**

Run: `npm run dev`
Expected: loader content is visible right away on first frame.

### Task 3: Smoothed progressive visual updates

**Files:**
- Modify: `src/components/layout/LoadScreen.tsx`
- Test: Manual startup verification

**Step 1: Define acceptance**

- Visual percentage and fill width move smoothly.
- Visual progress never decreases.
- Visual progress reaches 100 when real progress reaches 100.

**Step 2: Implement minimal change**

- Add `displayedProgress` state.
- Add easing interval that advances toward real progress with a bounded delta.
- Drive bar width and percentage text from `displayedProgress`.
- Keep ARIA count values tied to real counts.

**Step 3: Run app and verify**

Run: `npm run dev`
Expected: progressive updates are smooth and synchronized to completion.

### Task 4: Quality checks

**Files:**
- Modify: `src/components/layout/LoadScreen.tsx` (if needed)
- Test: lint diagnostics for changed files

**Step 1: Check diagnostics**

Use lints on changed files.
Expected: no new lint errors.

**Step 2: Final manual verification**

- Cold start
- Warm start
- Fast and slow preload conditions (as available)

Expected: behavior matches approved Option A.
