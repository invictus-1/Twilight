# Message

A turn in the thread: the user's words in a tinted bubble on the right, the model's reply unboxed on the canvas, failures in a `danger-soft` block.

**Markup:** `.tw-thread` holding `.tw-msg-user`, `.tw-msg-ai` (`.tw-msg-head`, `.tw-msg-body`, `.tw-msg-actions`) and `.tw-msg-error[role=alert]`. The consumer provides the rendered markdown, the model name, token count and latency, and the action handlers.

- The reply is not a card: it sits directly on `surface` so long answers read like a page. Tool calls inside a reply are `ToolCall` cards.
- Head line: model name in `ink-muted`, then "· N tokens · Ns" in `ink-faint`.
- Actions are ghost icon buttons — Copy, Regenerate, Clone into split — revealed on hover and always reachable by keyboard.
- **Branch switcher** (`.tw-branch`, "‹ 2 / 3 ›") leads the actions whenever a message has siblings. Regenerating or editing never overwrites: it adds a branch and switches to it (Alt+← / Alt+→ to move between them).
- Errors say what failed and the next step in one sentence, with a link to fix it: "qwen3-32b isn't loaded in Ollama. Load it or pick another model." Never a stack trace in the thread; offer "Show details".
- Max width `thread`; gap between turns `space-4`.
