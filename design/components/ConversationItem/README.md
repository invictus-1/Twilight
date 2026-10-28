# ConversationItem

One row in the conversation sidebar: a title and a single metadata line, sitting directly on `night`.

**Markup:** `nav.tw-sidebar > .tw-conv` with `.tw-conv-title` and `.tw-conv-meta`; the open conversation gets `aria-current="true"` (`iris-soft` ground). The consumer provides the title, the model(s) used and a relative time or count.

- Title in `label` style, one line, truncated with an ellipsis — never wrapped.
- Meta line is "model · when" for chats, "Split · model A / model B" for split sessions (prefixed by the split icon in `horizon`), "Agent · N tool calls" for agent runs (the word "Agent" in `dusk`).
- Hover is `surface-hover`; the selected row keeps `iris-soft` on hover.
- Right-click and the row's overflow menu offer: Rename, Clone into new chat, Clone into split, Pin, Delete. A chat cloned into a new chat shows a small branch icon and stays linked to the tree it came from.
