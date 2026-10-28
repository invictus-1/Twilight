# Badge

Small, non-interactive labels for state and category, plus the status dot and keyboard key that live beside them.

**Markup:** `<span class="tw-badge [tw-badge-iris|-dusk|-horizon|-danger]">Label</span>`; a status is a neutral badge holding `<span class="tw-dot" style="color:var(--success)">` and a word; keys are `<kbd class="tw-kbd">`.

- The tint says which part of the app the badge belongs to: `iris` for the user's own organizing (pinned, folder), `dusk` for agents and tools, `horizon` for writing, `danger` for failure.
- A status dot is never alone — "Online", "Rate limited", "Offline" always follow it, so state never rests on hue.
- One or two words, sentence case. Counts use a middle dot: "MCP · 6 tools".
