# Twilight design system

The source of truth for how Twilight looks: `tokens.json` (colours, type, spacing, radii, shadows, sizes), `components/` (each with guidelines and a preview), and the principles below. The app's own CSS (`src/renderer/src/styles/`) implements these tokens.

Twilight is a desktop front end for language models — cloud APIs, local models, tools and agents — with a writing studio and a coding agent built in. It should feel like the quiet hour after sunset: calm, and fast. Every rule below serves two promises: **nothing waits on the interface**, and **the user's words are the brightest thing on screen**.

This describes the app as of 1.0. When the app and this file disagree, check the app's CSS (`src/renderer/src/styles/`) and update whichever is wrong.

## Principles

- **Fast before fancy.** Controls never animate longer than 180ms. No splash screens, no skeleton shimmer for things that load under 300ms, no confirmation dialogs for undoable actions — undo instead. Speed claims are measured (`scripts/bench.cjs`), before and after any change meant to make things faster.
- **Nothing is lost.** Anything that can destroy work asks once more inline (a button that arms, then acts) or can be undone: deletions go to the Recycle Bin or Recently deleted, agent edits are snapshotted, a restore or a move backs up first.
- **One accent per job.** `iris` is interaction, `dusk` is agents and tools, `horizon` is writing. If something is colored, a person should be able to say which of the three it belongs to.
- **Tone, not boxes.** Layers are separated by stepping `night` → `surface` → `surface-raised` → `surface-overlay`. Borders appear only where a control needs a boundary (`line-strong`) or a card needs an edge (`line`).
- **The manuscript is sacred.** Models never change the user's text silently — every edit arrives as a Suggestion to accept or reject.

## Voice

Plain, short, and on the user's side. Sentence case everywhere, including buttons and menu items. No exclamation marks, no emoji in the interface, no "Oops".

- Buttons are verbs: "Clone into split", "Load model", "Allow once".
- Errors say what happened and what to do, in one breath: "qwen3-32b isn't loaded in Ollama. Load it or pick another model."
- Name things the way the user does: "chat", "split", "doc", "model", "tool". Not "session", "instance", "artifact", "inference endpoint".
- Address the user as "you" only when needed; the app never says "I".
- Numbers are compact and exact: "1.2k tokens", "3.4s", "6 tools".

## Color

Twilight (the default, a dark dusk) has ten sister themes: Ultraviolet, Phosphor, Nightshade, Ember, Midnight, Synthwave, Aurora, Campfire, High contrast, and **Moonlit Paper**, the one light theme (warm paper, dark ink, `color-scheme: light`); plus your own from the builder in `src/renderer/src/customTheme.ts`. They are `[data-theme]` overrides of the same tokens in `src/renderer/src/styles/themes.css`, listed once in `src/shared/themes.ts` for the pickers, the command menu and the window frame. Every text token names the grounds it is legible on, and every one of those pairs meets 4.5:1 in every theme (the e2e measures every visible text in Moonlit Paper); control borders and focus meet 3:1.

- **Never hard-code a colour** in component CSS. A literal colour is either a token, or a decoration with a per-theme override in `themes.css` (the skies on the Roadmap, Insights and the welcome are the examples). Moonlit Paper is where a missed one shows.

- **Grounds:** `night` for the frame (title bar, sidebar, split gutter), `surface` for the canvas, `surface-raised` for things on the canvas (composer, cards, inputs), `surface-overlay` + `shadow-lg` for anything floating. Hover is a `surface-hover` wash over whatever is beneath.
- **Text:** `ink` for content, `ink-muted` for labels and metadata, `ink-faint` for placeholders and timestamps. Never lighten text further with opacity.
- **Iris** is the only interactive color: primary buttons, links, focus, the selected conversation (`iris-soft`), the user's message bubble (`iris-soft`), split pane A. Text on an iris fill is `on-iris` (dark), never white.
- **Dusk** marks the agent: tool names, running spinners, MCP badges, the Tools toggle when on.
- **Horizon** marks writing: suggestion insertions, the Ask tool, split pane B, writing badges. On a horizon fill use `on-horizon`.
- **Status** (`success`, `warning`, `danger`) always travels with a word or an icon — never a bare colored dot.
- Fills are flat. Gradients are kept for a few celebratory surfaces only: the skies (welcome, Insights, Roadmap, the empty chat), charts and progress bars, and the background gradients a user can put behind the window.

