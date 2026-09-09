import type { Region } from '@/types'

// =============================================================================
// REGION ANALYZER v2
// - Robust row clustering (vertical-span overlap ratio, not a fixed 50px)
// - Asymmetric CSS-grid skeletons (12-col spans from real drawn widths)
// - Gap classes mapped from the actual gaps the user drew
// - Positional role hints (header strip / footer / offset / layering)
// - buildShellTsx(): deterministic TSX shell for the chunked path (no AI call)
// =============================================================================

interface LayoutGrid {
  rows: LayoutRow[]
  totalWidth: number
  totalHeight: number
}

interface LayoutRow {
  rowIndex: number
  yStart: number
  yEnd: number
  height: number
  columns: LayoutColumn[]
}

interface LayoutColumn {
  regionNumber: number
  region: Region
  xStart: number
  xEnd: number
  width: number
  widthPercent: number
}

/** Overlap ratio (fraction of the smaller region's area) for the "is X a local background of Y" question. Unified everywhere. */
export const STRUCTURAL_OVERLAP_RATIO = 0.3

function isStructural(r: Region): boolean {
  return !r.classificationTag ||
    r.classificationTag === 'exact-placement' ||
    r.classificationTag === 'approximate-area'
}

/**
 * Groups structural regions into rows: two regions share a row when their
 * vertical spans overlap by ≥ 50% of the SHORTER region's height. This is
 * scale-invariant (a 50px fixed threshold mis-grouped tall/short shapes).
 */
export function analyzeRegionLayout(regions: Region[]): LayoutGrid {
  const structuralRegions = regions.filter(isStructural)

  if (structuralRegions.length === 0) {
    return { rows: [], totalWidth: 800, totalHeight: 600 }
  }

  const allX = structuralRegions.flatMap(r => [r.geometry.x, r.geometry.x + r.geometry.width])
  const allY = structuralRegions.flatMap(r => [r.geometry.y, r.geometry.y + r.geometry.height])
  const totalWidth = Math.max(...allX)
  const totalHeight = Math.max(...allY)

  const sortedByY = [...structuralRegions].sort((a, b) => a.geometry.y - b.geometry.y)

  const rows: LayoutRow[] = []
  for (const region of sortedByY) {
    const top = region.geometry.y
    const bottom = region.geometry.y + region.geometry.height
    const height = Math.max(1, bottom - top)

    const foundRow = rows.find(row => {
      const overlapTop = Math.max(top, row.yStart)
      const overlapBottom = Math.min(bottom, row.yEnd)
      const overlapHeight = overlapBottom - overlapTop
      const smallerHeight = Math.min(height, Math.max(1, row.height))
      return overlapHeight / smallerHeight >= 0.5
    })

    const column: LayoutColumn = {
      regionNumber: region.regionNumber,
      region,
      xStart: region.geometry.x,
      xEnd: region.geometry.x + region.geometry.width,
      width: region.geometry.width,
      widthPercent: Math.round((region.geometry.width / totalWidth) * 100),
    }

    if (foundRow) {
      foundRow.yStart = Math.min(foundRow.yStart, top)
      foundRow.yEnd = Math.max(foundRow.yEnd, bottom)
      foundRow.height = foundRow.yEnd - foundRow.yStart
      foundRow.columns.push(column)
    } else {
      rows.push({ rowIndex: rows.length, yStart: top, yEnd: bottom, height, columns: [column] })
    }
  }

  for (const row of rows) row.columns.sort((a, b) => a.xStart - b.xStart)
  rows.sort((a, b) => a.yStart - b.yStart)
  rows.forEach((row, i) => (row.rowIndex = i))

  return { rows, totalWidth, totalHeight }
}

// ── Skeleton helpers ────────────────────────────────────────────────────────

/** Maps a measured pixel gap to a Tailwind vertical-gap class. */
function rowGapClass(px: number): string {
  if (px <= 36) return 'gap-6'
  if (px <= 80) return 'gap-8'
  if (px <= 140) return 'gap-12'
  if (px <= 220) return 'gap-16'
  return 'gap-20'
}

