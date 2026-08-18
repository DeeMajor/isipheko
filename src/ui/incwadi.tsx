/* eslint-disable @next/next/no-head-element -- see collection-page.tsx */

import { collectionCopy } from '@/copy/collection'
import type { CollectionPage } from '@/db/repositories/collection'
import type { ArchetypeConfig } from '@/domain/archetype'
import { formatMoneyWhole, fromCents } from '@/domain/money'

import { INCWADI_CSS } from './incwadi-css'
import { TOKENS_CSS } from './tokens'
import { accentStyle } from './theme'

/**
 * The incwadi — the one page the group hands over with the money.
 *
 * *"Print this and hand it over with the money. The family keeps it. Years
 * later this page may be gone and the paper will not be."*
 *
 * That sentence is the whole specification. It is a **printable record**, not a
 * screen: every name, every amount, the total, who collected it, and **how the
 * handover was confirmed** — a witness who was there, or the organiser on her
 * own word. The difference between those two stays on the paper, because
 * anybody reading it in five years should be able to see it.
 *
 * **This is not M4-02's album.** That is messages and photos across an event
 * with the strand as its cover, and M4-03 turns it into a PDF with real bleed.
 * This is the sheet that goes into a family's hands on the day, rendered as
 * HTML with print styles and nothing else — no photos (M4-01 owns uploads), no
 * PDF pipeline, no dependency.
 */

export interface IncwadiProps {
  readonly collection: CollectionPage
  readonly archetype: ArchetypeConfig
  /** Rendered rather than read from a clock, so the page is reproducible. */
  readonly printedAt?: Date
}

function formatDate(date: Date | null): string | null {
  if (date === null) return null

  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

const money = (cents: bigint | null) =>
  cents === null ? null : formatMoneyWhole(fromCents(cents))

/**
 * What the record says about how it was closed.
 *
 * A witness's tap and the organiser's own word are not the same thing, and the
 * paper says which. `handoverConfirmedMemberId` being null **is** the
 * organiser-marked case (M2-11).
 */
function confirmationLine(collection: CollectionPage, organiser: string): string {
  const copy = collectionCopy.incwadi

  if (collection.handoverStatus === 'not_started') return copy.notYet
  if (collection.witnessName !== null)
    return copy.confirmedByWitness(collection.witnessName)

  return copy.confirmedByOrganiser(organiser)
}

export function Incwadi({ collection, archetype, printedAt }: IncwadiProps) {
  const copy = collectionCopy.incwadi
  const organiser = collection.organiserName ?? ''
  const forWhom = collection.purpose ?? collection.event?.title ?? collection.title
  const verifiedOn = formatDate(collection.organiserVerifiedAt)
  const handedOver = formatDate(collection.handoverAt)

  // Only members whose money actually reached her: the paper the family keeps
  // must not list somebody who said they would and did not.
  const listed = collection.roster.filter((member) => member.status === 'confirmed')

  return (
    <html lang="en-ZA">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <title>{`${collection.title} · incwadi`}</title>
        <style dangerouslySetInnerHTML={{ __html: `${TOKENS_CSS}${INCWADI_CSS}` }} />
      </head>

      <body>
        {/* A landmark, so a screen reader can jump to the record itself rather
            than walking the page. axe fails a document without one. */}
        <main
          className="sheet"
          data-archetype={collection.archetype}
          {...accentStyle(archetype)}
        >
          <p className="wordmark">{copy.wordmark}</p>

          <h1 className="recordTitle">{collection.title}</h1>
          <p className="recordSub">{copy.forLine(forWhom)}</p>

          <ul className="rows">
            {listed.map((member) => (
              <li key={member.id} className="row">
                <span className="rowName">{member.name ?? copy.quiet}</span>
                <span className="rowAmount" data-numeric="">
                  {money(member.amountCents) ?? ''}
                </span>
              </li>
            ))}
          </ul>

          <div className="together">
            <span className="togetherLabel">{copy.together}</span>
            <span className="togetherAmount" data-numeric="">
              {money(collection.confirmedCents) ?? formatMoneyWhole(fromCents(0n))}
            </span>
          </div>

          <div className="foot">
            <p className="footLine" data-numeric="">
              {copy.collectedBy(organiser)}
              {verifiedOn === null ? '' : ` ${copy.verifiedOn(verifiedOn)}`}
            </p>

            {collection.needItem === null ? null : (
              <p className="footLine">{copy.claimedItem(collection.needItem.label)}</p>
            )}

            <p className="footLine" data-numeric="">
              {confirmationLine(collection, organiser)}
              {handedOver === null ? '' : ` ${handedOver}.`}
            </p>

            {collection.hostAcknowledgedAt === null ? null : (
              <p className="footLine">{copy.acknowledged}</p>
            )}
          </div>

          {/* Printing is the browser's. No PDF pipeline here — that is M4-03,
              and a print stylesheet is what a family actually needs on the day. */}
          <p className="printNote screenOnly">{copy.printNote}</p>
          {printedAt === undefined ? null : (
            <p className="printNote screenOnly" data-numeric="">
              {formatDate(printedAt)}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
