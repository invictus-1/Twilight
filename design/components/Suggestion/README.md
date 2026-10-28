# Suggestion

A proposed edit shown in place in the manuscript — old words struck, new words marked — with a small floating bar to accept, reject or retry.

**Markup:** inside `p.tw-prose`, removed text in `span.tw-del` and inserted text in `span.tw-ins`; below the paragraph, `.tw-suggest[role=group]` with the tool name in `b`, the model, and Retry / Reject / Accept (`tw-btn-accept`). The consumer provides the diff spans, the tool and model names and the handlers.

- Insertions: `ink` on `horizon-soft` with a `horizon` underline. Deletions: `ink-faint` with a strikethrough. They differ by decoration and lightness, not by a red/green hue.
- Accept is the only filled button (`horizon` / `on-horizon`), bound to Alt+Enter; Alt+Backspace rejects. Tab is never bound here — it moves keyboard focus.
- Several suggestions in a document step with Alt+] / Alt+[; "Accept all" lives in the editor toolbar, never in the bar.
- The model never edits the manuscript silently: every change from a writing tool or agent arrives as a Suggestion.
