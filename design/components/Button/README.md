# Button

Actions in four weights: one primary per view, secondary for everything else, ghost inside dense toolbars, danger only for confirming destruction.

**Markup:** `<button class="tw-btn [tw-btn-primary|tw-btn-ghost|tw-btn-danger] [tw-btn-sm] [tw-btn-icon]">`. Icons are 16px `svg.tw-icon` (stroke `currentColor`) placed before the label. The consumer provides the label and, for `tw-btn-icon`, an `aria-label`.

- **Primary** (`iris` fill, `on-iris` label): the single thing the view is for — Send, Save, Accept. Never two in one region.
- **Secondary** (default): `surface-raised` with a `line-strong` border.
- **Ghost**: message actions (copy, regenerate, branch), toolbar buttons. `ink-muted` at rest, `ink` on hover.
- **Danger** (`danger` fill, `on-danger` label): only inside a confirm dialog. The menu item that opens it stays plain text.
- `tw-btn-sm` (28px) in toolbars and pane headers; default 32px elsewhere.

Labels: sentence case, verb first, no trailing punctuation — "Clone into split", not "Split!". Focus is always `focus-ring`.
