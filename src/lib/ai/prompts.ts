import { wrapUserPrompt, sanitizeUserPrompt } from './prompt-rules'
import { describeLayout } from './region-analyzer'
import { buildInspirationSection } from './component-library'
import type { Region } from '@/types'
import type { DesignTokenSet } from './design-tokens'

// =============================================================================
// GENERATION SYSTEM PROMPT
// =============================================================================

const CRAFT_STANDARDS = `════════════════════════════════════════════
CRAFT STANDARDS — NON-NEGOTIABLE
════════════════════════════════════════════

TYPOGRAPHY SCALE (this is what separates designed sites from AI output):
  • Display headings (hero/section titles): text-6xl md:text-8xl (hero may go
    md:text-[9vw]), font-black or font-extrabold, tracking-tighter,
    leading-[0.9] to leading-[0.95]. NEVER text-3xl/text-4xl for a hero.
  • Eyebrow/kicker labels: text-xs uppercase tracking-[0.2em]-[0.3em] font-medium.
  • Body: text-base or text-lg, leading-relaxed, max-w-prose. Never justified.
  • Weight contrast is mandatory: 800/900 display vs 400 body. Never uniform font-bold.
  • When the preset calls for serif: font-serif display headings over sans body.

REAL CONTENT (no filler, ever):
  • Headlines: 3–5 words, concrete, evocative of the user's actual subject.
    BAD: "Welcome to Our Website" / "Empower Your Workflow" / "The Future of X".
    GOOD: "Clay, fired daily." / "Ship code while you sleep." / "Ramen, zero shortcuts."
  • Subheads: 12–15 words, one idea.
  • Buttons: verb-first, ≤3 words ("Start firing", "Book the studio", "See the menu").
  • Use specific nouns from the prompt's domain (materials, places, dish names,
    tools, prices). NEVER lorem ipsum. NEVER "Lorem". No "[placeholder]".

STRUCTURE:
  • Keep the provided skeleton's grid exactly — its spans encode drawn proportions.
  • Inside each region, vary internal composition: asymmetric splits, offset
    images, overlapping cards, numbered editorial rows, bento cells. NEVER the
    default "icon-in-rounded-square + title + 2-line description ×3" pattern.
  • Whitespace is a material: major sections get py-20/py-28, not py-8.
  • One idea per section; hierarchy before decoration.

QUALITY BAR (few-shot contrast — aim for the GOOD side):
  GOOD: <h1 className="text-7xl md:text-[9vw] font-black tracking-tighter leading-[0.9]">Clay, fired daily.</h1>
  BAD:  <h1 className="text-4xl font-bold">Welcome to Our Pottery Website</h1>
  GOOD: <div className="grid md:grid-cols-12 gap-8"><div className="md:col-span-5 ..."/><div className="md:col-span-7 ..."/></div>
  BAD:  <div className="flex gap-6"><Card/><Card/><Card/></div>
  GOOD: <span className="text-xs uppercase tracking-[0.3em] text-neutral-500">The Studio — Est. 2019</span>
  BAD:  <span className="text-sm text-gray-500">About Us</span>`

