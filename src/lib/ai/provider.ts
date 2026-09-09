import { geminiGenerate } from './gemini'
import { groqGenerate } from './groq'
import { nvidiaGenerate } from './nvidia'
import { extractReact, withTimeout, imageMimeFromDataUrl } from '@/lib/utils'
import type { GenerationResponse } from '@/types'
import type { Part } from '@google/generative-ai'
import {
  GENERATION_SYSTEM_PROMPT,
  REGENERATE_REGION_SYSTEM_PROMPT,
  CHUNKED_REGION_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildRegenerateUserPrompt,
  buildChunkUserPrompt,
} from './prompts'
import { resolveDesignTokens } from './design-tokens'
import { buildShellTsx } from './region-analyzer'
import { postProcessCode } from './postprocess'
import { makeGenerationCacheKey, getCachedGeneration, setCachedGeneration } from './cache'
import type { Region } from '@/types'

// Per-provider hard cap for a single generation call. Above this we give up on
// that provider and let the fallback chain try the next one, so a slow or dead
// upstream can't stall the whole request. Tuned to measured latencies
// (2026-08-30): Gemini vision generation runs ~30-45s and can exceed 60s on a
// real drawing + full prompt, so it gets the most headroom; Groq (gpt-oss-120b)
// answers in ~7s; NVIDIA models are currently slow/EOL, so cap low to fail over.
const PROVIDER_TIMEOUT_MS: Record<'gemini' | 'groq' | 'nvidia', number> = {
  gemini: 120000,
  groq: 45000,
  nvidia: 75000,
}

const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'

// Above this region count we switch from one monolithic call to the chunked
// path. Monolithic is strongly preferred: 1 call, full-page coherence, and it
// never trips free-tier RPM limits. The chunked path is for genuinely huge
// drawings only (audit P1.1).
const MONOLITHIC_REGION_THRESHOLD = 15

type ProviderId = 'gemini' | 'groq' | 'nvidia'

/**
 * Turn a raw provider/SDK error into a short, human-readable reason. The raw
 * errors are giant JSON blobs (429 quota dumps, Groq "request too large", …)
 * that are useless in the UI. This keeps the aggregated failure message clean
 * and actionable — the user should be able to tell a transient rate limit from
 * a genuine misconfiguration at a glance.
 */
function humanizeProviderError(raw: string | undefined): string {
  if (!raw) return 'skipped'
  const m = raw.toLowerCase()
  if (/reduce your message size|request too large|context length|maximum context/.test(m)) {
    return 'prompt too large for the free-tier token limit (fewer regions or a shorter prompt may help)'
  }
  if (/\b429\b|too many requests|resource_exhausted|rate.?limit|\bquota\b/.test(m)) {
    return 'free-tier rate limit / quota exceeded — wait ~a minute and retry'
  }
  if (/timed out|timeout|aborted|aborterror/.test(m)) {
    return 'timed out'
  }
  if (/truncat|incomplete/.test(m)) {
    return 'the model returned incomplete output'
  }
  if (/\b401\b|\b403\b|unauthorized|api key|invalid.*key|permission/.test(m)) {
    return 'API key rejected — check the provider credentials'
  }
  if (/\b404\b|\b410\b|decommission|not found|\beol\b|no longer/.test(m)) {
    return 'the selected model is unavailable'
  }
  // Unknown error: surface the first line, capped so the UI stays readable.
  return raw.split('\n')[0].slice(0, 140)
}

// =============================================================================
// Code Generation — Regions + Prompt → React TSX
// Gemini → Groq fallback chain (NVIDIA only when explicitly selected — it is
// slow/EOL and no longer part of the automatic chain; audit P1.4).
// Monolithic single call for <= 15 regions; chunked (deterministic shell +
// serial component chunks) above that. Cached results never re-run the chain.
// =============================================================================

