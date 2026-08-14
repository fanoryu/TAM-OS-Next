# TAM OS — Brand Guidelines

This Markdown file is the **canonical, authoritative** brand reference (BRAND-1). The
[`TAM-OS-Brand-Guidelines.pdf`](TAM-OS-Brand-Guidelines.pdf) in this folder is retained as a
**historical/exported** reference from the pre-BRAND-1 identity; where the two differ, **this
Markdown file wins**. A refreshed PDF should be exported from this document, not edited directly.

> **Use the supplied symbol artwork only.** Never recolor, recreate, stretch, rotate, or
> substitute the TAM monogram/symbol. The **wordmark**, by contrast, is now set live in the
> approved display typeface (below) rather than shipped as fixed artwork.

## Product vs. company naming

- **`TAM OS`** is the product identity. It is the only name shown in the **persistent application
  chrome** (sidebar/header brand lockup).
- **`PT Total Asset Manajemen`** is the company/legal identity. It appears where company
  identification is formal or contextual — About, Settings (company field), reports/exports, and
  organizational copy — **not** repeated in persistent product chrome.
- Capitalization: the product is `TAM OS` (all caps, single space). The company is
  `PT Total Asset Manajemen` in prose; `PT TOTAL ASSET MANAJEMEN` only where a historical record
  already used that form (history is never rewritten).

## Identity architecture

- **Primary lockup (app chrome):** TAM monogram + `TAM OS` wordmark, side by side.
- **Compact/collapsed:** TAM monogram only (the collapsed sidebar rail); the wordmark text is
  visually hidden but kept for assistive technology.
- **Formal/company:** `TAM OS` with `PT Total Asset Manajemen` beneath, in About/legal contexts.
- Do **not** imitate, trace, or reconstruct the Instagram (or any third-party) wordmark. The TAM OS
  wordmark is its own identity.

## Logo assets (official, in this folder)

| File | Role | Use on |
|---|---|---|
| `tam-os-logo-full-color.png` | **Primary** wordmark (Navy · Blue · Teal) | light / white backgrounds |
| `tam-os-logo-very-light.png` | Primary wordmark, full color | very light color backgrounds |
| `tam-os-logo-dark-navy.png` | Wordmark, white | dark navy backgrounds |
| `tam-os-logo-black-background.png` | Wordmark, white | black backgrounds |
| `tam-os-logo-secondary.png` | **Secondary** monogram (TAM mark) | favicon, app icon, avatar, watermark, compact navigation |
| `tam-os-favicon-64.png` | Browser-tab favicon, **resized-only** from the secondary monogram (64×64) | inline `data:` URI in `index.html` (portable-safe); provenance copy |

Default signature for websites, presentations, reports, GitHub, and formal
communication is the **primary** wordmark. Where space is limited, switch to the
**secondary** monogram.

## Color palette

### Identity palette (product identity only)

| Token | Hex | RGB | Role |
|---|---|---|---|
| TAM Navy | `#062E5B` | 6 46 91 | Primary wordmark / authority |
| TAM Blue | `#1478F2` | 20 120 242 | Progress / digital emphasis |
| TAM Teal | `#08B9B0` | 8 185 176 | Growth / operations; the wordmark **`OS`** reads teal |
| Ink | `#102A43` | 16 42 67 | Body text / UI |
| Cloud | `#F4F8FC` | 244 248 252 | Background / panels |

In the application these are exposed as `--identity-navy`, `--identity-blue`, `--identity-teal`.
On **light** backgrounds the wordmark teal is darkened (`#0A857E`) so the `OS` mark meets WCAG
large-text contrast (≥3:1) while staying unmistakably teal; the **dark** theme uses the exact
`#08B9B0`. **Do not introduce additional hues into the official mark.**

### Semantic UI accent (not part of the identity)

The application UI uses a **gold** accent (`--brand` / `--accent`: `#C9A15C` dark, `#9C6B1E` light)
for semantic meaning — the *Planned* status, the *Gaji*/payroll category, and the *Actual* chart
series. This gold is **not** part of the product identity and must **not** be used for the wordmark.
Identity (Navy/Blue/Teal) and semantic UI (gold) are deliberately separate systems.

## Background rules

| Background | Logo variant |
|---|---|
| Light / white | full color (`tam-os-logo-full-color.png`) |
| Very light color | black or full color (`tam-os-logo-very-light.png`) |
| Dark navy | white (`tam-os-logo-dark-navy.png`) |
| Black | white (`tam-os-logo-black-background.png`) |

Avoid busy photography, low contrast, gradients behind the mark, or colors that
visually collide with the blue-teal identity.

## Minimum size

| Variant | Digital | Print |
|---|---|---|
| Primary wordmark | 160 px wide | 35 mm wide |
| Secondary monogram | 32 px wide | 10 mm wide |

Do not reproduce below these sizes. If the primary wordmark becomes hard to read,
switch to the secondary monogram.

## Safe area

Keep clear space of at least **1X** on every side, where **X = the cap height of the
letter “O”** in the wordmark. No text, edge, image, or interface element may enter this
zone.

## Typography

- **Display / wordmark typeface:** **Sora SemiBold (600)** — geometric, modern, distinctive. Used
  **only** for the `TAM OS` wordmark (`--display`), never for general UI text.
- **UI / body typeface:** **Inter** (`--sans`) — neutral, compact, legible, for all application
  content: navigation, tables, forms, KPIs.
- **Supporting faces:** Source Serif 4 (`--serif`, one monthly-header use) and JetBrains Mono
  (`--mono`, code/contract-progress). **System fallback:** `-apple-system` / sans-serif.
- **Hierarchy:** Display 32–48 px / SemiBold · Heading 20–28 px / Bold · Subheading
  14–18 px / SemiBold · Body 10–16 px / Regular · Caption 8–12 px / Medium.

### Offline / embedded-font requirement (MUST)

All faces are **embedded locally** as base64 WOFF2 in [`css/fonts.css`](../../css/fonts.css)
(Latin subset). The application makes **no request to `fonts.googleapis.com` or
`fonts.gstatic.com`** and renders its intended typography under genuine offline `file://`. Any new
face must be embedded the same way — never linked from a CDN.

### Font licensing (MUST)

Every embedded face is **SIL Open Font License 1.1**, which permits redistribution, subsetting, and
embedding. The license texts are retained beside the fonts in
[`assets/fonts/`](../fonts/) (`*-OFL.txt`). No font may be added without verifying its license
permits redistribution/embedding and retaining that license text in the repository.

### Prohibited treatments

Do not stretch, recolor, or rotate the symbol; do not place the mark on low-contrast backgrounds;
do not set the wordmark in gold; do not imitate, trace, or reconstruct the Instagram (or any
third-party) wordmark; do not link fonts from a remote CDN.

## Correct / incorrect usage

- **Correct:** full color on white; white on dark; secondary monogram at compact size.
- **Incorrect:** do not stretch; do not recolor; do not place on low-contrast
  backgrounds; do not rotate.
