// Line icons, 16px on a 24px grid, 1.5px stroke, drawn in currentColor (see the design system's
// Iconography section). Placeholders until we adopt a full icon set.

type Props = { size?: number; className?: string; style?: React.CSSProperties }

function Icon({ size = 16, className, style, children }: Props & { children: React.ReactNode }) {
  return (
    <svg className={`tw-icon ${className ?? ''}`} style={style} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

export const PlusIcon = (p: Props) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
export const SendIcon = (p: Props) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
export const StopIcon = (p: Props) => <Icon {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" /></Icon>
export const CopyIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Icon>
)
export const RefreshIcon = (p: Props) => (
  <Icon {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></Icon>
)
export const ChevronDown = (p: Props) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>
export const ChevronLeft = (p: Props) => <Icon {...p}><path d="M15 6l-6 6 6 6" /></Icon>
export const ChevronRight = (p: Props) => <Icon {...p}><path d="M9 6l6 6-6 6" /></Icon>
export const CheckIcon = (p: Props) => <Icon {...p}><path d="M5 12l5 5 9-10" /></Icon>
export const CloseIcon = (p: Props) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>
export const SettingsIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
)
export const SlidersIcon = (p: Props) => (
  <Icon {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Icon>
)
export const DocIcon = (p: Props) => (
  <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" /></Icon>
)
export const PaperclipIcon =(p: Props) => (
  <Icon {...p}><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" /></Icon>
)
export const PenIcon =(p: Props) => <Icon {...p}><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" /></Icon>
export const UndoIcon =(p: Props) => <Icon {...p}><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></Icon>
export const RedoIcon = (p: Props) => <Icon {...p}><path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></Icon>
export const FolderIcon = (p: Props) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>
)
export const FolderPlusIcon = (p: Props) => (
  <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5" /></Icon>
)
export const PinIcon = (p: Props) => (
  <Icon {...p}><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5" /></Icon>
)
export const SplitIcon = (p: Props) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></Icon>
)
export const SidebarIcon = (p: Props) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Icon>
)
export const TrashIcon = (p: Props) => (
  <Icon {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Icon>
)
export const CloudIcon = (p: Props) => <Icon {...p}><path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z" /></Icon>
export const ChipIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </Icon>
)
export const GridIcon = (p: Props) => (
  <Icon {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Icon>
)
export const CalendarIcon = (p: Props) => (
  <Icon {...p}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></Icon>
)
export const BookIcon = (p: Props) => (
  <Icon {...p}><path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5C17 4 14 4.5 12 6zM12 6v14.5" /></Icon>
)
export const PeopleIcon = (p: Props) => (
  <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c1.7.6 2.8 2.4 3 5.5" /></Icon>
)
export const SparkIcon = (p: Props) => (
  <Icon {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></Icon>
)
export const TargetIcon = (p: Props) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></Icon>
)
export const BulbIcon = (p: Props) => (
  <Icon {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></Icon>
)
export const TrophyIcon = (p: Props) => (
  <Icon {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8 21h8M9 21c0-2 1-4 3-4s3 2 3 4" /></Icon>
)
export const ExportIcon = (p: Props) => (
  <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14l3 3 3-3" /></Icon>
)
export const BoltIcon = (p: Props) => <Icon {...p}><path d="M13 3L5 14h6l-1 7 8-11h-6z" /></Icon>
export const FlameIcon = (p: Props) => (
  <Icon {...p}><path d="M12 21c-3.9 0-6.5-2.7-6.5-6.3 0-3.6 3-5.8 3.8-9.7 2.3 1.3 3.3 3.4 3.4 5.3 1-.9 1.6-2.2 1.7-3.6 2.4 1.9 4.1 4.8 4.1 8 0 3.6-2.6 6.3-6.5 6.3z" /></Icon>
)
export const TrendIcon = (p: Props) => <Icon {...p}><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></Icon>
export const FeatherIcon = (p: Props) => (
  <Icon {...p}><path d="M20 4c-6 0-11 3.5-12.5 10L6 20M7.5 14H15M10 10h8c1.5-2 2-4 2-6" /></Icon>
)
export const MoonIcon = (p: Props) => <Icon {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Icon>
export const SunIcon = (p: Props) => (
  <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Icon>
)
export const SpeechIcon = (p: Props) => <Icon {...p}><path d="M4 5h16v11H9l-5 4z" /></Icon>
export const ScaleIcon = (p: Props) => (
  <Icon {...p}><path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z" /></Icon>
)
export const LockIcon = (p: Props) => <Icon {...p}><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>
export const PulseIcon = (p: Props) => <Icon {...p}><path d="M3 12h4l2-6 4 12 2-6h6" /></Icon>
export const AlertIcon = (p: Props) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></Icon>
