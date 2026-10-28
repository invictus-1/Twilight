# Composer

The prompt box: attachments on top, a growing textarea, and one bar holding attach, the tools toggle, the model chip and send.

**Markup:** `.tw-composer` containing `.tw-attach` (badges), a `textarea`, and `.tw-composer-bar` (ghost buttons, `.tw-spacer`, `ModelPicker` chip, `button.tw-send`). The consumer provides the attachments, the tool count and toggle state, the active model and the submit handler.

- Enter sends, Shift+Enter adds a line. `/` opens writing tools and slash commands in a menu anchored above the composer.
- The textarea grows to 12 lines, then scrolls. It never shrinks the thread below 40% of the pane.
- The tools toggle is ghost when off and `dusk-soft` / `dusk` when on (`aria-pressed`), showing the number of enabled tools.
- Send is the only `iris` fill in the composer. While a reply streams it becomes Stop (same position, square icon).
- In split compare there is one composer under both panes, with an A / B / Both target switch (see SplitCompare).
- Placeholder in `ink-faint`: "Ask anything, or type / for writing tools".
