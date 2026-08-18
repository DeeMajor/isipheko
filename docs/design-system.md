# Isipheko — Design System

What M1-05 settled: the tokens, the fonts, how an archetype reaches the page, and the six primitives. It will grow — the Ledger Strand, the needs board and the trust panel are not here yet — but everything below is implemented and tested.

Source of truth for values: CLAUDE.md and implementation plan Part C. Source of truth for layout and copy: the reference screens in `design/`. Where those two disagreed, see [decisions](decisions.md) M1-04 §1 and M1-05 §1.

---

## 1. Where things live

```
src/ui/
  tokens.css          the only global stylesheet: tokens, @font-face, focus, reduced motion
  theme.tsx           ArchetypeTheme — the only place --accent is ever set
  primitives/         Button, Card, Field, Select, Sheet, Toast (+ one .module.css each)
public/fonts/         exactly two woff2 files
src/app/dev/tokens/   the tokens page — every primitive in all six themes, 404 in production
```

`src/app/globals.css` holds the reset and nothing else. If you are about to put a colour or a radius in it, it belongs in `tokens.css`.

---

## 2. Tokens

| Token              | Value     | For                                          |
| ------------------ | --------- | -------------------------------------------- |
| `--ink`            | `#16233D` | Body text, and the accent fallback           |
| `--ink-soft`       | `#4A5670` | Help text, metadata, secondary lines         |
| `--paper`          | `#F2F1ED` | Page background                              |
| `--paper-raised`   | `#FFFFFF` | Cards, controls, sheets                      |
| `--rule`           | `#D8D6CE` | Every border in the product                  |
| `--muted-icon`     | `#A8A69E` | Icons only — it does not clear 4.5:1 as text |
| `--radius-control` | `4px`     | Buttons, inputs, selects                     |
| `--radius-card`    | `12px`    | Cards, sheets                                |
| `--hit-area-min`   | `44px`    | The floor for anything tappable              |
| `--control-height` | `48px`    | What controls actually stand at              |

Type scale: `--text-metadata` 13px, `--text-body` 15px, `--text-control` 16px, `--text-title` 17px, `--text-header` 28px. Weights 400 / 500 / 700 / 800.

There is no pill radius token and no shadow token. The product has one elevation and it is a 1px rule.

**Tabular figures** are applied globally to `[data-numeric]`, `<output>`, `<td>`, `<th>` and number inputs, so an amount added later cannot forget them and jitter as it updates.

---

## 3. The accent

**The accent is a CSS fallback, not a conditional** (CLAUDE.md rule 2). Every usage is:

```css
color: var(--accent, #16233d);
```

`ArchetypeTheme` reads `config.accent` and sets `--accent` as an inline custom property. Bereavement declares no accent, so **nothing is set**, and the fallback renders indigo. No code asks whether it is a funeral.

Three things follow, and all three are enforced by tests:

1. **No stylesheet declares `--accent`.** Adding `--accent: #16233D` to `tokens.css` as a "sensible default" looks identical on screen and quietly ends the mechanism — every archetype would then inherit indigo from that file rather than from the absence of a decision, and bereavement would stop being the case that proves it works.
2. **No stylesheet selects on a specific archetype.** `[data-archetype='umngcwabo'] { … }` is an accent map, which duplicates `ArchetypeConfig` and drifts. `data-archetype` is for tests and debugging.
3. **Every `var(--accent…)` carries the `#16233d` fallback.** A bare `var(--accent)` renders nothing at all on a funeral page.

### `--accent-strong`, and why it exists

Two of the six accents cannot carry white text:

| Accent                | Contrast on white | Verdict                             |
| --------------------- | ----------------- | ----------------------------------- |
| Achievement `#C89211` | 2.8:1             | Fails even the 3:1 large-text floor |
| Gathering `#A6742B`   | 4.1:1             | Fails 4.5:1                         |

So `tokens.css` derives one value for the case where the accent sits **behind text**:

```css
[data-archetype] {
  --accent-strong: color-mix(in srgb, var(--accent, #16233d) 60%, #16233d);
}
```

Every accent keeps its hue, stays inside the family palette, and clears 4.5:1. Pure `var(--accent, #16233d)` remains correct everywhere the colour is not behind text — rules, borders, focus rings, beads, marks.

It is declared on `[data-archetype]` rather than `:root` because a custom property resolves where it is declared: in `:root` the inner `var(--accent, …)` would resolve to the fallback before any theme exists, and every archetype would inherit one indigo value.

---

## 4. Fonts

Public Sans variable, self-hosted, **latin + latin-ext only**, `font-weight: 400 800`, no italic face, two files:

