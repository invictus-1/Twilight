# Changelog

Each version's section becomes its release notes on the releases page (`npm run release`), and Twilight shows them in Settings > Updates.

## 0.8.0

**Extras**
- **A new Extras page** in Settings, for things that are just for fun. Everything there starts off.
- **Scroll particles:** switch them on and scrolling through a chat throws up particles: a few when you scroll slowly, a shower when you fling. Six styles: Stardust, Sparks, Fireflies, Snow, Constellations (blue stars that join up as they drift) and Bats (dark, outlined in green, flapping up and around). They only follow scrolling you do, not a reply being followed as it streams, show only with Motion on Full, and stop drawing the moment the last one fades.

**Code**
- **A Code tab (Ctrl+5):** open a project folder and work in it with an agent, on any model you've set up. It lists, reads and searches files, edits and creates them, runs PowerShell commands, and asks you when it's unsure, with suggested answers.
- **You approve what changes:** every edit shows its diff first and waits for you. Commands wait too, and those that could delete, overwrite or throw away git work are flagged with a warning and can never be allowed for good. Decline with a reason and the agent reads it.
- **Three modes:** Ask first (the default), Accept edits (changes go through, commands and deletions still ask) and Read only.
- **Nothing is lost:** each change is snapshotted before it's made, so Undo puts back the last one and Undo all every one. Deleted files go to the Recycle Bin. The agent can't reach outside its folder or touch files inside .git, and it's told when you undo something.
- **Cache-friendly:** like chats, each step resends the one before exactly, so long sessions read mostly from the prompt cache; the session shows how much.

**Look and feel**
- **Frame your picture:** with your own background picture, drag the preview to choose which part shows and zoom in to crop tighter.
- **Nebula and Embers now show.** A mistake in how they were written made the window skip them entirely; they're back, much richer: Nebula's clouds have stars through them, and Embers has sparks rising from the glow.
- **Starfield, filled in:** nearly three hundred stars of every size and warmth, and a faint band of sky light across them.

## 0.7.0

**Look and feel**
- **Backgrounds:** Settings → General → Background puts a picture of your own, or one of six gradients (Dusk, Aurora, Nebula, Embers, Deep sea, Starfield), behind the whole window. Darken and Blur keep text easy to read, and the sidebar turns to frosted glass over it. Your picture is copied into Twilight's data folder and never leaves your PC.
- **Five more themes:** Midnight (near-black navy and ice blue), Synthwave (hot pink and cyan on deep purple, with a horizon grid), Aurora (green and violet over dark teal), Campfire (warm amber and gold) and High contrast (black, white and yellow, with strong lines and a thick focus ring).
- **Your own theme:** pick a ground colour and three accents in Settings → General, and Twilight builds the rest. Every colour is checked to keep text readable (4.5:1 or better); one that wouldn't be is lightened, or for the ground darkened, and the page says so.
- **Motion:** pages fade in as you switch, new messages ease in, and the window opens on a moment of evening glow. An empty chat now has a small evening of its own behind the greeting. Settings → General → Motion has Full, Gentle (fades only) and Off, and Windows' "reduce motion" setting counts as Gentle.

**Chat**
- **Web search and web fetch:** switch them on per chat in Tools. Claude uses Anthropic's own search and page reading (billed per search) and OpenRouter uses its web plugin. Replies show what was searched and read, with numbered sources that open in your browser.
- **Date and time:** each message you send can carry your local date, time and time zone. It goes into that message, not the system prompt, so earlier messages and the cache stay as they were.
- **Split differences:** a Differences button in split view marks the words that differ between the two panes' latest replies, each in its pane's colour, with a count and a similarity. Very long replies are compared paragraph by paragraph.
- **Personas:** a persona is a saved system prompt with a name and a one-line description, and optionally a model and choice cards. Start a chat from one with "New chat from a persona…" in the command menu or from Settings → Library. In a chat that's already going, apply one from Model settings, either as the system prompt (the cache restarts) or as a change from the next message (the cache holds).
- **Prompts:** save the messages you send often and put one in the message box from the new Prompts button in the composer. A prompt with `{{input}}` asks for that part first. Settings → Library keeps personas and prompts, and exports or imports them as one file.

**Usage**
- **Usage page:** Settings → Usage shows your tokens and spend over the last 7 days, 30 days, 12 months or all time, with a bar for each day or month, a table by model, and the chats that spent most. Judge runs count as their own line, and anything without a price is named, with a link to Prices.
- **Priced with your own list:** every count uses today's prices, yours included, so changing a price re-prices the past too. Ctrl+K → Usage goes straight there.

## 0.6.0

**Installing**
- **An installer that looks like Twilight:** the same evening as the app's welcome, with the sun setting behind the wordmark, a glowing progress bar, and Open Twilight at the end. It installs just for you, never asks for admin rights, and updates stay silent. On a PC without Microsoft's WebView2, the classic installer opens instead.

