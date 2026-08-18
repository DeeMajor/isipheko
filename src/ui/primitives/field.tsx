import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

import styles from './field.module.css'

interface FieldBase {
  /** Required. There is no unlabelled field in this product. */
  label: string
  id: string
  help?: string | undefined
  /** What went wrong and what to do next. Never an apology, never vague. */
  error?: string | undefined
}

export type FieldProps = FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>

export type TextAreaFieldProps = FieldBase &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>

/**
 * A labelled input, its help text and its error, wired together.
 *
 * `label` and `id` are required rather than optional: an unlabelled input is
 * both an axe violation and, on a form asking somebody for money, a real
 * question about what they are typing into. `aria-describedby` picks up the
 * help and the error so a screen reader hears both, and the error carries
 * `role="alert"` so it is announced when it appears rather than only when the
 * field is next visited.
 *
 * Multi-line input is {@link TextAreaField}, a separate component rather than a
 * `multiline` flag — one element per component, and no branch inside.
 */
export function Field({ label, id, help, error, className, ...rest }: FieldProps) {
  return (
    <FieldShell label={label} id={id} help={help} error={error}>
      {(control) => (
        <input
          {...rest}
          {...control}
          className={[control.className, className].filter(Boolean).join(' ')}
        />
      )}
    </FieldShell>
  )
}

/** {@link Field}, with a `<textarea>`. Same wiring, same rules. */
export function TextAreaField({
  label,
  id,
  help,
  error,
  className,
  ...rest
}: TextAreaFieldProps) {
  return (
    <FieldShell label={label} id={id} help={help} error={error}>
      {(control) => (
        <textarea
          {...rest}
          {...control}
          className={[control.className, styles.multiline, className]
            .filter(Boolean)
            .join(' ')}
        />
      )}
    </FieldShell>
  )
}

interface ControlProps {
  id: string
  className: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/** The label, help and error markup, and the wiring between them. */
function FieldShell({
  label,
  id,
  help,
  error,
  children,
}: FieldBase & { children: (control: ControlProps) => ReactNode }) {
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ')

  const control: ControlProps = {
    id,
    className: [styles.control, error ? styles.invalid : ''].filter(Boolean).join(' '),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true as const } : {}),
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      {children(control)}

      {help ? (
        <p className={styles.help} id={helpId}>
          {help}
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
