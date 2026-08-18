import { shareCopy } from '@/copy/share'
import type { ArchetypeConfig } from '@/domain/archetype'

/**
 * The card WhatsApp draws when somebody sends the link.
 *
 * More people see this than see the page (architecture §9.1), and most of them
 * decide whether the link is real from a thumbnail in a group chat. So it is
 * generated per event rather than a stock image with a logo on it.
 *
 * **Rendered by Satori, not a browser.** `next/og` supports flexbox and a
 * subset of CSS — no grid, no custom properties, no cascade. That is why the
 * accent arrives as a prop here instead of `var(--accent, #16233D)`: there is
 * no cascade to fall back through. The fallback is applied once, in
 * {@link cardAccent}, so the rule is still decided in one place and bereavement
 * still gets indigo without anything asking what archetype it is.
 *
 * **Nothing on this card can be added up.** No amount, no count, no target, no
 * progress. The strand hides those on the page for a reason (§7.3), and a card
 * carries further than a page does — it is forwarded, screenshotted, and sits
 * in group chats belonging to people who never opened anything.
 *
 * **The badge slot renders nothing.** Verification is M3-01 and the gate is
 * M3-02. A tick nobody earned is worth less than no tick and costs more, which
 * is the same call M1-08 §5 made about the page.
 */

/** Part C.2's ink, which is also `var(--accent, #16233D)`'s fallback. */
const INK = '#16233d'
const INK_SOFT = '#4a5670'
const PAPER = '#f2f1ed'
const PAPER_RAISED = '#ffffff'
const RULE = '#d8d6ce'

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

/**
 * The one place the accent fallback is applied for the card.
 *
 * Bereavement declares no accent, so this returns ink — the same colour the CSS
 * fallback resolves to, reached the same way: by the absence of a value rather
 * than by a conditional on the group (rule 2).
 */
export function cardAccent(archetype: ArchetypeConfig): string {
  return archetype.accent ?? INK
}

/**
 * Long titles are cut here rather than by the renderer.
 *
 * Satori's text handling differs from a browser's, and a title that overflows
 * silently would be discovered in somebody's chat rather than in review. A
 * character budget is crude, deterministic and testable.
 */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text

  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')

  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export interface OgCardProps {
  readonly archetype: ArchetypeConfig
  readonly title: string
  readonly subtitle: string | null
  readonly organiserName: string | null
  /** "Umngcwabo · Saturday, 15 August · KwaMashu" — never an amount. */
  readonly meta: string
  /**
   * Drawn only when the organiser's identity has actually been checked. False
   * everywhere until M3-02; the slot exists so that turning it on is a flag
   * rather than a redesign.
   */
  readonly verified?: boolean
}

export function OgCard({
  archetype,
  title,
  subtitle,
  organiserName,
  meta,
  verified = false,
}: OgCardProps) {
  const accent = cardAccent(archetype)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: PAPER,
        fontFamily: 'Public Sans',
      }}
    >
      {/* The band and the bead. At thumbnail size this is the first thing
          anybody sees, and on a bereavement card it is indigo. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          backgroundColor: accent,
          height: 104,
          width: '100%',
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: PAPER_RAISED,
          }}
        />
        <div
          style={{
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: 8,
            color: PAPER_RAISED,
          }}
        >
          {shareCopy.card.wordmark.toUpperCase()}
        </div>
      </div>

      {/*
       * Centred, and that is not a style preference. WhatsApp's small preview
       * crops to a square from the middle, so anything set against the left
       * edge is the first thing to disappear — including a name.
       */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 96px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: title.length > 34 ? 68 : 84,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1.05,
            color: INK,
            textAlign: 'center',
          }}
        >
          {clamp(title, 64)}
        </div>

        {subtitle === null || subtitle === '' ? null : (
          <div
            style={{
              marginTop: 14,
              fontSize: 38,
              fontWeight: 600,
              color: INK,
              textAlign: 'center',
            }}
          >
            {clamp(subtitle, 48)}
          </div>
        )}

        {organiserName === null || organiserName === '' ? null : (
          <div
            style={{
              marginTop: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              fontSize: 32,
              color: INK_SOFT,
            }}
          >
            {/*
              The badge, real since M3-02.

              **The tick is drawn, not typed.** Public Sans carries no U+2713,
              and Satori answers a missing glyph by fetching a font over the
              network — which failed with a 400 here, would be a request per
              card where it did not, and is the exact thing M1-05 hardcoded the
              `@font-face` rules to prevent. An SVG needs no font at all.
            */}
            {verified ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: accent,
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 22 22"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M4.5 11.5L9 16L17.5 6.5"
                    stroke={PAPER_RAISED}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            ) : null}
            <div style={{ color: INK_SOFT }}>
              {verified
                ? shareCopy.card.organiserVerified(clamp(organiserName, 40))
                : shareCopy.card.organiser(clamp(organiserName, 40))}
            </div>
          </div>
        )}

        {meta === '' ? null : (
          <div
            style={{
              marginTop: 22,
              fontSize: 28,
              color: INK_SOFT,
              textAlign: 'center',
            }}
          >
            {clamp(meta, 72)}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 84,
          borderTop: `1px solid ${RULE}`,
          fontSize: 24,
          letterSpacing: 1,
          color: INK_SOFT,
        }}
      >
        {shareCopy.card.host}
      </div>
    </div>
  )
}

/** Unused by the card; exported so tests and the share preview agree on ink. */
export const CARD_INK = INK
