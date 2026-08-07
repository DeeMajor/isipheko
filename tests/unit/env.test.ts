import { describe, expect, it } from 'vitest'

import { EnvironmentError, parseEnv } from '@/lib/env'

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
    const env = parseEnv({
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://isipheko.co.za',
    })

    expect(env).toEqual({
      NODE_ENV: 'production',
      NEXT_PUBLIC_APP_URL: 'https://isipheko.co.za',
    })
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
