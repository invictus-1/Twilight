# Rail

The column of sections down the far left edge, on `night`, always visible (it stays when the sidebar is hidden).

**Markup:** `nav.rail` > `.rail-head` (the mark, a drag region) > `.rail-items[role=tablist]` of `button.rail-item[role=tab][data-mode]` (`.rail-icon` over `.rail-label`), then a spacer and `.rail-items.rail-foot` with Search and Settings.

- Each item is an icon (19px) over its name in `caption`. The current one has an `iris-soft` pill behind the icon, `ink` text, and a 3px `iris` bar on the left edge.
- Clicking the current section shows or hides the sidebar; clicking another opens it.
- **Reordering:** a section can be dragged. After 5px of movement it lifts (`surface-raised`, `shadow-lg`, scale 1.06) and follows the pointer; the others slide out of the way (180ms); a dashed `iris` outline marks where it will land. Releasing settles it into place; the drop never also opens the section. Alt+↑ / Alt+↓ move the focused one. The order is stored per install.
- An update available shows as a small `dusk` dot on Settings.
