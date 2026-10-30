# Changelog

Each version's section becomes its release notes on the releases page (`npm run release`), and Twilight shows them in Settings > Updates.

## Unreleased

- **Models on this PC** (Settings → Models on this PC): search Hugging Face for a model and open it to see every size, each marked with how it would run here: on your graphics card, partly in memory (slower), on the processor, or too large, worked out from this PC's memory and graphics card. Download one in a click (a model in parts too, and a stopped download picks up where it left off). Twilight fetches llama.cpp from its official releases and runs it for you: one server for every model in the folder, loading the one a chat asks for, in the model picker as This PC. LM Studio and Ollama still work as before.
- **Running models on this PC, your way:** each downloaded model has settings of its own: how much context, and whether it goes on the graphics card as far as it fits, all of it, or not at all. The page shows what llama.cpp has loaded, with its context and the memory it takes on the card and in system memory, and Unload frees it. Good first models suggests a few well-known models at the usual size, leaving out any too large and marking the best for this PC. The model picker has Find a model to run on this PC. The search lists only models that can chat, and a model's sizes no longer include helper files that come with it. The page opens at once: reading the graphics card took most of a minute on some PCs and now takes a moment.
- **The context scout** (the first piece of 2.0, off until you choose a model): in Settings → Documents, pick a small fast model as the scout (Claude Haiku, or a local one) and before each reply it reads the library's best candidates for your message, asks for a few more searches if something is missing, and picks what the reply needs. What it picks comes as whole stretches of story in the order a reader meets them (Chapter 2 before Chapter 10), up to a word budget you set, rather than the top few snippets by score. If the scout fails, plain search answers as before. Try it from the search box with Scout, and judge it with Test the scout: a file of your own questions, each run through plain search and through the scout, with how much of what it needed each one found.
- **Passages know where they sit:** the document library keeps the headings above each passage ("Part one › The storm"), searches them with it and shows them beside it, and a heading always starts a new passage. The library is read again once to add them.
- **Surprises, modelled:** the sky's easter eggs are now little low-poly models made in Blender: a UFO whose lights turn as it bobs across and beams something up, a sky whale swimming past with its tail beating, a lighthouse on the horizon whose beam sweeps the sky, and a hot air balloon rising past the sun. Each takes the theme's colours and loads only when it appears. And Phosphor has a visitor of its own, if you look closely and keep very still.
- **Compacting, while it runs:** the bar above the message box counts the time and has Cancel (from the command menu too), and the summary gets the model's whole output allowance, so a big chat's summary doesn't run out of room at a reply-sized limit. If it can't finish, it says why.
- **Change a passage of a reply:** select text in a reply and a small toolbar offers Rewrite, Tighten, Expand, or any change you ask for. The model sees exactly what you selected, with the whole chat as context (read from its cache, and never added to the conversation) unless you switch that off. The change shows before and after; Accept saves the reply with it as a new version, the original one ‹ › away.
- **Compact a long chat:** sum up everything before your latest message and carry on from the summary, with that message and its reply kept word for word, quicker and cheaper, with everything above still there to read. With Claude it's Anthropic's own compaction; other models write the summary themselves. Set a size in Settings → General (say 250k tokens) and a quiet bar offers it when a chat gets there, or compact any time from the command menu. Your own summary instructions can replace the model's, and the documents, pictures and instruction changes you attached go in again right after the summary, word for word.

## 1.3.0

**Extras: the sky, small motions and celebrations** (Settings → Extras, each its own switch; Gentle or Off motion stills them all)
- **A sky that follows the clock:** the sky behind an empty chat and above every chat goes from dawn to day, dusk and night as the hours pass, with a moon after dark. Or hold it at the time of day you like.
- **Night falls on a long session:** the top of a chat slowly darkens over a few hours of writing.
- **Seasons** (off at first): snow in winter, petals in spring, fireflies in summer, leaves in autumn, bats and an orange sun around Halloween, and fireworks for the new year.
- **Surprises** (off at first): sit and watch an empty chat for a while, and every so often something crosses the sky.
- **Small motions:** the rail's highlight glides to the section you pick; your message lifts into place when you send it; versions slide in from the side you went; a choice card's options fan in; buttons give a little under a click and menus rise into place; the spinner is a small moon on its orbit.
- **A sun that rises while a reply streams** and **a sweep for a new theme** (both off at first).
- **Constellations:** an achievement's notice draws its own small constellation.
- **A glow for a good day's writing:** a warm light rises from the bottom of the window when the day's words pass 250, 500, 1,000 and on.
- **Warmer light late at night** (off at first): between midnight and 5 am, the colours warm slightly, like a reading lamp.

