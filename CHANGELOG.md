# Changelog

Each version's section becomes its release notes on the releases page (`npm run release`), and Twilight shows them in Settings > Updates.

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
