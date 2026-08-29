import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import NotFound from '@/app/not-found'
import { homeCopy } from '@/copy/home'
import { HomePage } from '@/ui/home-page'
import { DEFAULT_DESTINATION, signInDestination } from '@/app/(auth)/sign-in/destination'

/**
 * The front page (M1-09), and the 404 beside it.
 *
 * `src/app/page.tsx` rendered `<main>Isipheko</main>` and carried a comment
 * saying not to grow it. Somebody typing the domain landed on the word and
 * nothing else — on **the only screen in the product a stranger reaches without
 * a link**, and the one screen the product did not have.
 */

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

const withoutStyles = (markup: string) => markup.replace(/<style[\s\S]*?<\/style>/g, '')

/** A comment explaining an absence is not the absence (M3-08 §2's discipline). */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const home = () => withoutStyles(renderToStaticMarkup(<HomePage />))

describe('what the front page has to say', () => {
  it('explains the custom before it explains the product', () => {
    // *Isipheko* is from *ukupheka*, to cook. Somebody who has never heard of us
    // must finish this page knowing that bringing a thing counts the same as
    // sending an amount, because that is what separates this from a donation
    // page — and it is the reason the word is the name.
    const markup = home()

    expect(markup).toContain('ukupheka')
    expect(markup).toContain('umcimbi')
    expect(markup).toContain('Money, or a tent, or the chairs, or the meat')
  })

  it('offers both ways to start, with the umcimbi first', () => {
    const markup = home()

    const event = markup.indexOf(homeCopy.start.event.action)
    const collection = markup.indexOf(homeCopy.start.collection.action)

    expect(event).toBeGreaterThan(-1)
    expect(collection).toBeGreaterThan(event)
  })

  it('says who holds the money, and gives the two different answers', () => {
    /*
     * A front page implying custody we do not have would be the one dishonest
     * thing in the product. The two answers are genuinely different and the page
     * gives both rather than their reassuring average: on an umcimbi the money
     * reaches the family's own account, and on a collection it goes to the
     * organiser and never touches us at all (rules 12 and 16).
     */
    expect(homeCopy.start.event.body).toContain('Isipheko never holds them')
    expect(homeCopy.start.collection.body).toContain('never receives it')
    expect(homeCopy.start.collection.body).toContain('cannot pass it on for you')
  })

  it('routes somebody who distrusts a link to /check, by its literal address', () => {
    // The second visitor, and the reason this page is load-bearing: somebody
    // who was sent a link they do not trust and correctly refuses to use a
    // number on it (M3-04). Labelled with the address, so the label teaches the
    // shape of the real one.
    const markup = home()

    expect(markup).toContain('href="/check"')
    expect(markup).toContain('>isipheko.co.za/check</a>')
    expect(markup).toContain('href="/report"')
    expect(markup).toContain('>isipheko.co.za/report</a>')
  })

  it('says both routes in start with a phone number, before the tap', () => {
    // The difference between a step somebody expected and a phone-number field
    // that appears out of nowhere.
    expect(home()).toContain('phone number and a code')
  })
})