## Typography

Three families, each with one job. The app ships the font files itself (all three are SIL Open Font License) and never loads anything from the network; system fallbacks are in the stacks. Only this design system's preview pages pull them from Google Fonts.

- **Geist** (`sans`) for the interface. `body` (14/22) is the default for messages and controls; `label` (13/18, 500) for buttons, field labels and sidebar titles; `caption` (12/16) for metadata; `heading` and `title` for structure; `display` only for the empty-state greeting.
- **Literata** (`serif`) for the manuscript only — `prose` (17/29) and `prose-heading`. Seeing serif means "this is your writing". Chat stays in Geist even when it is about writing.
- **Geist Mono** (`mono`) for `code`: code blocks, tool names and arguments, model IDs, keyboard keys.
- Weights are 400, 500 and 600. No italics in the interface; italics belong to the user's prose.

## Space, size and shape

- 4px base: `space-1` to `space-4` inside components, `space-6` for page gutters, `space-8`/`space-12` for the editor and empty states.
- Controls are `control-md` (32px) by default, `control-sm` (28px) in toolbars. The title bar and pane headers are `titlebar` (40px).
- Threads cap at `thread` (760px); the editor's text column at `measure` (680px). The sidebar is `sidebar` (264px) and collapses with Ctrl+B.
- Radii shrink with the object: `radius-lg` for the composer, dialogs and split panes; `radius-md` for cards and menus; `radius-sm` for buttons, inputs and rows; `radius-xs` for badges and keys; `radius-full` only for model chips, status dots and the send button.

## Depth and focus

- `shadow-sm` on the composer and inputs; `shadow-lg` on every floating layer. Nothing else casts a shadow.
- Keyboard focus is always `focus-ring`: a 2px gap in the canvas color, then 2px of solid `iris`, applied with `:focus-visible`. Never remove it, never replace it with a color change.
- Text selection uses `selection`.

## Motion

- Hover and press: 120ms ease. Menus and popovers: 150ms fade plus 4px rise. Panes opening or closing: 180ms ease-out. Rail sections sliding aside while one is dragged: 180–200ms.
- Streaming text appears as it arrives — no typewriter effect, no fade per token.
- Longer motion is allowed only where nothing waits on it: the welcome's sunset, page fade-ins, messages easing in, and the opt-in scroll particles in Extras. Settings → General → Motion has Full, Gentle (fades only) and Off, and Windows' reduce-motion setting counts as Gentle. Particles show only on Full.
- The only looping animation in normal use is the `dusk` spinner.

## Layout

- **Rail:** the column of sections at the far left (Chats, Writing, Judge, Insights, Code, then Search and Settings at the foot), each an icon over its name. Sections can be dragged into the user's own order. See `components/Rail`.
- **Chat:** sidebar on `night` · thread on `surface`, centered, max `thread` · composer pinned to the bottom of the pane.
- **Code:** the same shape as a chat. The header holds the title, then chips for the folder, the instructions file and Web, the mode switch (Plan · Ask first · Accept edits · Read only), the model pill, Undo and Undo all; on a narrow window the chips give way first. Above the composer: the plan bar when a plan is ready, then the agent's task list. Approvals and questions appear in the thread as cards (`components/Approval`).
- **Settings:** a section list on the left with group names (App, Models, About) in `dusk`, bold, with a rule between groups; one page on the right, capped at 1320px. A page may add a side panel on a window wide enough for it (the Roadmap shows the way to 1.0 at 1700px and up); it never appears on narrower windows.
- **Split compare:** two panes on a `night` gutter, A (`pane-a`) left and B (`pane-b`) right, each with its own header, thread and footer, and one composer below both with an **A / B / Both** target switch (default Both).
- **Writing:** the manuscript in `prose` on `surface`, centered at `measure`, with an optional chat pane docked right. Writing tools appear in the SelectionToolbar; results arrive as Suggestions.