- **Bookmarks:** star a reply (a turn in the story, a fact worth keeping) and a star in the chat's header jumps between your bookmarks on that branch.
- **What a big message costs, before you send it:** once what's in the box and attached passes about 8k tokens, a line above it gives the size and, for a priced model, roughly what it costs to send (and that it's cached after).
- **Continue:** a reply that stopped at the max output tokens says so, with a Continue button that asks for the rest in a new message, so everything before stays cached.
- **Chats reopen where you left them:** come back to a chat and it's at the message you were reading; left at the newest message, it opens there. Remembered across restarts.
- **A gentle signal when a long reply is ready:** if a reply takes 10 seconds or more and you're in another window when it finishes, Twilight's taskbar button glows until you come back. A quiet Windows notification can come too (Settings → General).
- **Select and copy while a reply is still coming in:** the paragraphs a reply has finished are drawn once and left alone, so you can select and copy them mid-stream without flicker. While you're selecting, the chat stops following the new text; it carries on once you let go.
- **Find on the page (Ctrl+F):** a small find bar lights up every match in the open chat (or Judge, Code, Settings), with "3 of 12", Enter and Shift+Enter to step through them and Esc to close. The writing editor keeps its own find.
- **Choices in the middle of a reply:** when a model puts its numbered choices before other sections, the list still becomes a card, as long as it plainly is a decision (a title like Choices or What do you do?, or a Something else option). The sections after it stay in the reply. Rules drawn around a title ("—— CHOICES ——") are left off the card.
- **Fixed: the delete menu vanished before you could reach it.** Right-click the trash under a message and the menu now stays open until you choose, click elsewhere or press Esc.
- **Bold text in colour:** bold words in chats take a soft shade of the theme's writing colour, so they stand out as you read. In Settings → General, switch it off, or pick any colour you like with the swatch beside it (Use the theme's goes back).
- **Italic text in colour too:** italic words take their own soft colour from the theme (apart from bold's), with the same switch and colour picker.
- **Settings, easier to find your way around:** a new Appearance page holds the theme, background, motion, chat text size and bold and italic colours. General keeps how chats behave (the cache line, spelling, Game Format). Request logs moved to Data, with backups. Library is now Personas and prompts, and Writing is now Documents (the writing folder and the document library), together under a Writing group.
- **Lettered choices:** options written as A. / B. / C., with or without a bullet in front (* A.), become a card like numbered ones.
- **Settings opens on General.**
- **Game Format catches every divider:** with Remove the dividers on, lines like ———, * * * and <hr> go too, as does a --- right under an HTML line.
- **Thinking stays folded until you open it,** while it's being written too, and stays open once you do. The "open as it's written" option is gone.

## 1.2.0

- **The system prompt lives with the chat:** it's no longer in Model settings. On an empty chat, a small System prompt button under the greeting (No system prompt when there isn't one) opens it to check or set before the first message; once the chat starts, it's at the top.
- **Attach opens where you last attached from,** instead of the writing folder every time.
- **What you were typing waits for you:** text and attachments in the message box stay put when you go to another section or Settings and back, and the text is kept across restarts.
- **Fixed: Copy did nothing.** The copy buttons used the page's clipboard, which Twilight refuses along with every other web permission. They now use Twilight's own, and show a tick and "Copied" for a moment.
- **Your message's tools sit under it,** at its right edge (edit, copy, regenerate, delete), like a reply's.
- **Edit without sending:** editing one of your messages offers Save as well as Save and send. A saved edit waits as the newest message, with Send under it for when you're ready.
- **The choice cards how-to, on show:** when choice cards add their how-to to the system prompt, the top of the chat says so, shows what's added, and lets you stop adding it.
- **Each model's own defaults:** in Model settings, Save as this model's defaults keeps its effort, thinking, temperature, max output tokens and extra request JSON. Whenever you pick that model, or a chat starts with it, those settings come with it. The system prompt stays with the chat. Picking a model starts its own prompt cache anyway, so this never costs a cached one.
- **Fixed: a new chat in a workspace could miss the workspace's system prompt.** When New chat reused an empty chat, it only moved it into the workspace, so the chat kept an empty prompt. It's now set up afresh with the workspace's prompt and model.
- **A chat begins under the evening sky:** above the first message is half a screen of the sky from the empty chat, so scrolling to the top of a chat brings it back into view. At its foot is the chat's system prompt.
- **The system prompt, where you can see it:** read, copy or edit it at the top of the chat. Saving a change sends the chat again under the new prompt (the prompt cache restarts), or choose From the next message on to keep the cache.
- **No lost system prompts:** every prompt a chat replaces is kept under Earlier system prompts, with when it was replaced, to read and copy. Replies written under an earlier prompt say so quietly, and open to show the prompt they were written under.
- **The model's thinking, always there:** every reply that thought has a folded Thoughts section under the model's name, saying how long it thought ("Thought for 1m 13s"). Open it to read the thinking. While a reply is being written the thinking shows as it comes; turn that off in Model settings to keep it folded.
- **Chat text size:** Small, Medium or Large in Settings → General, for the words in chats, your messages and the message box. Medium, the new default, is a step bigger than before.
- **Model settings closes when you click outside it.** Pin it with the pin beside the close button to keep it open while you work.
- **The window opens as you left it:** the size and place it had when you closed it, or maximized if it was. A window last left on a monitor that's since been unplugged opens centred on the screen you have.

