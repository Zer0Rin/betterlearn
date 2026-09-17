export const GLASS_PREFERENCE_KEY = 'betterlearn:glass-appearance:v1'
export const DEFAULT_GLASS_FROST = 35

export function normalizeGlassFrost(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_GLASS_FROST
  return Math.round(Math.min(100, Math.max(0, value)))
}

export function readGlassFrost(storage: Pick<Storage, 'getItem'>): number {
  try {
    const saved: unknown = JSON.parse(storage.getItem(GLASS_PREFERENCE_KEY) ?? 'null')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return DEFAULT_GLASS_FROST
    const preference = saved as Record<string, unknown>
    if (preference.version !== 1) return DEFAULT_GLASS_FROST
    return normalizeGlassFrost(preference.frost)
  } catch {
    return DEFAULT_GLASS_FROST
  }
}

export function writeGlassFrost(storage: Pick<Storage, 'setItem'>, frost: number): boolean {
  try {
    storage.setItem(GLASS_PREFERENCE_KEY, JSON.stringify({ version: 1, frost: normalizeGlassFrost(frost) }))
    return true
  } catch {
    return false
  }
}

export function glassParameters(frost: number): { blur: number; tint: number; refraction: number; saturation: number } {
  const amount = normalizeGlassFrost(frost) / 100
  return {
    blur: 0.4 + 23.6 * amount ** 1.25,
    tint: 0.08 + 0.68 * amount,
    refraction: 24 * (1 - amount),
    saturation: 1.55 - 0.45 * amount,
  }
}