/** Maps a measured horizontal pixel gap between columns to a Tailwind class. */
function colGapClass(px: number): string {
  if (px <= 24) return 'gap-4'
  if (px <= 60) return 'gap-6'
  if (px <= 120) return 'gap-8'
  return 'gap-10'
}

/**
 * Converts column width percents to 12-col grid spans (largest-remainder
 * rounding so spans always sum to 12 → asymmetric splits survive).
 */
function colSpans(widthPercents: number[]): number[] {
  const raw = widthPercents.map(w => Math.max(1, (w / 100) * 12))
  const floors = raw.map(Math.floor)
  let remainder = 12 - floors.reduce((a, b) => a + b, 0)
  // Distribute leftover columns to the largest fractional parts.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  let k = 0
  while (remainder > 0 && order.length > 0) {
    floors[order[k % order.length].i]++
    remainder--
    k++
  }
  return floors.map(s => Math.min(12, Math.max(1, s)))
}

/** Finds the structural region that best overlaps a non-structural one. */
function findStructuralOverlap(region: Region, structural: Region[]): Region | null {
  const g = region.geometry
  const area = g.width * g.height
  let best: Region | null = null
  let bestOverlap = 0

  for (const s of structural) {
    const sg = s.geometry
    const overlapX = Math.max(0, Math.min(g.x + g.width, sg.x + sg.width) - Math.max(g.x, sg.x))
    const overlapY = Math.max(0, Math.min(g.y + g.height, sg.y + sg.height) - Math.max(g.y, sg.y))
    const overlapArea = overlapX * overlapY
    if (overlapArea > bestOverlap && overlapArea > area * STRUCTURAL_OVERLAP_RATIO) {
      bestOverlap = overlapArea
      best = s
    }
  }
  return best
}

function getArrowDirection(region: Region): string {
  if (!region.geometry.path || region.geometry.path.length < 2) return 'unknown'

  const start = region.geometry.path[0]
  const end = region.geometry.path[region.geometry.path.length - 1]
  const dx = end.x - start.x
  const dy = end.y - start.y

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI

  if (angle > -22.5 && angle <= 22.5) return 'right (→)'
  if (angle > 22.5 && angle <= 67.5) return 'down-right (↘)'
  if (angle > 67.5 && angle <= 112.5) return 'down (↓)'
  if (angle > 112.5 && angle <= 157.5) return 'down-left (↙)'
  if (angle > 157.5 || angle <= -157.5) return 'left (←)'
  if (angle > -157.5 && angle <= -112.5) return 'up-left (↖)'
  if (angle > -112.5 && angle <= -67.5) return 'up (↑)'
  if (angle > -67.5 && angle <= -22.5) return 'up-right (↗)'

  return 'unknown'
}

/** Human-readable position of a region as percentages of the canvas. */
function describePosition(region: Region, canvasWidth: number, canvasHeight: number): string {
  const g = region.geometry
  const left = Math.round((g.x / canvasWidth) * 100)
  const top = Math.round((g.y / canvasHeight) * 100)
  const width = Math.round((g.width / canvasWidth) * 100)
  const height = Math.round((g.height / canvasHeight) * 100)
  return `left ~${left}%, top ~${top}%, ~${width}% wide, ~${height}% tall`
}

/** Role hint for a row based on where it sits on the canvas. */
function rowRoleHint(row: LayoutRow, canvasWidth: number, canvasHeight: number): string | null {
  const topRatio = row.yStart / canvasHeight
  const bottomRatio = row.yEnd / canvasHeight
  const heightRatio = row.height / canvasHeight

  if (row.rowIndex === 0 && topRatio < 0.12 && heightRatio < 0.16) {
    return 'top strip — likely header/navigation'
  }
  if (heightRatio > 0.5) {
    return 'major section — generous internal padding (py-20+) and room for multiple internal blocks'
  }
  if (bottomRatio > 0.88 && heightRatio < 0.2) {
    return 'bottom strip — likely footer'
  }
  return null
}

