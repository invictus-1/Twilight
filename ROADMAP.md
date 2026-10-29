# Twilight roadmap

What's shipped, what's next, and ideas not yet committed to. Twilight shows this file as its Roadmap page (Settings → Roadmap), so keep the shape: `- [x]` shipped, `- [~]` in progress, `- [ ]` planned, each as `**Title** · Area — what it does`.

## Shipped

### 0.8.0 · In progress
- [x] **Background framing** · Core — drag and zoom your picture to choose which part shows; brighter Nebula, Embers and Starfield
- [x] **MCP and pictures** · Chat — MCP servers (programs or addresses) switched on per chat, each call approved in the reply unless allowed, and pictures from an image model
- [x] **Extras** · Core — a Settings page for things just for fun, starting with scroll particles in six styles that follow how fast you scroll
- [x] **Code** · Core — its own tab: an agent that reads, edits and runs things in a folder you choose, asks when it's unsure, shows every change as a diff, waits for approval before edits and commands, snapshots before each change so any of it can be undone, and sends deletions to the Recycle Bin

### 0.7.0 · October 2026
- [x] **Custom backgrounds** · Core — your own picture or a gradient behind the app, darkened and blurred to taste
- [x] **More themes** · Core — Midnight, Synthwave, Aurora, Campfire, High contrast, and a theme builder
- [x] **Motion** · Core — page transitions, messages easing in, an evening glow at startup, and a small evening in empty chats
- [x] **Web tools** · Chat — web search and web fetch (Claude's own, or OpenRouter's web plugin) and the date and time, per chat
- [x] **Split differences** · Chat — the words that differ between the two panes, in each pane's colour
- [x] **Usage stats** · Core — tokens and spend over time, by model and by chat
- [x] **Personas and prompts** · Chat — a library of personas and prompts

### 0.6.0 · October 2026
- [x] **Animated installer** · Core — the app's evening as the installer, with a glowing progress bar
- [x] **Your own prices** · Chat — an editable price list, and OpenRouter's reported cost
- [x] **Judge leaderboard** · Judge — a running tally across judgments, and up to six passages at once

### 0.5.0 · October 2026
- [x] **Command menu** · Core — Ctrl+K for everything, Ctrl+/ for the shortcut sheet, rebindable keys
- [x] **Search everything** · Core — every chat and document at once (Ctrl+Shift+F)
- [x] **Context meter** · Chat — tokens used against the model's window
- [x] **Branch into a new chat** · Chat — start a new chat from any reply, cache intact
- [x] **Choice card keys** · Chat — pick with 1–9, ask for more options, and a default for adventure workspaces
- [x] **Syntax highlighting** · Chat — for code blocks, in every theme
- [x] **Instruction changes mid-chat** · Chat — change the instructions from the next message on, cache intact
- [x] **PDFs and images** · Chat — attach them (Claude reads them natively), drop files on the composer, paste screenshots
- [x] **Document picker** · Writing — attach documents from the writing folder
- [x] **Folder management** · Writing — rename and remove documents and folders in Twilight
- [x] **Game Format everywhere** · Writing — in the editor too, and for a whole chat
- [x] **More undo** · Core — undo for trashing chats, moving, renaming and deleting workspaces
- [x] **Section rail** · Core — a vertical row of icons with names for every section, sleeker than tabs
- [x] **Colour themes** · Core — Phosphor (black and green), Nightshade (purple) and Ember (red), alongside Twilight and Ultraviolet
- [x] **Earlier results** · Writing — every AI page keeps its past results to read again
- [x] **Parallel deep scans** · Writing — 1 to 10 calls at once, finished by the same model
- [x] **Cheaper rescans** · Writing — parts are cut by the text itself, so an edit only re-reads its own part

### 0.4.0 · October 2026
- [x] **Writer insights** · Writing — dashboard, heatmap, word analysis and characters for the whole writing folder, counted as files grow
- [x] **Achievements** · Writing — 43 of them, earned quietly, one notice at a time
- [x] **Story analysis** · Writing — content, genres, tags and themes by a model you choose; deep scans never re-bill unchanged text
- [x] **Focus and Insights** · Writing — things to work on, and what your numbers say about how you write
- [x] **Reports** · Writing — week, month, year and all-time recaps as single HTML files
- [x] **Ultraviolet theme** · Core — deep violet with magenta and pink
- [x] **Tools menu** · Chat — every choice switch in one place, with hover help
- [x] **Models start hidden** · Core — tick the models you want in the picker
- [x] **Clearer key errors** · Core — pasted keys cleaned up; a rejected key described by its kind, never shown
- [x] **Providers, two panes** · Core — a provider list beside the selected provider's connection and model grid
- [x] **Roadmap page** · Core — this page: a release timeline, cards by area, and ideas
- [x] **Open source** · Core — source, releases and a feature tour in one public repository

