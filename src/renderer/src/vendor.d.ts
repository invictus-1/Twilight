declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it'
  const plugin: PluginSimple
  export default plugin
}

declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it'
  const plugin: PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>
  export default plugin
}

declare module '*.css'
declare module '*?raw' {
  const text: string
  export default text
}
declare module '@fontsource-variable/*'
declare module '*.webp' {
  const url: string
  export default url
}
