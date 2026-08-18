import type { ReactNode } from 'react'

import styles from './sheet.module.css'

export interface SheetProps {
  /** Names the sheet for a screen reader. Rendered as its heading. */
  title: string
  id: string
  /** Rendered open. Opening and closing are wired where the sheet is used. */
  open?: boolean
  children: ReactNode
  footer?: ReactNode
}

/**
 * A native `<dialog>`, presented from the bottom.
 *
 * Native because the browser already does the parts that get done badly by
 * hand: focus trapping, `Esc`, inertness of the page behind, and the backdrop.
 *
 * **Presentational at M1-05.** It ships no client JavaScript — `open` is a
 * prop, not state. Opening, closing and the 15-second `Undo` window belong to
 * the flows that use it (M1-07, M2), which must also work with JavaScript
 * disabled (CLAUDE.md rule 5). A primitive that assumed a click handler would
 * quietly rule that out.
 */
export function Sheet({ title, id, open = false, children, footer }: SheetProps) {
  const titleId = `${id}-title`

  return (
    <dialog id={id} className={styles.sheet} aria-labelledby={titleId} open={open}>
      <span className={styles.grip} aria-hidden="true" />

      <div className={styles.head}>
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
      </div>

      <div className={styles.body}>{children}</div>

      {footer ? <div className={styles.foot}>{footer}</div> : null}
    </dialog>
  )
}
