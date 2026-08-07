import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { TestProject } from 'vitest/node'

/**
 * A real Postgres, in a container, for the whole integration project.
 *
 * CLAUDE.md forbids mocking the database in integration tests, and this task is
 * why. Every guarantee being tested here — the bereavement CHECK, the
 * append-only ledger, the privileges of the application role — lives in
 * Postgres. A mock would answer according to whatever the mock's author
 * believed, which is precisely the belief under test.
 *
 * The container starts from the same `prisma/init/01-app-role.sql` that
 * compose.yaml mounts, so the test database and the development database begin
 * from an identical privilege position. If they diverged, a passing test would
 * say nothing about production.
 *
 * On this machine the runtime is Podman rather than Docker. Testcontainers finds
 * it through DOCKER_HOST — see README.
 */

const execFileAsync = promisify(execFile)

/**
 * Testcontainers looks for a Docker socket. This machine runs Podman, which
 * exposes a compatible one at a different path once `podman.socket` is enabled.
 *
 * Pointing at it here rather than asking every developer to export DOCKER_HOST
 * means the failure mode — an opaque "could not find a working container
 * runtime" from a library nobody has read — never happens on a machine that is
 * in fact perfectly capable of running the tests. An explicit DOCKER_HOST always
 * wins, so a real Docker host is unaffected.
 */
function pointTestcontainersAtPodman(): void {
  if (process.env.DOCKER_HOST) return

  const socket = `/run/user/${String(process.getuid?.() ?? 1000)}/podman/podman.sock`
  if (!existsSync(socket)) return

  process.env.DOCKER_HOST = `unix://${socket}`

  // Ryuk is Testcontainers' cleanup sidecar. It needs to bind-mount the socket
  // into a privileged container, which rootless Podman does not allow. The
  // teardown returned from setup() stops the container anyway, and a container
  // that outlives a crashed run is a `podman rm` rather than a problem.
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true'
}

const OWNER_USER = 'isipheko_owner'
const APP_USER = 'isipheko_app'
const PASSWORD = 'isipheko_local_dev'
const DATABASE = 'isipheko'

const initSql = fileURLToPath(
  new URL('../../prisma/init/01-app-role.sql', import.meta.url),
)

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connects as isipheko_app: INSERT and SELECT, no UPDATE or DELETE on the ledger. */
    appDatabaseUrl: string
    /** Connects as isipheko_owner: owns the schema. Used to arrange fixtures the app role cannot. */
    ownerDatabaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  pointTestcontainersAtPodman()

  const container = await new PostgreSqlContainer('docker.io/library/postgres:16-alpine')
    .withUsername(OWNER_USER)
    .withPassword(PASSWORD)
    .withDatabase(DATABASE)
    .withCopyFilesToContainer([
      {
        source: initSql,
        target: '/docker-entrypoint-initdb.d/01-app-role.sql',
      },
    ])
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(5432)

  const ownerDatabaseUrl = `postgresql://${OWNER_USER}:${PASSWORD}@${host}:${String(port)}/${DATABASE}`
  const appDatabaseUrl = `postgresql://${APP_USER}:${PASSWORD}@${host}:${String(port)}/${DATABASE}`

  // Migrations run as the owner, exactly as they do in deployment. `deploy`
  // rather than `dev`: it applies the committed migrations as written and never
  // offers to reset anything, so the hand-written constraints and grants in
  // 20260807235900_constraints_and_grants are applied verbatim.
  await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: ownerDatabaseUrl,
      MIGRATION_DATABASE_URL: ownerDatabaseUrl,
    },
  })

  project.provide('ownerDatabaseUrl', ownerDatabaseUrl)
  project.provide('appDatabaseUrl', appDatabaseUrl)

  return async () => {
    await container.stop()
  }
}
