import { z } from 'zod'

/**
 * Environment validation.
 *
 * Imported by src/instrumentation.ts (boot) and next.config.ts (build). A
 * missing or malformed variable throws here, which means the server refuses to
 * start and the build refuses to produce an artefact. It does not surface later
 * as a 500 on a contributor's page.
 *
 * Two rules this file holds to:
 *
 *   1. Report *every* problem at once. Finding one missing variable per restart
 *      is a miserable way to configure a deployment.
 *   2. Never print a value — only the variable name and what was wrong with it.
 *      Environment variables hold secrets, and this error reaches logs
 *      (CLAUDE.md rule 8).
 */

/**
 * URL.canParse alone is too permissive to be useful here: it accepts
 * `localhost:3000` (scheme `localhost:`) and `postgres://…`, so a mispasted
 * database URL would validate and then produce share links nobody can open.
 * The scheme has to be checked explicitly.
 */
function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'http:' || protocol === 'https:'
}

const absoluteUrl = z
  .string()
  .refine(isHttpUrl, {
    message: 'must be an absolute URL on http or https, e.g. https://isipheko.co.za',
  })
  .refine((value) => !value.endsWith('/'), {
    message: 'must not end in a trailing slash',
  })

/**
 * In development and test the documented defaults apply, so a clean clone runs
 * without a .env file. In production there are no defaults — every variable is
 * required, and a missing one is a hard failure.
 */
function schemaFor(nodeEnv: string | undefined) {
  const isProduction = nodeEnv === 'production'

  return z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // The externally reachable origin. Used for share links and OG image URLs,
    // so a container-internal address here produces WhatsApp previews that
    // nobody outside the cluster can load.
    NEXT_PUBLIC_APP_URL: isProduction
      ? absoluteUrl
      : absoluteUrl.default('http://localhost:3000'),
  })
}

export type Env = z.infer<ReturnType<typeof schemaFor>>

export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError'

  constructor(readonly problems: readonly string[]) {
    super(
      [
        'Environment validation failed — the app will not start.',
        '',
        ...problems.map((problem) => `  ${problem}`),
        '',
        'Set these in .env (start from .env.example) or in your deployment secret store.',
        'Values are deliberately not printed above; only variable names are.',
      ].join('\n'),
    )
  }
}

/**
 * Pure. Takes the source rather than reading process.env directly so it can be
 * tested without mutating global state or juggling the module cache.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schemaFor(source.NODE_ENV).safeParse(source)

  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const variable = issue.path.join('.') || '(root)'
      const detail =
        issue.code === 'invalid_type' ? 'is required but not set' : issue.message
      return `${variable} — ${detail}`
    })

    throw new EnvironmentError(problems)
  }

  return result.data
}

export const env = parseEnv(process.env)
