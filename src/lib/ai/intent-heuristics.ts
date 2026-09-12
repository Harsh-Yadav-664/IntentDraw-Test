// =============================================================================
// INTENT HEURISTICS — local, deterministic region classification (no AI calls)
// =============================================================================
// Client-safe module: NO SDK imports (imported by both the server-side
// intent-classifier and the ControlsPanel for the live tag preview).
//
// Design goal (audit P0.1): the user's drawing is layout intent. Freeform
// shapes must NOT default to "decorative" — that produced empty layout
// skeletons and fully ignored the user's drawing. The LLM is only needed for
// genuinely ambiguous shapes (medium-sized freeform, no annotation).

import type { Region } from '@/types'

export type RegionIntentTag = 'exact-placement' | 'approximate-area' | 'decorative' | 'relational'
export type BackgroundScope = 'region' | 'full' | null

export interface RegionIntentAssessment {
  tag: RegionIntentTag
  backgroundScope: BackgroundScope
  /** Human-readable explanation — used by the UI and the debug log. */
  reason: string
  /** True when the heuristic cannot decide — the only case that needs an LLM. */
  ambiguous: boolean
}

export interface CanvasBounds {
  width: number
  height: number
}

/** Area ratios (region area / canvas area) used by the freeform heuristics. */
export const FREEFORM_STRUCTURAL_MIN_RATIO = 0.30 // > 30% of canvas → structural area
export const FREEFORM_DECORATIVE_MAX_RATIO = 0.05 // < 5% of canvas → decorative scribble
export const FULL_PAGE_BACKGROUND_RATIO = 0.90 // ≥ 90% coverage → full-page background candidate
export const TINY_SHAPE_MAX_RATIO = 0.02 // < 2% of canvas → dot / accent mark

const DECORATION_WORDS = [
  'background', 'backdrop', 'bg', 'decoration', 'decorative', 'ornament',
  'pattern', 'texture', 'blob', 'doodle', 'scribble', 'flourish', 'divider',
  'accent', 'confetti', 'sparkle', 'glow', 'wash', 'shape behind',
]

const FULL_PAGE_WORDS = [
  'full page', 'full-page', 'whole page', 'entire page', 'page background',
  'site background', 'overall background', 'entire site', 'whole site',
  'site-wide', 'sitewide', 'everywhere', 'behind everything', 'all sections',
]

/**
 * NARROW decoration cues for PROMPT snippets around a region mention.
 * Prompt prose is noisy — e.g. the audit's failing case "make a website
 * with a similar drawing as the regions 1 to 6 show as solid background"
 * is a user describing section backgrounds for a LAYOUT, not asking for
 * the regions to be discarded as decoration. So a mere "background" near
 * the mention must NOT flip the region decorative. Only unambiguous
 * full-page-background phrases or clear ornament words do.
 */
const PROMPT_ORNAMENT_WORDS = [
  // explicit page/site-wide background assignments
  'page background', 'background of the page', 'background for the page',
  'site background', 'background of the site', 'background for the site',
  'whole page background', 'entire page background', 'full page background',
  'full-page background', 'background for the whole', 'background behind everything',
  // unambiguous ornament language
  'ornament', 'ornamental', 'squiggle', 'doodle', 'flourish', 'confetti',
  'sparkle', 'decoration', 'decorative element', 'divider line',
]

function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase()
  return needles.some(n => h.includes(n))
}

/** True when the text describes background/decoration rather than content. */
export function describesDecoration(text: string): boolean {
  return containsAny(text, DECORATION_WORDS)
}

/** True when the text describes a whole-page background. */
export function describesFullPage(text: string): boolean {
  return containsAny(text, FULL_PAGE_WORDS)
}

/**
 * True when a PROMPT snippet around a region mention unambiguously describes
 * decoration (narrow list — see PROMPT_ORNAMENT_WORDS). Prompt prose saying
 * just "background" near a region is treated as layout intent, not ornament.
 */
export function promptSnippetDescribesDecoration(text: string): boolean {
  return containsAny(text, PROMPT_ORNAMENT_WORDS)
}

