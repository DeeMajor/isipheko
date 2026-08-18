/**
 * The album's critical CSS, inlined into the document.
 *
 * Same posture as the public event page: this file *is* the stylesheet, there
 * is no CSS Module and no build step between it and the browser, because the
 * page is rendered with `renderToStaticMarkup` from a route handler.
 *
 * Every accent usage is `var(--accent, #16233d)`. A bereavement album declares
 * no accent and renders indigo with nothing asking what archetype it is
 * (rule 2). **Nothing in here moves**, at any archetype: the strand's one
 * settling bead belongs to a live page where something has just arrived, and a
 * record is not a live page.
 */
export const ALBUM_CSS = String.raw`
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: 1.55;
  -webkit-text-size-adjust: 100%;
}

.album {
  max-width: 46rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-6);
}

/* ---- the cover ------------------------------------------------------ */

.cover {
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--rule);
}

.coverLabel {
  margin: 0;
  font-size: var(--text-metadata);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent, #16233d);
}

.coverTitle {
  margin: var(--space-2) 0 0;
  font-size: var(--text-header);
  line-height: 1.12;
  font-weight: 800;
  letter-spacing: -0.03em;
  text-wrap: pretty;
}

.coverMeta {
  margin: var(--space-2) 0 0;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

.coverIntro {
  margin: var(--space-3) 0 0;
  max-width: 62ch;
  color: var(--ink-soft);
  text-wrap: pretty;
}

/* ---- the entries ---------------------------------------------------- */

.entriesHeading {
  margin: var(--space-6) 0 0;
  font-size: var(--text-title);
  font-weight: 800;
  letter-spacing: -0.02em;
}

.entries {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
}

.entry {
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--rule);
  /*
   * The anchor target for a bead on the cover. Without this an entry lands
   * flush against the top edge of the viewport, under nothing, and the reader
   * cannot tell they have arrived somewhere.
   */
  scroll-margin-top: var(--space-4);
}

.entryName {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--ink);
}

.entryWhat {
  margin: 2px 0 0;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

.entryMessage {
  margin: var(--space-3) 0 0;
  max-width: 60ch;
  color: var(--ink);
  text-wrap: pretty;
}

.entryWhen {
  margin: var(--space-3) 0 0;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

/* ---- photos --------------------------------------------------------- */

.entryPhoto {
  display: block;
  margin: var(--space-3) 0 0;
  width: 100%;
  height: auto;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--paper-raised);
}

/*
 * A photo stored before the dimensions were (M4-02 §1).
 *
 * The width and height attributes reserve the right box for everything written
 * since. Where they are absent the box is reserved at 4:3 and the photo is
 * **contained** inside it rather than cropped — a letterbox is a smaller wrong
 * than cutting the top off a gravestone to make it fit.
 */
.entryPhoto[data-unsized] {
  aspect-ratio: 4 / 3;
  object-fit: contain;
}

/* ---- group members -------------------------------------------------- */

.entryMembersLabel {
  margin: var(--space-3) 0 0;
  font-size: var(--text-metadata);
  font-weight: 700;
  color: var(--ink);
}

.entryMembers {
  margin: var(--space-1) 0 0;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
  text-wrap: pretty;
}

/* ---- foot ----------------------------------------------------------- */

.albumFoot {
  margin: var(--space-6) 0 0;
  padding-top: var(--space-4);
  border-top: 1px solid var(--rule);
  max-width: 62ch;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
  text-wrap: pretty;
}

/* Focus is the same everywhere in the product. */
a:focus-visible {
  outline: 2px solid var(--accent, #16233d);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
`