export const GENERATION_SYSTEM_PROMPT = `You are IntentDraw's React generation engine.
Your job: produce EXCEPTIONAL websites that look like a senior human designer
shipped them — award-portfolio work, not an AI template machine.

You will receive:
  1. A list of regions with positions (as % of the page), sizes, shape types,
     intent tags, and optional user intent notes
  2. A CONCRETE LAYOUT SKELETON that you MUST use
  3. Optional component inspiration (structural moves to learn from, not copy)
  4. Hard design tokens (style constraints + banned classes)
  5. A user prompt describing what each region should contain and look like

════════════════════════════════════════════
UNDERSTANDING REGIONS & SPATIAL INTENT
════════════════════════════════════════════

Regions are SPATIAL REFERENCES. Their shape type tells you geometry, NOT purpose.
The user's prompt and each region's "intent" note define what it IS.

Each region carries a classificationTag:
  - "exact-placement" / "approximate-area": structural — it appears in the
    LAYOUT SKELETON as a <RegionX /> placeholder you must fill.
  - "decorative": NOT a content block. Respect its backgroundScope EXACTLY:
      * "region": render ONLY where drawn — inside/behind the region it
        overlaps, or confined to its drawn position. NEVER stretch it page-wide.
      * "full": full-page background layer behind all content.
  - "relational": an arrow/connection — express as a directional cue or
    connector, not a content block.

CRITICAL REQUIREMENT — THE SKELETON:
The layout skeleton exactly mirrors the user's drawing. YOU MUST COPY IT
EXACTLY: same grid structure, same column spans, same order. Replace the
<RegionX /> placeholders with the components you build.

${CRAFT_STANDARDS}

════════════════════════════════════════════
BANNED PATTERNS — NEVER PRODUCE THESE
════════════════════════════════════════════

NEVER: Import or use ANY external libraries (framer-motion, next/image, next/link, react-router…). You ONLY have 'react' and 'lucide-react'. Images use plain <img> tags.
NEVER: placeholder images from picsum.photos. Use realistic Unsplash source URLs only if an image is truly required; prefer CSS gradients/SVG.
NEVER: Lorem ipsum or generic filler copy.
NEVER: Spinning loader rings as default state.
NEVER: Output markdown backticks (\`\`\`).
NEVER: The classes listed as BANNED in the design tokens — they will be
auto-replaced with clashing styles if you use them.

════════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════════

Return ONLY a complete, valid React TSX file. Nothing else.
No markdown formatting. No code fences. No explanation before or after.
Your response must start directly with imports and end with the default export.

Structure:
/* IntentDraw | Regions used: R1, R2... */
import React, { useState } from 'react';
import { Camera, ChevronRight } from 'lucide-react';

// Use this comment to denote regions so they can be regenerated later
// <!-- LOCKED:R1 -->
const Region1 = () => (
  <div className="...">...</div>
)

export default function App() {
  return (
    <div className="min-h-screen ...">
      {/* THE LAYOUT SKELETON, with each <RegionX /> replaced by real components */}
      <Region1 />
    </div>
  );
}`

// =============================================================================
// CHUNKED GENERATION SYSTEM PROMPTS
// =============================================================================

export const CHUNKED_REGION_SYSTEM_PROMPT = `You are IntentDraw's React component generation engine.
Your job is to generate ONLY the React components for a specific subset of regions.

You will receive:
  1. The user prompt describing the website
  2. The specific regions you must build, with their positions, sizes, intent tags and notes
  3. The overall layout skeleton for context

CRITICAL REQUIREMENTS:
1. ONLY generate the React components for the requested regions — define each as
   \`const RegionX = () => (...)\`. Do NOT generate the 'export default function App()'.
2. Follow the same extreme visual quality rules: display-scale typography with
   tight tracking, real concrete copy (3–5 word headlines, verb-first buttons),
   asymmetric internal structure, generous section padding.
3. Structural regions ("exact-placement"/"approximate-area") fill their grid cell —
   no absolute positioning, the shell already places them.
4. Decorative regions are self-positioning: return a component that renders an
   absolutely-positioned stylistic layer (SVG/CSS) confined to its drawn area
   (backgroundScope "region") or a fixed full-page background layer (scope "full").
5. Relational regions render a subtle directional cue/connector, absolutely positioned.
6. If you need icons, include 'import { IconName } from "lucide-react";' at the top.
7. Respect the design tokens and their banned classes exactly.

Structure:
import { Camera, Star } from 'lucide-react';

// <!-- CHUNK:R1 -->
const Region1 = () => (
  <section className="...">...</section>
)

// <!-- CHUNK:R2 -->
const Region2 = () => (
  <div className="...">...</div>
)`

// =============================================================================
// REGENERATE REGION SYSTEM PROMPT
// =============================================================================