/** Notes when a single-column row is deliberately not full width. */
function offsetHint(col: LayoutColumn, canvasWidth: number): string | null {
  const leftPct = (col.xStart / canvasWidth) * 100
  const rightPct = ((col.xEnd) / canvasWidth) * 100
  if (leftPct > 8) return `starts ${Math.round(leftPct)}% from the left — honor the offset (max-w + mx-auto/ml-auto or empty leading grid columns), do NOT stretch it full width`
  if (rightPct < 92) return `stops ${Math.round(100 - rightPct)}% short of the right edge — honor the asymmetry (constrain width, align left)`
  return null
}

// ── Main prompt-facing layout description ──────────────────────────────────

/**
 * Converts analyzed layout into a concrete TSX layout skeleton for the AI.
 * Emits an asymmetric CSS-grid skeleton (12-col spans from real drawn
 * widths), gap classes from the drawn gaps, and role/offset/layering notes.
 */
export function describeLayout(regions: Region[], canvasWidth?: number, canvasHeight?: number): string {
  const grid = analyzeRegionLayout(regions)

  const allX = regions.flatMap(r => [r.geometry.x, r.geometry.x + r.geometry.width])
  const allY = regions.flatMap(r => [r.geometry.y, r.geometry.y + r.geometry.height])
  const cw = canvasWidth && canvasWidth > 0 ? canvasWidth : Math.max(...allX, 1)
  const ch = canvasHeight && canvasHeight > 0 ? canvasHeight : Math.max(...allY, 1)

  if (regions.length === 0) {
    return 'NO REGIONS DRAWN — Create a complete website based only on the prompt.'
  }

  const structural = regions.filter(isStructural)
  const decorative = regions.filter(r => r.classificationTag === 'decorative')
  const relational = regions.filter(r => r.classificationTag === 'relational')

  const lines: string[] = []
  const notes: string[] = []

  if (structural.length > 0) {
    // Vertical gap class from the median gap between consecutive rows.
    const gaps: number[] = []
    for (let i = 1; i < grid.rows.length; i++) gaps.push(grid.rows[i].yStart - grid.rows[i - 1].yEnd)
    const medianGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 64
    const gapClass = rowGapClass(Math.max(0, medianGap))

    lines.push('LAYOUT SKELETON:')
    lines.push('You MUST keep this exact structure (grid spans, splits, order). Replace each <RegionX /> with the component you build for that region. The column spans encode the user\'s drawn proportions — asymmetric splits are intentional.')
    lines.push('')
    lines.push('```tsx')
    lines.push(`<div className="w-full flex flex-col ${gapClass}">`)

    for (const row of grid.rows) {
      const role = rowRoleHint(row, cw, ch)
      lines.push(`  {/* ROW ${row.rowIndex + 1}${role ? ` — ${role}` : ''} */}`)

      if (row.columns.length === 1) {
        const col = row.columns[0]
        const offset = offsetHint(col, cw)
        lines.push('  <div className="w-full">')
        lines.push(`    <Region${col.regionNumber} />`)
        lines.push('  </div>')
        if (offset) notes.push(`Region ${col.regionNumber}: ${offset}.`)
      } else {
        // Horizontal gap class from the median gap between adjacent columns.
        const colGaps: number[] = []
        for (let i = 1; i < row.columns.length; i++) {
          colGaps.push(row.columns[i].xStart - row.columns[i - 1].xEnd)
        }
        const medianColGap = colGaps.length
          ? colGaps.sort((a, b) => a - b)[Math.floor(colGaps.length / 2)]
          : 40
        const cg = colGapClass(Math.max(0, medianColGap))

        const spans = colSpans(row.columns.map(c => c.widthPercent))
        const mobileCols = row.columns.length >= 4 ? 'grid-cols-2' : 'grid-cols-1'

        lines.push(`  <div className="grid ${mobileCols} md:grid-cols-12 ${cg}">`)
        row.columns.forEach((col, i) => {
          lines.push(`    <div className="md:col-span-${spans[i]}">`)
          lines.push(`      <Region${col.regionNumber} />`)
          lines.push('    </div>')
        })
        lines.push('  </div>')

        // Bento note when column heights vary a lot within the row.
        const heights = row.columns.map(c => c.region.geometry.height)
        const hMax = Math.max(...heights)
        const hMin = Math.min(...heights)
        if (row.columns.length >= 3 && hMax > hMin * 1.6) {
          notes.push(`ROW ${row.rowIndex + 1}: columns have varied drawn heights (${Math.round(hMin)}–${Math.round(hMax)}px) — treat it as a bento grid: let cells keep their relative proportions instead of forcing equal heights.`)
        }
      }
    }

    lines.push('```')
    lines.push('')

    // Layering notes for structural regions that heavily overlap each other.
    for (const r of structural) {
      const host = findStructuralOverlap(r, structural.filter(s => s.id !== r.id))
      if (host) {
        const ratio = overlapRatio(r, host)
        if (ratio > 0.4) {
          notes.push(`Region ${r.regionNumber} overlaps Region ${host.regionNumber} by ${Math.round(ratio * 100)}% of its area — compose them LAYERED (absolute positioning / negative margins / card overlapping image) rather than as separate stacked rows.`)
        }
      }
    }
  } else {
    lines.push('NO STRUCTURAL REGIONS — the drawing contains only decorative/relational shapes.')
    lines.push('Design the page layout from the prompt, BUT reuse the drawing\'s composition as guidance: shapes that share a horizontal band belong to the same visual section; preserve their relative sizes, alignment and the empty-space rhythm between them. The positions below tell you WHERE the user wanted visual weight.')
    lines.push('')
  }

  // Special instructions for non-structural shapes — with explicit positions
  if (decorative.length > 0 || relational.length > 0) {
    lines.push('SPECIAL SHAPES / FLOATING ELEMENTS:')
    lines.push('The user drew additional non-structural shapes. DO NOT place these in the grid as content blocks. Render them as absolutely-positioned stylistic elements (SVG/CSS) at the positions described below. Positions are percentages of the page, derived from where the user drew them.')

    if (decorative.length > 0) {
      lines.push(`\nDECORATIVE ELEMENTS:`)
      for (const r of decorative) {
        const pos = describePosition(r, cw, ch)
        const scope = r.backgroundScope === 'full' ? 'full' : 'region'
        if (scope === 'full') {
          lines.push(`  • <Region${r.regionNumber} /> (Type: ${r.geometry.type}): FULL-PAGE BACKGROUND. The user wants this as the background of the entire page. Render it as a fixed/absolute layer behind ALL content (lowest z-index), spanning the full page. Echo its visual character (colors, curves, texture).`)
        } else {
          const overlap = findStructuralOverlap(r, structural)
          if (overlap) {
            lines.push(`  • <Region${r.regionNumber} /> (Type: ${r.geometry.type}): LOCAL BACKGROUND for <Region${overlap.regionNumber} />. Render it as an absolutely-positioned decorative layer INSIDE/behind Region${overlap.regionNumber} only — NOT a page-wide background. Do not let it bleed into other regions.`)
          } else {
            lines.push(`  • <Region${r.regionNumber} /> (Type: ${r.geometry.type}): LOCAL DECORATION at ${pos}. Render it as an absolutely-positioned decorative element confined to that area only — NOT a page-wide background. It should exist only where the user drew it.`)
          }
        }
        if (r.intent?.trim()) {
          lines.push(`    User's note for this shape: "${r.intent.trim()}"`)
        }
      }
    }

    if (relational.length > 0) {
      lines.push(`\nRELATIONAL ELEMENTS:`)
      for (const r of relational) {
        const pos = describePosition(r, cw, ch)
        let extra = ''
        if (r.geometry.type === 'arrow') {
          extra = ` It points ${getArrowDirection(r)}.`
        }
        const overlap = findStructuralOverlap(r, structural)
        const relTo = overlap ? ` It connects to / points at <Region${overlap.regionNumber} />.` : ''
        lines.push(`  • <Region${r.regionNumber} /> (Type: ${r.geometry.type}) at ${pos}: indicates a relationship or directional flow.${extra}${relTo} Express it as a subtle directional cue, connector, or animated hint — not a content block.`)
        if (r.intent?.trim()) {
          lines.push(`    User's note for this shape: "${r.intent.trim()}"`)
        }
      }
    }
    lines.push('')
  }

  if (notes.length > 0) {
    lines.push('ASSEMBLY NOTES:')
    for (const note of notes) lines.push(`  • ${note}`)
    lines.push('')
  }

  return lines.join('\n')
}

