import type { ReactNode } from 'react'

import { SETUP_STEPS, stepNumber, type SetupStep } from '@/domain/event'
import type { ArchetypeConfig } from '@/domain/archetype'
import { ArchetypeTheme } from '@/ui/theme'

import styles from './setup.module.css'

/**
 * The frame every setup step sits in: the crumb, "Step N of 6", and the
 * progress rule.
 *
 * The progress rule is a *position in a form*, not progress toward a target —
 * it says which of six questions you are on, and it renders identically on a
 * funeral. CLAUDE.md rule 1 is about a progress bar on money raised, which is a
 * different thing entirely and cannot appear here: this component is never
 * handed an amount.
 */
export function SetupShell({
  step,
  archetype,
  crumb,
  children,
}: {
  step: SetupStep
  archetype?: ArchetypeConfig | undefined
  crumb: string
  children: ReactNode
}) {
  const index = stepNumber(step)
  const percent = Math.round((index / SETUP_STEPS.length) * 100)

  const frame = (
    // A landmark, not a div: without it every step's content sits outside any
    // region and axe fails the page. It is also how a screen-reader user skips
    // the crumb and the step counter on each of six screens.
    <main className={styles.frame}>
      <header className={styles.head}>
        <p className={styles.crumb}>{crumb}</p>
        <p className={styles.step} data-numeric="">
          Step {index} of {SETUP_STEPS.length}
        </p>
        <div className={styles.rule}>
          <div className={styles.ruleFill} style={{ width: `${String(percent)}%` }} />
        </div>
      </header>

      {children}
    </main>
  )

  // Unthemed until an archetype is chosen — var(--accent, #16233D) renders
  // indigo on its own, which is also what bereavement will keep.
  return archetype === undefined ? (
    frame
  ) : (
    <ArchetypeTheme archetype={archetype}>{frame}</ArchetypeTheme>
  )
}