export const REGENERATE_REGION_SYSTEM_PROMPT = `You are IntentDraw's React regeneration engine.
You will modify ONE specific region component while preserving all others EXACTLY.

RULES:
1. You receive the complete existing React TSX file and the region to regenerate.
2. Find the React component for that region (look for comments or component names).
3. ONLY modify that region's content and styling.
4. Keep ALL other code byte-for-byte identical.
5. Maintain the existing premium, bold design language: display-scale typography
   with tight tracking, real concrete copy, asymmetric structure. No generic
   soft-UI templates, no filler copy.
6. The regenerated region must fit seamlessly with surrounding design.

Locked regions (marked with // <!-- LOCKED:RX --> comments):
  NEVER modify these, even if asked.

Output:
  Return the COMPLETE React TSX file with only the target region changed.
  No markdown. No code fences. No explanation.`


// =============================================================================
// SHARED HELPERS
// =============================================================================

/** Canvas bounds covering all regions. */
function getCanvasBounds(regions: Region[]): { width: number; height: number } {
  const allX = regions.flatMap(r => [r.geometry.x, r.geometry.x + r.geometry.width])
  const allY = regions.flatMap(r => [r.geometry.y, r.geometry.y + r.geometry.height])
  return {
    width: Math.max(...allX, 1),
    height: Math.max(...allY, 1),
  }
}

