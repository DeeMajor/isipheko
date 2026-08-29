import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

import {
  CONTENT,
  FOLIO_Y,
  MEDIA,
  TRIM,
  fitWithinDpi,
  mm,
  offsetsWithin,
  paginate,
  wrapText,
  type AlbumRenderer,
  type Measured,
  type PrintableAlbum,
  type PrintableEntry,
} from '../../domain/print/index.ts'

import { loadPrintFonts } from './fonts.ts'

/**
 * The album as a print-ready PDF. **The only file that imports `pdf-lib`.**
 *
 * `pdf-lib` is pure JavaScript with no native binary and no browser. The
 * obvious alternative — printing M4-02's HTML through Chromium — was rejected
 * because it writes no TrimBox and no BleedBox and produces RGB with no way to
 * say so, which means it fails the exact criterion it would exist to satisfy;
 * and because a browser binary in production is not a small thing.
 *
 * **RGB throughout, stated in the file's own metadata** (docs/decisions.md
 * M4-03 §4). South African trade printers convert to their own profile, and a
 * naive CMYK build would neither honour `--ink #16233D` — a specific navy — nor
 * survive being set as body text on four plates.
 *
 * **No amount can reach this file.** `PrintableEntry` has no amount field and
 * `PrintableBead` carries a diameter rather than a value, so the number the
 * band was computed from never crosses the boundary. The rule is a property of
 * the types rather than of anybody's care (M4-02 §3).
 */

/* Design tokens, as ink rather than as CSS. Same values as src/ui/tokens.ts. */
const INK = rgb(0x16 / 255, 0x23 / 255, 0x3d / 255)
const INK_SOFT = rgb(0x4a / 255, 0x56 / 255, 0x70 / 255)
const RULE = rgb(0xd8 / 255, 0xd6 / 255, 0xce / 255)
const PAPER = rgb(0xf2 / 255, 0xf1 / 255, 0xed / 255)

/**
 * The archetype accent, or the ink.
 *
 * The print equivalent of `var(--accent, #16233D)` (rule 2): bereavement
 * declares no accent and therefore gets indigo, with nothing here asking what
 * archetype it is. There is no branch on the group and there must not be one.
 */
function accentOf(hex: string | undefined): RGB {
  if (hex === undefined) return INK

  const value = hex.replace('#', '')

  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  )
}

/** Type scale, in points. Larger than the screen's: paper is read further away. */
const SIZE = {
  title: 26,
  kicker: 9,
  intro: 10,
  name: 11,
  meta: 8.5,
  body: 10,
  folio: 8,
} as const

const LEADING = 1.45

/** Between entries. Wide enough that two people do not read as one. */
const ENTRY_GAP = mm(7)

interface Fonts {
  readonly regular: PDFFont
  readonly heavy: PDFFont
}

/** Everything an entry draws, measured before anything is placed. */
interface EntryPlan {
  readonly entry: PrintableEntry
  readonly messageLines: readonly string[]
  readonly memberLines: readonly string[]
  readonly photo: { width: number; height: number } | null
  readonly height: number
}

export class PdfLibAlbumRenderer implements AlbumRenderer {
  async render(album: PrintableAlbum): Promise<Uint8Array> {
    const document = await PDFDocument.create()
    document.registerFontkit(fontkit)

    const faces = await loadPrintFonts()
    const fonts: Fonts = {
      // Subsetted: the file carries the glyphs it uses and not a whole Latin
      // typeface, which is both smaller and what a preflight expects to find.
      regular: await document.embedFont(faces.regular, { subset: true }),
      heavy: await document.embedFont(faces.heavy, { subset: true }),
    }

    this.describe(document, album)

    const accent = accentOf(album.archetype.accent)
    const plans = album.entries.map((entry) => this.plan(entry, fonts))

    const measured: Measured<EntryPlan>[] = plans.map((plan) => ({
      item: plan,
      height: plan.height,
    }))

    const pages = paginate(measured, {
      usableHeight: CONTENT.height,
      gap: ENTRY_GAP,
    })

    // Cover, the entry pages, then the colophon. Counted before anything is
    // drawn, because a folio has to know the total.
    const total = 1 + pages.length + 1

    this.drawCover(document, album, fonts, accent, total)

    let folio = 2
    for (const page of pages) {
      await this.drawEntries(document, page, fonts, folio, total)
      folio += 1
    }

    this.drawColophon(document, album, fonts, folio, total)

    /*
     * The dates are set explicitly in `describe`, from the album's own
     * `generatedAt`, and never from a clock read here.
     *
     * That is what makes the same album render the same bytes twice — which
     * matters because the download's URL is a hash of what the album holds. A
     * file that differed on every generation would be a URL claiming something
     * it could not keep.
     */
    return document.save()
  }