## 1.1.0

**From your feedback on 1.0**
- **A retro evening in new chats:** the empty chat is now a fuller sky, with a deep field of stars, a band of the galaxy, a striped sun on the horizon and a glowing grid running toward you. It takes each theme's own colours. The grid drifts, a few stars twinkle and the odd shooting star crosses; under Gentle or Off motion it all stays still. The greeting is larger, and says which model is ready when you've picked one.
- **Model settings before the first message:** the Model settings button works with no chat open. It starts the chat your first message would, so the model and its options can be set before you type.
- **Max output tokens takes any number:** type 1000 or 3500 and it stays as typed (it used to jump to the minimum at the first digit, and the arrows moved in steps of 256). The slider still moves in steps of 256.

## 1.0.0

**Faster**
- **The window appears in half the time:** it now shows at once in your theme's colour (274 ms after launch instead of 563 ms on the test machine) rather than waiting, hidden, for its first paint.
- **Less to load at start:** the page reads 0.5 MB of script instead of 1.4 MB. Settings, Judge, Code, Insights and the editor load in the background once the window is up, so they open at once when you get to them.
- **A check that no longer grows with your history:** at start, Twilight looks for replies a crash left unfinished. It used to read every message to do it; now it reads a small index, so a long history no longer slows starting.
- **Measured:** `node scripts/bench.cjs <label>` times startup, opening things, memory and scrolling on a lived-in profile; the numbers before and after are in bench/README.md.

**Polish**
- **Checkboxes and dropdowns look like Twilight's own:** an outlined box when off and a filled tick when on, instead of a flat grey tile; dropdowns draw the app's chevron. Each MCP server has the same on/off switch as a provider.
- **Split view:** the footer under a reply wraps in a half-width pane instead of running off the edge.
- **The Code header:** the folder, the instructions file and the Web switch are matching chips, the model picker is a pill, and on a narrower window the least needed pieces give way first.
- **Smaller things:** the Code session list shows each project folder by name instead of its whole path; a prompt inserted after your words keeps a space between them; hints no longer cover an open Tools or Prompts menu; the empty chat's evening fades into the message box instead of ending in a hard edge; theme cards fill the width; buttons beside a field match its height; diffs have even padding.


## 0.9.0

**Document library**
- **Your writing, searched for each message:** add folders of your own writing and notes in Settings → Writing. Turn on Document library in a chat's Tools menu and each message brings the passages that bear on it, with a chip on the message saying where they came from. A regenerate sends the same passages, so the cache holds.
- **Built for big collections:** a full-text index on this PC (only changed files are read again), so even very large folders are searched in an instant. Hidden folders like .obsidian are left out.
- **Search by meaning:** choose an embedding model (nomic-embed-text on Ollama, say, which keeps everything on this PC) and searches blend word matches with matches by meaning.
- **Models that search for themselves:** Claude, and models whose provider lists tool calling, get a search_library tool to look further mid-reply, rephrasing when the first passages aren't enough.
- **Try a search** in Settings to see what a message would bring.

