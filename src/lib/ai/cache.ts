// =============================================================================
// GENERATION CACHE (audit P1.3)
// =============================================================================
// Identical {regions + prompt + theme + provider} should not re-run the
// pipeline (or burn a daily quota slot). In-memory LRU with a TTL: warm
// server instances serve repeat generations instantly. NOTE: module-level
// state is per server instance — swap for Redis/Supabase if this ever runs
// multi-instance.

import type { Region } from '@/types'

type ProviderId = 'gemini' | 'groq' | 'nvidia'

export interface GenerationCacheInput {
  regions: Region[]
  prompt: string
  globalTheme?: string
  provider: ProviderId
  nvidiaModelId?: string
}

interface CacheEntry {
  code: string
  provider: ProviderId
  expiresAt: number
}

const MAX_ENTRIES = 40
const TTL_MS = 30 * 60 * 1000 // 30 minutes

const store = new Map<string, CacheEntry>()

/** Stable stringify: object keys sorted recursively so key order never busts the cache. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** Deterministic 32-bit FNV-1a hash, hex-encoded. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/** Only the fields that affect generation output — ids and timestamps excluded. */
function normalizeRegions(regions: Region[]): unknown {
  return regions.map(r => ({
    regionNumber: r.regionNumber,
    x: Math.round(r.geometry.x),
    y: Math.round(r.geometry.y),
    width: Math.round(r.geometry.width),
    height: Math.round(r.geometry.height),
    type: r.geometry.type,
    intent: r.intent?.trim() ?? '',
    classificationTag: r.classificationTag ?? null,
    backgroundScope: r.backgroundScope ?? null,
    tagOverride: r.tagOverride ?? null,
    backgroundScopeOverride: r.backgroundScopeOverride ?? null,
  }))
}

export function makeGenerationCacheKey(input: GenerationCacheInput): string {
  return fnv1a(stableStringify({
    v: 2, // bump when generation logic changes
    regions: normalizeRegions(input.regions),
    prompt: input.prompt.trim(),
    globalTheme: (input.globalTheme ?? '').trim(),
    provider: input.provider,
    nvidiaModelId: input.nvidiaModelId ?? null,
  }))
}

export function getCachedGeneration(key: string): CacheEntry | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  // LRU touch: re-insert to move to the end of the Map's ordering.
  store.delete(key)
  store.set(key, entry)
  return entry
}

export function setCachedGeneration(key: string, code: string, provider: ProviderId): void {
  if (store.size >= MAX_ENTRIES) {
    // Evict the oldest entry (first key in insertion order).
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(key, { code, provider, expiresAt: Date.now() + TTL_MS })
}
