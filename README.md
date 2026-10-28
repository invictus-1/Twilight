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

Add an Anthropic API key, or start Ollama / LM Studio, under **Settings → Providers**.

## How it's built

- `src/main` — the Electron main process. Owns the SQLite database (`db.ts`), API keys (`secrets.ts`, encrypted with Windows DPAPI via `safeStorage`), providers (`providers/`) and the chat engine (`chat.ts`). All network traffic to models happens here.
- `src/preload` — the typed bridge (`window.twilight`) between the interface and the main process.
- `src/renderer` — the React interface. It never touches the network: every web request from it is blocked.
- `src/shared` — types and pricing shared by both sides.
- `design/tokens.json` — tokens copied from the design system; `node scripts/tokens.mjs` regenerates `src/renderer/src/styles/tokens.css`.

### Conversations are trees

Each chat is a tree of messages under a hidden root that holds the system prompt. Regenerating adds a sibling instead of overwriting, and the thread is the path of "active" children. That keeps every request append-only.

### Split compare

Pane B is a second branch of the same tree: "Clone into split" (Ctrl+Shift+S, or the split icon on a reply) copies the conversation at that point, history, system prompt and settings included. Change B's model, then send to A, B or Both (Alt+1/2/3). B's branches never move pane A; "Keep A" or "Keep B" closes the split and continues on that branch, with the other still reachable from the version switcher. When both panes use the same model, B waits for A's first token so it reads A's prompt cache.

### Writing

Documents are plain `.md` files in a folder you choose (it defaults to `Documents\Twilight`; an Obsidian vault works as is, and both apps can edit the same files). The editor is CodeMirror 6, the engine Obsidian uses; it loads on first use, opens a 115k-word manuscript in about 35ms, autosaves atomically, and picks up edits made outside Twilight when the window regains focus.

Select text for the writing tools: Ask (Ctrl+J), Rewrite, Tighten, Expand and Tone. The result streams in as a suggestion: a word diff shown in place, which changes nothing until you accept it (Alt+Enter) or reject it (Alt+Backspace or Esc). The tools use the default model at low effort with about 1,000 words of surrounding context.

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
- `TWILIGHT_E2E=<folder> npx electron .` starts a fake OpenAI-compatible model server in-process and drives chat, split compare, documents, a 115k-word manuscript and a writing-tool accept through the real app, writing `e2e.json` (28 checks) and screenshots.
