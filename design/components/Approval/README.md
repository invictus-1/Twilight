# Approval

A card in the thread when something waits for the user: an agent's edit or command (Code), a tool call (MCP in a chat), or the agent's question.

**Code:** `.code-pending` > `.code-pending-head` (the question as a heading: "Make this change?", "Run this command?", "Move this file to the Recycle Bin?", with the path in `mono`), the diff (`.code-diff`: removed lines first in `danger`, then added in `success`, unchanged runs folded to "⋯ N unchanged lines") or the command in `mono`, then actions.
**MCP:** `.tool-approval` > head ("Allow `tool` from Server?", a read-only badge when the server says so), the arguments pretty-printed in `mono`, then actions.

- The primary action is the safe-to-undo one and is focused when the card appears: "Approve", "Run it", "Allow once". Then the broader grant as a plain button ("Approve all edits", "Always allow this command", "Always allow `tool`"), then Decline as a ghost button.
- Code adds an optional "Why not?" field the agent reads when declining.
- A **risky command** (deletes, overwrites, rewrites git history) gets a `danger` border and a warning line that names the risk ("Careful: it deletes files…"), and never offers "Always allow".
- Stopping the reply or the agent declines whatever is waiting; the card disappears.
- The agent's **question** card is `.code-question`: the question, suggested answers as buttons, and a free-text answer.