/** Canvas bounds covering every region (matches the classifier's bounds logic). */
export function getCanvasBounds(regions: Region[]): CanvasBounds {
  if (regions.length === 0) return { width: 1, height: 1 }
  const allX = regions.flatMap(r => [r.geometry.x, r.geometry.x + r.geometry.width])
  const allY = regions.flatMap(r => [r.geometry.y, r.geometry.y + r.geometry.height])
  return { width: Math.max(...allX, 1), height: Math.max(...allY, 1) }
}

/**
 * Detects whether the user's global prompt references a given region by
 * number ("region 3 is the pricing table", "R2 = footer", "shape 5…").
 * Returns the surrounding snippet so callers can check for decoration words
 * near the mention, or null when the region is not mentioned.
 */
export function findPromptReference(
  userPrompt: string,
  regionNumber: number
): { snippet: string } | null {
  const patterns = [
    // \b prefix prevents false positives like "for 1 minute" matching r1
    new RegExp(`\\b(?:region|regions|shape|box|area|r)\\s*#?\\s*${regionNumber}\\b`, 'gi'),
    new RegExp(`\\b(?:region|r)\\s*${regionNumber}\\s*(?:is|=|:|→|->)`, 'gi'),
  ]
  for (const re of patterns) {
    const m = re.exec(userPrompt)
    if (m) {
      const start = Math.max(0, m.index - 60)
      const end = Math.min(userPrompt.length, m.index + m[0].length + 90)
      return { snippet: userPrompt.slice(start, end) }
    }
  }
  return null
}

function areaRatio(region: Region, bounds: CanvasBounds): number {
  const canvasArea = Math.max(1, bounds.width * bounds.height)
  return (region.geometry.width * region.geometry.height) / canvasArea
}

/**
 * Deterministic classification of a single region.
 *
 * Priority order:
 *   1. User override (tagOverride from the Controls panel) — absolute.
 *   2. The user's own per-region intent note — it is their description.
 *   3. Prompt references ("region 3 is the pricing table").
 *   4. Shape type + size heuristics (freeform defaults to STRUCTURAL when
 *      it is large; only small scribbles are decorative).
 *
 * Only medium freeform shapes with no annotation and no prompt reference come
 * back as `ambiguous: true` — those are the sole candidates for the LLM pass.
 */
