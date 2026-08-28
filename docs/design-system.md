# Foggy design system

Foggy should feel like a calm operations console: clear enough to scan during
routine work, dense enough for technicians, and deliberate around consequential
actions. It is not a reskin of the legacy FOG interface.

## Visual direction

- **Navigation:** deep graphite, visually separate from the work surface.
- **Primary color:** fog teal, reserved for selection, links, focus, and primary
  actions rather than used as decoration everywhere.
- **Canvas:** a warm, low-contrast neutral that lets white data surfaces read as
  layers without heavy shadows.
- **Shape:** 10–14px radii for controls and surfaces; pills only for statuses.
- **Density:** compact tables and metadata, with more breathing room around page
  sections and guided workflows.
- **Typography:** system sans-serif for fast rendering; tabular numerals for
  counts, progress, durations, and transfer metrics.

## Layout

- Fixed `272px` desktop sidebar and a sticky `64px` context bar.
- Content is capped at `1440px` and uses responsive 16/24/32px gutters.
- Page headers own the title, description, and primary page action.
- Related data belongs in a bordered panel. Avoid nesting panels inside panels.
- On mobile, navigation becomes an off-canvas drawer and wide data tables scroll
  horizontally rather than collapsing into unreadable cards.

## Color roles

- Fog teal: navigation selection, primary buttons, links, progress, focus.
- Emerald: healthy, online, successful.
- Amber: queued, warning, attention needed.
- Red: failed, destructive, irreversible.
- Sky: running, informational, in progress.
- Stone: neutral, unknown, disabled, secondary metadata.

Never communicate status using color alone. Pair color with a visible label and,
where useful, a dot or icon.

## Component rules

- Use `.button-primary`, `.button-secondary`, `.button-ghost`, and
  `.button-danger`; do not create page-specific action styling.
- Use the badge component for system/task state. Keep labels short.
- Use the search-field component for list filtering.
- Use `.panel`/`.table-card` for content surfaces and shared table classes for
  data grids.
- Disabled future actions must look disabled and must not be interactive.
- Edit forms use a single bounded panel, persistent labels, inline field errors,
  and a footer with cancel before save. Read-only limitations should be stated
  beside the affected field rather than silently hiding it.
- Keep common actions in predictable locations: primary page action at the top
  right, row actions at the far right, destructive actions visually separated.

## Accessibility

- Maintain visible keyboard focus using the teal focus ring.
- Interactive targets should be at least 40px high.
- Preserve semantic headings, labels, tables, and status text.
- Use `aria-current="page"` in navigation and `aria-busy` during HTMX requests.
- Respect reduced-motion preferences.

## Theme evolution

Theme primitives live in `src/frontend/app.css`. Add future branded or dark
themes by remapping semantic CSS variables; do not fork templates or introduce
page-local color systems.
