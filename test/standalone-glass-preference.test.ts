import { expect, test } from 'vitest'
import {
  DEFAULT_GLASS_FROST,
  GLASS_PREFERENCE_KEY,
  glassParameters,
  normalizeGlassFrost,
  readGlassFrost,
  writeGlassFrost,
} from '../src/standalone/glass-preference.js'

test('normalizes the slider value to a whole percentage within its limits', () => {
  expect(normalizeGlassFrost(0)).toBe(0)
  expect(normalizeGlassFrost(100)).toBe(100)
  expect(normalizeGlassFrost(34.6)).toBe(35)
  expect(normalizeGlassFrost(-10)).toBe(0)
  expect(normalizeGlassFrost(120)).toBe(100)
  for (const invalid of [NaN, Infinity, -Infinity, '50', null, undefined, {}, true]) {
    expect(normalizeGlassFrost(invalid)).toBe(DEFAULT_GLASS_FROST)
  }
})

test('uses the default when saved appearance is absent, malformed or incompatible', () => {
  const invalidRecords = [
    null, '', '{', 'null', '[]', '42',
    '{"version":2,"frost":60}',
    '{"version":"1","frost":60}',
    '{"frost":60}',
    '{"version":1}',
    '{"version":1,"frost":"60"}',
    '{"version":1,"frost":null}',
    '{"version":1,"frost":1e999}',
  ]
  for (const saved of invalidRecords) {
    expect(readGlassFrost({ getItem: () => saved })).toBe(DEFAULT_GLASS_FROST)
  }
})

test('uses the default when browser storage cannot be read', () => {
  expect(readGlassFrost({ getItem() { throw new Error('Storage blocked') } })).toBe(DEFAULT_GLASS_FROST)
})

test('loads and normalizes a valid saved appearance', () => {
  for (const [saved, expected] of [[0, 0], [100, 100], [62.8, 63], [-3, 0], [110, 100]]) {
    expect(readGlassFrost({ getItem: () => JSON.stringify({ version: 1, frost: saved }) })).toBe(expected)
  }
})

test('persists the normalized appearance and restores it on the next read', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  expect(writeGlassFrost(storage, 71.8)).toBe(true)
  expect(values.get(GLASS_PREFERENCE_KEY)).toBe('{"version":1,"frost":72}')
  expect(readGlassFrost(storage)).toBe(72)
  expect(writeGlassFrost(storage, Infinity)).toBe(true)
  expect(readGlassFrost(storage)).toBe(DEFAULT_GLASS_FROST)
})

test('reports blocked writes without throwing', () => {
  expect(writeGlassFrost({ setItem() { throw new Error('Storage full') } }, 50)).toBe(false)
})

test('maps clear and frosted endpoints to visibly distinct material parameters', () => {
  const clear = glassParameters(0)
  const frosted = glassParameters(100)
  expect(clear.blur).toBeCloseTo(0.4)
  expect(clear.tint).toBeCloseTo(0.08)
  expect(clear.refraction).toBeCloseTo(24)
  expect(clear.saturation).toBeCloseTo(1.55)
  expect(frosted.blur).toBeCloseTo(24)
  expect(frosted.tint).toBeCloseTo(0.76)
  expect(frosted.refraction).toBeCloseTo(0)
  expect(frosted.saturation).toBeCloseTo(1.1)
})

test('each slider step increases frosting while reducing refraction and saturation', () => {
  let previous = glassParameters(0)
  for (let frost = 1; frost <= 100; frost++) {
    const current = glassParameters(frost)
    expect(current.blur).toBeGreaterThan(previous.blur)
    expect(current.tint).toBeGreaterThan(previous.tint)
    expect(current.refraction).toBeLessThan(previous.refraction)
    expect(current.saturation).toBeLessThan(previous.saturation)
    previous = current
  }
})

test('material parameters normalize unsafe values before calculating effects', () => {
  expect(glassParameters(-10)).toEqual(glassParameters(0))
  expect(glassParameters(110)).toEqual(glassParameters(100))
  expect(glassParameters(NaN)).toEqual(glassParameters(DEFAULT_GLASS_FROST))
})