| File                          | Bytes  | Fetched                                          |
| ----------------------------- | ------ | ------------------------------------------------ |
| `public-sans-latin.woff2`     | 26 832 | Every page                                       |
| `public-sans-latin-ext.woff2` | 18 472 | Only when the page contains latin-ext characters |

The `unicode-range` on the second face is what makes it lazy: an English page never pays the 18.5KB, an isiZulu or isiXhosa page does.

**Do not add a font URL.** Not Google Fonts, not a CDN, not `next/font` — the design pipeline re-added the Vietnamese subset twice when a URL was involved. The `@font-face` rules are hardcoded in `tokens.css`.

The two binaries are Fontsource `public-sans:vf@5.3.0`. Their SHA-256 hashes are asserted in `tests/unit/tokens.test.ts`: a swapped font binary is otherwise a rendering mystery — different metrics, different subset, no error anywhere.

---

## 5. Focus and motion

```css
:focus-visible {
  outline: 2px solid var(--accent, #16233d);
  outline-offset: 2px;
}
```

Declared once, globally. Never removed on a control — a Playwright test tabs through the tokens page and asserts a 2px solid ring at 2px offset on every control it reaches.

`prefers-reduced-motion: reduce` disables all animation and transition globally. Durations go to `0.01ms` rather than `none` so `transitionend` still fires and anything waiting on it completes rather than hanging.

---

## 6. Primitives

All six are **server components**. None ships client JavaScript.

| Primitive | Element                              | Notes                                                                                       |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `Button`  | `<button>`                           | `primary` / `secondary` / `quiet`; `type="button"` by default                               |
| `Card`    | `<div>`                              | 12px radius, 1px rule; `titleAs` sets the heading level                                     |
| `Field`   | `<label>` + `<input>` / `<textarea>` | `label` and `id` are **required**; wires `aria-describedby`, `aria-invalid`, `role="alert"` |
| `Select`  | native `<select>`                    | Styled, arrow drawn in CSS                                                                  |
| `Sheet`   | native `<dialog>`                    | Presentational; the browser handles focus trap, `Esc`, backdrop                             |
| `Toast`   | `role="status"` / `role="alert"`     | `alert` only for problems                                                                   |

**Why native elements.** The claim flow has to work with JavaScript disabled inside `<form method="post">` (rule 5), and the contributor may be on a borrowed phone with an old browser. A listbox built from divs and a dialog built from a positioned div both lose that.

**Sheet and Toast are presentational.** Opening, dismissing, and the 15-second `Undo` window belong to the flows that use them (M1-07, M2), which have to work without JavaScript. A primitive that assumed a click handler would quietly rule that out.

**Errors are not carried by colour.** Part C.2 defines no error colour, and inventing one would put an untested hue on the most stressful screen in the product. An invalid field is marked by a 2px ink border, bold text, a rule, and `aria-invalid` — colour alone is not a signal a screen reader or a colour-blind reader receives. Copy rules still apply: say what happened and what to do next, never apologise, never be vague.

---

## 7. The tokens page

`/dev/tokens` renders every primitive in all six themes. It answers **404 in production** — a route nobody linked to is still a route somebody can find.

It is also the accessibility gate: `tests/e2e/tokens.spec.ts` runs axe page-wide and once per theme, checks the focus ring, checks that bereavement sets no `style` attribute at all, and checks that every font request is same-origin and one of the two files.

---

## 8. The public event page is rendered differently

`/e/[slug]` is **not** an App Router page. It is a route handler that renders
`src/ui/public-page.tsx` with `renderToStaticMarkup` and inlines the tokens and
its own CSS into the head.

An App Router page for the same content shipped 199KB of first load, 174KB of it
Next's client runtime, against a 150KB ceiling. See decisions M1-08 and
implementation-plan Part G.1 — the measurement is recorded there so nobody
converts it back.

What this means for anything added to that page:

- **No CSS Modules.** Styles go in `src/ui/public-page-css.ts` as a string, and
  the accent rules apply there exactly as they do in a stylesheet — the unit
  test scans it too.
- **No client components, no `<Link>`, no `metadata` export.** The head is
  written by hand in that file.
- **Interactivity is a form.** `<form method="post">` to a route handler or a
  server action. Rule 5 required that anyway.
- **`accentStyle()` from `src/ui/theme.tsx`** sets `--accent`, the same helper
  the App Router pages use. Do not write a second one.

## 9. Adding to this system

- A new colour goes in `tokens.css` as a token, or it does not exist.
- A new primitive is a server component using a native element, with its own `.module.css`, added to the tokens page in the same commit.
- Any accent usage is `var(--accent, #16233d)`, or `var(--accent-strong, #16233d)` if text sits on it.
- User-facing strings do not belong in a primitive. They come from `src/copy/`, keyed by archetype (rule 11).
