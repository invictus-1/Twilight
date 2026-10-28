# SplitCompare

Two branches of one conversation side by side, so the same prompt can be run against different models, settings or documents and the replies compared.

**Markup:** `.tw-split` (a `night` gutter) holding two `section.tw-pane`, `.tw-pane-a` and `.tw-pane-b`, each with `.tw-pane-head` (`.tw-pane-tag` letter, model chip, document badges, close), `.tw-pane-body` (the thread) and `.tw-pane-foot` (settings and stats); below both, one `.tw-composer.tw-split-composer` with a `.tw-seg` A / B / Both switch. The consumer provides each pane's branch, model, attached docs, parameters and the send handler.

- **Cloning copies everything.** "Clone into split" (Ctrl+Shift+S, message actions, sidebar menu) makes B a new branch of A at the current point: full history, system prompt, persona, attached docs, model and parameters. Then change what you are testing — usually B's model.
- **One composer, a target switch.** Both is the default and sends the same message to each pane in parallel. A or B sends to one side only (Alt+1 / Alt+2 / Alt+3 switch). The placeholder names the target: "Message both panes", "Message A".
- **Identity by letter and color:** A is always `pane-a` (iris), B is always `pane-b` (horizon) — a 2px top edge and a filled letter tag. Never rely on left/right alone; the letter travels into exports, the sidebar and the target switch.
- **What each pane can see** is its document badges. Dragging a doc onto one pane attaches it there only; onto the gutter attaches it to both.
- **Footers line up:** the same stats in the same order in both panes (temperature, tokens, latency) so they compare at a glance.
- **Keep B** closes the split and continues on B's branch; A stays reachable from the branch switcher.
- Panes scroll independently; "Sync scroll" is a toggle in the split's overflow menu.