### 0.3.0 · October 2026
- [x] **Choices as a tool call** · Chat — the model calls present_choices with the options as data; the pick goes back as the tool result
- [x] **A switch for each way of offering choices** · Chat — tool call, choices blocks and plain numbered options, in any combination

### 0.2.0 · October 2026
- [x] **Updates page** · Core — daily check of the releases page, one-click update, roll back to any of the last three versions, a database backup before every switch
- [x] **Settings page** · Core — sections for General, Writing, Data, Shortcuts, Model providers, Updates and About, each described
- [x] **Model providers page** · Core — status, model count, on/off and Test connection per provider; capabilities, context and output size per model; rename, hide or add models
- [x] **Message actions** · Chat — copy, regenerate, edit as a new version, delete one or everything below, undo, Recently deleted, tokens per second
- [x] **Choice cards from plain text** · Chat — numbered options under a title that asks or with "Something else"; several decisions in one reply; options with details
- [x] **Resizable layout** · Core — drag the sidebar edge and the split divider; double-click to reset
- [x] **Rubrics as files** · Judge — import and export your own rubrics; only the general one ships

### 0.1.0 · October 2026
- [x] **Fully local app** · Core — bundled fonts, no network from the interface, keys encrypted with Windows DPAPI, model list cached for offline use
- [x] **Claude and any OpenAI-compatible server** · Core — Anthropic with adaptive thinking and refusal fallback; Ollama, LM Studio, llama.cpp, vLLM and OpenRouter
- [x] **Conversations as trees** · Chat — regenerate adds a version, ‹ 2 / 3 › to switch between them
- [x] **Split compare** · Chat — two branches side by side, A / B / Both, each pane with its own model, settings and system prompt
- [x] **Cache-first requests** · Chat — prompts built append-only, a cache status line, and same-model split sends staggered so B reads A's cache
- [x] **Model settings** · Chat — presets, editable system prompt, message limit in cache-friendly steps, effort in the provider's own names, max output, extra request JSON
- [x] **Workspaces** · Chat — pinned, workspaces and recent; drag to file; a default system prompt, model and color per workspace
- [x] **Markdown and safe HTML** · Chat — tables, footnotes, code blocks, collapsible details blocks, scripts and handlers stripped
- [x] **Game Format** · Chat — copy a reply for RPG Maker with paragraphs joined and code untouched
- [x] **Choice cards** · Chat — click an option, edit it first, or write your own
- [x] **The Judge** · Judge — two passages scored blind against a rubric, in both orders, with shared context cached
- [x] **Writing editor** · Writing — markdown documents in any folder (Obsidian vaults too); 115k words open in about 35 ms
- [x] **Forge-style tools** · Writing — Ask, Rewrite, Tighten, Expand and Tone on a selection, shown as an in-place diff you accept or reject
- [x] **Document context** · Writing — instructions, reference documents and the whole manuscript, cached
- [x] **240 Hz scrolling** · Core — measured on a 350k-token chat
- [x] **Installer** · Core — Windows installer and portable zip, with Twilight artwork

## Next
- [~] **Your feedback on 0.8** · Core — fixes from real use of the Code tab, Extras and backgrounds

## Later
- [ ] **Polish pass** · Core — once nearly feature-complete: an optimization run and a UI/UX pass over every screen, with more gradients and motion. Startup, chat-open and scroll times are measured before and after, so the gains are real numbers
- [ ] **Code, further** · Core — a plan mode that agrees the steps first, a project instructions file the agent reads, web search in Code, and a checkpoint per message you can rewind to
- [ ] **A light theme** · Core — Moonlit Paper: a soft, paper-light theme (Twilight is dark throughout today)
- [ ] **Document library** · Writing — retrieval over very large collections with local embeddings
- [ ] **Offline spellcheck** · Writing — bundled dictionaries
- [ ] **Your data, your place** · Core — choose where app data lives, scheduled backups

## Ideas
- **Story bible** · Writing — characters, places and facts pulled from a manuscript, with a continuity watcher
- **Ghost text** · Writing — autocomplete in the editor from a small local model
- **Multiverse drafts** · Chat — several continuations at once, kept as branches
- **Blind arena** · Judge — split compare with hidden names and a personal leaderboard
- **Branch map** · Chat — the whole conversation tree, drawn
- **Local-model power tools** · Chat — a confidence heatmap from logprobs, branching from any word, more samplers
- **Offline voice** · Core — dictation and read-aloud without the cloud
- **Cache savings meter** · Chat — what prompt caching saved you