export function assessRegionIntent(
  region: Region,
  allRegions: Region[],
  userPrompt: string,
  bounds: CanvasBounds
): RegionIntentAssessment {
  const g = region.geometry
  const intent = region.intent?.trim() ?? ''
  const ratio = areaRatio(region, bounds)
  const others = allRegions.filter(r => r.id !== region.id)
  const promptRef = userPrompt.trim() ? findPromptReference(userPrompt, region.regionNumber) : null

  // 1. Manual override wins unconditionally.
  if (region.tagOverride) {
    return {
      tag: region.tagOverride,
      backgroundScope: region.tagOverride === 'decorative'
        ? (region.backgroundScopeOverride ?? 'region')
        : null,
      reason: 'manual override from the Controls panel',
      ambiguous: false,
    }
  }

  // 2. Arrows are connectors, always.
  if (g.type === 'arrow') {
    return { tag: 'relational', backgroundScope: null, reason: 'arrow shape → relational connector', ambiguous: false }
  }

  if (g.type === 'rectangle' || g.type === 'circle') {
    // The user's own note describes the shape.
    if (intent && describesDecoration(intent)) {
      const full = describesFullPage(intent) || (promptRef ? describesFullPage(promptRef.snippet) : false)
      return {
        tag: 'decorative',
        backgroundScope: full ? 'full' : 'region',
        reason: `intent note reads as decoration ("${intent.slice(0, 40)}")`,
        ambiguous: false,
      }
    }
    if (intent) {
      return { tag: 'exact-placement', backgroundScope: null, reason: 'annotated box → structural, exact placement', ambiguous: false }
    }
    // Prompt assigns this region content or decoration.
    if (promptRef) {
      if (promptSnippetDescribesDecoration(promptRef.snippet)) {
        const full = describesFullPage(promptRef.snippet)
        return {
          tag: 'decorative',
          backgroundScope: full ? 'full' : 'region',
          reason: 'prompt describes this shape as decoration near its mention',
          ambiguous: false,
        }
      }
      return { tag: 'exact-placement', backgroundScope: null, reason: 'prompt assigns content to this region', ambiguous: false }
    }
    // A lone shape covering ~everything is layout, not background — never
    // discard the user's only drawing (that was the old classifier's bug).
    if (others.length > 0 && ratio >= FULL_PAGE_BACKGROUND_RATIO) {
      return {
        tag: 'decorative',
        backgroundScope: 'full',
        reason: 'spans ≥90% of the canvas alongside other regions → full-page background',
        ambiguous: false,
      }
    }
    if (others.length > 0 && ratio <= TINY_SHAPE_MAX_RATIO) {
      return {
        tag: 'decorative',
        backgroundScope: 'region',
        reason: 'tiny mark (<2% of canvas) → decorative accent',
        ambiguous: false,
      }
    }
    return { tag: 'exact-placement', backgroundScope: null, reason: `${g.type} → structural, exact placement`, ambiguous: false }
  }

  // Freeform — the shape type the old classifier always threw away.
  if (intent) {
    if (describesDecoration(intent)) {
      const full = describesFullPage(intent) || (promptRef ? describesFullPage(promptRef.snippet) : false)
      return {
        tag: 'decorative',
        backgroundScope: full ? 'full' : 'region',
        reason: `intent note reads as decoration ("${intent.slice(0, 40)}")`,
        ambiguous: false,
      }
    }
    return {
      tag: 'exact-placement',
      backgroundScope: null,
      reason: 'freeform with an intent note → structural, exact placement',
      ambiguous: false,
    }
  }

  if (promptRef) {
    if (promptSnippetDescribesDecoration(promptRef.snippet)) {
      const full = describesFullPage(promptRef.snippet)
      return {
        tag: 'decorative',
        backgroundScope: full ? 'full' : 'region',
        reason: 'prompt describes this freeform as decoration near its mention',
        ambiguous: false,
      }
    }
    return {
      tag: 'approximate-area',
      backgroundScope: null,
      reason: 'prompt references this freeform as content → structural area',
      ambiguous: false,
    }
  }

  if (ratio > FREEFORM_STRUCTURAL_MIN_RATIO) {
    return {
      tag: 'approximate-area',
      backgroundScope: null,
      reason: `freeform covers ${Math.round(ratio * 100)}% of the canvas → structural area`,
      ambiguous: false,
    }
  }

  if (ratio <= FREEFORM_DECORATIVE_MAX_RATIO) {
    return {
      tag: 'decorative',
      backgroundScope: 'region',
      reason: `small freeform (${Math.round(ratio * 100)}% of canvas) → decorative mark`,
      ambiguous: false,
    }
  }

  // Medium freeform, no annotation, no prompt reference — the only genuinely
  // ambiguous case. Flag it for the (optional) LLM pass. If the LLM is
  // skipped or fails, we lean STRUCTURAL: a drawing is layout intent.
  return {
    tag: 'approximate-area',
    backgroundScope: null,
    reason: `medium freeform (${Math.round(ratio * 100)}% of canvas), unannotated → ambiguous, AI may refine`,
    ambiguous: true,
  }
}

export interface HeuristicClassification {
  assessments: Record<string, RegionIntentAssessment>
  /** Regions the heuristics could not resolve — candidates for the LLM pass. */
  ambiguousRegions: Region[]
  bounds: CanvasBounds
}

/** Classifies every region locally. Zero model calls. */
export function assessAllRegionIntents(regions: Region[], userPrompt: string): HeuristicClassification {
  const bounds = getCanvasBounds(regions)
  const assessments: Record<string, RegionIntentAssessment> = {}
  const ambiguousRegions: Region[] = []

  for (const region of regions) {
    const assessment = assessRegionIntent(region, regions, userPrompt, bounds)
    assessments[region.id] = assessment
    if (assessment.ambiguous) ambiguousRegions.push(region)
  }

  return { assessments, ambiguousRegions, bounds }
}

/** Short human label for UI display. */
export function describeAssessment(a: RegionIntentAssessment): string {
  switch (a.tag) {
    case 'exact-placement': return 'Structural · exact placement'
    case 'approximate-area': return 'Structural · loose area'
    case 'relational': return 'Relational · connector'
    case 'decorative':
      return a.backgroundScope === 'full' ? 'Decorative · full-page background' : 'Decorative · local background'
  }
}
