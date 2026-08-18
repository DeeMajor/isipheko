import Script from 'next/script'
import type { ReactNode } from 'react'

/**
 * The organiser side's layout, and the only thing it does is load one 700-byte
 * enhancement.
 *
 * **It is here rather than on the share step, and it is `next/script`.** A bare
 * `<script src>` rendered by the client-side transition that publishing
 * performs did not run at all; found by a test that passed only when it
 * reloaded first. From the layout it loads once for this whole section, and
 * `share.js` delegates its listener to the document, so it survives every
 * navigation after that and does not care which button node React has hydrated.
 *
 * It arrives **after** the page is interactive, which is the point: the share
 * step is complete without it, and the copy button it powers is hidden by a
 * `<noscript>` rule wherever it cannot work.
 *
 * Nothing on the contributor path is affected: this layout does not wrap it,
 * and the 150KB budget (rule 9) is measured on `/e/[slug]`, which ships this
 * and nothing else from React at all.
 */
export default function OrganiserLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Script src="/share.js" strategy="afterInteractive" />
    </>
  )
}
