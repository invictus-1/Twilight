# SelectionToolbar

The floating bar that appears above selected text in the writing editor, offering the quick writing tools.

**Markup:** `.tw-seltool[role=toolbar]` of small ghost buttons separated by `.tw-sep`; the first is `tw-ask` (free-form instruction, `horizon`). The consumer provides the tool list (user-customizable presets) and the handlers; each tool returns a `Suggestion`.

- Order: Ask, then the user's presets (default Rewrite, Tighten, Expand, Tone ▾), then Compare in split — which runs the same tool on two models and shows both as A/B.
- Appears 120ms after the selection settles, above it (below if there is no room), and never covers the selected text.
- Every button has a shortcut shown in its tooltip; Ctrl+J opens Ask directly.
- Labels are bare verbs. No icons except Ask and Compare.
