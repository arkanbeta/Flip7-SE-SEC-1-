# 08 - UI and design guide

## Principles

A friendly online card game, not an admin dashboard: light surfaces, one strong blue for actions, teal as the supporting accent, generous spacing, and very little decoration. Animation is used to explain what happened (a card turning over, a dialog appearing), never to decorate, and it is always optional.

## Design tokens (`frontend/src/styles/variables.css`)

Everything visual comes from CSS variables, so the look can be changed in one file. Components never contain raw colours or sizes.

| Group | Tokens | Notes |
| --- | --- | --- |
| Palette | `--color-bg`, `--color-surface`, `--color-primary`, `--color-secondary`, `--color-text`, `--color-text-secondary`, `--color-border`, `--color-success`, `--color-warning`, `--color-error` | Exactly the colours in the project specification |
| Tints | `--color-primary-soft`, `--color-error-soft`, ... | Computed from the palette with `color-mix()`, so they can never drift from it |
| Type | `--font-display`, `--font-body`, `--text-sm` ... `--text-3xl` | Fredoka (rounded, friendly) for headings and card numbers; Nunito for reading text. Both are bundled via `@fontsource-variable`, so no request goes to Google Fonts |
| Space / shape | `--space-1..7`, `--radius-sm/md/lg/pill` | One scale for the whole app |
| Elevation | `--shadow-sm/md/card` | Deliberately light |
| Motion | `--duration-fast/base/flip`, `--ease-out` | Shared by CSS and Motion (JS) so they feel the same |

Blue is for primary actions, teal for secondary emphasis, neutrals for content.

## Contrast audit (Phase 8)

Ratios were computed from the tokens (WCAG 2.x). Body text, secondary text, button labels, links and the card numbers all pass 4.5:1 (text on page 13.7, secondary text 4.8, white on primary 4.9, primary on white 4.9). The brand **green, teal and orange are too light as small text on white** (3.1-3.3), so text uses the darker `--color-success-text`, `--color-secondary-text`, `--color-error-text` and `--color-warning-text` (all 4.6+ on white and on their soft tints); the base colours are kept for borders, icons and large shapes. Form fields and secondary buttons use `--color-field-border` (3.2:1) instead of the faint decorative `--color-border` (1.2:1), because a control's outline must be visible. Information is never carried by colour alone (statuses are also written: "Bust!", "Stayed", "Ready").

## Animation (Phase 8)

A new card slides in and turns face-up when it appears in a hand; a busted hand shakes once; the urgent timer pulses; dialogs animate through Motion. **All of it switches off** when the operating system asks for reduced motion (CSS media query plus `MotionConfig reducedMotion="user"`).

## Responsive check

The game table and results screen were rendered at 375 px (phone) and 1280 px (desktop) with Chromium: no horizontal scrolling, the Hit / Stay panel stays reachable at the bottom on phones, seats flow from one column to three. Firefox, Safari and real devices were not tested.

## Shared components (`frontend/src/components/`)

| Component | Purpose |
| --- | --- |
| `Button` | `primary` / `secondary`, loading spinner, disabled state, 44px minimum height for touch |
| `TextField` | Label + input + hint (`neutral`/`success`/`error`); error sets `aria-invalid` and links the hint with `aria-describedby` |
| `Avatar`, `AvatarPicker` | Round picture; picker uses real radio buttons so the keyboard and screen readers work |
| `Modal` | Dialog with Motion enter/exit, focus moved in and trapped, Escape and backdrop close, page scroll locked, focus returned to the opener |
| `Tabs` | WAI-ARIA tabs: arrow keys, Home/End, only the active tab in the Tab order |
| `PageHeader`, `Page` | Back link + title; `Page` eases content in with Motion |
| `PlayingCard` | See below |
| `RouteGuards`, `FullPageMessage` | Access control for pages; loading and "cannot reach server" screens |

## The playing card

`PlayingCard` has a front and a back and turns over with a **CSS 3D transform** (`rotateY`, `backface-visibility: hidden`, 600 ms). Props: `faceUp`, `label`, `state` (`default`, `selected`, `disabled`, `danger`), `size` (`sm`, `md`, `lg`; width scales down on phones), and an optional `onClick` which turns it into a real `<button>`.

