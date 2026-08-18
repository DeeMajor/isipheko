import type { CSSProperties, ReactNode } from 'react'

import type { ArchetypeConfig } from '@/domain/archetype'

/**
 * The only place in the product that sets `--accent`.
 *
 * An archetype that declares an accent gets it as an inline custom property.
 * Bereavement declares none, so **nothing is set** and every
 * `var(--accent, #16233D)` in the stylesheets resolves to indigo on its own.
 *
 * There is deliberately no accent map in CSS. A map would repeat the six
 * colours that already live in `ArchetypeConfig` — the same duplication M1-04
 * removed from the SQL — and the thing that would drift is which archetype has
 * no accent at all. Reading it from the config means the CSS cannot disagree
 * with the domain, because the CSS does not know.
 *
 * `data-archetype` is for tests and for reading the DOM in a debugger. It is
 * not a styling hook: no stylesheet may select on a specific archetype, and a
 * unit test enforces that. The one generic `[data-archetype]` rule in
 * tokens.css derives `--accent-strong` and is explained there.
 */
/**
 * The accent as an inline custom property, or nothing at all.
 *
 * Exported because there are two renderers: `ArchetypeTheme` for the App Router
 * pages, and `PublicEventPage`, which builds its own document because the
 * public route is a route handler (docs/decisions.md M1-08). Both spread this.
 *
 * One function so "no accent means the key is absent" is decided once. Two
 * copies would eventually disagree, and the one that disagreed would be the
 * funeral.
 */
export function accentStyle(archetype: ArchetypeConfig): {
  style?: CSSProperties
} {
  return archetype.accent === undefined
    ? {}
    : { style: { '--accent': archetype.accent } as CSSProperties }
}

export function ArchetypeTheme({
  archetype,
  children,
  className,
}: {
  archetype: ArchetypeConfig
  children: ReactNode
  /** `string | undefined` on purpose: a CSS-module lookup is possibly undefined
   * under `noUncheckedIndexedAccess`, and every call site would otherwise need
   * a non-null assertion to pass one. */
  className?: string | undefined
}) {
  // Not `style={{ '--accent': undefined }}` — the property is absent or it
  // holds a colour, exactly as on the config itself.
  const themed = accentStyle(archetype)

  return (
    <div data-archetype={archetype.key} className={className} {...themed}>
      {children}
    </div>
  )
}
