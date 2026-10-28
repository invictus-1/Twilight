# ModelPicker

A pill-shaped chip showing the active model, opening a grouped menu of every connected provider, cloud or local.

**Markup:** `button.tw-chip` (status dot, model name, `.tw-chip-src` source word, chevron) opening `div.tw-menu[role=listbox]` with `.tw-menu-label` group headings and `.tw-menu-item[role=option]` rows; the selected row has `aria-selected="true"` and an `iris` check. The consumer provides the provider list, each model's state and the selection handler.

- Group by provider, labelled "Provider · API" or "Provider · Local" — cloud models carry the cloud icon, local ones the chip icon.
- Show the model's human name ("Claude Opus 5.5"); put the raw ID (`claude-opus-5-5`) in the message metadata line, set in `code`.
- Right column (`.tw-meta`) holds one fact: context size, "Loaded", or "Not loaded". Never prices in the menu.
- The chip's dot is the provider's live status (`success`, `warning`, `danger`), always repeated as a word in the menu.
- Type-to-filter is expected: focus lands in the menu and typing narrows rows.
