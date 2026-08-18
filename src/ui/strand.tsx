import type { CSSProperties, ReactNode } from 'react'

import { eventCopy } from '@/copy/event'
import type { ArchetypeConfig } from '@/domain/archetype'
import { isAnimated } from '@/domain/archetype'
import {
  CORD_PITCH,
  bandFor,
  beadDiameter,
  daysBetween,
  densityFor,
  positionFor,
  strandHeight,
  type DensityBand,
} from '@/domain/strand'
import type { StrandBead } from '@/db/repositories/strand'

/**
 * The Ledger Strand — implementation plan Part C.4, and the signature element
 * of the product.
 *
 * It is the incwadi: the book kept at the door of a ceremony, where somebody
 * writes down who came and what they brought. **It is not a chart.** There is
 * no total, no count, no target and no amount anywhere in this file, and there
 * must never be one — a strand that could be added up would turn a family's
 * record into a scoreboard, and the beads into a ranking of what people could
 * afford.
 *
 * Three things about the markup are deliberate:
 *
 * **The beads are declared, not generated.** They are CSS-drawn elements the
 * server writes out; the page ships no JavaScript (M1-08) and this does not
 * change that. Geometry travels as two custom properties per bead, which
 * compresses to almost nothing at two hundred of them.
 *
 * **Each bead is a real `<button>`** inside one `<form method="get">`, so
 * opening a bead is a server round-trip that works with no script at all —
 * the same posture as the needs board. `public/needs-board.js` may intercept it
 * later without the markup changing.
 *
 * **Screen readers get a list.** `<ul>` and `<li>` at every density, including
 * the braided ones where the beads are absolutely positioned. The strand as an
 * image with a label would have to say how many people are in it, and that is
 * a count.
 */

export interface StrandProps {
  readonly slug: string
  readonly archetype: ArchetypeConfig
  readonly beads: readonly StrandBead[]
  /** The bead whose panel is open, from `?bead=`. */
  readonly openId?: string | undefined
  /** Injected so "3 days ago" is testable and the render stays pure. */
  readonly now?: Date | undefined
}

/**
 * How many people are inside a group bead.
 *
 * `memberCount` rather than `members.length`: somebody who gave quietly is in
 * the group and not in the list of names (M2-09), and a bead that said "5
 * together" while naming six would be wrong in the direction that matters.
 */
function groupSize(bead: StrandBead): number {
  return bead.memberCount ?? bead.members?.length ?? 0
}

/** What this bead is, in words: the label a screen reader hears. */
function whatOf(bead: StrandBead): string {
  if (bead.form === 'group') return eventCopy.strand.together(groupSize(bead))
  if (bead.form === 'in_kind') {
    return eventCopy.strand.bringing(bead.description ?? '')
  }

  return eventCopy.strand.money
}

function nameOf(bead: StrandBead): string {
  return bead.name ?? eventCopy.strand.quietly
}

const FORM_CLASS: Record<StrandBead['form'], string> = {
  cash: 'beadCash',
  in_kind: 'beadKind',
  group: 'beadGroup',
}

export function LedgerStrand({ slug, archetype, beads, openId, now }: StrandProps) {
  if (beads.length === 0) {
    return <p className="intro">{eventCopy.strand.empty}</p>
  }

  const density = densityFor(beads.length)
  const braided = density.cords > 1

  return (
    <>
      <p className="intro">{eventCopy.strand.intro}</p>

      {/* One form, every bead a submit button in it. The fragment on the
          action returns the reader to the strand rather than to the top of a
          page they have already read. */}
      <form method="get" action={`/e/${slug}#strand`} className="strandForm">
        {braided ? (
          <BraidedStrand
            beads={beads}
            density={density}
            archetype={archetype}
            openId={openId}
          />
        ) : (
          <SingleCord
            beads={beads}
            density={density}
            archetype={archetype}
            openId={openId}
            now={now}
          />
        )}

        {braided ? <OpenPanel beads={beads} openId={openId} now={now} /> : null}
      </form>
    </>
  )
}

/**
 * Up to thirty. One cord down the left, one bead per row, the name beside it —
 * the shape `design/event.html` draws, and the one that reads as a book.
 */