export async function generateCode(
  regions: Region[],
  userPrompt: string,
  globalTheme?: string,
  provider: ProviderId = 'gemini',
  nvidiaModelId: string = DEFAULT_NVIDIA_MODEL,
  imageBase64?: string
): Promise<GenerationResponse> {
  // ── Cache: identical {regions, prompt, theme, provider} → instant reuse ──
  const cacheKey = makeGenerationCacheKey({ regions, prompt: userPrompt, globalTheme, provider, nvidiaModelId })
  const cached = getCachedGeneration(cacheKey)
  if (cached) {
    console.log(`[AI Gen] Cache hit — returning previous ${cached.provider} generation`)
    return { success: true, code: cached.code, provider: cached.provider, cached: true }
  }

  const tokens = resolveDesignTokens(userPrompt)

  // Attach the drawing image whenever the user actually drew something.
  // The image is a visual reference for the character of decorative strokes;
  // region positions remain the source of truth for layout.
  const hasDrawingImage = regions.length > 0 && !!imageBase64

  // Strip the data URL prefix for inlineData
  const rawImageBase64 = imageBase64
    ? imageBase64.replace(/^data:image\/[\w.+-]+;base64,/, '')
    : undefined
  const imageMime = imageMimeFromDataUrl(imageBase64 ?? '')

  // Helper to run a specific provider
  // When image is available and provider is Gemini, includes inlineData for vision.
  const runProvider = async (p: ProviderId, sysPrompt: string, msg: string, attachImage = false): Promise<string> => {
    const call = async (): Promise<string> => {
      if (p === 'nvidia') {
        return nvidiaGenerate(sysPrompt, msg, nvidiaModelId)
      } else if (p === 'groq') {
        return groqGenerate(sysPrompt, msg)
      } else {
        // Build content array — attach image when a drawing exists.
        const contentParts: Part[] = [{ text: sysPrompt }, { text: msg }]
        if (attachImage && rawImageBase64) {
          contentParts.push({
            inlineData: { mimeType: imageMime, data: rawImageBase64 },
          })
        }
        // geminiGenerate retries free-tier 429s (honoring the server's
        // retryDelay) before giving up and letting the chain fall through.
        return geminiGenerate(contentParts, { perAttemptTimeoutMs: PROVIDER_TIMEOUT_MS.gemini })
      }
    }
    // Backstop in case an SDK ignores its own timeout/signal. Gemini can retry
    // through free-tier 429s (each with a short wait), so give it extra headroom.
    const backstopMs = p === 'gemini'
      ? PROVIDER_TIMEOUT_MS.gemini + 45000
      : PROVIDER_TIMEOUT_MS[p] + 5000
    return withTimeout(call(), backstopMs, `${p} generation`)
  }

  // Fallback chain based on user's selected provider.
  // NVIDIA is legacy/explicit-select only — never an automatic fallback hop.
  const fallbacks: ProviderId[] =
    provider === 'nvidia' ? ['nvidia', 'gemini', 'groq'] :
    provider === 'groq' ? ['groq', 'gemini'] :
    ['gemini', 'groq']

  // -------------------------------------------------------------------------
  // Monolithic generation path (≤ 15 regions — single call).
  // One call keeps us well under free-tier RPM/TPM limits; the chunked path
  // below fires several calls and is what trips 429s on free tiers, so we
  // only fall back to it for genuinely large layouts.
  // -------------------------------------------------------------------------
  if (regions.length <= MONOLITHIC_REGION_THRESHOLD) {
    const userMessage = buildGenerationUserPrompt(regions, userPrompt, tokens, globalTheme, hasDrawingImage)
    const errors: Record<string, string> = {}

    for (const currentProvider of fallbacks) {
      try {
        const responseText = await runProvider(currentProvider, GENERATION_SYSTEM_PROMPT, userMessage, hasDrawingImage)
        let code = extractReact(responseText)

        if (!code || code.length < 20) throw new Error(`${currentProvider} returned empty response`)
        if (!code.includes('export default')) throw new Error('Generation truncated — output incomplete')

        // Enforce the preset's banned classes (audit P3.2) — never trust
        // prompt-only enforcement.
        code = postProcessCode(code, tokens).code

        setCachedGeneration(cacheKey, code, currentProvider)
        return { success: true, code, provider: currentProvider }
      } catch (err) {
        errors[currentProvider] = err instanceof Error ? err.message : String(err)
        console.warn(`[AI Gen Monolithic] ${currentProvider} failed:`, errors[currentProvider])
      }
    }
    // Report every provider's failure (selected provider first) so the real
    // root cause is visible instead of only the last fallback's error.
    return { success: false, error: `Generation failed — ${fallbacks.map(p => `${p}: ${humanizeProviderError(errors[p])}`).join(' | ')}` }
  }

  // -------------------------------------------------------------------------
  // Chunked generation path (> 15 regions — for genuinely large layouts)
  // Phase 1: Shell — built DETERMINISTICALLY in code from the drawing (no AI
  //          call; audit P1.2). Grid spans/gaps mirror the prompt skeleton.
  // Phase 2: Component chunks (3 regions each, SERIAL to avoid rate-limit
  //          bursts). Chunks cover ALL regions (structural + decorative +
  //          relational) because the shell references every <RegionX />.
  // Phase 3: Assembly (merge imports + inject components into the shell).
  // -------------------------------------------------------------------------
  console.log(`[AI Gen] Using Chunked Generation for ${regions.length} regions`)

  const shellCode = buildShellTsx(regions, { root: tokens.rootClasses })

  const CHUNK_SIZE = 3
  const chunkTargets = regions

  const chunks: Region[][] = []
  for (let i = 0; i < chunkTargets.length; i += CHUNK_SIZE) {
    chunks.push(chunkTargets.slice(i, i + CHUNK_SIZE))
  }

  const activeProvider = fallbacks[0]
  // Try the user's selected provider first for every chunk, then fallbacks.
  const chunkFallbacks: ProviderId[] =
    [activeProvider, ...fallbacks.filter(p => p !== activeProvider)]

  const generatedComponents: string[] = new Array(chunks.length).fill('')
  const allImports = new Set<string>()
  let chunkFailures = 0

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]
    const chunkMessage = buildChunkUserPrompt(chunk, regions, userPrompt, tokens, globalTheme)

    let chunkSucceeded = false
    for (const currentProvider of chunkFallbacks) {
      try {
        const responseText = await runProvider(currentProvider, CHUNKED_REGION_SYSTEM_PROMPT, chunkMessage)
        const chunkCode = extractReact(responseText)
        if (!chunkCode || chunkCode.length < 10) throw new Error(`Chunk ${index} empty`)

        const lines = chunkCode.split('\n')
        lines.filter(l => l.trim().startsWith('import ')).forEach(l => allImports.add(l.trim()))

        const componentLines = lines.filter(
          l => !l.trim().startsWith('import ') && !l.trim().startsWith('export default')
        )
        generatedComponents[index] = componentLines.join('\n')
        chunkSucceeded = true
        break
      } catch (err) {
        console.warn(`[AI Gen Chunk ${index}] ${currentProvider} failed:`, err)
      }
    }
    if (!chunkSucceeded) chunkFailures++
  }

  // Phase 3: Assembly — merge shell + component definitions + imports.
  const shellLines = shellCode.split('\n')
  const finalImports = new Set<string>()
  const nonImportLines: string[] = []

  for (const line of shellLines) {
    if (line.trim().startsWith('import ')) {
      finalImports.add(line.trim())
    } else {
      nonImportLines.push(line)
    }
  }
  for (const imp of allImports) finalImports.add(imp)

  const mergedImports = Array.from(finalImports).join('\n')
  const shellBody = nonImportLines.join('\n')
  const exportIndex = shellBody.indexOf('export default')

  if (exportIndex === -1) {
    return { success: false, error: 'Could not assemble: shell is missing export default' }
  }

  let assembledCode =
    mergedImports + '\n\n' +
    shellBody.substring(0, exportIndex) + '\n\n' +
    generatedComponents.filter(Boolean).join('\n\n') + '\n\n' +
    shellBody.substring(exportIndex)

  assembledCode = postProcessCode(assembledCode, tokens).code

  if (chunkFailures > 0) {
    // Some regions have no component definition — the shell references
    // <RegionX /> that would be undefined. Report instead of shipping a
    // guaranteed runtime error.
    return {
      success: false,
      error: `${chunkFailures} of ${chunks.length} component chunks failed on every provider — try again in a minute (free-tier rate limits) or reduce the number of regions`,
    }
  }

  setCachedGeneration(cacheKey, assembledCode, activeProvider)
  return { success: true, code: assembledCode, provider: activeProvider }
}

