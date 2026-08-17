import { svg, type IconProps } from './svg'

export const IconPause = (p: IconProps) =>
  svg(
    p,
    <>
      <path d="M10 4H7v16h3z" />
      <path d="M17 4h-3v16h3z" />
    </>,
  )
