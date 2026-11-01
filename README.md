# Nutrition & Wellness Community Platform — Proposal

Client-facing proposal for a subscription membership platform (video programmes,
live broadcasting, member communities, group chat, paid 1-to-1 consultations).

Prepared by [impyre](https://www.impyre.io).

## What's here

| File | What it is |
|---|---|
| `index.html` | The proposal as a bilingual web page (EN / عربي) — this is what the client gets a link to |
| `assets/styles.css` | Design system: impyre typography and chrome, this project's palette |
| `assets/app.js` | Language toggle, scroll progress, reveal animations, print |
| `01-PROPOSAL.md` | The proposal source, English |
| `01-PROPOSAL-AR.md` | The proposal source, Arabic |
| `02-SCOPE-AND-SPECIFICATIONS.md` | **The binding scope** — 13 feature specs, architecture, risk register, 56 decisions |

The page and the two `01-PROPOSAL*.md` files carry the same content. Change one,
change the other.

## Publishing to GitHub Pages

1. Push this folder to a repository.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The link is `https://<owner>.github.io/<repo>/`.

`.nojekyll` is already present so Pages serves the files as-is.

## Notes

- **Language.** The page opens in Arabic for an `ar-*` browser and English otherwise,
  then remembers the reader's choice. The toggle is top-right.
- **Print.** The Print button produces a clean document — page chrome, the timeline
  bar and the animations are stripped, and the dark panels invert to ink-on-white.
- **Content is never JS-dependent.** The reveal animations only apply once a class is
  set from `<head>`; if scripting fails the proposal still renders in full.
- **Figures.** USD governs; KWD is shown at 1 KWD = 3.25 USD.
- **Cache-busting.** `index.html` loads the CSS and JS as `?v=N`. Bump `N` whenever
  you change a file in `assets/`, or readers who already opened the link keep the
  cached version and never see the edit.

## Local preview

```bash
python -m http.server 4173
```

Then open <http://localhost:4173>.
