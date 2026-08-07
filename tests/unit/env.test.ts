import { describe, expect, it } from 'vitest'

import { EnvironmentError, parseEnv } from '@/lib/env'

/** A production environment with nothing missing. Spread and overridden per case. */
const PRODUCTION = {
  NEXT_PUBLIC_APP_URL: 'https://isipheko.co.za',
  DATABASE_URL: 'postgresql://isipheko_app:secret@db.internal:5432/isipheko',
  MIGRATION_DATABASE_URL: 'postgresql://isipheko_owner:secret@db.internal:5432/isipheko',
  BANK_ACCOUNT_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  ID_NUMBER_PEPPER: Buffer.alloc(32, 2).toString('base64'),
}

describe('parseEnv', () => {
  it('applies the documented development defaults, so a clean clone runs', () => {
    const env = parseEnv({ NODE_ENV: 'development' })

    expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000')
    expect(env.NODE_ENV).toBe('development')
  })

  it('defaults NODE_ENV to development when it is absent', () => {
    expect(parseEnv({}).NODE_ENV).toBe('development')
  })

  it('refuses in production when a required variable is missing', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(EnvironmentError)
  })

  it('names the offending variable so the fix is obvious', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/NEXT_PUBLIC_APP_URL/)
  })

  // URL.canParse accepts this — `localhost:` reads as a scheme. Anything
  // looser than an explicit http(s) check lets it through.
  it('rejects a bare host:port', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'localhost:3000' }),
    ).toThrow(/absolute URL/)
  })

  // The realistic misconfiguration: the wrong variable pasted into the right
  // slot. It parses as a URL, so only the scheme check catches it.
  it('rejects a URL on a non-http scheme', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'postgres://db.internal:5432/isipheko',
      }),
    ).toThrow(/http or https/)
  })

  it('rejects a trailing slash, which would produce double-slashed share links', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://isipheko.co.za/',
      }),
    ).toThrow(/trailing slash/)
  })

  it('rejects an unknown NODE_ENV rather than silently treating it as development', () => {
    expect(() => parseEnv({ NODE_ENV: 'staging' })).toThrow(EnvironmentError)
  })

  it('accepts a fully specified production environment', () => {
    const env = parseEnv({ NODE_ENV: 'production', ...PRODUCTION })

    expect(env).toEqual({ NODE_ENV: 'production', ...PRODUCTION })
  })

  it('names every missing variable at once, not one per restart', () => {
    try {
      parseEnv({ NODE_ENV: 'production' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as EnvironmentError).problems).toHaveLength(5)
    }
  })

  // CLAUDE.md rule 8. This error reaches logs; environment variables hold
  // secrets. The variable name is enough to fix the problem.
  it('never puts a variable value in the error message', () => {
    const value = 'postgres://user:hunter2@db.internal:5432/isipheko'

    expect(() =>
      parseEnv({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: value }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('hunter2') as unknown as string,
      }),
    )
  })
})

/**
 * The database URLs and the key material arrived with M1-02. Between them they
 * carry the append-only guarantee and the encryption of bank account numbers, so
 * a malformed one is not a configuration inconvenience.
 */
describe('database URLs', () => {
  it('applies development defaults pointing at compose.yaml', () => {
    const env = parseEnv({})

    expect(env.DATABASE_URL).toContain('isipheko_app')
    expect(env.MIGRATION_DATABASE_URL).toContain('isipheko_owner')
    // Port 5433 — a developer machine often already has a Postgres on 5432, and
    // silently migrating the wrong database is a bad first ten minutes.
    expect(env.DATABASE_URL).toContain(':5433/')
  })

  // The mirror of the NEXT_PUBLIC_APP_URL check: there an http URL is required,
  // here it is the mistake. Both directions of the paste happen.
  it('rejects an http URL where a connection string belongs', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ...PRODUCTION,
        DATABASE_URL: 'https://isipheko.co.za',
      }),
    ).toThrow(/postgres:\/\//)
  })

  it('rejects a bare host:port', () => {
    expect(() =>
      parseEnv({ NODE_ENV: 'production', ...PRODUCTION, DATABASE_URL: 'localhost:5432' }),
    ).toThrow(/postgres:\/\//)
  })

  it('accepts the postgres:// spelling as well as postgresql://', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      ...PRODUCTION,
      DATABASE_URL: 'postgres://user:secret@db.internal:5432/isipheko',
    })

    expect(env.DATABASE_URL).toMatch(/^postgres:\/\//)
  })
})

describe('key material', () => {
  it('rejects a key that decodes to fewer than 32 bytes', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ...PRODUCTION,
        BANK_ACCOUNT_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
      }),
    ).toThrow(/exactly 32 bytes/)
  })

  it('rejects a key that is not valid base64', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ...PRODUCTION,
        BANK_ACCOUNT_ENCRYPTION_KEY: 'not base64 at all!!',
      }),
    ).toThrow(/base64/)
  })

  it('tells the reader how to generate one', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ...PRODUCTION,
        ID_NUMBER_PEPPER: 'c2hvcnQ=',
      }),
    ).toThrow(/openssl rand -base64 32/)
  })

  // The point of the whole stopgap arrangement. The development key is published
  // in .env.example and in src/lib/env.ts, so the only thing keeping it out of
  // production is this refusal.
  it('refuses the published development key in production', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ...PRODUCTION,
        BANK_ACCOUNT_ENCRYPTION_KEY: 'ZGV2ZWxvcG1lbnQtb25seS1rZXktZG8tbm90LXVzZSE=',
      }),
    ).toThrow(/development key/)
  })

  it('refuses the published development pepper in production', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        ...PRODUCTION,
        ID_NUMBER_PEPPER: 'ZGV2ZWxvcG1lbnQtb25seS1wZXBwZXItZG8tbm90ISE=',
      }),
    ).toThrow(/development pepper/)
  })

  it('accepts the development key in development, so a clean clone runs', () => {
    expect(parseEnv({}).BANK_ACCOUNT_ENCRYPTION_KEY).toHaveLength(44)
  })

  // CLAUDE.md rule 8, on the variables where it matters most.
  it('never puts key material in an error message', () => {
    const key = Buffer.from('a-real-looking-secret-32-bytes!!').toString('base64')

    try {
      parseEnv({ NODE_ENV: 'production', ...PRODUCTION, ID_NUMBER_PEPPER: `${key}x` })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain(key)
    }
  })
})

describe('EnvironmentError', () => {
  // Only one variable is required at M1-01, so the accumulation path is tested
  // directly. It starts carrying weight at M1-02, when DATABASE_URL and the
  // KMS pepper arrive: one missing variable per restart is a miserable way to
  // configure a deployment.
  it('lists every problem in one message', () => {
    const error = new EnvironmentError([
      'DATABASE_URL — is required but not set',
      'ID_NUMBER_PEPPER — is required but not set',
    ])

    expect(error.message).toContain('DATABASE_URL')
    expect(error.message).toContain('ID_NUMBER_PEPPER')
    expect(error.problems).toHaveLength(2)
  })

  it('points at .env.example rather than leaving the reader guessing', () => {
    expect(new EnvironmentError(['X — is required but not set']).message).toContain(
      '.env.example',
    )
  })
})
