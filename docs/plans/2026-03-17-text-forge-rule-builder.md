# Text Forge Rule Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a premium `Text Forge` tool under `Tools` that provides chainable text/number manipulation rules with split input/output editors, reusable presets, and polished in-app feedback.

**Architecture:** Implement a deterministic client-side pipeline engine for rule execution as pure functions, then build a high-quality UI shell in the existing Tools framework. Keep transforms side-effect free and test the engine with Vitest first, then connect UI state to run/preview, notifications, and persistence-ready preset structures.

**Tech Stack:** React, TypeScript, Vitest, existing app UI components (`ToolHeader`, `ViewFooter`, badges/buttons/switches/tooltips), app toast/notification utilities.

---

### Task 1: Register Text Forge in Tools navigation

**Files:**
- Modify: `src/lib/tools.tsx`
- Modify: `src/components/tools/ToolsTool.tsx`

**Step 1: Write the failing test**
- N/A (navigation wiring; validated via typecheck + runtime tab presence)

**Step 2: Run check to verify current failure state**
- Run: `npm run typecheck`
- Expected: existing unrelated errors may appear; no Text Forge symbols exist yet

**Step 3: Write minimal implementation**
- Add `text-forge` subview entry to Tools registry and ToolsTool tab items/constants.
- Add a new `TextForgeView` import and `TabsContent` render slot.

**Step 4: Run check to verify it passes**
- Run: `npm run typecheck`
- Expected: no new TypeScript errors from navigation wiring.

**Step 5: Commit**
- Skip commit unless user requests.

### Task 2: Build and test the Text Forge pipeline engine (TDD)

**Files:**
- Create: `src/components/tools/text-forge/textForgeEngine.ts`
- Create: `src/components/tools/text-forge/textForgeEngine.test.ts`

**Step 1: Write the failing test**
- Add tests for:
  - counts (`words`, `chars`, `lines`, `numbers`)
  - cleanup (`removeNumbers`, `removeLetters`, `trimExtraSpaces`)
  - sort (`alphaAsc/Desc`, `numericAsc/Desc`) for `lines` and `tokens`
  - organize (`groupByFirstChar`, `groupByLastChar`)
  - move operations (move letters/numbers to start/end)
  - pipeline ordering correctness

**Step 2: Run test to verify it fails**
- Run: `npx vitest run src/components/tools/text-forge/textForgeEngine.test.ts`
- Expected: FAIL due to missing engine implementation.

**Step 3: Write minimal implementation**
- Implement strict typed rule schema + pipeline executor.
- Ensure stable behavior for empty inputs and mixed-content lines.

**Step 4: Run test to verify it passes**
- Run: `npx vitest run src/components/tools/text-forge/textForgeEngine.test.ts`
- Expected: PASS.

**Step 5: Commit**
- Skip commit unless user requests.

### Task 3: Implement premium Text Forge UI

**Files:**
- Create: `src/components/tools/text-forge/TextForgeView.tsx`
- Modify (if needed): `src/styles.css` (only if minor scoped styling hooks are needed)

**Step 1: Write the failing test**
- N/A (UI integration focus; behavior covered by engine tests)

**Step 2: Run check to verify baseline**
- Run: `npm run typecheck`
- Expected: no TextForge UI yet

**Step 3: Write minimal implementation**
- Build split-pane Input/Output editor with:
  - premium header/status
  - rule builder list (add/remove/reorder/toggle/edit)
  - auto-run toggle + manual run
  - copy/swap/reset actions
  - tooltips for advanced rules
  - toasts/notifications for key actions
- Add preset support (starter presets + save current pipeline in-session).

**Step 4: Run check to verify it passes**
- Run: `npm run typecheck`
- Expected: PASS with no new TS errors.

**Step 5: Commit**
- Skip commit unless user requests.

### Task 4: Verification and polish

**Files:**
- Modify: files above as needed

**Step 1: Run focused tests**
- Run: `npx vitest run src/components/tools/text-forge/textForgeEngine.test.ts`
- Expected: PASS

**Step 2: Run project type checks**
- Run: `npm run typecheck`
- Expected: no new errors introduced by Text Forge files

**Step 3: Lint diagnostics**
- Use IDE lints (`ReadLints`) for edited files and fix any introduced issues.

**Step 4: Manual QA sanity**
- Confirm `Tools -> Text Forge` tab renders and can:
  - add multiple rules
  - reorder rules
  - run pipeline
  - show transformed output
  - copy/swap/reset actions

**Step 5: Commit**
- Skip commit unless user requests.
