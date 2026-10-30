# Start here

For a Claude session picking up Twilight with no memory of how it got here. Read this, then [CLAUDE.md](../CLAUDE.md) (ground rules and a map of the code), then skim [CHANGELOG.md](../CHANGELOG.md) and [ROADMAP.md](../ROADMAP.md). Together they are everything earlier sessions knew.

## What Twilight is

A fast, local-first Windows desktop app (Electron + React + TypeScript, SQLite) for writing with language models. Its owner built it with Claude for their own work: long-form fiction and text adventures, in chats that run to 300k+ tokens, a manuscript editor for 100k+ words, side-by-side model comparisons and a judge that scores passages. It talks to Claude through the user's own Anthropic API key and to any OpenAI-compatible server (OpenRouter, OpenAI, LM Studio, Ollama, llama.cpp).

It is a personal project released as-is: public repository, Windows only, issues off, no support. The README says so. The owner decides what it does; features follow their workflow.

The two things that matter most, always:

- **Speed.** Scrolling holds the display's rate (they use a 238 Hz screen) on a 350k-token chat, the window is up in under 300 ms, a 115k-word manuscript opens in tens of milliseconds. Claims are measured, not guessed.
- **The prompt cache never breaks by accident.** Every request is the previous one plus new turns: stored replies are replayed byte-for-byte, anything that changes over time goes into the newest message, and tool rounds are stored inside the reply. A change that would restart the cache is either avoided or told to the user.

## Where it stands

**1.0.0 was released on 2026-10-29**, after 0.8.0 and 0.9.0 the same day, and **1.1.0** followed it with fixes from the owner's feedback (a retro evening in empty chats, model settings before the first message, max output tokens taking any number). **1.3.0** (same day) added Extras (a sky that follows the clock with seasons and surprises, a gliding rail, small motions, constellations, a writing glow, warm night light), selecting while a reply streams, Continue, chats reopening where you left them, bookmarks, a done signal, a cost preview, coloured bold and italics, Ctrl+F and a reorganised Settings. Before it, **1.2.0** gathered a day of their requests: the system prompt shown at the top of every chat with earlier prompts kept, per-model defaults, Thoughts with how long the model thought, chat text size, copy that works, edits saved without sending, drafts kept across sections, and the window remembering its place. The roadmap's Next is "Your feedback on 1.0" (fixes from real use, as they come), and Later is "The road to 2.0": the owner wants to *talk through* what 2.0 should be before anything is built. Don't start 2.0 features on your own; bring ideas, ask, and plan together. The Ideas list on the roadmap is where that conversation starts.

Everything in 1.0, in one breath: chats as branching trees with choice cards, personas, prompts, web search and fetch, the date and time, MCP servers and pictures; split compare with differences; the Judge with rubrics and a leaderboard; a Markdown writing editor with Forge-style tools shown as diffs, offline spellcheck and a document library (full-text search, optional embeddings, a search tool for models); Writer insights; a Code tab where an agent edits a folder with approvals, snapshots, plan mode and rewind; usage and prices; backups, restore and moving the data folder; eleven themes (one light), backgrounds, motion settings, a reorderable rail, Extras (scroll particles); a GitHub-releases updater with rollback; an animated installer.

## How we work together

These are the owner's standing agreements. Follow them unless they say otherwise in the conversation.