**Chat**
- **Your own prices:** Settings → Prices takes a price per million tokens for any model, with * for whole families, and overrides the built-in list. Local models can be priced too.
- **OpenRouter's own cost:** replies through OpenRouter show what OpenRouter says they cost.

**Judge**
- **Leaderboard:** a running tally of every judgment by who wrote each passage, with wins, losses, ties, average score and an Elo-style rating. It's at the top of the Judge sidebar; judgments count when both passages are labelled.
- **More than two passages:** add up to six to one comparison. Every pair is judged blind, in both orders, as its own judgment, and the round gets its own leaderboard. Pairs share the cached context and run three at a time, so a round stays inside ordinary rate limits.

**Fixes**
- The welcome's tagline no longer touches the "g" in the wordmark.

## 0.5.0

**Getting around**
- **Command menu (Ctrl+K):** every command, chat and document by name. Letters in order are enough ("splt" finds Clone into split), arrows move, Enter runs.
- **Search everything (Ctrl+Shift+F):** every message in every chat and every document in the writing folder, as you type. A result opens its chat at the message (switching versions if it's on another one), or its document with the match selected.
- **Shortcut sheet (Ctrl+/)** and **rebindable keys:** Settings → Keyboard shortcuts lets you give any command your own keys, or none. New: Ctrl+1 to Ctrl+4 switch between Chats, Writing, Judge and Insights.

**Chat**
- **Context meter:** the cache bar shows how much of the model's context window the chat fills, with a bar that turns amber at 70% and red at 90%. Split panes show it in their footers.
- **Branch into a new chat:** a new button on every reply starts a new chat with everything up to there. Messages are copied exactly, so the branch's first message still reads from the prompt cache.
- **Change instructions without losing the cache:** Model settings has a new box for instructions that apply from your next message on. They go into that message instead of the system prompt, so everything before it stays cached. The composer shows the change is queued, and the message carries an "Instructions updated" chip.
- **Choice card keys:** press 1–9 to pick (Alt+1–9 while typing). With several decisions, each number fills the next one and Enter sends. **More options** asks the model for different ones.
- **Adventure workspaces:** a workspace can start its new chats with choice cards on.
- **Images and PDFs:** attach them with the paperclip, drop them on the composer, or paste a screenshot. They go to the model as the files themselves (Claude reads both natively; OpenAI-compatible servers get image and file parts), and replay unchanged so the cache holds. Images show a thumbnail before sending.
- **Attach a document:** a new button next to the paperclip finds a document in your writing folder and attaches its text.
- **Game Format for a whole chat:** "Copy the chat for a game" in the command menu copies every reply on the thread, reflowed, without the choice cards.
- **Undo for more things:** moving a chat to the trash, moving a chat or document, renaming, and deleting a workspace (it comes back with its settings and chats) all offer Undo.
- **Syntax highlighting** in code blocks, in each theme's own colours, for the languages models write most. Twilight's own highlighter, so it adds no weight and keeps up while a reply streams.

**Look and feel**
- **Section rail:** Chats, Writing, Judge and Insights moved from tabs to a rail down the left edge, each an icon with its name, with Search and Settings at the bottom. It stays when the sidebar is hidden; click the section you're in to hide or show the sidebar. The sidebar can now go narrower.
- **Three new themes:** Phosphor (black and green, like an old terminal), Nightshade (black with royal purple) and Ember (black and red, with orange and gold). Pick one in Settings → General, in the welcome, or from the command menu. Every theme keeps text readable to the same contrast standard.

**Writing**
- **Rename and remove folders and documents** from the sidebar (hover a row). Removing goes to the Recycle Bin, never straight to deletion, and asks once first. Document context follows a rename.
- **Game Format in the editor:** copies the selection, or the whole document.

**Writer insights**
- Moving or renaming a file is no longer counted as new writing.
- **Earlier results:** Story analysis, Focus and Insights keep up to 30 past results each. Pick one from "Earlier results" to read it again, or remove it.
- **Calls at once:** a deep scan can read 1 to 10 parts of your manuscript at the same time. The same model still writes the final themes.
- **Edits cost less to rescan:** where a deep scan cuts your text into parts now depends on the text itself, not on counting from the top. An edit only changes the part it's in, and the rest are never paid for twice.
- Common words like "The" are no longer suggested as character names.

**Fixes**
- The sidebar can't be dragged so narrow that the tab names get cut off.

## 0.4.0

**Writer insights** (a new tab)
- Your writing folder seen as numbers, opening on today's count under a twilight sky:
  - **Dashboard:** words written today, this week, month and year; your streak and best day; the last 14 days.
  - **Heatmap:** every day of the year you wrote, plus the hours you write in.
  - **Word analysis:** sentence length, dialogue share, adverb density, vocabulary, most used words.
  - **Characters:** screen time, who shares scenes with whom, where each one lives. Names are suggested from your text; aliases count as the same character.
- Words written are measured as your files grow, so they count wherever you write: in Twilight, Obsidian or anything else.
  - The first scan is a baseline: a finished manuscript isn't "written today".
  - A big new file is treated as an import, and cutting text never counts against you.
- Files are read in the background, and only the ones that changed. Millions of words take seconds.
- **Achievements:** 43 of them. Ones you'd already earned unlock quietly; new ones share a single notice.
- **Story analysis** (AI):
  - A quick sample, or a deep scan of every word, giving content breakdown, genres, tags with subtags, themes and a summary.
  - The deep scan never pays twice for text that hasn't changed, and you see the cost estimate first.
- **Focus** (AI): a few concrete things to work on, with quotes from your recent writing and an exercise for each.
- **Insights** (AI): observations about your habits and rhythms, from your statistics only. No manuscript text is sent.
- **Reports:** week, month, year and all-time recaps as single HTML files that open in your browser, optionally with your saved AI results.

**Look and feel**
- New **Ultraviolet** theme (Settings → General → Appearance): deep violet with magenta and pink. The window frame follows.
- **Tools** menu in the composer: choice cards, the choice-menu tool, how choices are read, and the how-to, all in one place. Choices and Tools explain themselves when you hover.
- **Model providers, redesigned:** providers on the left; the one you pick fills the right with its connection settings and a grid of its models. A provider without models shows the steps to get some.
- **Models start hidden:** tick the ones you want in the picker, with Show all and Hide all. After updating, only the model you're using stays ticked.
- **Roadmap page** in Settings: what has shipped, what's next and what's later, as a timeline and cards.
- Clicking a tab while Settings is open now closes Settings.
- Saving a document no longer fails now and then on Windows when another program (an antivirus scan, a sync client, Obsidian) has the file open for a moment; Twilight retries the save.

**Clearer API key problems**
- A pasted key is cleaned up before it's saved: an `ANTHROPIC_API_KEY=` or `x-api-key:` prefix, `Bearer`, quotes, and spaces or line breaks from copying. Keys you already saved are cleaned too.
- When Anthropic rejects a key, Twilight says what kind of key it is (never the key itself):
  - a Claude subscription sign-in token (`sk-ant-oat…`), which the API doesn't accept;
  - a key from another service;
  - or a real API key that's been revoked or deleted.
- An Anthropic endpoint written with `/v1` at the end now works; Twilight no longer doubles it.

**One repository**
- Twilight's source, releases and this changelog now live together at github.com/invictus-1/twilight, and updates come from its releases. If you have an earlier version, install this one by hand once.

## 0.3.0

**Choices as a tool call**
- New in Model settings, under Choice cards: each way of offering choices has its own switch. Turn on any combination:
  - **Tool call:** the model calls `present_choices` with the options as data. The card is drawn from that, so there's no text format to follow or misread.
  - **Choices blocks:** a ```` ```choices ```` block written in the reply.
  - **Plain numbered options:** written at the end of the reply, under a title that asks or with a "Something else" option.
- Your pick goes back to the model as the call's result: one line per decision ("Outfit: Coat"), or just the pick when there's one. Groups, context lines, option details and the "Something else" box all work the same as with text choices.
- Works with Claude and with OpenAI-compatible servers whose models support tool calling (OpenRouter, LM Studio, Ollama, llama.cpp with tool support).
- "Add Twilight's how-to to the system prompt" is its own switch. It adds one instruction at most: for the tool if that is on, otherwise for choices blocks. Turn it off when your own prompt already explains how to offer choices.

## 0.2.0

**Updates**
- New Settings > Updates page. It shows your version and when you installed it, checks for new releases once a day (or when you click Check now), and updates in one click.
- You can roll back to any of the last three versions. Twilight saves a copy of its database before every switch and keeps the last three copies.

**Settings and providers**
- Settings is now a full page with sections, and each section says what it's for.
- Model providers page: each provider shows its status, model count, an on/off switch and Test connection. Each model shows the context size, output size, capabilities and effort levels its provider reports. You can rename or hide a model, or add one by hand.
- Fixed: Anthropic keys were rejected when Twilight was started from a terminal that had its own Anthropic endpoint set.

**Chat**
- Message actions:
  - Edit any message. The edit is saved as a new version, and editing your own message gets a new reply.
  - Delete a message, or right-click the trash to delete it and everything below it.
  - Undo straight after a delete, or open Recently deleted later to read or restore it. A restore after later messages comes back as another version.
- Replies show tokens per second.
- Choice cards from plain text: with Choices on, numbered options at the end of a reply become a card when they look like a decision, either with a "Something else" option or under a title that asks ("What do you do?", "Choices (Night)"). Other numbered lists stay lists.
- One reply can hold several decisions, such as an outfit and then what to do, or one per character. You pick in each one, and nothing sends until you press Send choices. Options keep the detail bullets written under them, and "Something else" becomes a box for your own words.
- You can drag the sidebar edge and the split divider to resize them. Double-click either one to reset it.

## 0.1.0

First build: chat with Claude and local or OpenAI-compatible models, split compare, the Writing editor with Forge-style tools, workspaces, the Judge, Game Format, choice cards and status card rendering.
