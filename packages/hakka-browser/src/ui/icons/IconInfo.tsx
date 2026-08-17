import { svg, type IconProps } from './svg'

export const IconInfo = (p: IconProps) =>
  svg(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>,
  )