- **Commits and pushes to `main` are fine without asking**, after the e2e suite passes. Never force-push, never rewrite history, and push to no other repository.
- **Releases are big versions only** (0.8, 0.9, 1.0, …) and are public: always ask before `npm run release`. Build an installer for them to try whenever they ask; they install it and report back, often with screenshots.
- **Nothing personal in the repository**, ever: no names, emails, paths from their machine, their writing, system prompts, rubrics or chats. Tests and screenshots use the invented lighthouse story (Wren, Rowan, Gull Point). Before every push, check new content (screenshots too) for anything that could identify them. Personal files the app can import live in the git-ignored `private/`.
- **Deleting files:** don't delete. Move what should go (test leftovers, old builds, benchmark databases) into a `To delete` folder on their Desktop, create it if needed, and tell them; they empty it themselves.
- **Every feature gets e2e checks** in `src/main/e2e.ts`, and the whole suite must pass before a commit; before a release it must also pass against the packaged app. Keep `CHANGELOG.md` (one section per version; it becomes the release notes) and `ROADMAP.md` (drawn in the app; keep its line format) current with every change.
- **Measure speed work.** Benchmark before changing anything for speed and again after (`node scripts/bench.cjs <label>`), and report the numbers.
- **How they like updates:** short and plain, with the result first: what's done, what was checked, what's left. Screenshots of new UI help. They often add ideas or requests mid-task. Fold them in, say how you handled each, and keep going. They value real fixes over workarounds, and they like seeing the cool things that were made.
- Use subagents when work splits cleanly (a review of screenshots, a parallel feature), and check what they report before acting on it.

## Building, testing, releasing

```bash
npm install
npm run dev                      # the app with hot reload
npm run typecheck
npx electron-vite build          # bundles in out/
npm run dist                     # installer + zip in release/ (the animated installer needs Visual Studio's C++ tools)
npm run release                  # publish release/ as a GitHub release (ask first)
node scripts/bench.cjs <label>   # startup, navigation, memory and scroll on the packaged app → bench/<label>.json
```

The test modes run the real app in a throwaway profile and never touch real data:

```bash
TWILIGHT_E2E=<folder> node_modules/electron/dist/electron.exe .         # ~550 checks → <folder>/e2e.json + screenshots
TWILIGHT_E2E=<folder> release/win-unpacked/Twilight.exe                  # the same against the packaged app
TWILIGHT_SELFTEST=<folder> node_modules/electron/dist/electron.exe .    # scroll timings on a 450-turn chat
TWILIGHT_SHOWCASE=<folder> node_modules/electron/dist/electron.exe .    # README screenshots from demo data
```

