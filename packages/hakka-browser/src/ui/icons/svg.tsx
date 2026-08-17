/**
 * Shared SVG shell for the inspector's icon set — 24px grid, 2px stroke,
 * currentColor; sized via the `size` prop (default 14). Keep icons stroke-only,
 * round caps, no fills.
 */
import type { JSX } from '@solidjs/web'

export interface IconProps {
  size?: number
  class?: string
}

export const svg = (props: IconProps, children: JSX.Element): JSX.Element => (
  <svg
    width={props.size ?? 14}
    height={props.size ?? 14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
    aria-hidden="true"
  >
    {children}
  </svg>
)