  /**
   * What the file says about itself.
   *
   * A printer opens the properties before they open the artwork. The subject
   * line is where **RGB** is stated, because a colour space discovered at the
   * press is a colour space discovered too late.
   */
  private describe(document: PDFDocument, album: PrintableAlbum): void {
    document.setTitle(album.cover.title)
    document.setSubject(album.colophon.join(' '))
    /*
     * Creator, not Producer.
     *
     * PDF means something specific by each: the Creator is the application the
     * document came from, the Producer is the tool that wrote the PDF. That is
     * Isipheko and pdf-lib respectively, and claiming otherwise would misname
     * the one field a printer uses to work out what made a file when something
     * about it is wrong.
     */
    document.setCreator('Isipheko')
    document.setCreationDate(album.generatedAt)
    document.setModificationDate(album.generatedAt)
  }

  /** A page with its three boxes set. Everything else here draws onto one. */
  private newPage(document: PDFDocument): PDFPage {
    const page = document.addPage([MEDIA.width, MEDIA.height])

    page.setMediaBox(MEDIA.x, MEDIA.y, MEDIA.width, MEDIA.height)
    page.setBleedBox(MEDIA.x, MEDIA.y, MEDIA.width, MEDIA.height)
    page.setTrimBox(TRIM.x, TRIM.y, TRIM.width, TRIM.height)

    // The paper colour, painted to the bleed edge rather than to the trim.
    // A background that stopped at the cut leaves a white hairline the first
    // time a sheet shifts under the blade, which is what bleed is for.
    page.drawRectangle({
      x: MEDIA.x,
      y: MEDIA.y,
      width: MEDIA.width,
      height: MEDIA.height,
      color: PAPER,
    })

    return page
  }

  private measureLines(
    text: string,
    font: PDFFont,
    size: number,
    width: number,
  ): readonly string[] {
    return wrapText(text, width, (run) => font.widthOfTextAtSize(run, size))
  }

  private plan(entry: PrintableEntry, fonts: Fonts): EntryPlan {
    const width = CONTENT.width

    const messageLines =
      entry.message === null
        ? []
        : this.measureLines(entry.message, fonts.regular, SIZE.body, width)

    const memberLines =
      entry.members.length === 0
        ? []
        : this.measureLines(entry.members.join(' · '), fonts.regular, SIZE.meta, width)

    /*
     * The photograph's box, capped so the image is never printed below 300dpi.
     *
     * `fitWithinDpi` shrinks the frame rather than enlarging the picture.
     * Upscaling to fill a frame is how a photograph of a grandmother becomes a
     * soft rectangle, and the frame is the part nobody will miss.
     */
    const photo =
      entry.photo === null
        ? null
        : fitWithinDpi(entry.photo, {
            width,
            // Never more than half a page, so an entry stays an entry rather
            // than becoming a plate with a caption.
            height: CONTENT.height * 0.5,
          })

    const line = (size: number) => size * LEADING

    const height =
      line(SIZE.name) +
      line(SIZE.meta) +
      (messageLines.length === 0 ? 0 : mm(2) + messageLines.length * line(SIZE.body)) +
      (photo === null ? 0 : mm(3) + photo.height) +
      (memberLines.length === 0
        ? 0
        : mm(2) + line(SIZE.meta) + memberLines.length * line(SIZE.meta)) +
      mm(2) +
      line(SIZE.meta)

    return {
      entry,
      messageLines,
      memberLines,
      photo: photo === null ? null : { width: photo.width, height: photo.height },
      height,
    }
  }

