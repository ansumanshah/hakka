import { svg, type IconProps } from './svg'

// "Copy as agent context" — the de-facto AI-agent glyph (Notion/OpenAI's
// sparkle silhouette: a bezier kite), with two small companion sparkles so
// it doesn't read as a plain diamond. Stroke-only like the rest of the set —
// DESIGN.md bans emoji/pictographic glyphs, this is the icon-set alternative.
export const IconSparkle = (p: IconProps) =>
  svg(
    p,
    <>
      <path d="M12 3c.6 4 1 5.4 5 6-4 .6-4.4 2-5 6-.6-4-1-5.4-5-6 4-.6 4.4-2 5-6Z" />
      <path d="M19 3v3M17.5 4.5h3" />
      <path d="M5 16v3M3.5 17.5h3" />
    </>,
  )