describe('what the front page may not contain', () => {
  it('shows no total, no count and no progress', () => {
    /*
     * Rule 1, one level up from where it is enforced. A funeral is one of the
     * six archetypes and this is the door people arrive from one through, so
     * *"R2.4m raised"* above a link to a page about a death is the failure the
     * rule exists to prevent — and the archetype guards cannot catch it here,
     * because this page has no archetype.
     */
    const markup = home()

    expect(markup).not.toMatch(/R\s?\d/)
    expect(markup).not.toMatch(/\d+\s+(families|imicimbi|events|people have)/i)
    expect(markup.toLowerCase()).not.toContain('progress')
    expect(markup).not.toMatch(/<progress|raised so far|goal|target/i)
  })

  it('declares no accent, so the fallback indigo renders', () => {
    // Rule 2, and this is the cleanest demonstration of it in the product: the
    // page belongs to no ceremony, sets nothing, and is correct.
    //
    // Styles stripped: the shared stylesheet is full of `var(--accent, …)` and
    // of the `[data-archetype]` rules that set it. What matters is that the
    // markup declares neither, so the fallback is what renders.
    const markup = home()

    expect(markup).not.toContain('data-archetype')
    expect(markup).not.toMatch(/--accent/)
  })

  it('ships no script and builds its own document', () => {
    /*
     * Part G.1: an App Router page with zero client components still ships
     * ~174KB of React and the router, and this is a public path under rule 9's
     * ceiling. `pnpm gate:size` measures the served page; this catches the
     * conversion at the source, where somebody would make it.
     */
    const markup = renderToStaticMarkup(<HomePage />)

    expect(markup).not.toContain('<script')
    expect(markup).toContain('<html lang="en-ZA">')
    expect(source('src/app/route.tsx')).toContain('renderToStaticMarkup')
  })

  it('is the one public route without noindex, and says why', () => {
    /*
     * Architecture §10 keeps event and collection pages out of search because a
     * death in the family must not be findable on Google. That is about pages
     * naming a family; this one names nobody, and a front door nobody can find
     * is not a front door.
     *
     * Asserted here and again in `pnpm gate:size` against the real response,
     * both ways round — a later blanket header is exactly how this breaks.
     */
    // Comments stripped, because this file explains the absence at length and
    // an explanation must not satisfy the assertion it explains.
    const route = withoutComments(source('src/app/route.tsx'))

    expect(route).not.toContain('x-robots-tag')
    expect(source('src/app/route.tsx')).toContain('noindex')
    expect(withoutComments(source('src/app/(public)/check/route.tsx'))).toContain(
      "'x-robots-tag'",
    )
  })
})

describe('the 404', () => {
  it('exists at all', () => {
    // There was none. An address nobody issued produced the framework's default
    // page, which explains nothing and offers nowhere to go.
    expect(() => source('src/app/not-found.tsx')).not.toThrow()
  })

  it('sends somebody holding a bad link to /check and /report', () => {
    // A link that resolves to nothing is the scam case — it is exactly what
    // somebody holding a forged link finds (M3-06).
    const markup = renderToStaticMarkup(<NotFound />)

    expect(markup).toContain('href="/check"')
    expect(markup).toContain('href="/report"')
    expect(markup).toContain(homeCopy.notFound.title)
  })

  it('does not say the family may not have shared it yet', () => {
    /*
     * `NotFoundPage` in `public-page.tsx` says that, and is right to: it answers
     * about a specific umcimbi whose slug may simply not be public. This one
     * answers about an address that has never existed, and borrowing that
     * sentence would tell somebody holding a forgery to go and wait.
     */
    const markup = renderToStaticMarkup(<NotFound />)

    expect(markup).not.toContain('may not have shared it yet')
    expect(homeCopy.notFound.body).toContain('has ever been at this address')
  })
})

describe('where signing in sends somebody', () => {
  it('carries the destination from the front page through both steps', () => {
    const markup = home()

    expect(markup).toContain('href="/sign-in?next=%2Fcreate"')
    expect(markup).toContain('href="/sign-in?next=%2Fcollections%2Fnew"')

    // The forms post to server actions, which never see the query string — so
    // the value travels as a hidden field on both steps or it is lost between
    // the number and the code.
    expect(source('src/app/(auth)/sign-in/page.tsx')).toContain(
      '<input type="hidden" name="next"',
    )
  })

  it('accepts only destinations that exist, and defaults everything else', () => {
    expect(signInDestination('/create')).toBe('/create')
    expect(signInDestination('/collections/new')).toBe('/collections/new')
    expect(signInDestination(undefined)).toBe(DEFAULT_DESTINATION)
  })

  it('cannot be made to redirect anywhere off this origin', () => {
    /*
     * The mutation check for this task's guard. An allowlist rather than a
     * validated path, because every open redirect ever shipped passed a check
     * that the value started with a slash — and there are four places a sign-in
     * can usefully end, all known at build time.
     */
    for (const hostile of [
      'https://isipheko.co.za.evil.example/create',
      '//evil.example',
      '/\\evil.example',
      '/create/../../evil',
      '/create?x=1',
      'javascript:alert(1)',
      '/create ',
      '',
    ]) {
      expect(signInDestination(hostile), hostile).toBe(DEFAULT_DESTINATION)
    }
  })
})
