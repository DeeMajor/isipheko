import type { HTMLAttributes, ReactNode } from 'react'

import styles from './card.module.css'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  /** Heading level. A card is not always the second level of the page. */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4'
  children: ReactNode
}

/**
 * The 12px-radius surface everything sits on. Never a pill, never a shadow —
 * the design has one elevation, and it is a 1px rule.
 *
 * `titleAs` exists because heading order is an axe rule and a real navigation
 * aid: a card cannot assume it is an `<h2>` wherever it lands. On a page that
 * is one card — sign-in, for instance — the card's title is the `<h1>`, and a
 * page with no level-one heading is itself an axe violation.
 */
export function Card({
  title,
  titleAs: Heading = 'h2',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div {...rest} className={[styles.card, className].filter(Boolean).join(' ')}>
      {title ? <Heading className={styles.title}>{title}</Heading> : null}
      {children}
    </div>
  )
}
