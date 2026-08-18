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
 * The mirror image of the check above: here an http URL is the mistake. Both
 * directions of the paste happen, and neither should reach a running server.
 */
function isPostgresUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'postgres:' || protocol === 'postgresql:'
}

const postgresUrl = z.string().refine(isPostgresUrl, {
  message: 'must be a postgres:// or postgresql:// connection string',
})

/**
 * A 32-byte key, base64 encoded — AES-256 and nothing shorter.
 *
 * Length is checked after decoding rather than on the string, because base64
 * silently tolerates a truncated input and would otherwise yield a short key
 * that still encrypts. Encrypting bank account numbers under a 9-byte key
 * derived from a half-copied secret is the sort of failure that is discovered
 * years later.
 */
const base64Key = (bytes: number) =>
  z
    .string()
    .refine((value) => Buffer.from(value, 'base64').toString('base64') === value, {
      message: 'must be valid base64',
    })
    .refine((value) => Buffer.from(value, 'base64').length === bytes, {
      message: `must decode to exactly ${String(bytes)} bytes — generate one with: openssl rand -base64 ${String(bytes)}`,
    })

/**
 * Development-only key material, published in .env.example and in this file.
 *
 * That is safe precisely because it is worthless: it protects a throwaway local
 * database. It exists so a clean clone runs. Production has no defaults, so this
 * value cannot leak into one by omission — a deployment that forgets to set the
 * real key fails to start rather than quietly encrypting under a public key.
 */
const DEV_ENCRYPTION_KEY = 'ZGV2ZWxvcG1lbnQtb25seS1rZXktZG8tbm90LXVzZSE='
const DEV_ID_PEPPER = 'ZGV2ZWxvcG1lbnQtb25seS1wZXBwZXItZG8tbm90ISE='
const DEV_OTP_PEPPER = 'ZGV2ZWxvcG1lbnQtb25seS1vdHAtcGVwcGVyLWRvISE='

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

    // What the application connects as at runtime: isipheko_app, which holds
    // INSERT and SELECT on ledger_entries and deliberately not UPDATE or DELETE
    // (CLAUDE.md rule 3). Pointing this at the owner role would silently undo
    // the append-only guarantee, so the two URLs are separate variables rather
    // than one with a flag.
    DATABASE_URL: isProduction
      ? postgresUrl
      : postgresUrl.default(
          'postgresql://isipheko_app:isipheko_local_dev@localhost:5433/isipheko',
        ),

    // The owner role. Migrations and DDL only — never the request path.
    MIGRATION_DATABASE_URL: isProduction
      ? postgresUrl
      : postgresUrl.default(
          'postgresql://isipheko_owner:isipheko_local_dev@localhost:5433/isipheko',
        ),

    // Column encryption for bank account numbers (architecture §10). Held in
    // the environment as a stopgap; it belongs in a KMS, separate from the
    // database credential, before anything real is stored. See
    // docs/decisions.md M1-02.
    BANK_ACCOUNT_ENCRYPTION_KEY: isProduction
      ? base64Key(32).refine((value) => value !== DEV_ENCRYPTION_KEY, {
          message:
            'is the development key published in .env.example — generate a real one and hold it outside the repository',
        })
      : base64Key(32).default(DEV_ENCRYPTION_KEY),

    // Peppered SHA-256 of the ID number (architecture §7.3). The plaintext ID
    // number is never stored. Same stopgap, same destination.
    // Rotating this pepper invalidates every stored hash, so it is generated
    // once and kept. It cannot be recovered from the hashes it produced.
    ID_NUMBER_PEPPER: isProduction
      ? base64Key(32).refine((value) => value !== DEV_ID_PEPPER, {
          message:
            'is the development pepper published in .env.example — generate a real one and hold it outside the repository',
        })
      : base64Key(32).default(DEV_ID_PEPPER),

    // One-time codes are stored as HMAC-SHA256 under this pepper, and the
    // phone, IP and user-agent hashes in the audit log use it too (M1-06).
    //
    // A six-digit code is a 10^6 space and a South African mobile number about
    // 10^9: an unpeppered digest of either is a lookup table, not a secret.
    // This is the only thing that makes a stolen `otp_challenges` row useless.
    //
    // Separate from ID_NUMBER_PEPPER on purpose. Rotating this one costs the
    // codes in flight and the ability to correlate old audit rows; rotating
    // that one invalidates every stored identity hash. They should not be
    // forced to share a fate.
    OTP_PEPPER: isProduction
      ? base64Key(32).refine((value) => value !== DEV_OTP_PEPPER, {
          message:
            'is the development pepper published in .env.example — generate a real one and hold it outside the repository',
        })
      : base64Key(32).default(DEV_OTP_PEPPER),
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
