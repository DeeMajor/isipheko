import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { contributeCopy } from '@/copy/contribute'
import { ARCHETYPES } from '@/domain/archetype'
import type { ContributionRoute, Visibility } from '@/domain/contribution'
import { ContributePage } from '@/ui/contribute-page'

/**
 * Where the photo field appears, and where it deliberately does not.
 *
 * The row a photo attaches to is created at the pay step, so a route with no
 * pay step has nothing to attach one to. "Bring something" is that route — it
 * reserves through the claim path M2-04 already built — and offering a file
 * field there would take somebody's photo, store it, and lose it.
 */

function whoStep({
  route = 'money',
  carried = {},
  photoDigest,
}: {
  route?: ContributionRoute
  carried?: Record<string, string>
  photoDigest?: string
} = {}): string {
  return renderToStaticMarkup(
    <ContributePage
      slug="AbCdEf0123456789"
      eventTitle="Nokuthula Mthembu"
      organiserName="Nomsa Mthembu"
      archetype={ARCHETYPES.umngcwabo}
      route={route}
      step="who"
      amountsPublic={false}
      carried={carried}
      needs={[]}
      payDetails={{ phone: '082 123 4567', name: 'Nomsa Mthembu' }}
      mode="ledger_only"
      defaultVisibility="name_only"
      photoDigest={photoDigest}
    />,
  )
}

describe('the photo field on the who step', () => {
  it('is offered on the routes that create a contribution', () => {
    for (const route of ['money', 'earmark'] as const) {
      const markup = whoStep({ route })

      expect(markup).toContain('name="photo"')
      expect(markup).toContain('multipart/form-data')
    }
  })

  it('is not offered on "bring something", which creates no row to hold it', () => {
    const markup = whoStep({ route: 'item' })

    expect(markup).not.toContain('name="photo"')
    expect(markup).not.toContain(contributeCopy.who.photoLabel)
  })

  /**
   * Rule: security copy explains what it protects, never just what it blocks.
   * The thing protected is an address — a phone writes the place a photo was
   * taken inside the file, and on a funeral that place is the family's house.
   */
  it('says what is taken out of the photo, before anything is chosen', () => {
    const markup = whoStep()

    expect(markup).toContain('Phones save the place a photo was taken')
    expect(markup).toContain('never carries the family')
  })

  it('offers a way back out once one is attached', () => {
    const markup = whoStep({ photoDigest: 'a'.repeat(32) })

    expect(markup).toContain('name="removePhoto"')
    expect(markup).toContain(contributeCopy.who.photoRemove)
    // And says the thing the visibility control cannot: the photo shows either
    // way. It states the fact and leaves the choice alone — it is her photo.
    expect(markup).toContain('Your photo shows on the page whichever of these')
  })

  /**
   * A field rendered hidden *and* visible on the same form is sent twice, and
   * `FormData.get` returns the first — so the stale hidden copy wins and an edit
   * is silently dropped. Latent since M2-05; it matters now that a rejected
   * photo bounces somebody back to this step with everything else filled in.
   */
  it('repopulates what was typed rather than carrying a stale hidden copy', () => {
    const markup = whoStep({
      carried: { name: 'Thandi Ngcobo', message: 'Sisemuva kwenu.', amount: 'R450,00' },
    })

    expect(markup).not.toContain('<input type="hidden" name="name"')
    expect(markup).not.toContain('<input type="hidden" name="message"')
    expect(markup).toContain('value="Thandi Ngcobo"')
    expect(markup).toContain('value="Sisemuva kwenu."')
    // The amount has no input on this step, so it does travel hidden.
    expect(markup).toContain('<input type="hidden" name="amount" value="R450,00"/>')
  })
})

describe('the done step', () => {
  function doneStep(photoDigest?: string, visibility?: Visibility): string {
    return renderToStaticMarkup(
      <ContributePage
        slug="AbCdEf0123456789"
        eventTitle="Nokuthula Mthembu"
        organiserName="Nomsa Mthembu"
        archetype={ARCHETYPES.umngcwabo}
        route="money"
        step="done"
        amountsPublic={false}
        carried={{}}
        needs={[]}
        mode="ledger_only"
      defaultVisibility="name_only"
        photoDigest={photoDigest}
        visibility={visibility}
      />,
    )
  }

  it('shows AVIF with a WebP fallback, chosen by the markup', () => {
    const digest = 'b'.repeat(32)
    const markup = doneStep(digest)

    expect(markup).toContain(`<source srcSet="/e/AbCdEf0123456789/photo/${digest}-thumb.avif" type="image/avif"/>`)
    expect(markup).toContain(`src="/e/AbCdEf0123456789/photo/${digest}-thumb.webp"`)
  })

  it('says plainly when the photo and "quietly" disagree', () => {
    expect(doneStep('c'.repeat(32), 'anonymous')).toContain(
      contributeCopy.done.photoAnonymous,
    )
    expect(doneStep('c'.repeat(32), 'public')).not.toContain(
      contributeCopy.done.photoAnonymous,
    )
  })

  it('says nothing about a photo when there is none', () => {
    const markup = doneStep()

    expect(markup).not.toContain('<picture>')
    expect(markup).not.toContain(contributeCopy.done.photoCaption)
  })
})
