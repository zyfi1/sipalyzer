# Panel chrome — resize handles & dividers

Unified **Graphite Cobalt** primitives for split-pane resize rails and static toolbar dividers. Prefer these over ad-hoc `border-*`, `GripVertical`, or `w-px` rules so hover, focus, density, and high-visibility mode stay consistent.

## Components

Import from `@/components/ui/panel-chrome`.

### `PanelResizeHandle`

- **`orientation`**: `"vertical"` | `"horizontal"` — sets cursor and rail geometry.
- **`density`**: `"comfortable"` (10px) | `"compact"` (8px) | `"minimal"` (4px) hit target.
- **`appearance`**:
  - **`rail`** — centered pill rail (+ optional `decor="dots"`).
  - **`grip`** — Lucide grip icon (composer-style editors).
  - **`minimal`** — flat rail strip (dense layouts, monitor chrome).
  - **`edge`** — transparent hit zone with inset rail via `::after` (packet list column edges).
  - **`table-edge`** — transparent until hover; primary tint for table header columns.
- **`as`**: `"button"` (default, preferred) | `"div"` with `role="separator"` when nested in tricky regions.
- **`label`**: required `aria-label` / accessible name.

Styling is driven by `.ui-resize-handle*` classes in `src/styles.css` (tokens: `--ui-resize-rail`, `--ui-resize-surface`, etc.).

### `AppDivider`

Static **non-interactive** rule for toolbars and inline meta rows.

- **`orientation`**: `"vertical"` | `"horizontal"`.
- **`size`**: `"xs"` (`h-3`) | `"sm"` (`h-3.5`) | `"md"` (`h-4`) | `"lg"` (`h-5`) for vertical rules; horizontal spans full width. Override with `className` (e.g. `h-6`) when needed — `tailwind-merge` resolves conflicts.
- **`decorative`**: default `true` (`role="presentation"`).

## Related

- **react-grid-layout** resize corners: `.react-resizable-handle` overrides in `src/styles.css` match the same primary accent language.
- **High visibility**: `[data-visibility="high"]` strengthens `.ui-resize-handle` and `.ui-app-divider` contrast.

## When not to use

- **List reorder / drag handles** (e.g. `GripVertical` on sortable rows) are a different affordance; keep those as explicit grab buttons unless they truly resize a pane.
