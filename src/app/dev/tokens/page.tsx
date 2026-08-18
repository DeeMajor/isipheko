import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ARCHETYPES, type ArchetypeConfig } from '@/domain/archetype'
import { Button, Card, Field, Select, Sheet, TextAreaField, Toast } from '@/ui/primitives'
import { ArchetypeTheme } from '@/ui/theme'

import styles from './page.module.css'

/**
 * The tokens page — every primitive, in every archetype theme.
 *
 * It exists to be looked at and to be tested: `tests/e2e/tokens.spec.ts` runs
 * axe over each theme and checks the focus ring on every focusable control.
 * Bereavement is the one that matters most, because it is the theme that sets
 * no `--accent` at all and therefore proves the fallback is doing the work.
 *
 * **Not shipped.** It answers 404 in production. It is an internal reference,
 * and a route nobody linked to is still a route somebody can find.
 */

export const metadata: Metadata = {
  title: 'Tokens · Isipheko',
  robots: { index: false, follow: false },
}

/** One archetype per group — six themes, derived rather than listed. */
function themes(): readonly ArchetypeConfig[] {
  const seen = new Set<string>()
  return Object.values(ARCHETYPES).filter((config) => {
    if (seen.has(config.group)) return false
    seen.add(config.group)
    return true
  })
}

export default function TokensPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Isipheko · tokens and primitives</h1>
      <p className={styles.intro}>
        Every primitive in all six themes. Nothing here asks which archetype it is: the
        accent arrives as an inline custom property from the config, and bereavement sets
        none, so <code>var(--accent, #16233D)</code> renders indigo on its own.
      </p>

      <div className={styles.grid}>
        {themes().map((archetype) => (
          <ArchetypeTheme
            key={archetype.key}
            archetype={archetype}
            className={styles.column}
          >
            <ThemeColumn archetype={archetype} />
          </ArchetypeTheme>
        ))}
      </div>
    </main>
  )
}

function ThemeColumn({ archetype }: { archetype: ArchetypeConfig }) {
  const id = archetype.key

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className={styles.columnHead}>
        <span className={styles.bead} aria-hidden="true" />
        <h2 className={styles.columnTitle} id={`${id}-heading`}>
          {archetype.kicker}
        </h2>
        <p className={styles.columnMeta}>
          {archetype.group}
          {archetype.accent === undefined
            ? ' · no accent declared'
            : ` · ${archetype.accent}`}
        </p>
      </div>

      <div className={styles.stack}>
        <Button>{archetype.verb}</Button>
        <Button variant="secondary">Bring something instead</Button>
        <Button variant="quiet">Not now</Button>
        <Button disabled>Sending…</Button>

        <Card title="A card" titleAs="h3">
          <p className={styles.cardBody}>
            One elevation, a 1px rule and a 12px radius. No shadow, no gradient.
          </p>
        </Card>

        <Field
          id={`${id}-name`}
          label="Your name"
          help="However people know you. It appears on the strand."
          placeholder="e.g. Thandi Ngcobo"
        />

        <Field
          id={`${id}-amount`}
          label="Amount"
          inputMode="decimal"
          data-numeric=""
          defaultValue="1 234,56"
          error="That amount has too many decimals. Amounts look like 1 234,56."
        />

        <TextAreaField
          id={`${id}-message`}
          label="A message for the family"
          rows={2}
          placeholder="Say something if you would like to."
        />

        <Select
          id={`${id}-visibility`}
          label="Who can see this"
          help="The family always sees the full record, whatever you choose here."
          options={[
            { value: 'public', label: 'My name and what I gave' },
            { value: 'name_only', label: 'My name only' },
            { value: 'anonymous', label: 'Quietly' },
          ]}
        />

        <Toast title="You’ve claimed the tent">
          It is held for you until Saturday. Nobody else can claim it.
        </Toast>

        <Toast tone="problem" title="That payment didn’t go through">
          Nothing was taken from your account. You can try again.
        </Toast>

        <Sheet
          id={`${id}-sheet`}
          title="Claim the tent"
          open
          footer={
            <>
              <Button>Yes, I’ll bring the tent</Button>
              <Button variant="quiet">Leave it for someone else</Button>
            </>
          }
        >
          <p className={styles.cardBody}>
            Claiming holds it for you so nobody arrives with a second one.
          </p>
        </Sheet>
      </div>
    </section>
  )
}