  private drawCover(
    document: PDFDocument,
    album: PrintableAlbum,
    fonts: Fonts,
    accent: RGB,
    total: number,
  ): void {
    const page = this.newPage(document)
    const { cover } = album

    /*
     * A band of the archetype's colour across the head of the page, painted
     * **off three edges** — this is the one element that uses the bleed for
     * what bleed is for, and it is why the criterion asks for a bleed box at
     * all rather than a margin.
     */
    page.drawRectangle({
      x: MEDIA.x,
      y: MEDIA.height - mm(38),
      width: MEDIA.width,
      height: mm(38),
      color: accent,
    })

    let y = TRIM.y + TRIM.height - mm(52)

    page.drawText(cover.kicker.toUpperCase(), {
      x: CONTENT.x,
      y,
      size: SIZE.kicker,
      font: fonts.heavy,
      color: accent,
    })

    y -= mm(9)

    for (const line of this.measureLines(
      cover.title,
      fonts.heavy,
      SIZE.title,
      CONTENT.width,
    )) {
      page.drawText(line, {
        x: CONTENT.x,
        y,
        size: SIZE.title,
        font: fonts.heavy,
        color: INK,
      })
      y -= SIZE.title * 1.18
    }

    if (cover.organiserName !== null || cover.meta !== null) {
      y -= mm(4)
      page.drawText(
        [cover.organiserName, cover.meta].filter((part) => part !== null).join(' · '),
        { x: CONTENT.x, y, size: SIZE.meta, font: fonts.regular, color: INK_SOFT },
      )
    }

    y -= mm(8)

    for (const line of this.measureLines(
      cover.intro,
      fonts.regular,
      SIZE.intro,
      CONTENT.width,
    )) {
      page.drawText(line, {
        x: CONTENT.x,
        y,
        size: SIZE.intro,
        font: fonts.regular,
        color: INK_SOFT,
      })
      y -= SIZE.intro * LEADING
    }

    this.drawStrand(page, album, accent, y - mm(10))
    this.drawFolio(page, fonts, 1, total)
  }

  /**
   * The Ledger Strand, drawn as circles.
   *
   * The positions and diameters come from `src/domain/strand/` — the same pure
   * arithmetic the web page uses, so the cover of the book and the cover of the
   * page are the same picture rather than two drawings of one idea.
   *
   * Cash beads are solid, in-kind beads are ringed with a centre bar, group
   * beads are ringed. Equal visual mass, differing by form and not by
   * prominence (Part C.4).
   */
  private drawStrand(
    page: PDFPage,
    album: PrintableAlbum,
    accent: RGB,
    top: number,
  ): void {
    const centre = TRIM.x + TRIM.width / 2

    for (const bead of album.cover.beads) {
      const x = centre + bead.x
      const y = top - bead.y
      const radius = bead.diameter / 2

      if (bead.form === 'cash') {
        page.drawCircle({ x, y, size: radius, color: accent })
        continue
      }

      page.drawCircle({
        x,
        y,
        size: radius,
        borderColor: accent,
        borderWidth: Math.max(0.6, radius * 0.28),
      })

      if (bead.form === 'in_kind') {
        page.drawRectangle({
          x: x - radius * 0.55,
          y: y - radius * 0.11,
          width: radius * 1.1,
          height: radius * 0.22,
          color: accent,
        })
      }
    }
  }

