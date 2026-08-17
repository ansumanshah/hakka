/**
 * HakkaMark — the bowl-and-signal brand mark as a compact inline SVG.
 * Derived from the NoodleApps canvas icon (bowl + chopsticks + broadcast fan),
 * recolored to the Wok Hei tokens. The three signal arcs double as the live
 * "capturing" indicator: they pulse while the inspector records (CSS class
 * `hakka-mark-live`, disabled under prefers-reduced-motion).
 * No canvas, no assets — a few paths, so the SDK bundle stays lean.
 */
interface MarkProps {
  size?: number
  /** Pulse the signal arcs (capturing). */
  live?: boolean
  class?: string
}

export const HakkaMark = (props: MarkProps) => (
  <svg
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    class={`hakka-mark${props.live ? ' hakka-mark-live' : ''}${props.class ? ` ${props.class}` : ''}`}
    aria-hidden="true"
  >
    {/* bowl — a whisper of flame in the fill keeps the mark warm at any size */}
    <path
      d="M3.5 12.5h17a8.5 8.5 0 0 1-6 7.3v0.7h-5v-0.7a8.5 8.5 0 0 1-6-7.3z"
      fill="color-mix(in srgb, var(--hakka-accent) 14%, transparent)"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
    {/* broadcast fan — the network signal rising from the bowl */}
    <g stroke="var(--hakka-status-success)" stroke-width="1.6" stroke-linecap="round" fill="none">
      <path class="hakka-mark-arc a1" d="M9.9 7.4a3 3 0 0 1 4.2 0" />
      <path class="hakka-mark-arc a2" d="M8.2 5a5.4 5.4 0 0 1 7.6 0" />
      <path class="hakka-mark-arc a3" d="M6.4 2.7a7.9 7.9 0 0 1 11.2 0" />
    </g>
  </svg>
)
