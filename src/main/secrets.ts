import { safeStorage } from 'electron'
import { kvDelete, kvGet, kvSet } from './db'

// API keys are encrypted with the OS keychain (DPAPI on Windows) and never sent to the renderer.

export function setSecret(name: string, value: string): void {
  const stored = safeStorage.isEncryptionAvailable()
    ? { enc: true, data: safeStorage.encryptString(value).toString('base64') }
    : { enc: false, data: value }
  kvSet(`secret:${name}`, stored)
}

export function getSecret(name: string): string | undefined {
  const stored = kvGet<{ enc: boolean; data: string }>(`secret:${name}`)
  if (!stored) return undefined
  return stored.enc ? safeStorage.decryptString(Buffer.from(stored.data, 'base64')) : stored.data
}

export function hasSecret(name: string): boolean {
  return kvGet(`secret:${name}`) !== undefined
}

export function deleteSecret(name: string): void {
  kvDelete(`secret:${name}`)
}
