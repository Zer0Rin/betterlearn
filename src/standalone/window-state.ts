import type { WorkbenchSize } from '../client/workbench-size.js'

export const WINDOW_SIZE_KEY = 'betterlearn:standalone-window:v1'
export function readWindowSize(storage: Storage): WorkbenchSize {
  try {
    const value: unknown = JSON.parse(storage.getItem(WINDOW_SIZE_KEY) ?? 'null')
    if (value && typeof value === 'object') {
      const row = value as Record<string, unknown>
      if (row.version === 1 && typeof row.width === 'number' && Number.isFinite(row.width) && row.width > 0
        && typeof row.height === 'number' && Number.isFinite(row.height) && row.height > 0) {
        return { width: row.width, height: row.height }
      }
    }
  } catch { /* Browser storage may be unavailable. */ }
  return { width: 1080, height: 780 }
}
export function writeWindowSize(storage: Storage, size: WorkbenchSize): void {
  try { storage.setItem(WINDOW_SIZE_KEY, JSON.stringify({ version: 1, ...size })) }
  catch { /* Resizing remains available without browser persistence. */ }
}