  private async drawEntries(
    document: PDFDocument,
    plans: readonly EntryPlan[],
    fonts: Fonts,
    folio: number,
    total: number,
  ): Promise<void> {
    const page = this.newPage(document)
    const top = CONTENT.y + CONTENT.height

    const offsets = offsetsWithin(plans, (plan) => plan.height, ENTRY_GAP)

    for (const [index, plan] of plans.entries()) {
      let y = top - (offsets[index] ?? 0)

      page.drawText(plan.entry.name, {
        x: CONTENT.x,
        y: y - SIZE.name,
        size: SIZE.name,
        font: fonts.heavy,
        color: INK,
      })
      y -= SIZE.name * LEADING

      page.drawText(plan.entry.what, {
        x: CONTENT.x,
        y: y - SIZE.meta,
        size: SIZE.meta,
        font: fonts.regular,
        color: INK_SOFT,
      })
      y -= SIZE.meta * LEADING

      if (plan.messageLines.length > 0) {
        y -= mm(2)
        for (const line of plan.messageLines) {
          page.drawText(line, {
            x: CONTENT.x,
            y: y - SIZE.body,
            size: SIZE.body,
            font: fonts.regular,
            color: INK,
          })
          y -= SIZE.body * LEADING
        }
      }

      if (plan.photo !== null && plan.entry.photo !== null) {
        y -= mm(3)
        const image = await document.embedJpg(plan.entry.photo.jpeg)

        page.drawImage(image, {
          x: CONTENT.x,
          y: y - plan.photo.height,
          width: plan.photo.width,
          height: plan.photo.height,
        })
        page.drawRectangle({
          x: CONTENT.x,
          y: y - plan.photo.height,
          width: plan.photo.width,
          height: plan.photo.height,
          borderColor: RULE,
          borderWidth: 0.5,
        })
        y -= plan.photo.height
      }

      if (plan.memberLines.length > 0) {
        y -= mm(2)

        if (plan.entry.membersLabel !== null) {
          page.drawText(plan.entry.membersLabel, {
            x: CONTENT.x,
            y: y - SIZE.meta,
            size: SIZE.meta,
            font: fonts.heavy,
            color: INK,
          })
          y -= SIZE.meta * LEADING
        }

        for (const line of plan.memberLines) {
          page.drawText(line, {
            x: CONTENT.x,
            y: y - SIZE.meta,
            size: SIZE.meta,
            font: fonts.regular,
            color: INK_SOFT,
          })
          y -= SIZE.meta * LEADING
        }
      }

      y -= mm(2)
      page.drawText(plan.entry.when, {
        x: CONTENT.x,
        y: y - SIZE.meta,
        size: SIZE.meta,
        font: fonts.regular,
        color: INK_SOFT,
      })

      // A hairline under every entry but the last on the page: the same rule
      // the web album draws, and what stops two people running together.
      if (index < plans.length - 1) {
        const rule = top - (offsets[index] ?? 0) - plan.height - ENTRY_GAP / 2

        page.drawRectangle({
          x: CONTENT.x,
          y: rule,
          width: CONTENT.width,
          height: 0.5,
          color: RULE,
        })
      }
    }

    this.drawFolio(page, fonts, folio, total)
  }

  /**
   * The colophon: what this is, and what a printer needs to know about it.
   *
   * Chiefly that it is RGB. A colour space discovered at the press is a colour
   * space discovered too late, and the metadata alone is not read by everyone.
   */
  private drawColophon(
    document: PDFDocument,
    album: PrintableAlbum,
    fonts: Fonts,
    folio: number,
    total: number,
  ): void {
    const page = this.newPage(document)
    let y = CONTENT.y + CONTENT.height - mm(20)

    for (const paragraph of album.colophon) {
      for (const line of this.measureLines(
        paragraph,
        fonts.regular,
        SIZE.meta,
        CONTENT.width,
      )) {
        page.drawText(line, {
          x: CONTENT.x,
          y,
          size: SIZE.meta,
          font: fonts.regular,
          color: INK_SOFT,
        })
        y -= SIZE.meta * LEADING
      }

      y -= mm(4)
    }

    this.drawFolio(page, fonts, folio, total)
  }

  /**
   * `3 / 12`.
   *
   * A count of **pages**, not of people. The no-count rule exists so that a
   * family is not ranked and amounts cannot be reverse-engineered (Part C.4,
   * M4-02 §3); a folio touches neither, and a printed record without one is one
   * nobody can reassemble after it is dropped.
   */
  private drawFolio(page: PDFPage, fonts: Fonts, folio: number, total: number): void {
    const label = `${String(folio)} / ${String(total)}`
    const width = fonts.regular.widthOfTextAtSize(label, SIZE.folio)

    page.drawText(label, {
      x: TRIM.x + (TRIM.width - width) / 2,
      y: FOLIO_Y,
      size: SIZE.folio,
      font: fonts.regular,
      color: INK_SOFT,
    })
  }
}
