# Chip

Small labels that sit in a header or under a message.

- **Header chips** (`.code-chip`): 24px, `radius-sm`, `line` border on `surface-raised`, `caption` text in `ink-muted`. Used in the Code header for the folder (with a folder icon), the project instructions file (in `mono`) and the Web toggle. A chip that toggles is a `button` with `aria-pressed`; pressed is `iris-soft` with an `iris` border.
- **Message chips** (`.attach-chip`, `.instruction-chip`): what went with a message of yours — attached files, "Date and time", "Instructions updated", "From your library · 8 passages" — each with an icon, and a title listing details on hover.
- **Badges** (`tw-badge`, `cap-badge`) are for states and capabilities ("Installed", "Newest", "read-only", "Image output"); see `Badge`.
