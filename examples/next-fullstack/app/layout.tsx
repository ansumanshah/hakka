import type { ReactNode } from 'react'

import './globals.css'
import { HakkaOverlay } from './hakka-overlay'

export const metadata = {
  title: 'Hakka — Next.js full-stack inspector example',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HakkaOverlay />
      </body>
    </html>
  )
}
