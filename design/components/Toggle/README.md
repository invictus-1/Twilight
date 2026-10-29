# Toggle: switch and checkbox

Two controls for on/off, with different jobs.

- **Switch** (`label.switch` > `input[type=checkbox]` + `span.switch-track`): something that is *running or not* and takes effect at once — a provider, an MCP server. 36×20, the knob slides 120ms; on is an `iris` track with an `on-iris` knob.
- **Checkbox** (`label.check` > `input[type=checkbox]` + text): a setting or a choice in a list — Tools menu rows, "Check spelling as you type", "Ask before each tool call". 16px, `radius-xs`-ish corners (4px), a 1.5px `line-strong` outline on `surface` when off (never a flat grey tile), an `iris` fill with an `on-iris` tick when on.
- Both take the focus ring on `:focus-visible`. Disabled is 50% opacity, and a disabled row says why in its note ("Choose an image model in Settings → Tools first.").
- Dropdowns (`select`) draw the app's own chevron (an `ink-faint` stroke; a darker one in Moonlit Paper), never the system's.
