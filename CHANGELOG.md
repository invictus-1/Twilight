# Changelog

Each version's section becomes its release notes on the releases page (`npm run release`), and Twilight shows them in Settings > Updates.

## 0.3.1

**Clearer API key problems**
- A pasted key is cleaned up before it's saved: an `ANTHROPIC_API_KEY=` or `x-api-key:` prefix, `Bearer`, quotes, and spaces or line breaks from copying. Keys you already saved are cleaned too.
- When Anthropic rejects a key, Twilight says what kind of key it is (never the key itself):
  - a Claude subscription sign-in token (`sk-ant-oat…`), which the API doesn't accept;
  - a key from another service;
  - or a real API key that's been revoked or deleted.
- An Anthropic endpoint written with `/v1` at the end now works; Twilight no longer doubles it.

**Model providers, redesigned**
- Providers are listed on the left. The one you pick fills the right side: connection settings side by side, then its models as a grid of cards.
- A provider without models shows the steps to get them instead of an empty box.

**Roadmap**
- New Settings → Roadmap page: what has shipped (a timeline of releases), what's next, what's later and the ideas, filterable by area.

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
