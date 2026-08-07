import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/db/generated/client'

/**
 * A client bound to a specific role.
 *
 * Integration tests need both: the application role, because that is what the
 * guarantees are about, and the owner role, to arrange fixtures the application
 * role is deliberately unable to create. Passing the connection string
 * explicitly keeps which-role-am-I visible at every call site — the moment that
 * becomes ambient is the moment a test quietly proves nothing.
 */
export function clientFor(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: ['warn', 'error'],
  })
}
