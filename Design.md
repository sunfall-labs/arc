# Sunfall Arc Design Reference

Source style: [Better Auth documentation](https://better-auth.com/docs/introduction).

Sunfall Arc should feel like a sharp, inspectable developer docs surface: neutral canvas, fixed
rails, small mono navigation, compact prose, square code blocks, subtle dashed dividers, and a
mostly monochrome interaction model. The mood is Better Auth's docs system adapted to Arc, not a
marketing page and not decorative black glass.

## Design Intent

Use a documentation-first layout with a thin global topbar, a persistent left navigation rail, a
center article column, and a right "On this page" rail when headings exist. Content should feel
technical and scannable: headings are modest, body copy is comfortable, cards are low-radius
containers, and code is visually first-class.

Color should be neutral by default. Use foreground contrast, hairline borders, muted stone text,
and small hover states before reaching for chroma. Arc may keep one cool accent for focus and
selected states, but it should be rare and quiet.

## Tokens

### Colors

| Role             | Token                 | Value       | Use                                                 |
| ---------------- | --------------------- | ----------- | --------------------------------------------------- |
| Canvas           | `--color-canvas`      | `#000000`   | Full-page background and dominant docs surface.     |
| Page             | `--color-page`        | `#050505`   | Article/code backing where a slight lift helps.     |
| Surface          | `--color-surface`     | `#0c0a09`   | Cards, left rail blocks, popovers, and lifted rows. |
| Muted surface    | `--color-muted`       | `#292524`   | Hover rows, badges, selected low-emphasis surfaces. |
| Border           | `--color-border`      | `#292524`   | Primary hairlines, rails, and card edges.           |
| Border subtle    | `--color-border-soft` | `#ffffff0f` | Code block borders and very quiet dividers.         |
| Foreground       | `--color-foreground`  | `#fafaf9`   | Primary text, active nav, strong labels.            |
| Muted foreground | `--color-muted-text`  | `#a6a09b`   | Body support copy and inactive navigation.          |
| Dim foreground   | `--color-dim-text`    | `#79716b`   | Meta labels, section captions, dormant icons.       |
| Inverse          | `--color-inverse`     | `#1c1917`   | Text on filled foreground buttons.                  |
| Focus            | `--color-focus`       | `#fafaf9`   | Focus rings and selected monochrome states.         |
| Info             | `--color-info`        | `#3080ff`   | Sparse links, focus affordances, and semantic info. |
| Success          | `--color-success`     | `#00c758`   | Semantic status only.                               |
| Warning          | `--color-warning`     | `#f99c00`   | Semantic status only.                               |
| Error            | `--color-error`       | `#fb2c36`   | Semantic status only.                               |

Do not use vivid colors as decoration. If a color is not explaining interaction, syntax, status,
or product data, keep it neutral.

### Typography

Use two voices:

| Voice | Font         | Fallback                                                    | Use                                              |
| ----- | ------------ | ----------------------------------------------------------- | ------------------------------------------------ |
| UI    | `Geist`      | `Inter`, `ui-sans-serif`, system sans                       | Navigation, prose, labels, buttons, cards.       |
| Code  | `Geist Mono` | `CommitMono`, `JetBrains Mono`, `SFMono-Regular`, monospace | Code blocks, ids, tabs, commands, package names. |

| Role             | Size             | Weight | Line height |
| ---------------- | ---------------- | ------ | ----------- |
| Nav caption      | `11px`           | `500`  | `1.2`       |
| Caption          | `12px`           | `500`  | `1.33`      |
| Body small       | `14px`           | `400`  | `1.55`      |
| Body             | `16px`           | `400`  | `1.7`       |
| Lead             | `18px`           | `400`  | `1.55`      |
| Heading small    | `20px`           | `600`  | `1.35`      |
| Article heading  | `28px`           | `600`  | `1.2`       |
| Overview heading | `40px` to `52px` | `600`  | `1.05`      |

Keep letter spacing at `0` for every role, including mono navigation. Use case, weight, spacing,
and separators to create hierarchy instead of tracking.

## Layout

Use a Better Auth-style docs shell:

| Area         | Size / behavior                                                  |
| ------------ | ---------------------------------------------------------------- |
| Topbar       | `44px` desktop, `48px` mobile, fixed or sticky, bottom hairline. |
| Left brand   | `min(22vw, 300px)` on desktop, collapsed into topbar on mobile.  |
| Sidebar      | `268px` to `300px`, sticky below topbar, scrollable.             |
| Article      | `900px` max page column, centered between rails.                 |
| TOC rail     | `268px` to `280px`, sticky, hidden below wide desktop widths.    |
| Page padding | `56px 32px` desktop, `32px 18px` mobile.                         |

Use `4px` as the base spacing unit. Documentation pages should be denser than a product landing
page: section gaps around `32px`, prose blocks around `20px`, card grids around `12px` to `16px`.

## Shape

Better Auth's docs use restrained geometry. Prefer square-ish surfaces:

| Element     | Radius         |
| ----------- | -------------- |
| Code blocks | `0px`          |
| Buttons     | `4px`          |
| Badges      | `4px`          |
| Cards       | `4px` to `6px` |
| Popovers    | `6px`          |

Avoid pill-heavy controls. If a shape becomes round, it should be because the element itself is
round, such as a progress dot.

## Components

### Topbar

Use a sticky monochrome topbar with mono uppercase tabs. The active tab gets a foreground bottom
border or filled foreground state. Keep labels short: "Readme", "Docs", "Cookbook", "Why Arc".
Use hairline separators between tab groups and keep `letter-spacing: 0`.

### Sidebar

The sidebar is a navigation document, not a card. It uses section captions, compact links, and
subtle hover backgrounds. Active or hover rows may use `--color-muted`; selected states should use
foreground text rather than bright color.

### Page Header

Article headers should be compact: a small uppercase eyebrow, a `28px` title on docs pages, and a
muted lead. Overview/home pages can use a larger heading, but avoid full landing-page hero
composition unless the page is actually a product landing page.

### Cards

Cards use a thin border, low radius, and neutral surface. Feature or index cards may include a
subtle grid texture or dashed divider, echoing Better Auth's feature tiles. Do not use ordinary
drop shadows.

### Code

Code blocks are square, dark, bordered, and visually dense:

- Background: `#050505`
- Border: `1px solid var(--color-border-soft)`
- Radius: `0`
- Toolbar: mono uppercase, transparent or same dark background
- Inline code: compact neutral chip with mono type

### Page Rail

The right rail uses a small title, compact links, and a thin vertical border. The active link can
use a foreground line or dot. Hide it below wide desktop if it would squeeze the article.

## Do

- Use the docs shell as the primary layout pattern.
- Keep the palette neutral and stone-based.
- Favor mono uppercase labels for top-level navigation and utility actions.
- Use hairlines, dashed dividers, and contrast instead of shadows.
- Keep code blocks square and important.
- Make article pages compact and readable rather than heroic.
- Verify sidebars, code blocks, headings, and cards across mobile and desktop.

## Don't

- Do not use filled blue CTAs as the default action style.
- Do not use large rounded cards or pill-heavy navigation.
- Do not decorate with gradient orbs, bokeh, blobs, or ornamental shadows.
- Do not let docs pages become marketing hero pages.
- Do not overuse accent color; monochrome selected states should come first.
- Do not let rails crowd the article on medium screens.

## Tailwind v4 Theme Sketch

```css
@theme {
  --color-canvas: #000000;
  --color-page: #050505;
  --color-surface: #0c0a09;
  --color-muted: #292524;
  --color-border: #292524;
  --color-border-soft: #ffffff0f;
  --color-foreground: #fafaf9;
  --color-muted-text: #a6a09b;
  --color-dim-text: #79716b;
  --color-inverse: #1c1917;
  --color-focus: #fafaf9;
  --color-info: #3080ff;
  --color-success: #00c758;
  --color-warning: #f99c00;
  --color-error: #fb2c36;

  --font-sans:
    Geist, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  --font-mono: "Geist Mono", CommitMono, "JetBrains Mono", "SFMono-Regular", monospace;

  --radius-code: 0px;
  --radius-control: 4px;
  --radius-card: 6px;
  --radius-popover: 6px;
}
```

## Agent Prompt Guide

When implementing UI in this repo, use this short prompt:

> Build a Better Auth-inspired Sunfall Arc docs interface: sticky mono topbar, fixed left docs rail,
> centered 900px article, optional right TOC rail, neutral stone-on-black tokens, compact Geist-like
> typography, square bordered code blocks, low-radius cards, hairline and dashed dividers, and
> minimal accent color reserved for focus or semantic states.
