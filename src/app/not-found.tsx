import type { Metadata } from 'next'
import Link from 'next/link'

import { homeCopy } from '@/copy/home'

/**
 * The global 404 (M1-09).
 *
 * There was none. An address nobody issued produced the framework's default
 * page, which explains nothing and offers nowhere to go — and **a link that
 * resolves to nothing is the scam case**, the exact thing somebody holding a
 * forged link finds. M3-06 built `/report` for that moment and M3-05 built
 * `/check`; this is the screen that connects them.
 *
 * **This one is a page rather than a route handler**, and it is the only public
 * screen in the product that is. Next renders `not-found.tsx` for an unmatched
 * address and there is no route-handler equivalent, so it inherits the root
 * layout and the App Router runtime with it. Measured by `pnpm gate:size` like
 * everything else on the public path, and recorded rather than hidden — see
 * docs/decisions.md M1-09 §4.
 *
 * The markup is `AddressNotFoundPage`'s content without its `<html>`, because
 * the root layout supplies one.
 */

export const metadata: Metadata = {
  title: `${homeCopy.notFound.title} · Isipheko`,
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <main>
      <h1>{homeCopy.notFound.title}</h1>
      <p>{homeCopy.notFound.body}</p>

      <p>{homeCopy.notFound.checkLead}</p>
      <a href="/check" rel="noreferrer">
        {homeCopy.check.action}
      </a>

      <p>{homeCopy.check.reportLead}</p>
      <a href="/report" rel="noreferrer">
        {homeCopy.check.reportAction}
      </a>
      <p>{homeCopy.check.reportNote}</p>

      <p>
        <Link href="/">{homeCopy.notFound.homeAction}</Link>
      </p>
    </main>
  )
}