**Code**
- **Plan mode:** the agent looks around and writes a numbered plan; edits and commands are declined until you press Run this plan (asking first, or accepting edits). The model is told when the plan is approved.
- **A task list:** for longer work the agent keeps a checklist of its steps, shown above the message box as it goes.
- **Project instructions:** a TWILIGHT.md, AGENTS.md or CLAUDE.md at the top of the folder is read into the session, and shown in the header. Change it mid-session and the new version goes in with your next message, so the cache holds.
- **Web search and fetch:** switch Web on for a session with a Claude model, and the agent can search and read pages; each search shows in the transcript.
- **Rewind to any message:** hover one of your messages and choose Rewind to here. Every file changed since goes back, the conversation is cut there (what came before still reads from the cache), and the message returns to the box to edit and send again.

**Look and feel**
- **Arrange the rail:** drag the sections on the left into your own order. The one you hold lifts and follows the pointer, the others slide aside, and a soft outline shows where it will land. Alt+Up and Alt+Down move the focused one. The order is remembered.
- **Moonlit Paper, a light theme:** warm paper, dark ink, accents deep enough to read on it, and a dawn sky on the Roadmap, Insights and the welcome. Every text colour is at least 4.5:1 against what's behind it, and scroll particles paint over the paper instead of glowing. Pick it in Settings → General or with Ctrl+K.
- **The way to 1.0:** on a wide window, the Roadmap has a panel beside it: how far along 1.0 is, each release as a step you can click to jump to, and what has shipped in each area.

**Writing**
- **Spelling:** misspelled words are underlined as you type, in the editor, the message box and everywhere else. Right-click one for suggestions, or to add it to the dictionary. It's Windows' own spellchecker with the languages set in Windows, so it works offline and nothing is downloaded. Switch it off in Settings → Writing.
- **A right-click menu:** cut, copy, paste and select all, wherever you type.

## 0.8.0

**Chat**
- **Regenerate from your own message:** your messages now have a regenerate button too, next to edit and copy. It adds another version of the reply, like the one on the reply itself.

**Your data**
- **Backups:** Settings → Data backs everything up: chats, workspaces, settings, encrypted keys, your background, generated pictures, and your theme, motion and shortcut settings. Each backup is a plain folder, in "Twilight backups" in Documents or a folder you choose. Back up now whenever you like; automatic backups run daily or weekly and keep the last ten (you can change that). Older automatic ones go to the Recycle Bin, and ones you made stay until you remove them.
- **Restore:** pick a backup and Twilight backs up what's there first, restarts, and puts the backup in place before anything opens.
- **Move your data:** keep it on another drive or in a synced folder. Twilight backs up first, restarts, copies everything, checks the copy and only then uses it. The old copy stays where it was until you remove it, and you can move back any time.

**Tools**
- **MCP servers:** add servers in Settings → Tools, either a program on this PC (stdio) or a server at an address (HTTP), then switch them on per chat in the Tools menu. Test shows whether a server connected and lists its tools. Environment values and headers are encrypted like API keys.
- **You approve each call:** by default a tool call waits in the reply, showing the tool and its arguments, for Allow once, Always allow, or Decline. A server you trust can be set to run calls without asking. Stopping the reply declines whatever is waiting.
- **Tools inside the reply:** a reply can call tools over several rounds and carry on with the results. Each round is stored with the reply and resent exactly, so the cache holds. The reply lists every tool it used, with what went in and what came back.
- **Pictures:** choose an image model in Settings → Tools (OpenAI's images endpoint or an OpenRouter image model), switch Pictures on for a chat, and the model can make an image when you ask. It's saved in Twilight's data folder and shown in the reply.
- **Chatting with an image model:** a model that draws (Nano Banana on OpenRouter, for one) is asked for pictures as well as text, and the picture it sends shows under its reply and is kept in Twilight's data folder. Before, the picture was made and billed but not shown. Models like this are marked Image output in the model list; press Test connection on OpenRouter to refresh it.

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
- **Clearer Settings headings:** the group names in Settings (App, Models, About) are now in the accent colour and bold, with a line between groups, so they no longer read like one more page.
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
