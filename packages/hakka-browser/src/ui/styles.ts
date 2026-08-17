/**
 * All component styles for the Hakka inspector Shadow DOM.
 * Design tokens (colors) are generated from design-tokens.json with a navy-dark
 * canonical default by scripts/sync-design-tokens.mjs — see ./tokens.css. Set
 * theme="light" on the <hakka-inspector> element for the light palette, or call
 * `setPreset()` for one of six curated presets (navy/light/high-contrast/amber/
 * matrix/paper) — see ./presets.ts for the full themable --hakka-* API (every
 * token here is overridable from the host page across the Shadow DOM boundary).
 */
import TOKENS from './tokens.css?raw'

export const STYLES = `${TOKENS}
/* ── Host isolation: the overlay never intercepts the host page's clicks ── */
:host { pointer-events: none; }
.hakka-toggle, .hakka-panel { pointer-events: auto; }

/* ── Base typography — lives on :host, not just .hakka-panel ── declared
   here so a standalone element with no .hakka-panel ancestor
   (elements/shared.ts's adoptSharedStyles) still inherits real values
   instead of the near-invisible UA default. */
:host {
  font-family: var(--hakka-font-sans);
  font-size: var(--hakka-font-md);
  color: var(--hakka-text);
  /* Suppresses WebKit/Blink's tap-highlight flash on tapped elements;
     inherited property, so declaring it here covers the whole shadow tree —
     :hover/:active states are the real feedback instead. */
  -webkit-tap-highlight-color: transparent;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
/* Form controls don't inherit the page font by default — this gives every
   control its font/color from here unless a more specific rule overrides it. */
button, input, select, textarea {
  font: inherit;
  color: inherit;
}

/* ── Keyboard focus — one visible ring everywhere ── */
:focus-visible {
  outline: 2px solid var(--hakka-accent);
  outline-offset: 1px;
  border-radius: var(--hakka-radius-md);
}

/* ── Scrollbars — themed inside the Shadow DOM ── */
.hakka-panel * {
  scrollbar-width: thin;
  scrollbar-color: var(--hakka-border) transparent;
}
.hakka-panel *::-webkit-scrollbar {
  width: 8px;
  height: 8px; /* ui-token-check-ignore: scrollbar track */
}
.hakka-panel *::-webkit-scrollbar-thumb {
  background: var(--hakka-border);
  border-radius: var(--hakka-radius-pill);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.hakka-panel *::-webkit-scrollbar-thumb:hover {
  background: var(--hakka-text-tertiary);
  border: 2px solid transparent;
  background-clip: padding-box;
}
.hakka-panel *::-webkit-scrollbar-track {
  background: transparent;
}

.hakka-toggle {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483646;
  width: 44px;
  height: var(--hakka-ctl-h-tap);
  border-radius: 50%;
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  font-size: var(--hakka-font-xl);
  color: var(--hakka-accent);
}
.hakka-toggle:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.hakka-toggle:active {
  transform: scale(0.95);
}
.hakka-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: var(--hakka-ctl-h-xs);
  padding: 0 var(--hakka-space-xs);
  border-radius: var(--hakka-radius-pill);
  background: var(--hakka-status-error);
  color: var(--hakka-status-on);
  font-size: var(--hakka-font-xs);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--hakka-font-sans);
}

/* ── Toggle HUD — compact inline expansion of the launcher (tap/Enter),
   NOT the full panel; collapses back on the next tap. ── */
@keyframes hakka-hud-in {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.hakka-hud {
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-sm);
  max-width: calc(100vw - 16px);
  padding: var(--hakka-space-md) var(--hakka-space-lg);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-lg);
  box-shadow: 0 4px 20px rgba(0,0,0,0.35);
  animation: hakka-hud-in 0.15s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .hakka-hud { animation: none; }
}
.hakka-hud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hakka-hud-count {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-variant-numeric: tabular-nums;
  color: var(--hakka-text-tertiary);
}
.hakka-hud-list {
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-xs);
  list-style: none;
}
.hakka-hud-row {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-md);
  min-height: var(--hakka-ctl-h);
}
/* Rows use plain text, not chips — same treatment as the list rows,
   scoped to the HUD instead of .hakka-list. */
.hakka-hud .hakka-method-badge {
  border: none;
  background: none;
  border-radius: 0;
  padding: 0;
  width: 40px;
  flex-shrink: 0;
  text-align: left;
}
.hakka-hud-path {
  flex: 1;
  min-width: 0;
  font-size: var(--hakka-font-sm);
  color: var(--hakka-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hakka-hud-empty {
  font-size: var(--hakka-font-sm);
  color: var(--hakka-text-tertiary);
}

/* ── Panel — mobile-first partial sheet. Below 680px it opens to
   --hakka-panel-height-mobile (60dvh), leaving the host page visible
   underneath; full-screen is an explicit escalation via .mobile-full (tap
   the grip), never the resting state. ── */
.hakka-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2147483645;
  height: 60vh;
  height: var(--hakka-panel-height-mobile, 60dvh);
  background: var(--hakka-bg);
  display: flex;
  flex-direction: column;
  font-family: var(--hakka-font-sans);
  font-size: var(--hakka-font-md);
  color: var(--hakka-text);
  overflow: hidden;
  transform: translateY(100%);
  opacity: 0;
  transition: transform 250ms cubic-bezier(0.32,0.72,0,1), opacity 0.15s ease;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  will-change: transform;
  /* Size-query container for the header's narrow/wide split below — keyed
     to the panel's own box, not the viewport, so a narrower mount() embed
     collapses the header the same way the floating overlay does at that
     width. */
  container-type: inline-size;
  container-name: hakka-panel;
}
.hakka-panel.open {
  transform: translateY(0);
  /* --hakka-panel-opacity is unset by default, so this var() fallback stays
     pixel-identical to the literal opacity(1) it replaces. */
  opacity: var(--hakka-panel-opacity, 1);
}
@media (prefers-reduced-motion: reduce) {
  .hakka-panel {
    transition: opacity 0.1s ease;
  }
}
/* >= 680px: height honors --hakka-panel-height (set by the resize handle
   below or a host override); unset by default, so var()'s fallback (80vh)
   stays pixel-identical to the literal value it replaces. */
@media (min-width: 680px) {
  .hakka-panel {
    height: var(--hakka-panel-height, 80vh);
    max-height: var(--hakka-panel-height, 80vh);
    border-top: 1px solid var(--hakka-border);
    border-radius: var(--hakka-radius-lg) var(--hakka-radius-lg) 0 0;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.15);
    padding-top: 0;
  }
}
/* Mobile full-height escalation, applied by Inspector.tsx when the grip is
   tapped; scoped to < 680px so it never fights the desktop
   var(--hakka-panel-height) resize, and .embedded (higher specificity, below)
   wins if both apply. */
@media (max-width: 679px) {
  .hakka-panel.mobile-full {
    height: 100vh;
    height: 100dvh;
  }
}

/* ── Resize handle — drag (or focus + Arrow Up/Down) to resize the panel's
   height on desktop/tablet; hidden below 680px, where the tap-to-expand grip
   below is used instead. Positioned to straddle the panel's top edge without
   adding to its box. ── */
.hakka-resize-handle {
  display: none;
  position: absolute;
  top: -4px;
  left: 0;
  right: 0;
  height: 10px; /* ui-token-check-ignore: drag-handle hit strip */
  z-index: 2;
  cursor: ns-resize;
  touch-action: none;
  align-items: center;
  justify-content: center;
}
@media (min-width: 680px) {
  .hakka-resize-handle {
    display: flex;
  }
}
.hakka-resize-grip {
  width: 28px; /* ui-token-check-ignore: grabber bar width */
  height: 3px; /* ui-token-check-ignore: grabber bar / range track */
  border-radius: var(--hakka-radius-pill);
  /* Quieter than plain border — the grip is an affordance, not a divider,
     and must not compete with the active-tab indicator right below it. */
  background: color-mix(in srgb, var(--hakka-border) 75%, transparent);
  transition: background 0.12s;
}
.hakka-resize-handle:hover .hakka-resize-grip,
.hakka-resize-handle:focus-visible .hakka-resize-grip {
  background: var(--hakka-text-tertiary);
}

/* ── Mobile expand grip (< 680px) — tap to reach full height, tap again to
   return to the 60dvh default; a two-state toggle for touch, sharing only
   the grip visual (.hakka-resize-grip) with the desktop drag handle. Hidden
   >= 680px and in embedded mode. ── */
.hakka-mobile-grip {
  display: none;
  position: absolute;
  top: -4px;
  left: 0;
  right: 0;
  height: var(--hakka-ctl-h-sm);
  z-index: 2;
  background: none;
  border: none;
  padding: 0;
  font-size: var(--hakka-font-xs);
  cursor: pointer;
  align-items: center;
  justify-content: center;
}
@media (max-width: 679px) {
  .hakka-mobile-grip {
    display: flex;
  }
}
.hakka-mobile-grip:hover .hakka-resize-grip,
.hakka-mobile-grip:focus-visible .hakka-resize-grip {
  background: var(--hakka-text-tertiary);
}

/* ── Embedded mode — the panel rendered inline into a host element
   (ui/mount.tsx) instead of the floating overlay; swaps position:fixed for
   a static box that fills its container. ── */
.hakka-panel.embedded {
  position: static;
  width: 100%;
  height: 100%;
  max-height: none;
  transform: none;
  opacity: var(--hakka-panel-opacity, 1);
  border-top: none;
  border-radius: 0;
  box-shadow: none;
  transition: none;
  padding-top: 0;
  padding-bottom: 0;
}

/* Vertical padding stays 0 so the 44px tabs set the row height and their
   active underline sits exactly on the header's bottom border. */
.hakka-header {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-md);
  /* Left inset matches the search row's magnifier (space-lg); right inset
     matches its trailing controls (space-md) — keeps both rows' icons
     aligned vertically. */
  padding: 0 var(--hakka-space-md) 0 var(--hakka-space-lg);
  border-bottom: 1px solid var(--hakka-border);
  background: var(--hakka-surface);
  flex-shrink: 0;
}
.hakka-header-count {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--hakka-text-secondary);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-pill);
  padding: var(--hakka-space-xxs) var(--hakka-space-md);
}
/* Narrow header: the count pill duplicates the list's "Showing X of Y" line,
   so every px of the toolbar row goes to the tabs instead. Keyed to the
   panel's own container width, not the viewport. */
@container hakka-panel (max-width: 679px) {
  .hakka-header-count {
    display: none;
  }
}
/* Wide container: Clear/Export/Session/⌘K sit inline; the kebab fallback
   stays hidden. */
.hakka-header-actions {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-md);
}
.hakka-header-kebab {
  display: none;
}
/* Narrow container: those same actions collapse into the one kebab button
   instead, so the tab strip (which flexes to fill the row) keeps its width. */
@container hakka-panel (max-width: 679px) {
  .hakka-header-actions {
    display: none;
  }
  .hakka-header-kebab {
    display: block;
  }
}
/* ── Control geometry — one base every interactive control composes: height,
   radius, font-size and horizontal padding resolve HERE, once, from tokens.
   The btn/btn-primary/input/select/seg-btn variants below change ONLY
   color/border/font-weight — never geometry. Header-action buttons
   (Clear/Export/Session/⌘K/the kebab trigger) and the close button escalate
   to ctl-h-lg (32px) via the more specific rule right below instead of
   inventing their own padding. */
.hakka-ctl,
.hakka-btn,
.hakka-btn-primary,
.hakka-input,
.hakka-select,
.hakka-seg-btn,
.hakka-curl-btn,
.hakka-tour-next {
  box-sizing: border-box;
  height: var(--hakka-ctl-h-md);
  border-radius: var(--hakka-radius-md);
  font-family: var(--hakka-font-sans);
  font-size: var(--hakka-font-sm);
  padding: 0 var(--hakka-space-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hakka-space-xs);
}
.hakka-btn {
  background: none;
  border: 1px solid var(--hakka-border);
  color: var(--hakka-text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
/* Header-action row + the narrow-container kebab fallback escalate to lg
   (32px), matching the close button. Direct children only, so the dropdown
   menu items inside stay at the md default instead of inheriting it. */
.hakka-header-actions > .hakka-btn,
.hakka-header-actions > .hakka-menu > summary.hakka-btn,
.hakka-header-kebab > summary.hakka-btn {
  height: var(--hakka-ctl-h-lg);
}
/* Buttons and chips host inline SVG icons — center them on the text baseline.
   .hakka-rt-tag joins this group for the icon-forward "Agent" affordance;
   its text-only uses (mock/live/runtime/cache tags) are unaffected. */
.hakka-btn, .hakka-chip, .hakka-curl-btn, .hakka-back-btn, .hakka-density-btn,
.hakka-select-mode-btn, .hakka-save-filter-btn, .hakka-saved-filter-remove,
.hakka-action-btn, .hakka-action-cancel, .hakka-json-toggle, .hakka-rt-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hakka-space-xs);
  vertical-align: middle;
}
.hakka-btn:hover {
  background: var(--hakka-surface);
  color: var(--hakka-text);
}
.hakka-btn-close {
  height: var(--hakka-ctl-h-lg);
  border: none;
  font-size: var(--hakka-font-xl);
  padding: var(--hakka-space-xxs) var(--hakka-space-sm);
  color: var(--hakka-text-tertiary);
}
.hakka-btn-close:hover {
  color: var(--hakka-text);
}

/* ── Brand mark — signal arcs pulse while capturing ── */
.hakka-mark {
  color: var(--hakka-text-secondary);
  flex-shrink: 0;
  display: block;
}
@keyframes hakka-arc-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.hakka-mark-live .hakka-mark-arc { animation: hakka-arc-pulse 2.4s ease-in-out infinite; }
.hakka-mark-live .a2 { animation-delay: 0.3s; }
.hakka-mark-live .a3 { animation-delay: 0.6s; }
@media (prefers-reduced-motion: reduce) {
  .hakka-mark-live .hakka-mark-arc { animation: none; }
}

.hakka-menu {
  position: relative;
}
.hakka-menu summary {
  list-style: none;
  user-select: none;
}
.hakka-menu summary::-webkit-details-marker { display: none; }
.hakka-menu summary::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px; /* ui-token-check-ignore: status dot */
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-2px);
  margin-left: var(--hakka-space-xxs);
}
.hakka-menu[open] summary {
  color: var(--hakka-text);
  border-color: var(--hakka-text-tertiary);
}
/* Icon-only menu triggers (the header ⋮ kebab, the search ⓘ) — the glyph
   already announces "menu", so these go ghost at rest (border-color
   transparent, not none, to keep the box geometry stable); hover paints
   the surface and [open] restores the border. */
.hakka-header-kebab > summary.hakka-btn,
.hakka-menu summary.hakka-search-help-btn {
  border-color: transparent;
  background: none;
}
.hakka-header-kebab > summary::after,
.hakka-menu summary.hakka-search-help-btn::after {
  display: none;
}
.hakka-menu-list {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-xxs);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  padding: var(--hakka-space-xs);
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  min-width: 110px;
}
.hakka-menu-list .hakka-btn {
  border: none;
  justify-content: flex-start;
  text-align: left;
  width: 100%;
  /* One line per item: long labels truncate rather than wrap. Width caps are
     content-column geometry, not control geometry — 260px fits the longest
     current label with room, then ellipsis. */
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  padding: var(--hakka-space-sm) var(--hakka-space-ml);
  border-radius: var(--hakka-radius-sm);
}
.hakka-menu-list .hakka-btn > svg {
  vertical-align: text-bottom;
}
.hakka-menu-list .hakka-btn:hover {
  background: var(--hakka-surface);
}

/* ── Filter bar — the search IS the row ── full-bleed, no outer padding or
   boxed input; the list's border-top below is the single hairline under it. ── */
.hakka-filter-bar {
  display: flex;
  align-items: center;
  background: var(--hakka-surface);
  flex-shrink: 0;
}
.hakka-filter-sub {
  padding-top: 0;
}
/* One hairline closes the whole filter group, on the list itself. */
.hakka-list {
  border-top: 1px solid var(--hakka-border);
}
/* Collapsed rows stay mounted (filter state persists) but take no space. */
.hakka-collapsed {
  display: none !important;
}

/* ── Advanced filter group — flat continuation of the filter zone ──
   Same surface as the primary row (no two-tone stack); the labeled clusters
   and a hairline above carry the grouping instead of an inset card. */
.hakka-filter-adv {
  padding: var(--hakka-space-md) var(--hakka-space-xl) var(--hakka-space-lg);
  background: var(--hakka-surface);
  border-top: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-md);
}
.hakka-filter-cluster {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  flex-wrap: wrap;
  min-height: var(--hakka-ctl-h);
}
.hakka-filter-cluster-spacer {
  flex: 1;
}
/* Panel rows follow the Settings grammar: label anchored left, controls
   right-aligned; overflow chip lines wrap right-aligned under the first. */
.hakka-filter-cluster {
  justify-content: flex-end;
  align-items: center;
}
/* Only the row's LEADING label anchors left — the range row's inline labels
   ("–", "Size kb") must stay beside their inputs, not scatter the line. */
.hakka-filter-cluster > .hakka-filter-label:first-child {
  margin-right: auto;
}
/* Hairline between sections — the same softened rule the panel's own top
   border uses, closing each label|controls row like a Settings row. */
.hakka-filter-adv > .hakka-filter-cluster:not(:last-child) {
  border-bottom: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
  padding-bottom: var(--hakka-space-md);
}
/* Method + status quick chips — first cluster inside the Filters panel;
   a wrapping row where every chip keeps its full control height and tap
   space. */
.hakka-method-chips {
  gap: var(--hakka-space-sm);
}
/* Every control in a cluster sits on the same --hakka-ctl-h line, including
   the segmented tracks: the seg's outer box totals that height and its
   nested buttons fill it, so chips, selects, and segs read as one geometry. */
.hakka-filter-cluster .hakka-btn,
.hakka-filter-cluster .hakka-select,
.hakka-filter-cluster .hakka-density-btn,
.hakka-filter-cluster .hakka-select-mode-btn,
.hakka-filter-cluster .hakka-save-filter-btn {
  height: var(--hakka-ctl-h);
  min-height: var(--hakka-ctl-h);
  padding-top: 0;
  padding-bottom: 0;
}
.hakka-filter-cluster .hakka-seg {
  height: var(--hakka-ctl-h);
}
.hakka-filter-cluster .hakka-seg-btn {
  height: 100%;
  min-height: 0;
}
.hakka-filter-label {
  display: inline-flex;
  align-items: center;
  gap: var(--hakka-space-xs);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hakka-text-tertiary);
  margin-right: var(--hakka-space-xxs);
  white-space: nowrap;
}
/* A label after controls starts a new cluster segment — give it air. */
.hakka-filter-cluster > .hakka-filter-label:not(:first-child) {
  margin-left: var(--hakka-space-md);
}

/* ── Segmented control — single-select option strips (status class, content
   type, runtime). One composed unit instead of loose pills; scrolls
   horizontally on narrow screens instead of wrapping into noise. ── */
.hakka-seg {
  display: inline-flex;
  align-items: center;
  gap: var(--hakka-space-xxs);
  padding: var(--hakka-space-xxs);
  background: color-mix(in srgb, var(--hakka-surface-raised) 80%, transparent);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.hakka-seg::-webkit-scrollbar { display: none; }
.hakka-seg-btn {
  /* Nested inside a track — radius-sm is the one deliberate exception to
     the shared md radius above, reserved for controls nested inside another
     control. */
  border-radius: var(--hakka-radius-sm);
  height: var(--hakka-ctl-h);
  justify-content: center;
  text-align: center;
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  color: var(--hakka-text-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.1s, background 0.1s;
}
.hakka-seg-btn:hover:not(.on) {
  color: var(--hakka-text-secondary);
  background: color-mix(in srgb, var(--hakka-text-tertiary) var(--hakka-tint-hover), transparent);
}
/* Active segment fills with its tone at low opacity — status classes speak
   in their semantic color (jade 2xx, steel 3xx, turmeric 4xx, chili 5xx). */
.hakka-seg-btn.on {
  color: var(--hakka-accent);
  background: color-mix(in srgb, currentColor var(--hakka-tint-active), transparent);
}
/* Search input sits inside .hakka-search-wrap so the magnifier icon can be
   absolutely positioned over its left edge without eating into the input's
   own box-model math. */
.hakka-search-wrap {
  position: relative;
  flex: 1;
  min-width: 120px;
  display: flex;
  align-items: center;
}
.hakka-search-icon {
  position: absolute;
  left: var(--hakka-space-lg);
  display: flex;
  align-items: center;
  color: var(--hakka-text-tertiary);
  pointer-events: none;
}
/* One control-height token for the whole primary row (search input, NL/
   Filters chips, the ⓘ help button) — keeps the search input the same
   height as the chips beside it instead of each sizing off its own padding. */
.hakka-search {
  width: 100%;
  height: var(--hakka-ctl-h-xl);
  box-sizing: border-box;
  background: var(--hakka-surface);
  border: none;
  border-radius: 0;
  color: var(--hakka-text);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-sm);
  padding: 0 96px 0 36px; /* ui-token-check-ignore: leading icon inset + trailing AI/ⓘ/funnel controls */
  outline: none;
}
/* Trailing controls INSIDE the search field (AI toggle, ⓘ syntax help, the
   Filters funnel) ride its right edge as quiet ghosts. Scoped (0,2,0)
   overrides below beat both the width-based min-height bump and the
   coarse-pointer .hakka-btn reset near the end of this sheet. */
.hakka-search-trailing {
  position: absolute;
  right: var(--hakka-space-md);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: var(--hakka-space-xxs);
}
.hakka-search-trailing .hakka-btn,
.hakka-search-trailing .hakka-chip {
  height: auto;
  min-height: 0;
  border-color: transparent;
  background: none;
  padding: var(--hakka-space-xxs) var(--hakka-space-xs);
  font-size: var(--hakka-font-xs);
}
.hakka-search-trailing .hakka-chip.active {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-active), transparent);
  color: var(--hakka-accent);
}
/* Borderless full-bleed field — focus speaks through a hairline accent
   underline instead of a box border. */
.hakka-search:focus {
  box-shadow: inset 0 -1px 0 var(--hakka-accent);
}
/* The datalist "list" attribute makes Chromium draw its own ▼ picker
   indicator inside the input — it collides with the trailing AI/ⓘ/funnel
   controls and clips the placeholder. Suggestions still work; only the
   native glyph goes. */
.hakka-search::-webkit-calendar-picker-indicator {
  display: none !important;
}
.hakka-search::placeholder {
  color: var(--hakka-text-tertiary);
}
.hakka-chip {
  height: var(--hakka-ctl-h);
  box-sizing: border-box;
  background: none;
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-secondary);
  cursor: pointer;
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  padding: 0 var(--hakka-space-md);
  transition: all 0.12s;
  white-space: nowrap;
}
.hakka-chip:hover {
  background: var(--hakka-surface-raised);
  color: var(--hakka-text);
}
.hakka-chip.active {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-active), transparent);
  border-color: var(--hakka-accent);
  color: var(--hakka-accent);
}
/* Method + status quick chips share one visual language: quiet graphite at
   rest, their semantic tone previewed on hover and spoken only when active. */
.hakka-chip.method-GET { --hakka-tone: var(--hakka-method-get); }
.hakka-chip.method-POST { --hakka-tone: var(--hakka-method-post); }
.hakka-chip.method-PUT { --hakka-tone: var(--hakka-method-put); }
.hakka-chip.method-PATCH { --hakka-tone: var(--hakka-method-patch); }
.hakka-chip.method-DELETE { --hakka-tone: var(--hakka-method-delete); }
.hakka-chip.status-1xx { --hakka-tone: var(--hakka-status-pending); }
.hakka-chip.status-2xx { --hakka-tone: var(--hakka-status-success); }
.hakka-chip.status-3xx { --hakka-tone: var(--hakka-status-info); }
.hakka-chip.status-4xx { --hakka-tone: var(--hakka-status-warning); }
.hakka-chip.status-5xx { --hakka-tone: var(--hakka-status-error); }
.hakka-chip[class*='method-'],
.hakka-chip[class*='status-'] {
  font-family: var(--hakka-font-mono);
  /* Same at-rest voice as every other chip in the panel. */
  color: var(--hakka-text-secondary);
  border-color: var(--hakka-border);
  /* Radius stays the shared chip radius-md here — no override. */
  font-weight: 700;
  padding: var(--hakka-space-xs) var(--hakka-space-md);
}
.hakka-chip[class*='method-']:hover,
.hakka-chip[class*='status-']:hover {
  color: var(--hakka-tone);
}
.hakka-chip[class*='method-'].active,
.hakka-chip[class*='status-'].active {
  /* Active mirrors the row badge exactly: 40% border, 10% fill. */
  color: var(--hakka-tone);
  border-color: color-mix(in srgb, currentColor var(--hakka-tint-border), transparent);
  background: color-mix(in srgb, currentColor var(--hakka-tint-hover), transparent);
}
.hakka-chip[class*='method-']:hover:not(.active),
.hakka-chip[class*='status-']:hover:not(.active) {
  background: color-mix(in srgb, currentColor var(--hakka-tint-hover), transparent);
}
.hakka-chip-sep {
  width: 1px;
  height: 16px; /* ui-token-check-ignore: inline glyph box */
  background: var(--hakka-border);
  flex-shrink: 0;
  align-self: center;
}
.hakka-search-help-list {
  min-width: 240px;
  gap: var(--hakka-space-sm);
}
.hakka-search-help-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hakka-space-md);
  padding: var(--hakka-space-xxs) var(--hakka-space-sm);
  font-size: var(--hakka-font-xs);
}
.hakka-search-help-row code {
  font-family: var(--hakka-font-mono);
  color: var(--hakka-accent);
  font-weight: 600;
  white-space: nowrap;
}
.hakka-search-help-row span {
  color: var(--hakka-text-secondary);
  text-align: right;
}
.hakka-search-help-link {
  display: block;
  margin-top: var(--hakka-space-xxs);
  padding: var(--hakka-space-sm);
  border-top: 1px solid var(--hakka-border);
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  color: var(--hakka-accent);
  text-decoration: none;
  white-space: nowrap;
}
.hakka-search-help-link:hover {
  text-decoration: underline;
}
/* Native select arrows never line up with our control geometry — suppress
   them and overlay IconChevronDown instead (every select site wraps in
   .hakka-select-wrap). */
.hakka-select {
  appearance: none;
  -webkit-appearance: none;
  background: var(--hakka-surface-raised);
  padding-right: 26px; /* ui-token-check-ignore: clearance for the overlaid chevron */
  color: var(--hakka-text-secondary);
  border: 1px solid var(--hakka-border);
  cursor: pointer;
}
.hakka-select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.hakka-select-caret {
  position: absolute;
  right: var(--hakka-space-sm);
  display: flex;
  align-items: center;
  color: var(--hakka-text-tertiary);
  pointer-events: none;
}
.hakka-select:hover {
  color: var(--hakka-text);
  border-color: var(--hakka-text-tertiary);
}

/* ── Network split: list + detail side-by-side on wide viewports ── */
.hakka-network-split {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.hakka-network-list-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.hakka-network-detail-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
@media (min-width: 900px) {
  .hakka-network-split.has-detail {
    flex-direction: row;
  }
  .hakka-network-split.has-detail .hakka-network-list-pane {
    flex: 0 0 38%;
    max-width: 460px;
    border-right: 1px solid var(--hakka-border);
  }
}

.hakka-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  /* Size-query container for the row-grid layout below — keyed to the
     LIST's own box, not the viewport or the panel: the list pane can be
     narrower than the panel in the side-by-side split, and a standalone
     <hakka-request-list> has no panel ancestor to measure at all. */
  container-type: inline-size;
  container-name: hakka-list;
}
.hakka-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--hakka-space-md);
  height: 100%;
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-md);
  text-align: center;
  padding: var(--hakka-space-xl);
}
.hakka-empty-icon {
  color: var(--hakka-text-tertiary);
  opacity: 0.5;
}
.hakka-empty-title {
  color: var(--hakka-text-secondary);
  font-size: var(--hakka-font-md);
  font-weight: 600;
}
.hakka-empty-hint {
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-sm);
  max-width: 36ch;
  line-height: 1.5;
}

.hakka-group-header {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  padding: var(--hakka-space-xs) var(--hakka-space-xl);
  background: var(--hakka-surface);
  border-bottom: 1px solid var(--hakka-border);
  position: sticky;
  top: 0;
  z-index: 1;
}
.hakka-group-label {
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  color: var(--hakka-text-secondary);
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
/* Left stripe encodes severity at a glance: chili = 5xx/error, turmeric = 4xx,
   flame = selected. 2px inset, never a badge. */
.hakka-row {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-md);
  padding: var(--hakka-space-md) var(--hakka-space-xl);
  padding-left: calc(var(--hakka-space-xl) - 2px);
  border-bottom: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: background 0.1s;
  min-height: var(--hakka-ctl-h-tap);
}
.hakka-row:hover {
  background: var(--hakka-surface);
}
.hakka-row.is-error {
  border-left-color: var(--hakka-status-error);
}
.hakka-row.is-warn {
  border-left-color: var(--hakka-status-warning);
}
.hakka-row.selected {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-hover), transparent);
  border-left-color: var(--hakka-accent);
}
.hakka-method-badge {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-weight: 700;
  padding: var(--hakka-space-xs) 0;
  border-radius: var(--hakka-radius-sm);
  border: 1px solid color-mix(in srgb, currentColor var(--hakka-tint-border), transparent);
  background: color-mix(in srgb, currentColor var(--hakka-tint-hover), transparent);
  white-space: nowrap;
  flex-shrink: 0;
  width: 44px;
  text-align: center;
}
.method-GET { color: var(--hakka-method-get); }
.method-POST { color: var(--hakka-method-post); }
.method-PUT { color: var(--hakka-method-put); }
.method-PATCH { color: var(--hakka-method-patch); }
.method-DELETE { color: var(--hakka-method-delete); }
.method-OTHER { color: var(--hakka-method-other); }
/* Rows: the method is data, not a control — plain colored mono text, no
   chip box (chips stay reserved for interactive controls). Applies at every
   .hakka-list width, and to .hakka-detail-rowback since the Detail header
   renders the same RequestRow as its title line. Width stays untouched (the
   base badge's fixed 44px keeps the path column aligned row to row); only
   text-align flips to left. */
.hakka-list .hakka-method-badge,
.hakka-detail-rowback .hakka-method-badge {
  border: none;
  background: none;
  border-radius: 0;
  padding: 0;
  text-align: left;
}
.hakka-row-url {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* Breathing room between the path line and the host line — they read as
     one smeared block without it. (display: contents in the desktop grid
     dissolves this box, so the grid's own row-gap governs there.) */
  gap: var(--hakka-space-xxs);
}
.hakka-row-path {
  font-size: var(--hakka-font-sm);
  color: var(--hakka-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hakka-row-host {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hakka-row-meta {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-md);
  flex-shrink: 0;
  font-family: var(--hakka-font-mono);
  font-variant-numeric: tabular-nums;
}
/* Groups the 0-5 optional badges into one box — one flex row on any width,
   and one GRID CELL in the >=768px row-grid below, so a row with zero badges
   never shifts the columns after it. */
.hakka-row-badges {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-xs);
}
.hakka-status {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-data);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  white-space: nowrap;
  min-width: 30px;
  text-align: right;
}
.status-success { color: var(--hakka-status-success); }
.status-error { color: var(--hakka-status-error); }
.status-warning { color: var(--hakka-status-warning); }
.status-pending { color: var(--hakka-status-pending); }
.status-info { color: var(--hakka-status-info); }
/* Duration stacked over size — one fixed-width column, both lines right-aligned
   so the mono digits register vertically like the path/host stack beside them. */
.hakka-row-timing {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 58px;
  line-height: 1.35;
}
.hakka-row-dur {
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  white-space: nowrap;
}
.hakka-row-size {
  font-size: var(--hakka-font-xs);
  color: color-mix(in srgb, var(--hakka-text-tertiary) 75%, transparent);
  white-space: nowrap;
}
/* Gated number tones — duration/size past the configured warn/hot thresholds
   (see numberGates.ts). Text color only; a tinted chip here would out-shout
   the severity stripe. */
.hakka-row-dur.num-warn,
.hakka-row-size.num-warn {
  color: var(--hakka-status-warning);
}
.hakka-row-dur.num-hot,
.hakka-row-size.num-hot {
  color: var(--hakka-status-error);
}

/* ── Desktop table row grid ──
   At >=768px of the LIST's own container width (not the viewport), a row
   becomes one true aligned grid row — method | path | host | badges |
   status | size | duration — instead of the mobile stack below. Scoped to
   .hakka-list:not(.compact): compact density is an explicit opt-in that
   keeps the mobile stack at any width.
   Every optional part gets an explicit grid-column rather than relying on
   auto-placement, so a row missing one never shifts the columns after it.
   The three wrapper elements that otherwise wrap these parts
   (.hakka-row-url, .hakka-row-meta, .hakka-row-timing) become display:
   contents here, letting their own children join this grid directly. ── */
@container hakka-list (min-width: 768px) {
  .hakka-list:not(.compact) .hakka-row {
    display: grid;
    /* Every track is fixed (or the one 1fr) — never auto-sized. Each
       .hakka-row is its own grid container (the list is virtualized, so
       subgrid is off the table); an auto-sized track would resolve per-row,
       shifting columns out of alignment with neighboring rows.
       Col 1 defaults to stripe width (--hakka-space-xxs, 2px) — with
       selectMode off, RequestRow never renders a checkbox into that cell,
       so a full 20px reservation was dead space. .multi-select-mode (below)
       restores the 20px width once there's a checkbox to put in it. */
    grid-template-columns:
      var(--hakka-space-xxs)
      44px
      minmax(0, 1fr)
      minmax(0, 160px)
      96px
      36px
      64px
      56px;
    grid-template-rows: 1fr;
    column-gap: var(--hakka-space-md);
  }
  .hakka-list:not(.compact) .hakka-row.multi-select-mode {
    grid-template-columns:
      20px
      44px
      minmax(0, 1fr)
      minmax(0, 160px)
      96px
      36px
      64px
      56px;
  }
  /* grid-row: 1 on every item, explicitly — .hakka-row-dur (col 8) sits
     before .hakka-row-size (col 7) in DOM order, and sparse auto-placement
     (the grid default) never moves its placement cursor backward: once dur
     claims column 8, size's earlier column 7 reads as "already passed" and
     gets pushed onto an implicit second row. Pinning every column's row
     explicitly sidesteps that ordering trap. */
  .hakka-list:not(.compact) .hakka-row-checkbox {
    grid-column: 1;
    grid-row: 1;
  }
  .hakka-list:not(.compact) .hakka-method-badge {
    grid-column: 2;
    grid-row: 1;
  }
  .hakka-list:not(.compact) .hakka-row-url {
    display: contents;
  }
  .hakka-list:not(.compact) .hakka-row-path {
    grid-column: 3;
    grid-row: 1;
    min-width: 0;
  }
  .hakka-list:not(.compact) .hakka-row-host {
    grid-column: 4;
    grid-row: 1;
    min-width: 0;
  }
  .hakka-list:not(.compact) .hakka-row-meta {
    display: contents;
  }
  .hakka-list:not(.compact) .hakka-row-badges {
    grid-column: 5;
    grid-row: 1;
    /* Fixed 96px track (see the template comment above) — badges wrap
       within their own cell instead of widening the column per-row. */
    min-width: 0;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .hakka-list:not(.compact) .hakka-status {
    grid-column: 6;
    grid-row: 1;
  }
  .hakka-list:not(.compact) .hakka-row-timing {
    display: contents;
  }
  .hakka-list:not(.compact) .hakka-row-size {
    grid-column: 7;
    grid-row: 1;
    text-align: right;
  }
  .hakka-list:not(.compact) .hakka-row-dur {
    grid-column: 8;
    grid-row: 1;
    text-align: right;
  }
}
.hakka-mocked-tag,
.hakka-gql-tag,
.hakka-rt-tag {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  border-radius: var(--hakka-radius-pill);
  border: 1px solid color-mix(in srgb, currentColor var(--hakka-tint-border), transparent);
  background: color-mix(in srgb, currentColor var(--hakka-tint-hover), transparent);
  padding: 1px var(--hakka-space-sm);
}
.hakka-mocked-tag {
  color: var(--hakka-status-warning);
}
.hakka-gql-tag {
  color: var(--hakka-method-patch);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hakka-rt-tag {
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.hakka-initiator {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-secondary);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-sm);
  padding: var(--hakka-space-sm);
  margin: 0 0 var(--hakka-space-md);
  white-space: pre;
  overflow-x: auto;
  line-height: 1.5;
}
/* Runtime tags speak in theme voices like every other badge: outlined tint via
   the .hakka-rt-tag base — steel for server, plum for edge. Never a filled pill. */
.hakka-rt-server {
  color: var(--hakka-status-info);
}
.hakka-rt-edge {
  color: var(--hakka-method-patch);
}
/* A stream still receiving — jade, softly pulsing (opacity only: compositor-
   friendly, and stilled entirely under reduced motion). */
.hakka-live-tag {
  color: var(--hakka-status-success);
  animation: hakka-live-pulse 1.6s ease-in-out infinite;
}
@keyframes hakka-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .hakka-live-tag { animation: none; }
}

/* Data-cache verdict tones on the same outlined-tint tag base: a HIT is good
   news (jade), STALE is a heads-up (turmeric), MISS stays the neutral tag
   tint — a miss is normal, not a warning. */
.hakka-cache-hit {
  color: var(--hakka-status-success);
}
.hakka-cache-stale {
  color: var(--hakka-status-warning);
}
/* A revalidate verdict is a heads-up like STALE, not a HIT — same tone alias. */
.hakka-cache-revalidate {
  color: var(--hakka-status-warning);
}

/* Request-kind tags (document/rsc/route-handler/server-action) on the same
   .hakka-rt-tag pill base — informational, not warning states, so neutral
   tag tint by default. */
.hakka-kind-document,
.hakka-kind-rsc,
.hakka-kind-route-handler,
.hakka-kind-server-action {
  color: var(--hakka-text-secondary);
}

/* ── Trace waterfall — the cross-runtime hop chain under a trace group header.
   Each hop shares one time axis; the bar's colour is the runtime that captured
   it, dimmed to a warn/error tone when the hop failed. ── */
.hakka-trace-wf {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--hakka-space-sm) var(--hakka-space-xl) var(--hakka-space-md);
  background: color-mix(in srgb, var(--hakka-surface) 55%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
}
/* Which color means which runtime — tiny, only the runtimes present. */
.hakka-wf-legend {
  display: flex;
  gap: var(--hakka-space-md);
  justify-content: flex-end;
  padding: 0 var(--hakka-space-xs) var(--hakka-space-xxs);
}
.hakka-wf-legend-item {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.hakka-wf-legend-item.rt-client {
  color: var(--hakka-accent);
}
.hakka-wf-legend-item.rt-server {
  color: var(--hakka-status-info);
}
.hakka-wf-legend-item.rt-edge {
  color: var(--hakka-method-patch);
}

.hakka-wf-hop {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  padding: var(--hakka-space-xxs) var(--hakka-space-xs);
  border-radius: var(--hakka-radius-sm);
  cursor: pointer;
  /* --hakka-tone is the hop's runtime colour, overridden below for warn/error. */
  --hakka-tone: var(--hakka-accent);
}
.hakka-wf-hop:hover {
  background: var(--hakka-surface);
}
.hakka-wf-hop.selected {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-hover), transparent);
}
.hakka-wf-hop.rt-server {
  --hakka-tone: var(--hakka-status-info);
}
.hakka-wf-hop.rt-edge {
  --hakka-tone: var(--hakka-method-patch);
}
.hakka-wf-hop.tone-warning {
  --hakka-tone: var(--hakka-status-warning);
}
.hakka-wf-hop.tone-error {
  --hakka-tone: var(--hakka-status-error);
}
/* Label column (dot + name) is a FIXED width, same for every row in the
   group — this is what gives every bar one shared time-axis origin. The
   legend above is the one place a "web"/"server"/"edge" LABEL appears;
   runtime is otherwise a 6px dot, not per-row text. Indentation (below,
   .kind-span .hakka-wf-label) is padding-left INSIDE this fixed box — never
   a margin on the whole row — so a deeper span trades name-text room for
   its indent instead of shifting the track/duration columns that follow it. */
.hakka-wf-label {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  width: min(42%, 180px);
  flex-shrink: 0;
  min-width: 0;
  box-sizing: border-box;
}
.hakka-wf-dot {
  width: 6px;
  height: 6px; /* ui-token-check-ignore: waterfall runtime dot, matches its own 6px width */
  border-radius: var(--hakka-radius-circle);
  background: var(--hakka-tone);
  flex-shrink: 0;
}
/* Method-prefixed path for a hop ("GET /api/users"), the span name (plus
   its request kind for the synthetic root span) otherwise. Ellipsis, never
   wrap — a name can never collide with the bar drawn in the track beside
   it because it has no room to grow into. */
.hakka-wf-name {
  flex: 1;
  min-width: 0;
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* The axis region — bars only, nothing else lives here. Every row's track
   starts at the same x (right after the fixed label column) and ends at
   the same x (right before the fixed duration column), so bars across the
   whole group share one time-axis origin regardless of depth. */
.hakka-wf-track {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 16px; /* ui-token-check-ignore: inline glyph box */
  display: flex;
  align-items: center;
}
.hakka-wf-bar {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 6px; /* ui-token-check-ignore: range track */
  min-width: 3px;
  border-radius: var(--hakka-radius-pill);
  background: var(--hakka-tone);
}
.hakka-wf-hop.tone-pending .hakka-wf-bar {
  background: repeating-linear-gradient(
    90deg,
    var(--hakka-tone) 0,
    var(--hakka-tone) 3px,
    transparent 3px,
    transparent 6px
  );
}
/* Fixed width, right-aligned, tabular-nums — durations form one straight
   right edge down the whole group. */
.hakka-wf-dur {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-data);
  font-variant-numeric: tabular-nums;
  color: var(--hakka-text-tertiary);
  flex-shrink: 0;
  width: 44px;
  text-align: right;
}

/* Framework span bars — a thinner track than a hop's, dimmed slightly so the
   request hops (the causal backbone) still read as primary. Per-depth indent
   scales the space-lg token by the --wf-depth custom property
   TraceWaterfall.tsx sets per bar — not a hardcoded px-per-level, since
   happy-dom's CSSStyleDeclaration setter can't parse a literal
   calc(var(...) * N) assigned as padding-left directly, only the
   custom-property indirection. Padding on the LABEL, not margin on the row —
   see .hakka-wf-label's doc comment for why that's load-bearing. */
.hakka-wf-hop.kind-span {
  opacity: 0.85;
}
.hakka-wf-hop.kind-span .hakka-wf-label {
  padding-left: calc(var(--hakka-space-lg) * var(--wf-depth, 0));
}
.hakka-wf-hop.kind-span .hakka-wf-track {
  height: 12px; /* ui-token-check-ignore: thinner span track, see .hakka-wf-track's own 16px hop baseline */
}
.hakka-wf-hop.kind-span .hakka-wf-bar {
  height: 4px; /* ui-token-check-ignore: thinner span bar, see .hakka-wf-bar's own 6px hop baseline */
}
/* Verbose-only spans (the "Verbose" toggle in TraceBadgeRow) sit further
   back than a primary span's own 0.85 — opted into, not the causal backbone. */
.hakka-wf-hop.kind-span.verbose {
  opacity: 0.6;
}

/* ── Trace badge row — method/status/kind pills, fetch/operation counts,
   cache summary + slowest-op prose, verbose toggle. Reuses
   .hakka-rt-tag/.hakka-count-badge/.hakka-switch throughout. ── */
.hakka-trace-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--hakka-space-sm);
  padding: var(--hakka-space-xs) var(--hakka-space-xl);
  background: color-mix(in srgb, var(--hakka-surface) 55%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
}
.hakka-trace-badge-prose {
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-secondary);
}
.hakka-trace-badge-spacer {
  flex: 1;
}
.hakka-trace-verbose-toggle {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-xs);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  cursor: pointer;
}

/* ── Rules panel — Mock / Breakpoints / Throttle behind one segmented switch ── */
.hakka-rules {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.hakka-rules-switch {
  padding: var(--hakka-space-md) var(--hakka-space-xl) 0;
  flex-shrink: 0;
}
.hakka-rules .hakka-pane {
  flex: 1;
  height: auto;
  min-height: 0;
}

/* ── Shared switch (settings/mock/breakpoints booleans) — ONE
   implementation. Toggle by adding .on to .hakka-switch. ── */
.hakka-switch {
  width: 36px;
  height: var(--hakka-ctl-h-sm);
  border-radius: var(--hakka-radius-pill);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}
.hakka-switch.on {
  background: var(--hakka-accent);
  border-color: var(--hakka-accent);
}
.hakka-switch-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px; /* ui-token-check-ignore: inline glyph box */
  border-radius: 50%;
  background: var(--hakka-text);
  transition: transform 0.15s;
}
.hakka-switch.on .hakka-switch-knob {
  transform: translateX(16px);
  background: var(--hakka-bg);
}

/* ── Shared count badge (toggle bubble, tab error dot, console unread) ──
   ONE numeric-pill treatment; .sm for the tighter 16px variant. ── */
.hakka-count-badge {
  min-width: 18px;
  height: var(--hakka-ctl-h-xs);
  padding: 0 var(--hakka-space-xs);
  border-radius: var(--hakka-radius-pill);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  display: inline-block;
  box-sizing: border-box;
}
.hakka-count-badge.sm {
  min-width: 16px;
  height: 16px; /* ui-token-check-ignore: inline glyph box */
  line-height: 16px; /* ui-token-check-ignore: inline glyph box */
}
/* Quiet outline variant — group headers and per-section item counts read as
   a passive tally, not an alert; the caller supplies no color of its own. */
.hakka-count-badge.outline {
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  color: var(--hakka-text-tertiary);
  font-weight: 400;
}

.hakka-ws-list {
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-xxs);
}
.hakka-ws-msg {
  display: flex;
  align-items: baseline;
  gap: var(--hakka-space-sm);
  padding: var(--hakka-space-xs) var(--hakka-space-sm);
  border-radius: var(--hakka-radius-sm);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  background: var(--hakka-surface-raised);
}
.hakka-ws-dir {
  flex: none;
  font-size: var(--hakka-font-xs);
}
.hakka-ws-sent .hakka-ws-dir {
  color: var(--hakka-method-post);
}
.hakka-ws-received .hakka-ws-dir {
  color: var(--hakka-status-success);
}
.hakka-ws-data {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--hakka-text);
}
.hakka-ws-time {
  flex: none;
  color: var(--hakka-text-tertiary);
}

.hakka-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Detail header — the tapped row rendered flush (same insets as the list)
   over an actions toolbar. Column layout: rowback line, optional decoded-URL
   line, toolbar. */
.hakka-detail-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 0;
  border-bottom: 1px solid var(--hakka-border);
  background: var(--hakka-surface);
  flex-shrink: 0;
}
.hakka-detail-rowback {
  border-bottom: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
}
.hakka-detail-rowback .hakka-row {
  cursor: pointer;
  /* The separator belongs to the container, not the row — the row's own
     list-separator border doubled the rowback's divider here. */
  border-bottom: none;
}
.hakka-detail-decoded {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  padding: var(--hakka-space-sm) var(--hakka-space-xl);
  word-break: break-all;
  border-bottom: 1px solid color-mix(in srgb, var(--hakka-border) 55%, transparent);
}
/* Bottom action bar — pinned under the scrolling tab content (last flex
   child of the .hakka-detail column), thumb reach on a phone. */
.hakka-detail-status {
  padding: var(--hakka-space-sm) var(--hakka-space-xl);
  border-top: 1px solid var(--hakka-border);
  background: var(--hakka-surface);
  flex-shrink: 0;
}
/* Dropdowns in the bottom bar open UPWARD — downward would render off-panel. */
.hakka-detail-status .hakka-menu-list {
  top: auto;
  bottom: calc(100% + 4px);
}
/* ← back control leading the detail tab strip. */
/* Scoped under .hakka-tabs to outrank .hakka-back-btn's fixed height below. */
.hakka-tabs .hakka-detail-tabs-back {
  background: none;
  border: none;
  /* Tabs carry a 2px active-indicator bottom border; without a matching
     transparent one here the chevron centers 3px high of the tab labels. */
  border-bottom: 2px solid transparent;
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  height: auto;
  min-height: 0;
  padding: 0 var(--hakka-space-sm) 0 var(--hakka-space-lg);
  flex-shrink: 0;
}
.hakka-detail-tabs-back:hover {
  color: var(--hakka-text);
}
/* Detail tabs are SECONDARY nav — a visible step smaller than the main
   NETWORK/STATS strip so the two levels never read as siblings. */
.hakka-detail .hakka-tab {
  font-size: var(--hakka-font-xs);
  padding-top: var(--hakka-space-xs);
  padding-bottom: var(--hakka-space-xs);
  min-height: var(--hakka-ctl-h-md);
}
.hakka-back-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-secondary);
  cursor: pointer;
  font-size: var(--hakka-font-sm);
  font-weight: 500;
  height: var(--hakka-ctl-h);
  padding: 0 var(--hakka-space-md) 0 var(--hakka-space-sm);
  gap: var(--hakka-space-xs);
  flex-shrink: 0;
}
.hakka-back-btn:hover {
  color: var(--hakka-text);
  background: var(--hakka-surface-raised);
}
.hakka-detail-status {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  flex-shrink: 0;
}
/* Geometry (height/radius/font-size/padding) comes from the shared .hakka-ctl
   base above — this rule is color/border only, same split as .hakka-btn. */
.hakka-curl-btn {
  background: none;
  border: 1px solid var(--hakka-border);
  color: var(--hakka-text-secondary);
  cursor: pointer;
}
.hakka-curl-btn:hover {
  background: var(--hakka-surface-raised);
  color: var(--hakka-text);
}

/* ── Tabs — shared by the header row and the Detail section strip ── */
.hakka-tabs {
  display: flex;
  gap: 0;
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  /* Fade the right edge so a clipped tab reads as "scroll for more", not a bug. */
  mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
}
/* Only the header's strip flexes to fill the toolbar row; in the Detail pane's
   column layout flex would grow the strip vertically instead. */
.hakka-header .hakka-tabs {
  align-self: stretch;
  flex: 1;
}
.hakka-tabs::-webkit-scrollbar { display: none; }
.hakka-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: var(--hakka-space-sm);
  background: none;
  border: none;
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 0 var(--hakka-space-md);
  min-height: var(--hakka-ctl-h-xl);
  transition: color 0.12s, opacity 0.15s;
  white-space: nowrap;
}
/* Active indicator — a short centered pill under the label, not a
   full-tab-width bar, so it never reads as a sibling of the sheet grabber. */
.hakka-tab::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 55%;
  height: 2px; /* ui-token-check-ignore: active-tab indicator thickness */
  border-radius: var(--hakka-radius-pill);
  background: transparent;
  transition: background 0.12s;
}
.hakka-tab svg {
  flex-shrink: 0;
  opacity: 0.85;
}
.hakka-tab:hover {
  color: var(--hakka-text-secondary);
}
.hakka-tab.active {
  color: var(--hakka-accent);
}
.hakka-tab.active::before {
  background: var(--hakka-accent);
}
@keyframes hakka-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.hakka-tab-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--hakka-space-xl);
}

/* Lazy-load fallbacks — brief, shown while a panel / the JSON viewer chunk arrives. */
.hakka-panel-loading {
  padding: var(--hakka-space-xl);
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-xs);
}
.hakka-json-fallback {
  margin: 0;
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.hakka-kv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--hakka-font-sm);
}
.hakka-kv-table th {
  text-align: left;
  font-size: var(--hakka-font-xs);
  font-weight: 600;
  color: var(--hakka-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: var(--hakka-space-xs) var(--hakka-space-md);
  background: var(--hakka-surface);
  border-bottom: 1px solid var(--hakka-border);
}
.hakka-kv-table td {
  padding: var(--hakka-space-xs) var(--hakka-space-md);
  border-bottom: 1px solid var(--hakka-border);
  vertical-align: top;
}
/* The pane already insets the table — outer cell padding would double it, so
   the first/last columns sit flush and the values get the reclaimed width. */
.hakka-kv-table th:first-child,
.hakka-kv-table td:first-child {
  padding-left: 0;
}
.hakka-kv-table th:last-child,
.hakka-kv-table td:last-child {
  padding-right: 0;
}
.hakka-kv-key {
  color: var(--hakka-text-secondary);
  white-space: nowrap;
  /* Shrink-to-fit (nowrap makes 1% collapse to content) — keys take what they
     need, values get everything else on every screen width. */
  width: 1%;
  font-weight: 500;
}
.hakka-kv-value {
  color: var(--hakka-text);
  word-break: break-all;
}
/* Click-to-edit affordance on Storage panel value cells. */
.hakka-kv-value-editable {
  cursor: pointer;
  border-radius: var(--hakka-radius-sm);
  transition: background 0.1s;
}
.hakka-kv-value-editable:hover {
  background: var(--hakka-surface);
}
/* ── Panel section anatomy — the one header grammar every tab pane composes:
   a title, an optional one-line description, and (Network's list/group
   headers aside) counts via .hakka-count-badge, never a bespoke pill.
   .hakka-section-title is ALSO the in-card group-label style (Add Rule,
   Response headers, Overview, …) — one class, one size, everywhere a tab
   needs a heading. ── */
.hakka-section {
  margin-bottom: var(--hakka-space-xl);
}
.hakka-section:last-child {
  margin-bottom: 0;
}
.hakka-section-title {
  font-size: var(--hakka-font-sm);
  font-weight: 600;
  color: var(--hakka-text);
  margin: var(--hakka-space-xl) 0 var(--hakka-space-xs);
}
.hakka-section-title:first-child,
.hakka-section > .hakka-section-title:first-child {
  margin-top: 0;
}
/* .flush zeroes BOTH margins — for a title sitting in a flex row/column that
   already supplies its own rhythm via the flex gap property (a .hakka-card's
   Add-rule/Add-breakpoint header, or a title beside a count badge), where the
   default bottom margin would double up with that gap. The plain :first-child
   rule above only zeroes the top, which is right for a title that's simply
   first in normal document flow and still wants its own bottom margin. */
.hakka-section-title.flush {
  margin: 0;
}

.hakka-body-pre {
  background: var(--hakka-surface);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-md);
  line-height: 1.6;
  overflow-x: auto;
  padding: var(--hakka-space-lg);
  white-space: pre-wrap;
  word-break: break-all;
}
/* ── Body region — Loading's stale-content revalidation (Detail.tsx). Dims
   the PREVIOUS request's body slightly while a newer selection's body is
   still in flight, instead of a spinner/skeleton (repo rule). ── */
.hakka-body-region {
  transition: opacity 0.15s ease;
}
.hakka-body-pending {
  opacity: 0.6;
}
.hakka-img-preview {
  max-width: 100%;
  border-radius: var(--hakka-radius-md);
  border: 1px solid var(--hakka-border);
}

/* Minimal substring search above the tree — no query language, plain
   key/value text match. Neutral at rest; the border tints jade the moment
   there's a live match, turmeric on a live query with zero matches — the
   same status tokens the rest of the inspector already speaks, not new
   colors. The .hakka-input class supplies the shared control geometry. */
.hakka-json-search {
  width: 100%;
  margin-bottom: var(--hakka-space-sm);
}
input.hakka-json-search.match {
  border-color: var(--hakka-status-success);
}
input.hakka-json-search.no-match {
  border-color: var(--hakka-status-warning);
}
.hakka-json-mark {
  background: var(--hakka-code-highlight);
  color: inherit;
  border-radius: var(--hakka-radius-xs);
}
.hakka-json {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-md);
  line-height: 1.6;
  background: var(--hakka-surface);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  padding: var(--hakka-space-lg);
  overflow-x: auto;
}
.hakka-json-node {
  display: flex;
  flex-direction: column;
}
.hakka-json-row {
  display: flex;
  align-items: baseline;
  gap: var(--hakka-space-xs);
  cursor: default;
}
.hakka-json-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-xs);
  padding: 0 var(--hakka-space-xxs);
  line-height: 1;
  flex-shrink: 0;
}
.hakka-json-key {
  color: var(--hakka-text-secondary);
  font-weight: 500;
}
.hakka-json-colon {
  color: var(--hakka-text-tertiary);
}
.hakka-json-string { color: var(--hakka-code-string); }
.hakka-json-number { color: var(--hakka-code-number); }
.hakka-json-boolean { color: var(--hakka-code-boolean); }
.hakka-json-null { color: var(--hakka-code-null); }
.hakka-json-bracket { color: var(--hakka-text-secondary); }
.hakka-json-children {
  margin-left: var(--hakka-space-xxl);
  border-left: 1px solid var(--hakka-border);
  padding-left: var(--hakka-space-md);
}
.hakka-json-ellipsis {
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-size: var(--hakka-font-xs);
}

.hakka-timing {
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-lg);
}
/* Why the connection phases are blank — shown when TTFB exists but
   DNS/TCP/TLS are all unmeasured (reused socket / layer can't split them). */
.hakka-timing-note {
  margin: 0;
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
}
.hakka-timing-row {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-md);
}
.hakka-timing-label {
  width: 80px;
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-secondary);
  text-align: right;
  flex-shrink: 0;
}
.hakka-timing-track {
  flex: 1;
  height: 16px; /* ui-token-check-ignore: inline glyph box */
  background: var(--hakka-surface);
  border-radius: var(--hakka-radius-sm);
  overflow: hidden;
  position: relative;
}
.hakka-timing-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: var(--hakka-radius-sm);
  transition: width 0.4s ease;
}
.hakka-timing-value {
  width: 60px;
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  flex-shrink: 0;
}
.hakka-timing-note {
  font-size: var(--hakka-font-sm);
  color: var(--hakka-text-tertiary);
  font-style: italic;
}

.hakka-row-checkbox {
  width: 20px;
  height: var(--hakka-ctl-h-sm);
  min-width: 20px;
  border: 2px solid var(--hakka-border);
  border-radius: var(--hakka-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--hakka-status-on);
  font-size: var(--hakka-font-sm);
  font-weight: 700;
  transition: background 0.1s, border-color 0.1s;
  cursor: pointer;
}
.hakka-row-checkbox.checked {
  background: var(--hakka-accent);
  border-color: var(--hakka-accent);
}
.hakka-row.multi-select-mode:hover .hakka-row-checkbox,
.hakka-row.multi-select-mode:focus .hakka-row-checkbox {
  border-color: var(--hakka-accent);
}
.hakka-row.row-selected {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-hover), transparent);
}

.hakka-action-bar {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  padding: var(--hakka-space-sm) var(--hakka-space-xl);
  background: var(--hakka-surface);
  border-top: 1px solid var(--hakka-border);
  flex-shrink: 0;
  animation: hakka-slide-up 180ms cubic-bezier(0.22,1,0.36,1) both;
  min-height: var(--hakka-ctl-h-tap);
}
@keyframes hakka-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hakka-action-bar { animation: none; }
}
.hakka-action-bar-count {
  font-size: var(--hakka-font-sm);
  font-weight: 600;
  color: var(--hakka-text-secondary);
  margin-right: var(--hakka-space-sm);
  white-space: nowrap;
}
.hakka-action-btn {
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-secondary);
  cursor: pointer;
  font-size: var(--hakka-font-xs);
  padding: var(--hakka-space-xs) var(--hakka-space-ml);
  white-space: nowrap;
  min-height: var(--hakka-ctl-h-lg);
  transition: background 0.1s, color 0.1s;
}
.hakka-action-btn:hover {
  background: var(--hakka-border);
  color: var(--hakka-text);
}
.hakka-action-btn-danger {
  color: var(--hakka-status-error);
  border-color: var(--hakka-status-error);
}
.hakka-action-btn-danger:hover {
  background: color-mix(in srgb, var(--hakka-status-error) var(--hakka-tint-active), transparent);
}
.hakka-action-spacer { flex: 1; }
.hakka-action-cancel {
  background: none;
  border: none;
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-size: var(--hakka-font-sm);
  padding: var(--hakka-space-xs) var(--hakka-space-sm);
  min-height: var(--hakka-ctl-h-lg);
}
.hakka-action-cancel:hover { color: var(--hakka-text); }

.hakka-density-btn {
  background: none;
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-size: var(--hakka-font-xs);
  padding: var(--hakka-space-xxs) var(--hakka-space-sm);
  white-space: nowrap;
  transition: color 0.1s, background 0.1s;
}
.hakka-density-btn.active {
  color: var(--hakka-text);
  background: var(--hakka-surface-raised);
  border-color: var(--hakka-text-tertiary);
}
.hakka-density-btn:hover { color: var(--hakka-text); }

.hakka-list.compact .hakka-row {
  padding-top: var(--hakka-space-xs);
  padding-bottom: var(--hakka-space-xs);
  min-height: var(--hakka-ctl-h-lg);
}
.hakka-list.compact .hakka-row-host {
  display: none;
}

.hakka-save-filter-btn {
  background: none;
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-size: var(--hakka-font-xs);
  padding: var(--hakka-space-xxs) var(--hakka-space-md);
  white-space: nowrap;
  min-height: var(--hakka-ctl-h);
  transition: color 0.1s, background 0.1s;
}
.hakka-save-filter-btn:hover {
  background: var(--hakka-surface-raised);
  color: var(--hakka-text);
}

.hakka-saved-filters-row {
  overflow-x: auto;
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.hakka-saved-filters-row::-webkit-scrollbar { display: none; }

.hakka-saved-filter-entry {
  display: inline-flex;
  align-items: center;
  gap: 0;
}
.hakka-saved-chip {
  border-radius: var(--hakka-radius-md) 0 0 var(--hakka-radius-md);
  padding-right: var(--hakka-space-xs);
}
.hakka-recent-chip {
  border-radius: var(--hakka-radius-md);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hakka-saved-filter-remove {
  background: none;
  border: 1px solid var(--hakka-border);
  border-left: none;
  border-radius: 0 var(--hakka-radius-md) var(--hakka-radius-md) 0;
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-size: var(--hakka-font-sm);
  padding: var(--hakka-space-xxs) var(--hakka-space-sm);
  line-height: 1;
  transition: color 0.1s, background 0.1s;
  min-height: var(--hakka-ctl-h);
}
.hakka-saved-filter-remove:hover {
  background: color-mix(in srgb, var(--hakka-status-error) var(--hakka-tint-active), transparent);
  color: var(--hakka-status-error);
}

/* ── Shared form/layout primitives (Mock, Breakpoints, Settings, Stats, …) ──
   Tabs must compose these instead of hand-rolling inline styles, so every
   panel shares one card/input/label/hint vocabulary. */
.hakka-pane {
  padding: var(--hakka-space-xl);
  overflow-y: auto;
  height: 100%;
}
.hakka-card {
  background: var(--hakka-surface);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  padding: var(--hakka-space-lg);
}
.hakka-card + .hakka-card {
  margin-top: var(--hakka-space-md);
}
.hakka-input {
  background: var(--hakka-surface-raised);
  color: var(--hakka-text);
  border: 1px solid var(--hakka-border);
  outline: none;
  min-width: 0;
}
.hakka-input:focus {
  border-color: var(--hakka-accent);
}
.hakka-input::placeholder {
  color: var(--hakka-text-tertiary);
}
/* A value field (mock/breakpoint body, headers) is DATA, not UI chrome — mono
   at the data size, one step up from the xs chip/label size so digits and
   JSON punctuation don't read as fine print. */
.hakka-input-mono {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-data);
}
/* Multi-line value fields (Mock/Breakpoints body + headers editors) — the
   single-line ctl-h-md is a floor, not the shape; an auto height lets the
   rows attribute plus this min-height (2x the control height) decide the
   box, and the base's horizontal-only padding gets a vertical partner. */
textarea.hakka-input {
  height: auto;
  min-height: calc(var(--hakka-ctl-h-md) * 2);
  padding-top: var(--hakka-space-xs);
  padding-bottom: var(--hakka-space-xs);
}

/* ── Range slider (Settings > Panel opacity) — themed track + thumb, one
   implementation shared by any future range control. ── */
.hakka-range {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: var(--hakka-ctl-h);
  background: transparent;
  cursor: pointer;
}
.hakka-range::-webkit-slider-runnable-track {
  height: 4px; /* ui-token-check-ignore: grabber bar / range track */
  border-radius: var(--hakka-radius-pill);
  background: var(--hakka-border);
}
.hakka-range::-moz-range-track {
  height: 4px; /* ui-token-check-ignore: grabber bar / range track */
  border-radius: var(--hakka-radius-pill);
  background: var(--hakka-border);
}
.hakka-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px; /* ui-token-check-ignore: range thumb */
  margin-top: -5px; /* ui-token-check-ignore: centres the range thumb on its track */
  border-radius: 50%;
  background: var(--hakka-accent);
  border: none;
  cursor: pointer;
}
.hakka-range::-moz-range-thumb {
  width: 14px;
  height: 14px; /* ui-token-check-ignore: range thumb */
  border-radius: 50%;
  background: var(--hakka-accent);
  border: none;
  cursor: pointer;
}
.hakka-range:focus-visible {
  outline: 2px solid var(--hakka-accent);
  outline-offset: 2px;
}
/* .hakka-tour-next joins this fill — the Tour CTA is a filled primary
   button, not a separate color definition (geometry comes from the shared
   .hakka-ctl base above). */
.hakka-btn-primary,
.hakka-tour-next {
  background: var(--hakka-accent);
  color: var(--hakka-status-on-warm);
  border: none;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.1s;
}
.hakka-btn-primary:hover,
.hakka-tour-next:hover {
  opacity: 0.85;
}
.hakka-btn-primary:disabled {
  opacity: 0.45;
  cursor: default;
}
.hakka-form-row {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  flex-wrap: wrap;
}
.hakka-hint {
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
}
.hakka-hint-em {
  font-style: italic;
}

/* ── Keyboard shortcut hints (command palette footer, etc.) ── */
.hakka-kbd {
  display: inline-block;
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-secondary);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-bottom-width: 2px;
  border-radius: var(--hakka-radius-sm);
  padding: 1px var(--hakka-space-sm);
  margin-right: var(--hakka-space-xxs);
}

/* ── Command palette (Cmd/Ctrl-K) ── */
.hakka-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  animation: hakka-fade-in 120ms ease both;
}
@media (prefers-reduced-motion: reduce) {
  .hakka-palette-overlay { animation: none; }
}
.hakka-palette {
  width: min(560px, 92vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--hakka-surface);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-lg);
  box-shadow: 0 16px 48px rgba(0,0,0,0.45);
  overflow: hidden;
  font-family: var(--hakka-font-sans);
  color: var(--hakka-text);
}
.hakka-palette-input {
  border: none;
  border-bottom: 1px solid var(--hakka-border);
  background: var(--hakka-surface-raised);
  color: var(--hakka-text);
  font-size: var(--hakka-font-md);
  padding: var(--hakka-space-lg);
  outline: none;
  flex-shrink: 0;
}
.hakka-palette-input::placeholder {
  color: var(--hakka-text-tertiary);
}
.hakka-palette-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--hakka-space-sm);
}
.hakka-palette-empty {
  padding: var(--hakka-space-lg);
  text-align: center;
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-sm);
}
.hakka-palette-item {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-sm);
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-secondary);
  cursor: pointer;
  font-size: var(--hakka-font-sm);
  padding: var(--hakka-space-sm) var(--hakka-space-md);
}
.hakka-palette-item.active {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-active), transparent);
  color: var(--hakka-text);
}
.hakka-palette-group {
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--hakka-text-tertiary);
  flex-shrink: 0;
}
.hakka-palette-label {
  flex: 1;
  color: var(--hakka-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hakka-palette-hint {
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  flex-shrink: 0;
}
.hakka-palette-footer {
  display: flex;
  gap: var(--hakka-space-lg);
  padding: var(--hakka-space-sm) var(--hakka-space-lg);
  border-top: 1px solid var(--hakka-border);
  background: var(--hakka-surface-raised);
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  flex-shrink: 0;
}

.hakka-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.hakka-diff-header {
  display: flex;
  align-items: center;
  gap: var(--hakka-space-lg);
  padding: var(--hakka-space-md) var(--hakka-space-xl);
  border-bottom: 1px solid var(--hakka-border);
  background: var(--hakka-surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.hakka-diff-summary {
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-xxs);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  min-width: 0;
}
.hakka-diff-side {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--hakka-text-secondary);
}
.hakka-diff-side-label {
  display: inline-block;
  width: 16px;
  height: 16px; /* ui-token-check-ignore: inline glyph box */
  line-height: 16px; /* ui-token-check-ignore: inline glyph box */
  text-align: center;
  border-radius: var(--hakka-radius-sm);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  color: var(--hakka-text);
  font-weight: 700;
  margin-right: var(--hakka-space-xs);
}
.hakka-diff-side-host {
  color: var(--hakka-text-tertiary);
}
.hakka-diff-block {
  margin: 0 0 var(--hakka-space-lg);
  font-family: var(--hakka-font-mono);
  font-size: var(--hakka-font-xs);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  overflow: hidden;
  background: var(--hakka-surface-raised);
}
.hakka-diff-line {
  display: flex;
  gap: var(--hakka-space-sm);
  padding: 1px var(--hakka-space-sm);
  white-space: pre-wrap;
  word-break: break-word;
}
.hakka-diff-marker {
  flex-shrink: 0;
  width: 1ch;
  color: var(--hakka-text-tertiary);
}
.hakka-diff-add {
  background: color-mix(in srgb, var(--hakka-status-success) var(--hakka-tint-active), transparent);
  color: var(--hakka-text);
}
.hakka-diff-add .hakka-diff-marker {
  color: var(--hakka-status-success);
}
.hakka-diff-remove {
  background: color-mix(in srgb, var(--hakka-status-error) var(--hakka-tint-active), transparent);
  color: var(--hakka-text);
}
.hakka-diff-remove .hakka-diff-marker {
  color: var(--hakka-status-error);
}
.hakka-diff-same {
  color: var(--hakka-text-secondary);
}

.hakka-select-mode-btn {
  background: none;
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-md);
  color: var(--hakka-text-tertiary);
  cursor: pointer;
  font-size: var(--hakka-font-xs);
  padding: var(--hakka-space-xxs) var(--hakka-space-md);
  white-space: nowrap;
  min-height: var(--hakka-ctl-h);
  transition: color 0.1s, background 0.1s;
}
.hakka-select-mode-btn.active {
  background: color-mix(in srgb, var(--hakka-accent) var(--hakka-tint-active), transparent);
  border-color: var(--hakka-accent);
  color: var(--hakka-accent);
}
.hakka-select-mode-btn:hover:not(.active) {
  background: var(--hakka-surface-raised);
  color: var(--hakka-text);
}

/* ── Mobile (< 680px) — full-screen inspector ergonomics. Kept last so these
   win the cascade over the component rules above at equal specificity. ── */
@media (max-width: 679px) {
  /* The filter zone keeps the base --hakka-ctl-h (26px) on phones too —
     every chip/select/button rides the one token, so the panel reads as one
     compact geometry; the section gaps provide the tap slack. */
  .hakka-search {
    /* 16px is the iOS Safari threshold below which focusing an input zooms the
       page — a full-screen inspector must never trigger that. The TYPED text
       must stay 16px for that guard; the placeholder is exempt from the zoom
       heuristic, so it drops back to the UI size instead of shouting. */
    font-size: var(--hakka-font-lg);
    /* Full-bleed row grows to the finger-sized constant on a phone. */
    height: var(--hakka-ctl-h-tap);
  }
  .hakka-search::placeholder {
    font-size: var(--hakka-font-md);
  }
  /* Finger-sized interactive controls OUTSIDE the filter zone — everything
     inside .hakka-filter-bar / .hakka-filter-adv already rides the escalated
     --hakka-ctl-h token above, so no per-control bump is needed there. */
  .hakka-seg-btn,
  .hakka-btn,
  .hakka-select,
  .hakka-density-btn,
  .hakka-select-mode-btn,
  .hakka-save-filter-btn {
    min-height: var(--hakka-ctl-h-lg);
  }
  /* Tabs stay visually ctl-h-xl on touch too — the tap-height guarantee is
     met by an invisible hit-area extension, not a taller bar. */
  .hakka-tab {
    position: relative;
  }
  .hakka-tab::after {
    content: '';
    position: absolute;
    top: calc(-1 * var(--hakka-space-xs));
    bottom: calc(-1 * var(--hakka-space-xs));
    left: 0;
    right: 0;
  }
  /* Narrower label column on a phone — the axis needs the room more than the
     name does here; the alignment guarantee (fixed width -> shared track
     origin) holds at any width, only the number changes. */
  .hakka-wf-label {
    width: min(38%, 120px);
  }
  /* Labels STAY on a phone — the panel lives behind a disclosure now, so
     vertical space is cheap and the uppercase labels are what make a stack
     of chips/segs/selects scannable. */
  .hakka-filter-adv {
    padding: var(--hakka-space-sm) var(--hakka-space-lg) var(--hakka-space-md);
  }
  /* Content panes trade chrome for width — a phone needs the pixels for
     values, URLs, and JSON, not for side margins. */
  .hakka-tab-content,
  .hakka-pane {
    padding: var(--hakka-space-md) var(--hakka-space-lg);
  }
}

/* ── Touch: expand the tap target without inflating the visual control — a
   ::before hit-area extender instead of literal padding, so the control
   still reads devtools-tight (28px) next to its label. Gated on
   (pointer: coarse) — an actual touch surface, not merely a narrow viewport
   — so on a real phone/tablet this wins the cascade over the width-based
   min-height bump above (kept last), and the box stays visually 28/32px
   while its tappable area reaches the 44px constant. Chips and seg-buttons
   are exempt: they sit in tightly-gapped rows (2-6px) where an 8px extension
   per side would make neighbours' hit zones overlap. ── */
@media (pointer: coarse) {
  .hakka-btn,
  .hakka-btn-primary,
  .hakka-curl-btn,
  .hakka-tour-next,
  .hakka-select {
    position: relative;
    height: var(--hakka-ctl-h-md);
    min-height: 0;
  }
  .hakka-btn::before,
  .hakka-btn-primary::before,
  .hakka-curl-btn::before,
  .hakka-tour-next::before,
  .hakka-select::before {
    content: '';
    position: absolute;
    inset: calc((var(--hakka-ctl-h-md) - var(--hakka-ctl-h-tap)) / 2);
  }
  .hakka-btn-close {
    position: relative;
    height: var(--hakka-ctl-h-lg);
    min-height: 0;
  }
  .hakka-btn-close::before {
    content: '';
    position: absolute;
    inset: calc((var(--hakka-ctl-h-lg) - var(--hakka-ctl-h-tap)) / 2);
  }
}

/* ── Empty state — "Load sample traffic" ── */
.hakka-empty-actions {
  display: flex;
  gap: var(--hakka-space-md);
  margin-top: var(--hakka-space-sm);
}
.hakka-empty-sample-btn {
  background: var(--hakka-accent);
  color: var(--hakka-status-on);
  border: none;
  border-radius: var(--hakka-radius-md);
  padding: var(--hakka-space-sm) var(--hakka-space-lg);
  font-size: var(--hakka-font-sm);
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.1s ease;
}
.hakka-empty-sample-btn:hover {
  opacity: 0.88;
}
.hakka-empty-sample-hint {
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-xs);
  max-width: 32ch;
  line-height: 1.5;
}

.hakka-tour-overlay {
  z-index: 2147483647;
  animation: hakka-fade-in 0.18s ease;
}
@media (prefers-reduced-motion: reduce) {
  .hakka-tour-overlay {
    animation: none;
  }
}
.hakka-tour-card {
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-border);
  border-radius: var(--hakka-radius-lg);
  box-shadow: 0 8px 28px rgba(0,0,0,0.28);
  padding: var(--hakka-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--hakka-space-sm);
}
.hakka-tour-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hakka-tour-step-count {
  font-size: var(--hakka-font-xs);
  color: var(--hakka-text-tertiary);
  font-weight: 600;
  letter-spacing: 0.3px;
}
.hakka-tour-skip {
  background: none;
  border: none;
  color: var(--hakka-text-tertiary);
  font-size: var(--hakka-font-xs);
  cursor: pointer;
  padding: var(--hakka-space-xxs) var(--hakka-space-xs);
}
.hakka-tour-skip:hover {
  color: var(--hakka-text-secondary);
}
.hakka-tour-title {
  font-size: var(--hakka-font-md);
  font-weight: 600;
  color: var(--hakka-text);
}
.hakka-tour-body {
  font-size: var(--hakka-font-sm);
  color: var(--hakka-text-secondary);
  line-height: 1.5;
}
.hakka-tour-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--hakka-space-xxs);
}

/* ── Root crash boundary (CrashBoundary.tsx) — the fallback shown when
   something inside the inspector throws during render or update. Always on
   top (same max z-index as the tour overlay); floating mode pins it near
   the bottom like the panel/toggle it replaces, embedded mode pins it as a
   top banner inside the host's container instead of a fixed viewport
   position (there is no viewport to pin to — the embed fills whatever the
   host page gave it). ── */
.hakka-crash-bar {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hakka-space-lg);
  background: var(--hakka-surface-raised);
  border: 1px solid var(--hakka-status-error);
  border-radius: var(--hakka-radius-md);
  padding: var(--hakka-space-md) var(--hakka-space-lg);
  font-family: var(--hakka-font-sans);
  font-size: var(--hakka-font-sm);
  color: var(--hakka-text);
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
}
.hakka-crash-bar-floating {
  position: fixed;
  left: var(--hakka-gutter);
  right: var(--hakka-gutter);
  bottom: var(--hakka-space-xxl);
  z-index: 2147483647;
}
.hakka-crash-bar-embedded {
  position: absolute;
  top: var(--hakka-space-lg);
  left: var(--hakka-space-lg);
  right: var(--hakka-space-lg);
  z-index: 2147483647;
}
.hakka-crash-bar-text {
  color: var(--hakka-status-error);
  font-weight: 600;
}
.hakka-crash-bar-btn {
  flex-shrink: 0;
  height: var(--hakka-ctl-h-lg);
  padding: 0 var(--hakka-space-lg);
  background: var(--hakka-status-error);
  color: var(--hakka-status-on);
  border: none;
  border-radius: var(--hakka-radius-md);
  font-size: var(--hakka-font-sm);
  font-weight: 600;
  cursor: pointer;
}
.hakka-crash-bar-btn:hover {
  opacity: 0.88;
}
`
