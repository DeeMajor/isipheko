/**
 * Next.js calls register() once, at server start, before the first request is
 * served. Importing the env module here is what turns a missing variable into a
 * refusal to start rather than a 500 on someone's contribution page.
 *
 * Throwing is not enough, and this is the whole reason the file is shaped this
 * way. Verified against Next 16.3.0: a throw out of register() is caught, logged
 * as an unhandledRejection, and the server keeps listening — then answers every
 * request with a 500. A container in that state passes a TCP health check and
 * stays in the load balancer, serving 500s to contributors, which is precisely
 * the outcome this guard exists to prevent. So the process is ended here.
 */

export interface StartupHost {
  readonly report: (error: unknown) => void
  readonly exit: (code: number) => void
}

const nodeHost: StartupHost = {
  // The error object, not just its message: the stack is useful and carries no
  // variable values, so this stays within CLAUDE.md rule 8.
  report: (error) => {
    console.error(error)
  },
  // process.exit is absent in the edge runtime. Rethrowing there is worse than
  // exiting but better than swallowing, and it keeps the failure loud.
  exit: (code) => {
    if (typeof process.exit === 'function') process.exit(code)
    throw new Error('Environment validation failed and the process could not be stopped.')
  },
}

/**
 * The host is injectable only so tests can assert the refusal without taking the
 * test runner down with a real process.exit. Next calls this with no arguments.
 */
export async function register(host: StartupHost = nodeHost): Promise<void> {
  try {
    await import('@/lib/env')
  } catch (error) {
    host.report(error)
    host.exit(1)
  }
}
