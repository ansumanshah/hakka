import { svg, type IconProps } from './svg'

export const IconExport = (p: IconProps) =>
  svg(
    p,
    <>
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>,
  )