/** Normalized region data with explicit percentage units and intent notes. */
function buildRegionData(regions: Region[]) {
  const { width: canvasWidth, height: canvasHeight } = getCanvasBounds(regions)

  // A region is floating if it overlaps another region by >40% of its area
  const isFloating = (region: Region): boolean => {
    const rBox = region.geometry
    for (const other of regions) {
      if (other.id === region.id) continue
      const oBox = other.geometry
      const overlapX = Math.max(0, Math.min(rBox.x + rBox.width, oBox.x + oBox.width) - Math.max(rBox.x, oBox.x))
      const overlapY = Math.max(0, Math.min(rBox.y + rBox.height, oBox.y + oBox.height) - Math.max(rBox.y, oBox.y))
      const overlapArea = overlapX * overlapY
      const regionArea = rBox.width * rBox.height
      if (regionArea > 0 && overlapArea > regionArea * 0.4) return true
    }
    return false
  }

  const getDirection = (region: Region): string | null => {
    if (region.geometry.type !== 'arrow' || !region.geometry.path || region.geometry.path.length < 2) {
      return null
    }
    const start = region.geometry.path[0]
    const end = region.geometry.path[region.geometry.path.length - 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
    return dy > 0 ? 'down' : 'up'
  }

  return regions.map((r, i) => ({
    id: `r${i + 1}`,
    label: `R${r.regionNumber}`,
    // All positions are PERCENTAGES of the page (0-100)
    leftPercent: Math.round((r.geometry.x / canvasWidth) * 100),
    topPercent: Math.round((r.geometry.y / canvasHeight) * 100),
    widthPercent: Math.round((r.geometry.width / canvasWidth) * 100),
    heightPercent: Math.round((r.geometry.height / canvasHeight) * 100),
    shapeType: r.geometry.type === 'rectangle' ? 'rect' : r.geometry.type,
    isFloating: isFloating(r),
    directionVector: getDirection(r),
    locked: r.lockState.layout || r.lockState.style || r.lockState.animation,
    // The user's own description of this specific region, if provided
    intent: r.intent?.trim() || null,
    classificationTag: r.classificationTag || 'exact-placement',
    backgroundScope: r.classificationTag === 'decorative' ? (r.backgroundScope || 'region') : undefined,
  }))
}

function buildTokenSection(tokens: DesignTokenSet): string {
  return `HARD DESIGN CONSTRAINTS (PRESET: ${tokens.name}):
You MUST follow these concrete style tokens exactly. Do NOT use generic fallback classes.
- Border Radius: ${tokens.borderRadius}
- Colors: ${tokens.colorPalette}
- Typography: ${tokens.typography}
- Shadows/Borders: ${tokens.shadowTreatment}
- Special Instructions: ${tokens.specialInstructions || 'None'}

CRITICAL - BANNED CLASSES (auto-enforced by post-processing — using them produces clashing styles):
${tokens.bannedClasses.join(', ')}`
}

// =============================================================================
// USER PROMPT BUILDERS
// =============================================================================

export function buildGenerationUserPrompt(
  regions: Region[],
  userPrompt: string,
  tokens: DesignTokenSet,
  globalTheme?: string,
  hasDrawingImage?: boolean
): string {
  const sanitized = sanitizeUserPrompt(userPrompt)

  const sections: string[] = []

  // Add Design Tokens (Aesthetic Enforcement)
  sections.push(buildTokenSection(tokens))

  // Component inspiration (audit P0.3) — structural few-shot, selected by prompt
  const inspiration = buildInspirationSection(sanitized, regions)
  if (inspiration) sections.push(inspiration)

  // Build normalized region data
  if (regions.length > 0) {
    const { width: canvasWidth, height: canvasHeight } = getCanvasBounds(regions)

    sections.push(`REGIONS (all positions/sizes are PERCENTAGES of the page, 0-100):
${JSON.stringify(buildRegionData(regions), null, 2)}`)

    // Add layout description (skeleton + positioned decorative/relational instructions)
    sections.push(describeLayout(regions, canvasWidth, canvasHeight))
  } else {
    sections.push('NO REGIONS DRAWN — Create a complete website based only on the prompt.')
  }

  // Visual reference instruction when canvas image will be attached
  if (hasDrawingImage) {
    sections.push(`VISUAL REFERENCE IMAGE:
An image of the user's canvas drawing is attached to this request.
Use it to understand the VISUAL CHARACTER of any decorative/freeform shapes
(their curves, flow, density, rhythm, colors) and echo that character in CSS/SVG.
The region positions above remain the source of truth for WHERE things go.
Decorative shapes are NOT literal layout boxes unless their tags say so.`)
  }

  if (globalTheme) {
    sections.push(`THEME: ${globalTheme}`)
  }

  sections.push(`USER PROMPT:\n${sanitized}`)

  return wrapUserPrompt(sections.join('\n\n'))
}

export function buildRegenerateUserPrompt(
  regionNumber: number,
  userPrompt: string,
  existingCode: string,
  allRegions: Region[]
): string {
  const sanitized = sanitizeUserPrompt(userPrompt)

  const regionList = allRegions.map(r => {
    const marker = r.regionNumber === regionNumber ? ' ← REGENERATE' : ''
    const locked = (r.lockState.layout || r.lockState.style || r.lockState.animation) ? ' [LOCKED]' : ''
    const intent = r.intent?.trim() ? ` — "${r.intent.trim()}"` : ''
    return `R${r.regionNumber}: ${r.geometry.type}${locked}${intent}${marker}`
  }).join('\n')

  const prompt = `EXISTING HTML:
${existingCode}

REGIONS:
${regionList}

REGENERATE R${regionNumber} with:
${sanitized}

Return complete React TSX code with ONLY R${regionNumber} modified.`

  return wrapUserPrompt(prompt)
}

export function buildChunkUserPrompt(
  regions: Region[],
  allRegions: Region[],
  userPrompt: string,
  tokens: DesignTokenSet,
  globalTheme?: string
): string {
  const sanitized = sanitizeUserPrompt(userPrompt)

  const sections: string[] = []

  sections.push(buildTokenSection(tokens))

  const inspiration = buildInspirationSection(sanitized, allRegions)
  if (inspiration) sections.push(inspiration)

  // Full context: this chunk's regions with geometry + intent,
  // plus the overall skeleton so components know where they live.
  const { width: canvasWidth, height: canvasHeight } = getCanvasBounds(allRegions)

  const chunkData = buildRegionData(allRegions).filter(rd =>
    regions.some(r => `R${r.regionNumber}` === rd.label)
  )

  sections.push(`YOUR REGIONS — define a \`const RegionX = () => (...)\` for EACH of them (positions/sizes are PERCENTAGES of the page, 0-100):
${JSON.stringify(chunkData, null, 2)}`)

  sections.push(`OVERALL LAYOUT (for context — build ONLY your regions above):
${describeLayout(allRegions, canvasWidth, canvasHeight)}`)

  if (globalTheme) {
    sections.push(`THEME: ${globalTheme}`)
  }

  sections.push(`USER PROMPT:\n${sanitized}`)

  return wrapUserPrompt(sections.join('\n\n'))
}
