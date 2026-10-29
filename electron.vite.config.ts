import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Bundlers write module ids into the output (the worker import's source comment, for one), and an
 * id can hold the absolute path of the folder the app was built in. Nobody's local paths belong in
 * a published build, so every chunk has the project folder replaced with ".".
 */
function scrubLocalPaths(): Plugin {
  const root = resolve('.')
  const forms = [root, root.replace(/\\/g, '/'), root.replace(/\\/g, '\\\\')]
  return {
    name: 'twilight-scrub-local-paths',
    enforce: 'post',
    renderChunk(code) {
      let out = code
      for (const form of forms) out = out.split(form).join('.')
      return out === code ? null : { code: out, map: null }
    }
  }
}

export default defineConfig({
  // Minified: less for the app to read and compile at every start.
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [scrubLocalPaths()],
    build: { minify: true }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [scrubLocalPaths()],
    build: { minify: true }
  },
  renderer: {
    build: { minify: true },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), scrubLocalPaths()]
  }
})