// =============================================================================
// Region Regeneration — Change one region, keep the rest
// =============================================================================

export async function regenerateRegion(
  regionNumber: number,
  userPrompt: string,
  existingCode: string,
  allRegions: Region[],
  provider: ProviderId = 'gemini',
  nvidiaModelId: string = DEFAULT_NVIDIA_MODEL
): Promise<GenerationResponse> {
  const tokens = resolveDesignTokens(userPrompt)
  const userMessage = buildRegenerateUserPrompt(regionNumber, userPrompt, existingCode, allRegions)

  const runProvider = async (p: ProviderId): Promise<string> => {
    const call = async (): Promise<string> => {
      if (p === 'nvidia') {
        return nvidiaGenerate(REGENERATE_REGION_SYSTEM_PROMPT, userMessage, nvidiaModelId)
      } else if (p === 'groq') {
        return groqGenerate(REGENERATE_REGION_SYSTEM_PROMPT, userMessage)
      } else {
        return geminiGenerate(
          [{ text: REGENERATE_REGION_SYSTEM_PROMPT }, { text: userMessage }],
          { perAttemptTimeoutMs: PROVIDER_TIMEOUT_MS.gemini }
        )
      }
    }
    const backstopMs = p === 'gemini'
      ? PROVIDER_TIMEOUT_MS.gemini + 45000
      : PROVIDER_TIMEOUT_MS[p] + 5000
    return withTimeout(call(), backstopMs, `${p} regeneration`)
  }

  const fallbacks: ProviderId[] =
    provider === 'nvidia' ? ['nvidia', 'gemini', 'groq'] :
    provider === 'groq' ? ['groq', 'gemini'] :
    ['gemini', 'groq']

  let lastError = 'Unknown error'

  for (const currentProvider of fallbacks) {
    try {
      const responseText = await runProvider(currentProvider)
      let code = extractReact(responseText)

      if (!code || code.length < 20) {
        throw new Error(`${currentProvider} returned empty or too-short response`)
      }

      code = postProcessCode(code, tokens).code
      return { success: true, code, provider: currentProvider }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[AI Regen] ${currentProvider} failed, trying next fallback:`, lastError)
    }
  }

  console.error('[AI Regen] All providers failed. Last error:', lastError)
  return {
    success: false,
    error: `Regeneration failed — ${humanizeProviderError(lastError)}`,
  }
}
