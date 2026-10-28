// Line icons, 16px on a 24px grid, 1.5px stroke, drawn in currentColor (see the design system's
// Iconography section). Placeholders until we adopt a full icon set.

type Props = { size?: number; className?: string }

function Icon({ size = 16, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg className={`tw-icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
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
export const AlertIcon = (p: Props) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></Icon>
