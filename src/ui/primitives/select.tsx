import type { SelectHTMLAttributes } from 'react'

import styles from './select.module.css'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  id: string
  options: readonly SelectOption[]
  help?: string
}

/**
 * A native `<select>`, styled. Not a listbox built from divs.
 *
 * The native control is the one that works on a five-year-old Android browser,
 * with a screen reader, with the keyboard, and with no JavaScript at all. On
 * the contributor path — a borrowed phone with little data left — that is not a
 * trade-off worth making for a nicer-looking menu.
 *
 * The arrow is a background SVG rather than an icon element so nothing extra
 * has to load, and it is `currentColor` so it follows the text.
 */
export function Select({ label, id, options, help, className, ...rest }: SelectProps) {
  const helpId = `${id}-help`

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <div className={styles.wrap}>
        <select
          {...rest}
          id={id}
          className={[styles.select, className].filter(Boolean).join(' ')}
          {...(help ? { 'aria-describedby': helpId } : {})}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {help ? (
        <p className={styles.help} id={helpId}>
          {help}
        </p>
      ) : null}
    </div>
  )
}
