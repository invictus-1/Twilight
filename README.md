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

`TWILIGHT_SELFTEST=<folder> npx electron .` (after `npm run build`) seeds a ~350k-token chat into a throwaway profile, scrolls it top to bottom one step per frame, and writes `selftest.json` and `selftest.png` to the folder.