function overlapRatio(a: Region, b: Region): number {
  const ag = a.geometry
  const bg = b.geometry
  const overlapX = Math.max(0, Math.min(ag.x + ag.width, bg.x + bg.width) - Math.max(ag.x, bg.x))
  const overlapY = Math.max(0, Math.min(ag.y + ag.height, bg.y + bg.height) - Math.max(ag.y, bg.y))
  const areaA = Math.max(1, ag.width * ag.height)
  return (overlapX * overlapY) / areaA
}

// ── Deterministic shell (chunked generation Phase 1 — no AI call) ──────────

export interface ShellClasses {
  /** Root page classes, e.g. "bg-white text-neutral-900". */
  root: string
}

/**
 * Builds the App shell TSX deterministically from the same layout analysis
 * used for the prompt skeleton (audit P1.2). Only region COMPONENTS are
 * AI-generated afterwards and stitched in before `export default`.
 *
 * Placement rules:
 *  - structural regions → grid cells exactly as the skeleton
 *  - decorative + full scope → first child of the root (behind everything)
 *  - decorative + region scope w/ overlap → inside the overlapped region's cell
 *  - decorative w/o overlap / relational → after the grid; components are
 *    absolutely positioned themselves (per their prompt instructions)
 */
export function buildShellTsx(regions: Region[], classes: ShellClasses): string {
  const grid = analyzeRegionLayout(regions)
  const structural = regions.filter(isStructural)
  const decorativeFull = regions.filter(r => r.classificationTag === 'decorative' && r.backgroundScope === 'full')
  const decorativeLocal = regions.filter(r => r.classificationTag === 'decorative' && r.backgroundScope !== 'full')
  const relational = regions.filter(r => r.classificationTag === 'relational')

  const allX = regions.flatMap(r => [r.geometry.x, r.geometry.x + r.geometry.width])
  const allY = regions.flatMap(r => [r.geometry.y, r.geometry.y + r.geometry.height])
  const cw = Math.max(...allX, 1)
  const ch = Math.max(...allY, 1)

  const gaps: number[] = []
  for (let i = 1; i < grid.rows.length; i++) gaps.push(grid.rows[i].yStart - grid.rows[i - 1].yEnd)
  const medianGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 64
  const gapClass = rowGapClass(Math.max(0, medianGap))

  // Local decorative shapes → the structural cell they overlap (if any).
  const localDecorativeByHost = new Map<string, Region[]>()
  const standaloneDecorative: Region[] = []
  for (const d of decorativeLocal) {
    const host = findStructuralOverlap(d, structural)
    if (host) {
      const list = localDecorativeByHost.get(host.id) ?? []
      list.push(d)
      localDecorativeByHost.set(host.id, list)
    } else {
      standaloneDecorative.push(d)
    }
  }

  const lines: string[] = []
  lines.push(`/* IntentDraw | Regions used: ${regions.map(r => `R${r.regionNumber}`).join(', ')} */`)
  lines.push(`import React from 'react';`)
  lines.push('')
  lines.push('// NOTE: <RegionX /> components are generated separately and stitched in.')
  lines.push('export default function App() {')
  lines.push('  return (')
  lines.push(`    <div className="min-h-screen relative overflow-x-clip ${classes.root}">`)

  for (const d of decorativeFull) {
    lines.push(`      {/* R${d.regionNumber} — full-page background layer (drawn by the user) */}`)
    lines.push(`      <Region${d.regionNumber} />`)
  }

  lines.push(`      <div className="relative z-10 flex w-full flex-col ${gapClass}">`)

  for (const row of grid.rows) {
    const role = rowRoleHint(row, cw, ch)
    lines.push(`        {/* ROW ${row.rowIndex + 1}${role ? ` — ${role}` : ''} */}`)

    if (row.columns.length === 1) {
      const col = row.columns[0]
      const locals = localDecorativeByHost.get(col.region.id) ?? []
      lines.push('        <div className="relative w-full">')
      for (const d of locals) {
        lines.push(`          {/* R${d.regionNumber} — local background for this region */}`)
        lines.push(`          <Region${d.regionNumber} />`)
      }
      lines.push(`          <Region${col.regionNumber} />`)
      lines.push('        </div>')
    } else {
      const colGaps: number[] = []
      for (let i = 1; i < row.columns.length; i++) {
        colGaps.push(row.columns[i].xStart - row.columns[i - 1].xEnd)
      }
      const medianColGap = colGaps.length
        ? colGaps.slice().sort((a, b) => a - b)[Math.floor(colGaps.length / 2)]
        : 40
      const cg = colGapClass(Math.max(0, medianColGap))
      const spans = colSpans(row.columns.map(c => c.widthPercent))
      const mobileCols = row.columns.length >= 4 ? 'grid-cols-2' : 'grid-cols-1'

      lines.push(`        <div className="grid ${mobileCols} md:grid-cols-12 ${cg}">`)
      row.columns.forEach((col, i) => {
        const locals = localDecorativeByHost.get(col.region.id) ?? []
        lines.push(`          <div className="relative md:col-span-${spans[i]}">`)
        for (const d of locals) {
          lines.push(`            {/* R${d.regionNumber} — local background for this region */}`)
          lines.push(`            <Region${d.regionNumber} />`)
        }
        lines.push(`            <Region${col.regionNumber} />`)
        lines.push('          </div>')
      })
      lines.push('        </div>')
    }
  }

  lines.push('      </div>')

  for (const d of [...standaloneDecorative, ...relational]) {
    lines.push(`      {/* R${d.regionNumber} — self-positioned floating element (component positions itself absolutely) */}`)
    lines.push(`      <Region${d.regionNumber} />`)
  }

  lines.push('    </div>')
  lines.push('  );')
  lines.push('}')

  return lines.join('\n')
}

