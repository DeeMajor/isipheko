import type { ButtonHTMLAttributes } from 'react'

import styles from './button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Auto-width instead of full-width. Still respects the 44px hit area. */
  inline?: boolean
}

/**
 * A real `<button>`, always. Never a styled `<div>` with a click handler —
 * the claim flow has to work with JavaScript disabled inside a
 * `<form method="post">` (CLAUDE.md rule 5), and a div submits nothing.
 *
 * `type` defaults to `button`. The default in HTML is `submit`, which turns
 * every incidental button inside a form into an accidental submission.
 */
export function Button({
  variant = 'primary',
  inline = false,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], inline ? styles.inline : '', className]
    .filter(Boolean)
    .join(' ')

  return <button type={type} className={classes} {...rest} />
}
