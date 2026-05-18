# Sunfall Arc Design Reference

Source style: [Resend design system on Refero Styles](https://styles.refero.design/style/0d914ef0-fa84-4c60-a9aa-cef0b5eb6e5d).

Sunfall Arc should feel like a developer command surface: black canvas, precise white type, quiet borders, syntax-colored code, and exactly one primary interaction color. The mood is polished black glass, not decorative darkness.

## Design Intent

Use a matte, near-black interface for docs, tools, and product surfaces. Surfaces should feel flush and technical, separated by 1px hairlines rather than shadows. Color is functional punctuation: blue for primary interaction, violet for code identity, and small vivid colors only for data/status semantics.

The UI should be dense, editorial, and calm. It can be dramatic through contrast and typography, but it should not become a marketing gradient page. Developer content stays central: package names, route ids, code blocks, commands, diagnostics, and graph facts should look first-class.

## Tokens

### Colors

| Role         | Token                 | Value     | Use                                                    |
| ------------ | --------------------- | --------- | ------------------------------------------------------ |
| Canvas       | `--color-canvas`      | `#000000` | Full-page background and dominant app surface.         |
| Card surface | `--color-surface`     | `#0b0e14` | Cards, tool panels, elevated content containers.       |
| Overlay top  | `--color-overlay`     | `#1b1b1b` | Popovers, barely lifted panel tops, nav blur backing.  |
| Rail         | `--color-rail`        | `#292d30` | Borders, dividers, image frames, card outlines.        |
| Smoke        | `--color-smoke`       | `#464a4d` | Secondary borders and quiet structural strokes.        |
| Ash          | `--color-ash`         | `#6c6c6c` | Tertiary text, badge labels, de-emphasized metadata.   |
| Steel        | `--color-steel`       | `#6e727a` | Secondary body text and low-emphasis icons.            |
| Fog          | `--color-fog`         | `#a1a4a5` | Muted body text, badge borders, helper copy.           |
| Mist         | `--color-mist`        | `#abafb4` | Brighter secondary UI text and active badge outlines.  |
| Frost        | `--color-frost`       | `#f0f0f0` | Primary content text, headings, nav labels.            |
| White        | `--color-white`       | `#ffffff` | Maximum-emphasis text and active icon fills.           |
| Action blue  | `--color-action`      | `#3b9eff` | Primary CTA border, selected nav state, focus moments. |
| Code violet  | `--color-code-violet` | `#9281f7` | Code identity, active code tabs, product data accents. |
| Delivered    | `--color-delivered`   | `#3ad389` | Data/status mark only.                                 |
| Bounced      | `--color-bounced`     | `#ff9592` | Data/status mark only.                                 |
| Complained   | `--color-complained`  | `#ffca16` | Data/status mark only.                                 |
| Opened       | `--color-opened`      | `#70b8ff` | Data/status mark only.                                 |
| Clicked      | `--color-clicked`     | `#baa7ff` | Data/status mark only.                                 |

Do not use vivid colors as decoration. If a color is not explaining interaction, syntax, status, or product data, keep it neutral.

### Typography

Use three voices, with fallbacks when commercial fonts are not available:

| Voice   | Font         | Fallback                                                   | Use                                                               |
| ------- | ------------ | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| UI      | `Inter`      | `ui-sans-serif`, system sans                               | Navigation, body copy, buttons, labels, cards.                    |
| Display | `Domaine`    | `DM Serif Display`, `Playfair Display`, serif              | Rare hero statements and editorial section closers.               |
| Code    | `CommitMono` | `JetBrains Mono`, `Fira Code`, `SFMono-Regular`, monospace | Code blocks, inline code, filenames, CLI snippets, package names. |

| Role          | Size             | Weight | Line height |
| ------------- | ---------------- | ------ | ----------- |
| Caption       | `12px`           | `400`  | `1.33`      |
| Body small    | `14px`           | `400`  | `1.43`      |
| Body          | `16px`           | `400`  | `1.5`       |
| Subheading    | `18px`           | `400`  | `1.6`       |
| Heading small | `20px`           | `500`  | `1.3`       |
| Heading       | `24px`           | `500`  | `1.33`      |
| Heading large | `56px`           | `400`  | `1`         |
| Display       | `77px` to `96px` | `400`  | `1`         |

Implementation note: the source reference uses tight negative tracking on display type. In this repo, keep `letter-spacing: 0` unless a user explicitly approves an exception, because our frontend rules require non-negative tracking.

## Spacing And Layout

Use a `4px` base unit with comfortable density.

| Token        | Value   |
| ------------ | ------- |
| `--space-1`  | `4px`   |
| `--space-2`  | `8px`   |
| `--space-3`  | `12px`  |
| `--space-4`  | `16px`  |
| `--space-5`  | `20px`  |
| `--space-6`  | `24px`  |
| `--space-7`  | `28px`  |
| `--space-8`  | `32px`  |
| `--space-10` | `40px`  |
| `--space-12` | `48px`  |
| `--space-16` | `64px`  |
| `--space-20` | `80px`  |
| `--space-24` | `96px`  |
| `--space-36` | `144px` |

Use `1200px` as the wide content max. Section gaps can be `80px` to `120px` on spacious pages; docs and app tools can tighten this where scanning matters. Standard card padding is `32px`; standard element gap is `16px`.

## Shape

| Element      | Radius |
| ------------ | ------ |
| Buttons      | `6px`  |
| Badges       | `6px`  |
| Tags         | `10px` |
| Cards        | `16px` |
| Modals       | `16px` |
| Large panels | `24px` |

This style is not pill-heavy. Buttons are compact rounded rectangles, badges are tighter, and cards use a larger but still restrained radius.

## Surfaces

| Level | Name         | Value     | Purpose                                     |
| ----- | ------------ | --------- | ------------------------------------------- |
| 0     | Canvas       | `#000000` | Page background and dominant surface.       |
| 1     | Card surface | `#0b0e14` | Feature cards and elevated containers.      |
| 2     | Rail         | `#292d30` | Borders, dividers, structural edges.        |
| 3     | Overlay      | `#1b1b1b` | Popovers, dark gradients, nav blur backing. |

Elevation comes from borders and contrast. Use `1px solid var(--color-rail)` as the default frame. Do not use ordinary drop shadows for cards or page sections.

## Components

### Navigation Bar

Use a black sticky top or side surface with a `1px` rail border. Nav links are ghost text in `--color-frost` or `--color-fog`; active states may use `--color-action` as a border, underline, or small indicator. Keep navigation chroma extremely restrained.

### Primary Action Button

Primary actions are outlined, not filled:

- Background: transparent or `--color-canvas`
- Border: `1px solid var(--color-action)`
- Text: `--color-white`
- Radius: `6px`
- Font: Inter, `14px`, weight `500`

Do not use filled blue buttons in this design language.

### Ghost Link Button

Secondary actions such as "Docs", "Log in", or "View on GitHub" should be transparent, borderless, and quiet. Use `--color-fog` for low emphasis and `--color-frost` for standard emphasis.

### Announcement Badge

Use a transparent badge with a `1px solid var(--color-rail)` border, `16px` radius, and Inter `14px`. It should feel like a terminal prompt or notification, not a colorful marketing pill.

### Cards

Feature cards and repeated items use:

- Background: `--color-canvas` or `--color-surface`
- Border: `1px solid var(--color-rail)`
- Radius: `16px`
- Padding: `32px`
- No decorative shadow

Use near-black surface lift only when a card needs a touch more depth, and keep it subtle.

### Code

Code is a first-class visual voice. Use CommitMono or fallback monospace for inline code, package names, CLI commands, route ids, filenames, and env vars.

Code blocks should use a near-black surface, rail border, `16px` radius, compact toolbar, and syntax color. Violet is appropriate for identifiers and active code tabs; status colors belong only to semantic output or product data.

### Status Badges

Use vivid status colors only when they encode real data state:

- Delivered: `--color-delivered`
- Bounced: `--color-bounced`
- Complained: `--color-complained`
- Opened: `--color-opened`
- Clicked: `--color-clicked`

Do not use these colors for section decoration.

## Do

- Use black or near-black surfaces as the default.
- Use `1px` rail borders for structure and elevation.
- Keep blue rare and focused on primary interaction.
- Use violet and vivid colors only for code, product identity, status, or data semantics.
- Use monospace for package names, commands, paths, route ids, tokens, and API identifiers.
- Give cards real breathing room with `32px` padding when the layout is spacious.
- Verify code blocks, tables, package names, and sidebars for overflow on mobile and desktop.

## Don't

- Do not introduce full-width light sections.
- Do not use filled chromatic action buttons.
- Do not decorate backgrounds with gradients, blobs, bokeh, or abstract color washes.
- Do not use shadows to lift ordinary cards.
- Do not use status colors outside actual status/data contexts.
- Do not mix more than two type voices inside one component.
- Do not let dark UI collapse into undifferentiated boxes; every framed surface needs a clear border or hierarchy reason.

## Tailwind v4 Theme Sketch

```css
@theme {
  --color-canvas: #000000;
  --color-surface: #0b0e14;
  --color-overlay: #1b1b1b;
  --color-rail: #292d30;
  --color-smoke: #464a4d;
  --color-ash: #6c6c6c;
  --color-steel: #6e727a;
  --color-fog: #a1a4a5;
  --color-mist: #abafb4;
  --color-frost: #f0f0f0;
  --color-white: #ffffff;
  --color-action: #3b9eff;
  --color-code-violet: #9281f7;
  --color-delivered: #3ad389;
  --color-bounced: #ff9592;
  --color-complained: #ffca16;
  --color-opened: #70b8ff;
  --color-clicked: #baa7ff;

  --font-sans:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-display: "DM Serif Display", "Playfair Display", serif;
  --font-mono: "CommitMono", "JetBrains Mono", "Fira Code", "SFMono-Regular", monospace;

  --text-caption: 12px;
  --text-body-sm: 14px;
  --text-body: 16px;
  --text-subheading: 18px;
  --text-heading-sm: 20px;
  --text-heading: 24px;
  --text-heading-lg: 56px;
  --text-display: 96px;

  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-10: 40px;
  --spacing-16: 64px;
  --spacing-20: 80px;
  --spacing-24: 96px;
  --spacing-36: 144px;

  --radius-button: 6px;
  --radius-badge: 6px;
  --radius-tag: 10px;
  --radius-card: 16px;
  --radius-modal: 16px;
  --radius-large: 24px;
}
```

## Agent Prompt Guide

When implementing UI in this repo, use this short prompt:

> Build a Resend-inspired Sunfall Arc interface: pure black canvas, near-black cards, 1px graphite borders, Inter UI text, serif only for rare display statements, CommitMono-style code, outlined blue primary actions, vivid colors only for code/status/data, compact rounded rectangles, no filled blue buttons, no light sections, no decorative shadows.
