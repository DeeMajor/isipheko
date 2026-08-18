import type { ReactNode } from 'react'

import styles from './toast.module.css'

export interface ToastProps {
  /** A problem is announced immediately; anything else waits its turn. */
  tone?: 'neutral' | 'problem'
  title?: string
  children: ReactNode
}

/**
 * A live region for something that just happened.
 *
 * `role="status"` for the ordinary case and `role="alert"` for a problem: the
 * first is announced politely when the reader is idle, the second interrupts.
 * Using `alert` for everything is how screen-reader users end up ignoring it.
 *
 * **Presentational at M1-05** — no timers, no dismissal, no client JavaScript.
 * It renders where the server puts it, which is what makes it usable on the
 * no-JS path.
 */
export function Toast({ tone = 'neutral', title, children }: ToastProps) {
  return (
    <div
      className={[styles.toast, tone === 'problem' ? styles.problem : '']
        .filter(Boolean)
        .join(' ')}
      role={tone === 'problem' ? 'alert' : 'status'}
    >
      <span className={styles.mark} aria-hidden="true" />
      <div>
        {title ? <p className={styles.title}>{title}</p> : null}
        <p className={styles.text}>{children}</p>
      </div>
    </div>
  )
}
