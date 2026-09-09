import { getVisionModel } from './gemini'
import { extractJson, imageMimeFromDataUrl } from '@/lib/utils'
import {
  assessAllRegionIntents,
  type RegionIntentTag,
  type BackgroundScope,
} from './intent-heuristics'
import type { Region } from '@/types'

export type { RegionIntentTag, BackgroundScope } from './intent-heuristics'

export interface RegionIntentResult {
  tags: Record<string, RegionIntentTag>
  backgroundScopes: Record<string, BackgroundScope>
  /** True when the vision model was consulted at all. */
  usedLlm: boolean
}

const VALID_TAGS: RegionIntentTag[] = ['exact-placement', 'approximate-area', 'decorative', 'relational']

/**
 * Classifies the intent of each drawn region.
 *
 * Two passes:
 *   1. LOCAL HEURISTICS (free, instant) — shape type + size + the user's own
 *      annotations + prompt references resolve ~all regions deterministically.
 *      Freeform shapes default to STRUCTURAL (they are layout intent), fixing
 *      the old behavior where unannotated freeform was always "decorative"
 *      and the user's drawing was silently discarded.
 *   2. LLM (vision) — only for the handful of genuinely ambiguous regions
 *      (medium freeform, no annotation, no prompt reference). If the call
 *      fails or times out we keep the heuristic answer (structural-leaning).
 *
 * `imageBase64` is only attached when pass 2 actually runs.
 */
export async function classifyRegionIntents(
  regions: Region[],
  userPrompt: string,
  imageBase64?: string
): Promise<RegionIntentResult> {
  if (regions.length === 0) {
    return { tags: {}, backgroundScopes: {}, usedLlm: false }
  }

  const { assessments, ambiguousRegions, bounds } = assessAllRegionIntents(regions, userPrompt)

  const mergeFromHeuristics = (): RegionIntentResult => {
    const tags: Record<string, RegionIntentTag> = {}
    const backgroundScopes: Record<string, BackgroundScope> = {}
    for (const r of regions) {
      const a = assessments[r.id]
      tags[r.id] = a.tag
      if (a.tag === 'decorative') backgroundScopes[r.id] = a.backgroundScope ?? 'region'
    }
    return { tags, backgroundScopes, usedLlm: false }
  }

  const writeDebug = async (result: RegionIntentResult, llmError?: string) => {
    // Debug log (local only)
    try {
      const fs = await import('fs')
      const path = await import('path')
      const debugDir = path.join(process.cwd(), '.system_generated')
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })
      fs.writeFileSync(
        path.join(debugDir, 'region-intent-debug.json'),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          userPrompt,
          canvas: { width: Math.round(bounds.width), height: Math.round(bounds.height) },
          heuristicAssessments: Object.fromEntries(
            regions.map(r => [`R${r.regionNumber}`, { ...assessments[r.id], shape: r.geometry.type }])
          ),
          ambiguousCount: ambiguousRegions.length,
          usedLlm: result.usedLlm,
          llmError: llmError ?? null,
          finalTags: result.tags,
          backgroundScopes: result.backgroundScopes,
        }, null, 2)
      )
    } catch (logErr) {
      console.error('[Intent Classifier] Failed to write debug log:', logErr)
    }
  }

  // ── Pass 1: heuristics resolved everything → ZERO model calls ────────────
  if (ambiguousRegions.length === 0) {
    const result = mergeFromHeuristics()
    console.log(`[Intent Classifier] ${regions.length} regions resolved by heuristics — no LLM call`)
    await writeDebug(result)
    return result
  }

  // ── Pass 2: ask the vision model about ONLY the ambiguous regions ────────
  console.log(`[Intent Classifier] ${ambiguousRegions.length}/${regions.length} regions ambiguous — consulting vision model`)
  try {
    const model = getVisionModel()

    const simplifiedRegions = ambiguousRegions.map(r => ({
      id: r.id,
      regionNumber: r.regionNumber,
      shapeType: r.geometry.type,
      x: Math.round(r.geometry.x),
      y: Math.round(r.geometry.y),
      width: Math.round(r.geometry.width),
      height: Math.round(r.geometry.height),
      areaPercentOfCanvas: Math.round(
        (r.geometry.width * r.geometry.height) / Math.max(1, bounds.width * bounds.height) * 100
      ),
      userIntent: r.intent?.trim() || null,
    }))

    const systemPrompt = `You are a design intent classifier for shapes in a wireframe drawing.
You receive: the user's text prompt, the canvas size, and a JSON list of AMBIGUOUS regions (medium-sized freeform shapes with no annotation and no prompt reference). All other regions were already classified deterministically.

For EACH ambiguous region decide only between:
- "approximate-area": the freeform encloses/represents a content area of the page (a section, a panel, a blob the content lives inside). Lean toward this — users draw shapes to express LAYOUT.
- "decorative": the freeform is purely a stylistic mark (a squiggle, an underline flourish, a wave ornament) that must NOT become a structural DOM area.

If you answer "decorative", also give a backgroundScope:
- "region": the element stays confined to where it was drawn.
- "full": the element is a background for the ENTIRE page (only when it visually spans nearly the whole canvas).

Heuristics for judgment:
- Freeforms that trace a panel/blob/area outline (roughly closed, sizeable, or aligned with other regions) are content areas.
- Freeforms that look like an underline, a stroke beside text, a small wave/ribbon, or pure ornament are decorative.
- When unsure, choose "approximate-area" — losing the user's layout is worse than decorating a section.

Respond ONLY with valid JSON, no markdown fences:
{
  "tags": { "<region id>": "approximate-area" | "decorative" },
  "backgroundScopes": { "<region id>": "region" | "full" }
}
Include backgroundScopes ONLY for regions tagged "decorative".`

    const promptMessage = `User's prompt: "${userPrompt}"

Canvas size: ${Math.round(bounds.width)} x ${Math.round(bounds.height)} px

Ambiguous regions (positions in canvas pixels):
${JSON.stringify(simplifiedRegions, null, 2)}

Analyze the attached drawing image together with the positions above, then respond with JSON.`

    const contentParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: systemPrompt },
      { text: promptMessage },
    ]
    if (imageBase64) {
      const mime = imageMimeFromDataUrl(imageBase64)
      contentParts.push({
        inlineData: {
          mimeType: mime,
          data: imageBase64.replace(/^data:image\/[\w.+-]+;base64,/, ''),
        },
      })
    }

    const result = await model.generateContent(contentParts, {
      // Fail fast: heuristic answers already exist for every region; if this
      // stalls we keep them instead of hanging generation.
      signal: AbortSignal.timeout(45000),
    })
    const responseText = result.response.text()
    const data = JSON.parse(extractJson(responseText))

    const merged = mergeFromHeuristics()
    merged.usedLlm = true
    for (const r of ambiguousRegions) {
      const rawTag = data?.tags?.[r.id]
      if (VALID_TAGS.includes(rawTag) && rawTag !== 'relational') {
        merged.tags[r.id] = rawTag
        if (rawTag === 'decorative') {
          merged.backgroundScopes[r.id] = data?.backgroundScopes?.[r.id] === 'full' ? 'full' : 'region'
        } else {
          delete merged.backgroundScopes[r.id]
        }
      }
      // Invalid/missing answer → keep heuristic (structural-leaning) tag.
    }

    await writeDebug(merged)
    return merged
  } catch (error) {
    console.error('[Intent Classifier] LLM pass failed, keeping heuristic answers:', error)
    const result = mergeFromHeuristics()
    await writeDebug(result, error instanceof Error ? error.message : String(error))
    return result
  }
}
