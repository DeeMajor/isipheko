import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Isipheko',
  description: 'An honest record of who stood with the family.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // lang is en-ZA, not en. Screen readers and translation tooling both read it,
  // and the copy layer (M1-05+) is keyed by locale from here.
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  )
}
