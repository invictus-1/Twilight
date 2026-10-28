# ToolCall

A compact card for one tool or MCP call inside an assistant reply: name, argument summary, live status, and an optional result or approval row.

**Markup:** `.tw-tool > .tw-tool-head` (`.tw-tool-name`, `.tw-tool-arg`, `.tw-tool-status`), then optionally `.tw-tool-body` (result preview) or `.tw-tool-approve` (permission prompt). The consumer provides the tool name, a one-line argument summary, the state and the result text.

- Tool names are always `code` in `dusk` — dusk means "the agent did this".
- States, each a word plus an icon: Running (`dusk` spinner), Done · time (`success` check), Needs approval (`warning`), Failed · reason (`danger` ×).
- Collapsed by default once done; the head toggles the body. Consecutive calls of the same tool group into "read_file ×4".
- Approval rows state the consequence as a question ("Overwrite 2,140 words?") and offer Show diff, Deny, Allow once — "Always allow" lives in the overflow, never as the primary.
- The spinner slows under `prefers-reduced-motion`.