A release goes: update CHANGELOG and ROADMAP (mark the version's date) → `npm run dist` → e2e against `release/win-unpacked` → commit and push → ask → `npm run release` (it refuses to publish if any built file holds a path from this machine).

### Things that trip sessions up here

- **Shell heredocs mangle backslashes** in this environment. Write multi-line scripts and patches as files (Python patch scripts with exact find/replace work well) or use the Edit tool. A lost backslash once turned a Windows path split `/[\\/]/` into `/[\/]/`.
- **Deleting is often blocked** (`rm -rf`, `Remove-Item`), which is one reason for the `To delete` folder.
- Run the e2e suite with `node_modules/electron/dist/electron.exe .` directly. Scripts that need `better-sqlite3` outside the app run under Electron with `ELECTRON_RUN_AS_NODE=1` (it's built for Electron's Node).
- One e2e failure is a known, rare flake: "Timed out waiting for replies" (a request never reaches the mock server). Rerun; if it repeats, it's real.
- Scroll timings drift with how busy the machine is. Compare builds back to back in one session, never against an old number.
- Use a fresh folder for each showcase run; a reused profile seeds the demo data twice.
- The window frame colours come from `src/shared/themes.ts`; theme colours from `styles/themes.css`. Minified CSS may shorten `#000000` to `#000`, so compare colours, not strings.

## How the app is put together

[CLAUDE.md](../CLAUDE.md) maps every file. The decisions behind it:

- **Conversations are trees** of messages under a hidden root; regenerating or editing adds a sibling, and the thread is the path of active children. Split compare's pane B is a second branch of the same tree.
- **Requests are append-only** for the cache (see above). Context that changes (date and time, an instruction change, attached files, library passages) is a tagged block in the newest user message (`src/shared/attachments.ts`, `isContextText`).
- **Tools Twilight runs itself** (MCP, pictures, `search_library`) happen inside one reply: Claude rounds are stored as `tool_results` blocks, OpenAI-compatible ones as `tool_round` blocks, replayed exactly (`src/main/providers/`). Each MCP call waits for approval unless allowed.
- **The Code tab** (`src/main/code/`) is our own agent loop: path confinement with realpath, nothing written inside `.git`, a snapshot before every change, deletions to the Recycle Bin, risky commands flagged and never allowed for good, plan mode, rewind, and a stopped turn's results joined to the next message.
- **The interface never reaches the network.** Model calls, MCP, embeddings and the daily update check run in the main process; the window's web requests are blocked.
- **Data safety:** restores and data-folder moves happen at startup, before the database opens, and back up first. The document library's index is its own `library.db`, rebuilt from the files whenever needed.
- **Visual rules** are in [design/](../design/README.md): tokens, themes (never hard-code a colour; Moonlit Paper exposes a missed one), the rail, approvals, toggles, chips.

## How it got here

- **0.1–0.3:** chat with Claude and local models, split compare, the writing editor and its tools, the Judge, choice cards, the installer.
- **0.4:** Writer insights, the updater, the Tools menu.
- **0.5–0.6:** command menu and search, personas and prompts, usage and prices, web tools, the rail, the animated installer.
- **0.7:** themes and the theme builder, backgrounds, motion, split differences, Judge rounds and leaderboard.
- **0.8:** the Code tab, MCP and pictures, backups/restore/moving the data folder, Extras (scroll particles).
- **0.9:** offline spellcheck and a right-click menu, Moonlit Paper, rail reordering, Code plan mode / task list / instructions file / web / rewind, the document library.
- **1.0:** a measured speed pass (the window up in 274 ms, down from 563) and a UI pass over every screen; numbers in [bench/README.md](../bench/README.md).

## The road to 2.0

**1.0 is the foundation; everything past it is extras, cool features and experiments**, and what stays is decided as they're tried. The owner will review this plan and talk it through on their main account before anything is built.

The proposed theme for 2.0, agreed in outline at the end of the 1.0 session: **Twilight knows your story.** Its parts build on each other, so they belong in one release (on the roadmap under Later):

1. **Retrieval research, first.** Look beyond graph RAG at what else exists, and weigh building a fully custom system (on RAG or newer, experimental methods) against the known approaches, before choosing.
2. **Context scout** (the owner's idea): a small, fast model reads each message first and gathers what the main model needs — passages, earlier scenes, facts about the characters in play.
3. **Story bible:** characters, places, relationships and facts from the manuscript and chats, as pages to read and edit.
4. **Continuity watcher:** flags where a reply or a draft contradicts the bible.
5. **Better retrieval underneath:** passages indexed with context about where they sit, and a reranking pass.

The owner's answers (2026-10-29, after 1.1.0):

- **Daily pain:** nothing pressing; they'll say when something comes up.
- **Local models:** they rarely use them, but want them supported for freedom. Prefer talking to llama.cpp's server or LM Studio directly over wrappers like Ollama.
- **The bible:** a middle ground. The user picks which documents feed it (their library has documents such as character profiles and a world state), a model reads those and proposes entries, and retrieval later finds them while writing. It draws on the document library only, so nothing else is touched.
- **Every 2.0 part can be switched off.** Not everyone wants it.
- **Retrieval must be exceptional,** using the newest methods, not the same RAG everyone ships. The research is the first job of the next session.
- **Local models, made easy:** search Hugging Face for models and download them in the app, with a built-in check of what this PC can run (like LM Studio's), so anyone can use local models without the convoluted interfaces most wrappers have. To be explored alongside the retrieval research.
- **Motion:** explore new animations across the app, unique to Twilight, for the owner and for everyone.

Standalone ideas for 2.x afterwards (on the roadmap under Ideas):

- **Ghost text:** autocomplete in the editor from a small local model.
- **Multiverse drafts:** several continuations at once, kept as branches.
- **Blind arena:** split compare with hidden names and a personal leaderboard.
- **Branch map:** the whole conversation tree, drawn.
- **Local-model power tools:** a confidence heatmap from logprobs, branching from any word, more samplers.
- **Offline voice:** dictation and read-aloud without the cloud.
- **Cache savings meter:** what prompt caching saved.
