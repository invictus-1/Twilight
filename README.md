# Twilight

A fast, local-first desktop front end for language models: cloud APIs and local models, chat, writing and (soon) agents. Electron + React + TypeScript.

## Run

```bash
npm install
npm run dev        # hot-reloading dev build
npm run build      # production bundles in out/
npm start          # run the production build
npm run dist       # Windows installer (.exe) and portable .zip in release/
npm run typecheck
```

Add an Anthropic API key, or start Ollama / LM Studio, under **Settings → Providers**. What's done and what's next: [ROADMAP.md](ROADMAP.md).

`npm run dist` writes `release/Twilight-Setup-<version>.exe` (installer) and `release/Twilight-<version>-x64.zip` (portable). The builds are unsigned, so Windows SmartScreen asks once ("More info" → "Run anyway"). `npx electron scripts/make-icon.cjs` regenerates the app icon.

### Model settings and workspaces

Each chat (and each split pane) has its own model settings: an editable system prompt (sent with every message; a change restarts the prompt cache), recent message limit, temperature where the model accepts it, max output tokens, thinking effort, thinking display, caching on/off with its lifetime, and extra request JSON merged in last. Effort levels are read per model from the Anthropic Models API, in Anthropic's own names; OpenAI-compatible servers get the standard `reasoning_effort` names (OpenRouter's `reasoning.effort`). Settings can be saved as presets. A status line under the chat says whether the last reply hit the prompt cache.

Workspaces group chats and carry defaults: new chats in a workspace start with its system prompt (optionally headed by its name and description) and model. Attach text files to a message with the paperclip; their full text goes into that message.

## How it's built

- `src/main` — the Electron main process. Owns the SQLite database (`db.ts`), API keys (`secrets.ts`, encrypted with Windows DPAPI via `safeStorage`), providers (`providers/`) and the chat engine (`chat.ts`). All network traffic to models happens here.
- `src/preload` — the typed bridge (`window.twilight`) between the interface and the main process.
- `src/renderer` — the React interface. It never touches the network: every web request from it is blocked.
- `src/shared` — types and pricing shared by both sides.
- `design/tokens.json` — tokens copied from the design system; `node scripts/tokens.mjs` regenerates `src/renderer/src/styles/tokens.css`.

### Conversations are trees

Each chat is a tree of messages under a hidden root. Regenerating adds a sibling instead of overwriting, and the thread is the path of "active" children. That keeps every request append-only.

### Split compare

Pane B is a second branch of the same tree: "Clone into split" (Ctrl+Shift+S, or the split icon on a reply) copies the conversation at that point, history, system prompt and settings included. Change B's model, then send to A, B or Both (Alt+1/2/3). B's branches never move pane A; "Keep A" or "Keep B" closes the split and continues on that branch, with the other still reachable from the version switcher. When both panes use the same model, B waits for A's first token so it reads A's prompt cache.

### Folders

Chats sit in Twilight's own folders (a database record, nothing on disk), with Pinned and Recent sections; drag a chat onto a folder to file it, onto Recent to unfile it. Deleting a folder never deletes its chats. In Writing, folders are the real subfolders of the writing folder, so they match an Obsidian vault; dragging a document onto a folder moves the file, and a move never overwrites an existing file.

### Writing

Documents are plain `.md` files in a folder you choose (it defaults to `Documents\Twilight`; an Obsidian vault works as is, and both apps can edit the same files). The editor is CodeMirror 6, the engine Obsidian uses; it loads on first use, opens a 115k-word manuscript in about 35ms, autosaves atomically, and picks up edits made outside Twilight when the window regains focus.

Select text for the writing tools: Ask (Ctrl+J), Rewrite, Tighten, Expand and Tone, plus formatting (bold Ctrl+B, italic Ctrl+I, strikethrough, code, heading, quote) and undo/redo. A tool's result streams in as a suggestion: a word diff shown in place, which changes nothing until you accept it (Alt+Enter) or reject it (Alt+Backspace or Esc). Only the selected passage ever changes. Accepted edits stay faintly marked and go into **Edits**, where each can be reverted on its own; a pill offers Revert right after accepting. "Send to Writing" on a chat reply turns it into a document.

**Context** (per document) is what the tools send along, like a chat: standing instructions, reference documents sent in full (a character bible, an outline), and optionally the whole manuscript instead of about 1,000 words around the selection. Instructions and references go in the cached system prompt; the manuscript has its own cache breakpoint; the passage and instruction come last. Context is stored in Twilight's database, never in your files, and follows a document when it moves. The tools use the default model at low effort.

### Safety net

Deleting a chat moves it to the Trash at the bottom of the sidebar; Restore brings it back, and only "Delete forever" or "Empty trash" removes it. Request logs (on by default, Settings → Safety net) append every chat turn and writing-tool run, prompt and reply, to a daily JSON Lines file in the app's `logs` folder. API keys are never written to them.

### Prompt caching

Caching is a prefix match, so requests are built to be the previous request plus new turns:

- The system prompt is frozen when the chat starts and carries its own cache breakpoint.
- Claude's replies are stored as the exact content blocks the API returned (thinking blocks included) and replayed unchanged.
- A top-level `cache_control` moves the second breakpoint to the end of the conversation.
- Cache lifetime defaults to 1 hour (Chat settings), for writers who pause between messages.
- Nothing volatile (dates, IDs) is ever added to the prefix. Switching models, or changing effort mid-chat, re-caches once; the interface says so.

Every reply shows its cost, token count and how much of the prompt was read from cache.

### Scrolling performance

Messages render with `content-visibility: auto` and an estimated height so huge chats open fast, inside a plain block container (not flex: a flex column re-lays out every sibling when one message changes size). Once the chat has painted, everything is laid out in one idle pass, so scrolling afterwards does no layout at all.

### Tests

After `npm run build`, both run in a throwaway profile and never touch your real data:

- `TWILIGHT_SELFTEST=<folder> npx electron .` seeds a ~350k-token chat, scrolls it top to bottom one step per frame, and writes `selftest.json` (frame timings) and `selftest.png`.
- `TWILIGHT_E2E=<folder> npx electron .` starts a fake OpenAI-compatible model server in-process and drives chat, split compare, documents, a 115k-word manuscript and a writing-tool accept through the real app, writing `e2e.json` (74 checks) and screenshots.