function SingleCord({
  beads,
  density,
  archetype,
  openId,
  now,
}: {
  beads: readonly StrandBead[]
  density: DensityBand
  archetype: ArchetypeConfig
  openId: string | undefined
  now: Date | undefined
}) {
  return (
    <ul className="strand strandCord">
      {beads.map((bead, index) => {
        const open = bead.id === openId

        return (
          <li key={bead.id} className="beadRow">
            <BeadButton
              bead={bead}
              index={index}
              total={beads.length}
              density={density}
              archetype={archetype}
              open={open}
            >
              <span className="beadName">{nameOf(bead)}</span>
              <span className="beadWhat">{whatOf(bead)}</span>
            </BeadButton>

            {open ? <BeadPanel bead={bead} now={now} /> : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Beyond thirty the strand braids across two, three or five cords, so it
 * thickens rather than running on down the page. The weight is the point.
 */
function BraidedStrand({
  beads,
  density,
  archetype,
  openId,
}: {
  beads: readonly StrandBead[]
  density: DensityBand
  archetype: ArchetypeConfig
  openId: string | undefined
}) {
  // The same arithmetic the beads use, from the same constant: a cord drawn
  // anywhere but under its beads is a strand with the string in the wrong place.
  const cords = Array.from({ length: density.cords }, (_, cord) =>
    Math.round((cord - (density.cords - 1) / 2) * CORD_PITCH),
  )

  return (
    <div
      className="strandFrame"
      style={
        {
          '--strand-height': `${String(strandHeight(beads.length, density))}px`,
        } as CSSProperties
      }
    >
      {/* The cords themselves. Decorative — the beads carry the meaning. */}
      <div className="cords" aria-hidden="true">
        {cords.map((x) => (
          <span
            key={x}
            className="cord"
            style={{ '--x': `${String(x)}px` } as CSSProperties}
          />
        ))}
      </div>

      <ul className="strand strandBraid">
        {beads.map((bead, index) => {
          const { x, y } = positionFor(index, density)

          return (
            <li
              key={bead.id}
              className="beadRow"
              style={
                { '--x': `${String(x)}px`, '--y': `${String(y)}px` } as CSSProperties
              }
            >
              <BeadButton
                bead={bead}
                index={index}
                total={beads.length}
                density={density}
                archetype={archetype}
                open={bead.id === openId}
              >
                <span className="beadHidden">
                  {eventCopy.strand.beadLabel(nameOf(bead), whatOf(bead))}
                </span>
              </BeadButton>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The bead itself: a submit button carrying its own id, with the visible disc
 * inside it. The button holds the 44px hit area; the disc stays 10–24px.
 */
function BeadButton({
  bead,
  index,
  total,
  density,
  archetype,
  open,
  children,
}: {
  bead: StrandBead
  index: number
  total: number
  density: DensityBand
  archetype: ArchetypeConfig
  open: boolean
  children: ReactNode
}) {
  const band = bandFor({
    form: bead.form,
    amount: bead.amount,
    amountsPublic: archetype.amountsPublic,
  })

  const diameter = beadDiameter(band, density)

  /*
   * Motion, and only for the bead that arrived most recently.
   *
   * `isAnimated` is the type layer of architecture §6 and checks `animate ===
   * true` explicitly, so an archetype that merely fails to declare the flag
   * gets nothing. There is no second application-level check beside it: two
   * checks of one condition is one check with a spare, and the removal of
   * either goes unnoticed (docs/decisions.md M2-05 §7).
   */
  const settles = isAnimated(archetype) && index === total - 1

  return (
    <button
      type="submit"
      name="bead"
      value={open ? '' : bead.id}
      className={`beadButton ${FORM_CLASS[bead.form]}${settles ? ' beadNew' : ''}`}
      aria-expanded={open}
      // Only while the panel exists: aria-controls pointing at an id that is
      // not in the document is a broken reference, not a promise.
      {...(open ? { 'aria-controls': `bead-${bead.id}` } : {})}
    >
      <span className="beadMark">
        <span
          className="beadDot"
          style={{ '--d': `${String(diameter)}px` } as CSSProperties}
        >
          <span className="beadBar" />
        </span>
      </span>
      {children}
    </button>
  )
}

/** The braided strand's panel: one region under the strand, for the open bead. */
function OpenPanel({
  beads,
  openId,
  now,
}: {
  beads: readonly StrandBead[]
  openId: string | undefined
  now: Date | undefined
}) {
  const bead = beads.find((candidate) => candidate.id === openId)
  if (bead === undefined) return null

  return <BeadPanel bead={bead} now={now} />
}

/**
 * What a bead says when it is opened: who, their words, who was inside it if it
 * was a group, and when. Never an amount.
 */
function BeadPanel({ bead, now }: { bead: StrandBead; now: Date | undefined }) {
  const members = bead.members ?? []
  const what =
    bead.form === 'group'
      ? eventCopy.strand.groupMeta(bead.description ?? '')
      : whatOf(bead)

  const when = now === undefined ? null : eventCopy.strand.when(daysBetween(bead.at, now))

  return (
    <div className="beadPanel" id={`bead-${bead.id}`}>
      <p className="beadPanelName">{nameOf(bead)}</p>
      {bead.message === null ? null : <p className="beadPanelMessage">{bead.message}</p>}

      {members.length === 0 && groupSize(bead) === 0 ? null : (
        <div className="beadMembers">
          <p className="beadMembersLabel">
            {eventCopy.strand.membersLabel(groupSize(bead))}
          </p>
          <div className="beadMemberNames">
            {members.map((member) => (
              <span key={member} className="beadMember">
                {member}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="beadPanelMeta" data-numeric="">
        {when === null ? what : `${what} · ${when}`}
      </p>

      {/* Submitting with an empty value closes it — the same button the bead
          is, so nothing here needs script to toggle. */}
      <button type="submit" name="bead" value="" className="buttonQuiet">
        {eventCopy.strand.close}
      </button>
    </div>
  )
}