## Conversations are trees

Every conversation is a tree of messages. Regenerating a reply, editing an earlier message, or cloning makes a new **branch**; nothing is ever overwritten.

- A branch carries everything above its branch point: the full history, the system prompt, attached docs, persona, model and parameters. After that, each branch is changed independently.
- **Branch switcher** (‹ 2 / 3 ›) on any message with siblings moves between them.
- **Clone into split** opens the current branch and a fresh copy of it side by side as A and B — the usual next step is to change B's model ("Opus 5" in A, "Opus 5.5" in B) and send to Both.
- **Clone into new chat** opens a branch as its own sidebar entry; it stays linked to the tree it came from.
- **Keep B** closes the split and continues on B's branch. A is not deleted; it stays reachable from the switcher.

## Keyboard

Everything is reachable from the keyboard, every shortcut can be rebound in Settings → Keyboard, and **Ctrl+/** opens the full shortcut sheet. The command menu shows each command's shortcut beside it, so nobody has to memorize them.

| Action | Default |
| --- | --- |
| Command menu (anything, by name) | Ctrl+K |
| Shortcut sheet | Ctrl+/ |
| New chat | Ctrl+N |
| New writing doc | Ctrl+Shift+N |
| Search all chats and docs | Ctrl+Shift+F |
| Toggle sidebar | Ctrl+B |
| Model picker | Ctrl+M |
| Send | Enter (Shift+Enter for a new line) |
| Stop generating | Esc |
| Clone into split | Ctrl+Shift+S |
| Send to A / B / Both | Alt+1 / Alt+2 / Alt+3, then Enter |
| Previous / next branch | Alt+← / Alt+→ |
| Regenerate | Ctrl+R |
| Accept / reject suggestion | Alt+Enter / Alt+Backspace |
| Next / previous suggestion | Alt+] / Alt+[ |
| Ask about the selection | Ctrl+J |
| Settings | Ctrl+, |
| Chats · Writing · Judge · Insights · Code | Ctrl+1 … Ctrl+5 |
| Move a focused rail section | Alt+↑ / Alt+↓ |

Defaults avoid keys that move on non-US layouts (`\`, `[`, `]` alone, `` ` ``) except where a layout-safe alternative is also bound.

## Iconography

Line icons at 16px on a 24px grid, 1.5px stroke, round caps and joins, drawn in `currentColor` so they take the text color they sit beside. This system has no icon set of its own yet: the previews use simple hand-drawn placeholders in that style, and Lucide is the recommended match. Icons label actions only — never decoration, never emoji. The core set: plus, paperclip, arrow-up (send), copy, refresh (regenerate), columns (split), check, x, chevron-down, sparkle (Ask), wrench (tools), cloud (API model), chip (local model), alert-circle.

## Logo

The mark is a sun on the horizon under two bands of sky (`Rail.tsx`, `Mark`), drawn in `horizon` with an `iris`→`dusk` sky. The wordmark is the name in Literata 600, used large only on the welcome and the installer.

## Using the components

Components are plain CSS classes (prefix `tw-`) in `components/bundle.css`, framework-agnostic, reading only tokens. Load the compiled tokens CSS first, then `bundle.css`. Each component's guidelines list the markup and what you provide.

Components added since the previews were drawn (Rail, Toggle, Approval, Chip) have guidelines only; their live styles are in `src/renderer/src/styles/app.css`. The app's styles are the reference for anything newer than a preview.
