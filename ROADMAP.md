# Twilight roadmap

What's shipped, what's next, and ideas not yet committed to. Twilight shows this file as its Roadmap page (Settings → Roadmap), so keep the shape: `- [x]` shipped, `- [~]` in progress, `- [ ]` planned, each as `**Title** · Area — what it does`.

## Shipped

### 0.3.1 · October 2026
- [x] **Clearer key errors** · Core — pasted keys cleaned up; a rejected key described by its kind, never shown
- [x] **Providers, two panes** · Core — a provider list beside the selected provider's connection and model grid
- [x] **Roadmap page** · Core — this page: a release timeline, cards by area, and ideas

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
- [~] **Releases page tour** · Core — screenshots made from demo data and a feature tour
- [ ] **Welcome** · Core — an animated first run: the cover's bands slide in, the sun sets, and setup follows (a provider or local server, a writing folder)
- [ ] **Command menu** · Core — Ctrl+K for everything, Ctrl+/ for the shortcut sheet, rebindable keys
- [ ] **Search everything** · Core — every chat and document at once (Ctrl+Shift+F)
- [ ] **Context meter** · Chat — tokens used against the model's window
- [ ] **PDFs and images** · Chat — attach them (Claude reads them natively) and drop files on the composer
- [ ] **Choice card keys** · Chat — pick with 1–9, ask for more options, and a default for adventure workspaces
- [ ] **Branch into a new chat** · Chat — start a new chat from any message
- [ ] **Instruction changes mid-chat** · Chat — change the instructions without breaking the cache
- [ ] **Syntax highlighting** · Chat — for code blocks
- [ ] **Your own prices** · Chat — an editable price list, and OpenRouter's reported cost
- [ ] **Game Format everywhere** · Writing — in the editor too, and for a whole chat
- [ ] **Document picker** · Writing — attach documents from the writing folder
- [ ] **Folder management** · Writing — rename and delete document folders in Twilight
- [ ] **More undo** · Core — undo for deleting chats and moving things
- [ ] **Judge leaderboard** · Judge — a running tally across judgments, and more than two passages at once
- [ ] **Code signing** · Core — a signed installer, so Windows doesn't warn

## Later
- [ ] **Tools and MCP** · Chat — web search, web fetch, date and time, image generation, switched on per chat
- [ ] **Agents and code** · Chat — an agent loop for any model with tool calling, with approvals and diffs
- [ ] **Themes** · Core — Midnight, Synthwave, Aurora, Campfire, Moonlit Paper, High contrast, and a theme builder
- [ ] **Motion** · Core — a startup animation, a retro home screen, transitions between pages
- [ ] **Stats** · Core — words, tokens, spend, active days and streaks; quiet achievements
- [ ] **Personas and prompts** · Chat — a library of personas and prompts
- [ ] **Split differences** · Chat — see what changed between the two panes
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
