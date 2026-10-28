# Working on Twilight

Twilight is a local-first Windows desktop app (Electron + React + TypeScript) for writing with language models: chat with Claude and OpenAI-compatible models, split compare, a writing editor with Forge-style tools, the Judge, choice cards for text adventures, and Writer insights. This file is what a new session needs to pick the work up, whichever account it runs under.

## Ground rules

- **Nothing personal in the repo, ever.** It is public. No names, emails, file paths from anyone's machine, private writing, system prompts or rubrics, chat transcripts, or links to personal accounts. Demo content and tests use invented text (the lighthouse story in `src/main/showcase.ts`, Wren and Rowan in the tests). Personal files that the app can import (a rubric, say) live in `private/`, which is git-ignored.
- **Fresh installs start clean.** Nothing user-specific ships in the app: no built-in rubric beyond General fiction, no default system prompt content, every model hidden until chosen.
- **Commits and pushes to `main` are fine without asking.** Never force-push unless the user asks for it.
- **Releases are big versions only** (0.4, 0.5, …), published as GitHub releases of this repository (the updater reads them). Build patch versions locally if useful, but don't publish them. Always ask before running `npm run release`, because it publishes publicly.
- Builds strip the project folder path from every bundle (electron.vite.config.ts), and `npm run release` refuses to publish if any built file still holds a path from this machine. Keep both.
- Avoid destructive shell commands (`rm -rf` is blocked). Write multi-line scripts and patches as files rather than heredocs: the shell here mangles backslashes in heredocs.
- Keep CHANGELOG.md (a section per version; it becomes the release notes) and ROADMAP.md (drawn in the app as Settings → Roadmap; keep its line format) current with every change.

## Commands

```bash
npm install
npm run dev          # the app with hot reload
npm run typecheck    # both TypeScript projects
npm run dist         # Windows installer + zip in release/
npm run release      # publish release/ as a GitHub release (ask first)
```

Testing (each runs the real app against a throwaway profile; nothing touches real data):

```bash
npx electron-vite build
TWILIGHT_E2E=<dir> npx electron .         # end-to-end suite → <dir>/e2e.json + screenshots
TWILIGHT_SELFTEST=<dir> npx electron .    # scroll performance on a 450-turn chat
TWILIGHT_SHOWCASE=<dir> npx electron .    # README screenshots from demo data
```

Also run the e2e suite against the packaged build after `npm run dist`: `TWILIGHT_E2E=<dir> release/win-unpacked/Twilight.exe`. Every feature gets e2e checks in `src/main/e2e.ts`; the suite must pass fully before a commit.

## Map

- `src/main/` — Electron main process. `chat.ts` (conversation trees, generate, delete/restore/edit), `db.ts` (SQLite: conversations, nodes, kv, deletions, doc_stats, writing_days), `providers/` (Anthropic and OpenAI-compatible, model lists, keys), `judge.ts`, `writing.ts` (editor tools), `docs.ts` (writing folder), `insights.ts` + `insights.worker.ts` (Writer insights tracker), `updates.ts` (GitHub releases updater), `e2e.ts`, `selftest.ts`, `showcase.ts`.
- `src/shared/` — types and logic used on both sides: `types.ts` (the IPC API), `choices.ts` (choice-card parsing and the present_choices tool), `insights.ts` (text analysis, achievements), `judge.ts`, `roadmap.ts`, `gameFormat.ts`, `pricing.ts`.
- `src/preload/index.ts` — the `window.twilight` bridge; every API method is listed there.
- `src/renderer/src/` — React UI. `store.ts` (zustand), `components/` (one file per surface), `styles/tokens.css` + `styles/app.css`.
- `design/` — the design system: tokens, component guidelines and previews. Follow it for anything visual.

## How things are built

- Requests are built append-only so the prompt cache keeps working: stored assistant blocks are replayed byte-for-byte, history trims in steps, and anything new goes at the end.
- The interface never reaches the network; model calls and the daily update check run in the main process.
- Comments explain why, in plain sentences, at the density of the surrounding code. UI copy is short, sentence case, no exclamation marks.
