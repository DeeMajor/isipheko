import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StartupHost } from '@/instrumentation'

/**
 * These cover the boot guard rather than the validation rules — env.test.ts owns
 * those. What matters here is the consequence of a failure: the process must end,
 * not carry on serving.
 *
 * Modules are reset around every case because src/lib/env.ts reads process.env
 * once, at module evaluation, and is otherwise cached across tests.
 */

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

function recordingHost(): StartupHost & {
  readonly exits: number[]
  readonly reported: unknown[]
} {
  const exits: number[] = []
  const reported: unknown[] = []

  return {
    exits,
    reported,
    report: (error) => reported.push(error),
    exit: (code) => exits.push(code),
  }
}

async function registerWith(host: StartupHost): Promise<void> {
  vi.resetModules()
  const { register } = await import('@/instrumentation')
  await register(host)
}

describe('register', () => {
  it('starts cleanly when the environment is valid', async () => {
    const host = recordingHost()

    await registerWith(host)

    expect(host.exits).toEqual([])
    expect(host.reported).toEqual([])
  })

  // The case that was actually broken: a throw alone leaves Next serving 500s.
  it('ends the process when a required variable is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
    const host = recordingHost()

    await registerWith(host)

    expect(host.exits).toEqual([1])
  })

  it('ends the process when a variable is malformed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'postgres://db.internal:5432/isipheko')
    const host = recordingHost()

    await registerWith(host)

    expect(host.exits).toEqual([1])
  })

  it('reports the failure before exiting, naming the variable', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined)
    const host = recordingHost()

    await registerWith(host)

    expect(host.reported).toHaveLength(1)
    expect(String((host.reported[0] as Error).message)).toContain('NEXT_PUBLIC_APP_URL')
  })

  // CLAUDE.md rule 8 again, at the point where the message actually reaches a log.
  it('does not report the offending value', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'postgres://user:hunter2@db.internal:5432/isipheko')
    const host = recordingHost()

    await registerWith(host)

    expect(String((host.reported[0] as Error).message)).not.toContain('hunter2')
  })
})