/**
 * Finds which regions overlap or are near a specific region.
 * Useful for describing spatial relationships.
 */
export function findNearbyRegions(targetRegion: Region, allRegions: Region[]): {
  above: Region[]
  below: Region[]
  left: Region[]
  right: Region[]
  overlapping: Region[]
} {
  const result = {
    above: [] as Region[],
    below: [] as Region[],
    left: [] as Region[],
    right: [] as Region[],
    overlapping: [] as Region[],
  }

  const target = targetRegion.geometry
  const targetCenterX = target.x + target.width / 2
  const targetCenterY = target.y + target.height / 2

  for (const region of allRegions) {
    if (region.id === targetRegion.id) continue

    const other = region.geometry
    const otherCenterX = other.x + other.width / 2
    const otherCenterY = other.y + other.height / 2

    const overlapsX = target.x < other.x + other.width && target.x + target.width > other.x
    const overlapsY = target.y < other.y + other.height && target.y + target.height > other.y

    if (overlapsX && overlapsY) {
      result.overlapping.push(region)
      continue
    }

    if (otherCenterY < targetCenterY - target.height / 2) {
      result.above.push(region)
    } else if (otherCenterY > targetCenterY + target.height / 2) {
      result.below.push(region)
    }

    if (otherCenterX < targetCenterX - target.width / 2) {
      result.left.push(region)
    } else if (otherCenterX > targetCenterX + target.width / 2) {
      result.right.push(region)
    }
  }

  return result
}
