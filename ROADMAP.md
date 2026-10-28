# Twilight roadmap

What's done, what's next, and ideas we haven't committed to. Updated with every change; tick a box when it ships.

## Done

### Core
- [x] Electron + React + TypeScript app, fully local interface (bundled fonts, renderer network blocked, keys encrypted with Windows DPAPI)
- [x] Providers: Anthropic (streaming, adaptive thinking, refusal fallback) and any OpenAI-compatible server (Ollama, LM Studio, llama.cpp, OpenRouter)
- [x] Model list cached on disk so it works offline
- [x] Per-reply cost, tokens and cache hit rate
- [x] Request logs (daily JSONL) and a Trash for deleted chats
- [x] Windows installer and portable build (`npm run dist`), with Twilight artwork on the installer pages
- [x] Settings page with sections (General, Writing, Data, Shortcuts, Model providers, About), each described
- [x] Model providers page: per-provider status, model count, on/off, Test connection; models with capabilities, context and output size read from the provider; rename, hide, or add models by hand
- [x] Draggable sidebar edge and split divider (double-click resets)

### Chat
- [x] Conversations as trees: regenerate adds a version, ‹ 2 / 3 › switcher
- [x] Message actions: copy, regenerate, edit (as a new version), delete; right-click delete for "this and everything below"; undo toast; Recently deleted panel to read or restore (a restore after later messages comes back as another version); tokens per second
- [x] Split compare with A / B / Both, per-pane model, settings and system prompt; Keep A / Keep B
- [x] Prompt caching built append-only; same-model split sends stagger so B reads A's cache
- [x] Cache status bar (hit / written / off), dismissable
- [x] Model settings: presets, editable system prompt, recent message limit (cache-friendly steps), temperature, max output tokens, thinking effort in the provider's own names, thinking display, caching on/off + TTL, extra request JSON
- [x] Effort levels read from the Anthropic Models API per model; OpenRouter parameters read from its model list
- [x] Attach text files to a message (full text injected)
- [x] Workspaces: pinned / workspaces / recent, drag to file, default system prompt + model + color per workspace
- [x] Full markdown (tables, task lists, footnotes, code blocks with copy and collapse) plus safe HTML: collapsible `<details>` blocks (status cards), with scripts, images and event handlers stripped
- [x] Game Format: copy a reply for RPG Maker with paragraphs joined, dividers optional, code and HTML blocks untouched
- [x] Choice cards for text adventures: the model offers numbered options (any model, no tool calling needed); click one, edit it before sending, or write your own; answered cards show the pick; with Choices on, plain-text options from your own system prompt work too (a "Something else" option or a title that asks marks them as a decision; other lists stay lists), including several decisions in one reply with options that carry details
- [x] **Judge**: two passages scored blind against a rubric by a judge model you choose, run in both orders, with shared context (system prompt, author prompt, reference files) cached across runs; "Judge A vs B" from split compare; a built-in General fiction rubric, your own rubrics (create, copy, import and export as files); reveal who wrote which after scoring
- [x] 240Hz scrolling on a 350k-token chat (measured with `TWILIGHT_SELFTEST`)

### Writing
- [x] Markdown documents in a chosen folder (Obsidian vaults work as is), real subfolders, drag to move
- [x] CodeMirror editor: 115k words open in ~35ms, atomic autosave, picks up outside edits
- [x] Forge-style tools on a selection: Ask, Rewrite, Tighten, Expand, Tone, plus formatting and undo/redo
- [x] Suggestions shown as an in-place word diff; Accept / Reject; every accepted edit revertable
- [x] Per-document context: instructions, reference docs, optional whole manuscript (cached)
- [x] Send a chat reply to Writing

## Next
- [ ] Releases page: screenshots (demo data only) and a feature tour
- [ ] A designed roadmap page
- [ ] **Updates page**: check GitHub for a new release once a day (and on demand), show the installed version and when it was installed, update in one click, and roll back to any of the last 2–3 versions kept on disk. Needs a decision: releases on a public repo (no token) or a read-only GitHub token for the private one
- [ ] Animated first-run welcome: the cover's bands slide in and the sun sets, flowing into setup (provider key or local server, writing folder, theme)
- [ ] Choice cards: keyboard picks (1–9), a "suggest more options" button, and per-workspace default for adventure workspaces
- [ ] Code signing when Twilight is shared (Azure Trusted Signing or an OV certificate)
- [ ] Judge follow-ups: a personal leaderboard across judgments; judge more than two passages
- [ ] Game Format in the Writing editor too, and a "copy as game format" for a whole chat
- [ ] Undo toast for more destructive actions (chat delete, moves)
- [ ] Command menu (Ctrl+K) and the full shortcut sheet (Ctrl+/), rebindable shortcuts
- [ ] Search across all chats and documents (Ctrl+Shift+F)
- [ ] Branch from any message into a new chat
- [ ] Context meter: tokens used vs the model's window
- [ ] Code blocks: syntax highlighting
- [ ] Attach PDFs and images (Claude reads them natively); drag files onto the composer
- [ ] Attach documents from the writing folder in a picker
- [ ] Rename and delete document folders inside Twilight
- [ ] Mid-conversation instruction changes without breaking the cache (Claude system messages)
- [ ] Editable price list for cost (and OpenRouter's reported cost)

## Later
- [ ] Tools and MCP: web search, web fetch, date/time (as a tool, so the cache holds), image generation; toggles like OpenRouter's server tools
- [ ] Agents and a coding workspace for any model with tool calling (own agent loop; MCP tools; approvals and diffs)
- [ ] Fusion (to design together)
- [ ] Personas and a prompt library
- [ ] Difference view between split panes
- [ ] Judge / shadow persona that compares or merges A and B
- [ ] Document library with optional retrieval for very large collections (local embeddings)
- [ ] Stats page: words typed, tokens in/out, spend, active days, streaks; achievements (quiet, no pop-ups)
- [ ] Themes: fine-tuned Twilight, Midnight (OLED), Synthwave, Aurora, Campfire, Moonlit Paper, High contrast, theme builder
- [ ] Startup animation from the cover, animated retro home screen, view transitions between pages
- [ ] Bundled spellcheck dictionaries (offline)
- [ ] Choose where app data lives; backups

## Ideas (not committed)
- Story bible: extract characters, places and facts from a manuscript; a continuity watcher flags contradictions
- Ghost-text autocomplete in the editor from a small local model
- Multiverse drafts: several continuations at once, kept as branches
- Blind arena: split compare with hidden model names and a personal leaderboard
- Branch map: the whole conversation tree, visually
- Local-model power tools: confidence heatmap from logprobs, click a word to branch from an alternative; min-p / DRY / XTC samplers
- Offline voice: Whisper dictation, Piper/Kokoro read-aloud
- Cache savings meter
