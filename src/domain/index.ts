/**
 * Pure business logic. No I/O, no framework, no Prisma types.
 *
 * Nothing here may import from `app/`, `adapters/` or `db/`, by alias or by
 * relative path. ESLint enforces it (see eslint.config.mjs) and
 * tests/unit/domain-boundary.test.ts proves the rule actually fires.
 *
 * This boundary is what makes the payment provider swappable, which matters
 * because the regulatory position on Mode B is unresolved — see
 * docs/architecture.md §0.2 and §15 item 1.
 *
 * Populated from M1-03 (Money) onward. Empty by design at M1-01.
 */

export {}