It only *displays*: which cards exist, their values and what they do are decided by the backend game engine (Phase 6). Card values and special-card designs will be added from the rules you supply. Motion for React is reserved for moving cards between places (dealing, collecting), which arrives with the game screen.

## Motion rules

- CSS: hover effects, transitions, the card flip. Motion for React: page entrance, dialogs, and later lists and card movement.
- `App.jsx` wraps everything in `<MotionConfig reducedMotion="user">` and `global.css` has a `prefers-reduced-motion` block, so people who ask their system for less motion get (almost) none.
- Animations never block input: a dialog is usable immediately and nothing waits for an animation to finish before the game accepts an action.

## Layout and responsiveness

Mobile first. The lobby actions stack on phones and sit in three columns from 700px; statistics are 2 columns on phones and 4 on larger screens; the login page stacks its brand panel above the form below 900px. Page width is capped (`--page-max`). **Not yet tested on real devices or browsers** (planned for Phase 8).

## Accessibility checklist (what is in place)

Visible focus ring on everything; all controls reachable and operable by keyboard; dialogs trap focus; status and error messages use `role="status"` / `role="alert"`; form hints are tied to inputs; images have text alternatives; colour is never the only signal (errors also have text). A contrast audit of every colour pair has not been run yet.

## Screens built so far

| Route | Screen | Notes |
| --- | --- | --- |
| `/login`, `/create-account`, `/create-account/profile` | Authentication | Phase 2 |
| `/lobby` | Profile icon, Create Game, Join Game, Rules | Create/Join open dialogs that say plainly that rooms arrive in Phase 4; the room-code box already validates its input |
| `/profile` | Avatar, nickname, email, ranking points, statistics, recent matches, edit dialog, log out | Numbers come from the backend; email is read-only |
| `/rules` | Tabs from data | Only Normal Mode, showing a clearly marked placeholder until the rules are supplied |

## Adding a game mode's rules later

Add one object to `MODE_RULES` in `features/rules/rulesData.js`:

```js
{ id: 'normal', label: 'Normal Mode', summary: '...', sections: [
  { heading: 'Goal', paragraphs: ['...'] },
  { heading: 'Turns', items: ['...', '...'] },
] }
```

The tab bar and page render it automatically; no component changes are needed.

## Visual redesign (warm card table)

The interface was re-art-directed around the owner's reference image and sketch (`frontend/src/assets/`): textured cream paper, a deep teal felt board fading up into muted sage, earthy accents (tan, ochre, terracotta) and charcoal ink. This supersedes the blue/white palette described above; token *names* are unchanged, so every screen picked it up from `variables.css`.

- **Tokens:** raw palette (`--teal-*`, `--sage-*`, `--cream-*`, `--tan-*`, `--ochre-500`, `--terracotta-500`, `--ink-*`), board tokens (`--board-ink`, `--board-well`, `--board-highlight`), and inline SVG noise textures (`--texture-paper`, `--texture-felt`) so no image is downloaded.
- **Type:** Fraunces (variable serif with optical sizes) for headings, scores and card numbers; Nunito for body text; Fredoka kept as `--font-rounded`. All bundled.
- **Board layout (from the sketch):** the draw pile on top (a fanned stack of card backs and its count), then one row per player: avatar and name on the left, cards in the middle, points on the right. Rows stack on phones (name and points above the cards). The active player gets an ochre edge and glow; the dealer a "D" token on the avatar.
- **Cards (`PlayingCard`, new optional `kind` prop):** cream paper fronts with a double inner frame, a flowing ribbon ornament behind the number and corner indices (drawn by CSS from `data-label`, so the text appears once for tests and screen readers). Each Number value has its own earthy tone. Special cards: Freeze = snowflake, Second Chance = heart, Flip Three = three fanned cards; modifiers are sage cards. Backs are deep teal with a lattice, a hairline frame and a large "7" monogram. Artwork lives in `components/cardArt.jsx`.
- **Contrast:** cream text on the felt sits inside darker "wells" (rows, facts, feed), and small tags use solid fills; teal on cream and cream on teal are both above 4.5:1.
