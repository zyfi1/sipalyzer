# Loading Screen Progressive Startup Design

## Goal

Make the initial app loading screen start immediately on first load and display progress progressively with smooth motion, while reducing perceived startup delay.

## Current Behavior

- The load screen is shown while tool chunks preload in `App.tsx`.
- Progress is computed from real preload counts.
- In `LoadScreen.tsx`, staged visibility delays hide the progress UI for about 1.7 seconds.
- A minimum display time (`MIN_LOAD_DISPLAY_MS = 2800`) keeps the splash visible even when preload finishes quickly.

## Approved Direction (Option A)

1. Show loading screen content immediately from first frame.
2. Keep progress based on real preload counts.
3. Smooth visible progress so updates feel continuous rather than jumpy.
4. Reduce minimum display time for a faster startup feel.

## Design Details

### Immediate Visibility

- Remove delayed stage-based entrance timing for logo/text/progress.
- Keep existing visual styling and animation language.

### Smoothed Progressive Loading

- Keep `realProgress` derived from `loadedCount / totalCount`.
- Add `displayedProgress` state that eases toward `realProgress`.
- Use a short interval (or frame loop) to converge quickly without sudden jumps.
- Ensure completion snaps to 100% when real progress reaches 100.

### Accessibility

- Keep `role="progressbar"` and `aria-*` values mapped to real counts.
- Use smoothed progress for visual width and displayed percentage text only.

### Startup Timing

- Reduce `MIN_LOAD_DISPLAY_MS` from 2800 ms to 1400 ms.
- Keep minimum display guard to avoid flash-on/flash-off.

## Validation

- Cold app start: loading screen appears immediately.
- Progress begins moving as preload events arrive.
- Progress movement appears smooth and reaches 100 by completion.
- Fast machines still show brief branded load screen, but shorter than before.
