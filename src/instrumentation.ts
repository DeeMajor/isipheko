/**
 * Next.js calls register() once, at server start, before the first request is
 * served. Importing the env module here is what turns a missing variable into
 * a refusal to start rather than a 500 on someone's contribution page.
 */
export async function register() {
  await import('@/lib/env')
}
