import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { homeCopy } from '@/copy/home'

/**
 * Nothing falls through to the catch-all 404 (M1-09).
 *
 * `src/app/[...path]/route.tsx` matches every address, and is only correct
 * because Next resolves more specific segments first: `/check` wins on a literal
 * segment, `/e/[slug]` wins on a shorter and more specific dynamic one. **That
 * is a framework guarantee this product depends on rather than one it
 * enforces**, and the failure mode if it ever changes is silent — every umcimbi
 * in existence answering "there is nothing at this address" with a 404, which
 * looks exactly like the scam the page is warning about.
 *
 * So every route is walked and asserted not to have fallen through, and the
 * list is checked against the filesystem so that adding a route without adding
 * it here fails rather than going unwatched.
 *
 * A route answering 404 is fine and expected — an unknown slug is a 404. What
 * must not happen is a route answering **this** 404.
 */

const CATCH_ALL = homeCopy.notFound.title

/**
 * Which handler answered, read from the document title.
 *
 * Not from the body: **every App Router page embeds its `not-found` boundary in
 * the RSC flight payload**, so `homeCopy.notFound.title` appears in the source
 * of `/sign-in` and every other page whether or not it was rendered. Found by
 * writing the naive version of this test and watching `/sign-in` fail while
 * plainly serving the sign-in form.
 *
 * The title is what the browser shows and what a person would see.
 */
const titleOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? ''

/**
 * Every address a request can arrive at, with a value for each parameter.
 *
 * The values are deliberately ones nothing exists for: what is being tested is
 * which handler answered, not what it found. A route that resolves correctly
 * and then says it has nothing has still resolved correctly.
 */
const ROUTES = [
  '/',
  '/check',
  '/check?code=MTH-4K7B2X',
  '/report',
  '/sign-in',
  '/account',
  '/verify',
  '/create',
  '/create/details',
  '/create/aaaaaaaaaaaaaaaa/details',
  '/create/aaaaaaaaaaaaaaaa/needs',
  '/create/aaaaaaaaaaaaaaaa/witnesses',
  '/create/aaaaaaaaaaaaaaaa/verify',
  '/create/aaaaaaaaaaaaaaaa/share',
  '/manage/aaaaaaaaaaaaaaaa',
  '/collections/new',
  '/collections/aaaaaaaaaaaaaaaa',
  '/review',
  '/review/aaaaaaaaaaaaaaaa',
  '/e/NoSuchEventSlug01',
  '/e/NoSuchEventSlug01/contribute',
  '/e/NoSuchEventSlug01/album',
  '/e/NoSuchEventSlug01/album/1.pdf',
  '/e/NoSuchEventSlug01/og/1.png',
  '/e/NoSuchEventSlug01/photo/00112233445566778899aabbccddeeff-thumb.avif',
  '/c/NoSuchCollection1',
  '/c/NoSuchCollection1/join',
  '/c/NoSuchCollection1/incwadi',
  '/h/nosuchtoken',
  '/k/nosuchtoken',
  '/w/nosuchtoken',
] as const

test('every route resolves to its own handler, not to the catch-all', async ({
  request,
}) => {
  for (const path of ROUTES) {
    const response = await request.get(path, { maxRedirects: 0 })
    const status = response.status()

    // A redirect to /sign-in is a route that resolved and refused. The catch-all
    // redirects nowhere, so there is no body to read on these.
    if (status >= 300 && status < 400) continue

    expect(
      titleOf(await response.text()),
      `${path} fell through to the catch-all`,
    ).not.toContain(CATCH_ALL)
  }
})

test('an address nobody issued gets the catch-all, with somewhere to go', async ({
  request,
}) => {
  const response = await request.get('/nothing-is-here', { maxRedirects: 0 })
  const body = await response.text()

  expect(response.status()).toBe(404)
  expect(titleOf(body)).toContain(CATCH_ALL)
  expect(body).toContain(CATCH_ALL)

  // A link that resolves to nothing is the scam case (M3-06), so this is the
  // one 404 in the product with somewhere to send people.
  expect(body).toContain('href="/check"')
  expect(body).toContain('href="/report"')

  // And it is the reason this is a route handler rather than not-found.tsx:
  // that one renders as a page and brings ~174KB of client runtime with it,
  // over rule 9's ceiling, on the screen for somebody on a prepaid bundle
  // holding a link they do not trust.
  expect(body).not.toContain('<script')
})

test('a deep unmatched address gets it too, not just a single segment', async ({
  request,
}) => {
  // The catch-all matches one segment or ten. A forged link is more likely to
  // be long than short.
  const response = await request.get('/e/../../etc/passwd/and/more', {
    maxRedirects: 0,
  })

  expect([404, 400]).toContain(response.status())
})

test('the route list covers every route on disk', () => {
  /*
   * The list above is hand-written, so this is what stops it going stale: every
   * `route.ts(x)` and `page.tsx` under `src/app/` has to be represented, or a
   * route added later is a route nothing checks for fall-through.
   *
   * `/api` and `/dev` are excluded deliberately. The API routes are POST-only
   * and answer 405 to the GET this walk makes; the `/dev` routes 404 in
   * production by design (M5-01 §11) and are not addresses anybody arrives at.
   */
  const root = fileURLToPath(new URL('../../src/app', import.meta.url))

  const segments = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(route|page)\.tsx?$/.test(entry.name))
    .map((entry) =>
      entry.parentPath
        .slice(root.length)
        .replace(/\/\([^)]+\)/g, '')
        .replace(/\[\.\.\.[^\]]+\]/g, '*'),
    )
    .filter((path) => !path.startsWith('/api') && !path.startsWith('/dev'))
    .filter((path) => path !== '/*')

  // Not vacuous: if the filtering above ever drops everything, this test would
  // pass while checking nothing.
  expect(segments.length).toBeGreaterThanOrEqual(25)

  // Every filesystem route, with its parameters replaced, must appear in the
  // walk above.
  const walked = ROUTES.map((path) =>
    path
      .replace(/\?.*$/, '')
      .split('/')
      .map((part) =>
        /^(NoSuch|aaaaaaaa|nosuchtoken|00112233)/.test(part) ||
        /^\d+\.(pdf|png)$/.test(part)
          ? 'PARAM'
          : part,
      )
      .join('/'),
  )

  for (const segment of segments) {
    const shape = segment.replace(/\[[^\]]+\]/g, 'PARAM')
    expect(walked, `${segment} is not in the route walk`).toContain(
      shape === '' ? '/' : shape,
    )
  }
})
