/**
 * Writes `src/ui/tokens.css` from `src/ui/tokens.ts`.
 *
 * The tokens have to exist twice — as a stylesheet the App Router pages import,
 * and as a string the public event page inlines into its head, because a route
 * handler cannot import CSS (docs/decisions.md M1-08). Two hand-maintained
 * copies would drift, and what drifts is a colour nobody notices is wrong.
 *
 * **Workflow — do not hand-edit `src/ui/tokens.css`.**
 *
 *   1. edit `src/ui/tokens.ts`
 *   2. `pnpm tokens:css`
 *   3. commit both
 *
 * `tests/unit/tokens.test.ts` fails if the committed CSS is not what this
 * emits, so step 2 cannot be skipped quietly.
 *
 * Run: `node --experimental-strip-types scripts/generate-tokens-css.ts`
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { TOKENS_CSS } from '../src/ui/tokens.ts'

export const TOKENS_CSS_PATH = fileURLToPath(
  new URL('../src/ui/tokens.css', import.meta.url),
)

const BANNER = `/* GENERATED FILE — DO NOT EDIT.
 *
 * Written by scripts/generate-tokens-css.ts from src/ui/tokens.ts. Edit that,
 * run \`pnpm tokens:css\`, commit both. A unit test fails if they disagree.
 */
`

export function buildTokensCss(): string {
  return `${BANNER}${TOKENS_CSS.replace(/^\n/, '')}`
}

const isCli =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isCli) {
  writeFileSync(TOKENS_CSS_PATH, buildTokensCss(), 'utf8')
  process.stdout.write(`wrote ${TOKENS_CSS_PATH}\n`)
}
