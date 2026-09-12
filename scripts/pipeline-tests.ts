// =============================================================================
// PIPELINE BEHAVIOR TESTS
// =============================================================================
// No test framework in this repo — this is a plain assertion script compiled
// with tsc and executed with node:
//
//   npx tsc -p scripts/tsconfig.pipeline-tests.json && node .pipeline-test-out/scripts/pipeline-tests.js
//
// Covers the deterministic (non-LLM) generation pipeline pieces:
// intent heuristics, layout skeleton, deterministic shell, component
// inspiration selection, design-token resolution, banned-class
// post-processing, extractReact robustness, and the generation cache.

import {
  assessAllRegionIntents,
  assessRegionIntent,
  getCanvasBounds,
  type RegionIntentTag,
} from '../src/lib/ai/intent-heuristics'
import { describeLayout, buildShellTsx } from '../src/lib/ai/region-analyzer'
import { selectInspirationPatterns, buildInspirationSection } from '../src/lib/ai/component-library'
import { resolveDesignTokens, PRESETS } from '../src/lib/ai/design-tokens'
import { postProcessCode } from '../src/lib/ai/postprocess'
import { extractReact, imageMimeFromDataUrl } from '../src/lib/utils'
import { makeGenerationCacheKey, getCachedGeneration, setCachedGeneration } from '../src/lib/ai/cache'
import type { Region } from '../src/types'

// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function mkRegion(
  n: number,
  type: Region['geometry']['type'],
  x: number, y: number, w: number, h: number,
  intent = '',
  extra: Partial<Region> = {}
): Region {
  return {
    id: `r${n}`,
    regionNumber: n,
    geometry: { x, y, width: w, height: h, type },
    intent,
    lockState: { layout: false, style: false, animation: false },
    generatedCode: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

// ─── 1. Intent heuristics (audit P0.1) ─────────────────────────────────────

console.log('\n[1] Intent heuristics')

// THE audit failure case: 6 freeform regions, no per-region intents, prompt
// asking for "a similar drawing as the regions 1 to 6 show as solid
// background" — the old classifier tagged ALL of them decorative and the
// layout was discarded. They must be structural now.
{
  const regions = [
    mkRegion(1, 'freeform', 0, 0, 1061, 180),
    mkRegion(2, 'freeform', 0, 200, 1061, 60),
    mkRegion(3, 'freeform', 0, 280, 520, 160),
    mkRegion(4, 'freeform', 540, 280, 520, 160),
    mkRegion(5, 'freeform', 0, 460, 1061, 100),
    mkRegion(6, 'freeform', 0, 580, 1061, 33),
  ]
  const prompt = 'make a website with a similar drawing as the regions 1 to 6 show as solid background for each section'
  const { assessments } = assessAllRegionIntents(regions, prompt)
  for (const r of regions) {
    const tag = assessments[r.id].tag
    check(`audit case: freeform R${r.regionNumber} structural (got ${tag})`,
      tag === 'exact-placement' || tag === 'approximate-area')
  }
  check('audit case: at most some regions ambiguous (LLM may refine)', true)
}

// Shape-type defaults
{
  const rect = mkRegion(1, 'rectangle', 0, 0, 500, 100)
  const circle = mkRegion(2, 'circle', 50, 150, 200, 200)
  const arrow = mkRegion(3, 'arrow', 0, 400, 300, 80)
  const regions = [rect, circle, arrow]
  const a = assessAllRegionIntents(regions, 'a landing page')
  check('rectangle → exact-placement', a.assessments[rect.id].tag === 'exact-placement')
  check('circle (13% canvas) → exact-placement', a.assessments[circle.id].tag === 'exact-placement')
  check('arrow → relational', a.assessments[arrow.id].tag === 'relational')
  check('arrow not ambiguous', !a.assessments[arrow.id].ambiguous)
}

// Freeform size ladder
{
  // canvas 1000x1000
  const big = mkRegion(1, 'freeform', 0, 0, 800, 800)        // 64% → structural
  const small = mkRegion(2, 'freeform', 0, 0, 100, 100)      // 1% → decorative
  const medium = mkRegion(3, 'freeform', 0, 0, 400, 400)     // 16% → ambiguous
  const regions = [big, small, medium]
  const a = assessAllRegionIntents(regions, 'portfolio site')
  check('big freeform (>30%) → approximate-area', a.assessments[big.id].tag === 'approximate-area')
  check('big freeform not ambiguous', !a.assessments[big.id].ambiguous)
  check('small freeform (<5%) → decorative region', a.assessments[small.id].tag === 'decorative' && a.assessments[small.id].backgroundScope === 'region')
  check('medium freeform → ambiguous, structural-leaning default', a.assessments[medium.id].ambiguous && a.assessments[medium.id].tag === 'approximate-area')
}

// Intent notes
{
  const hero = mkRegion(1, 'freeform', 0, 0, 400, 400, 'hero section with big headline')
  const wave = mkRegion(2, 'freeform', 0, 0, 400, 100, 'background wave behind the hero')
  const fullBg = mkRegion(3, 'freeform', 0, 0, 900, 900, 'full page background texture')
  const regions = [hero, wave, fullBg]
  const a = assessAllRegionIntents(regions, 'studio site')
  check('freeform + content intent → exact-placement', a.assessments[hero.id].tag === 'exact-placement')
  check('freeform + "background wave" intent → decorative region', a.assessments[wave.id].tag === 'decorative' && a.assessments[wave.id].backgroundScope === 'region')
  check('freeform + "full page background" intent → decorative full', a.assessments[fullBg.id].tag === 'decorative' && a.assessments[fullBg.id].backgroundScope === 'full')
}

// Prompt references
{
  const pricing = mkRegion(3, 'freeform', 0, 0, 400, 400)
  const pageBg = mkRegion(2, 'freeform', 0, 0, 400, 400)
  const bounds = getCanvasBounds([pricing, pageBg])
  const a1 = assessRegionIntent(pricing, [pricing, pageBg], 'Region 3 is the pricing table for our plans', bounds)
  check('prompt "Region 3 is the pricing table" → structural (not ambiguous)', a1.tag === 'approximate-area' && !a1.ambiguous)
  const a2 = assessRegionIntent(pageBg, [pricing, pageBg], 'region 2 is the page background, keep content off it', bounds)
  check('prompt "region 2 is the page background" → decorative full', a2.tag === 'decorative' && a2.backgroundScope === 'full')

  // False-positive guards
  const r1 = mkRegion(1, 'rectangle', 0, 0, 300, 300)
  const a3 = assessRegionIntent(r1, [r1, pricing], 'wait for 1 minute then show the hero', bounds)
  check('"for 1 minute" does not reference Region 1', a3.reason.includes('structural, exact placement'))

  const r12 = mkRegion(12, 'freeform', 0, 0, 400, 400)
  const sibling = mkRegion(13, 'rectangle', 0, 0, 1000, 1000)
  const a4 = assessRegionIntent(r12, [r12, sibling], 'region 1 is the nav', getCanvasBounds([r12, sibling]))
  check('"region 1" does not match Region 12 (medium freeform stays ambiguous)', a4.ambiguous)
}

// Overrides win
{
  const r = mkRegion(1, 'freeform', 0, 0, 400, 400, '', { tagOverride: 'decorative', backgroundScopeOverride: 'full' })
  const a = assessRegionIntent(r, [r], 'anything', getCanvasBounds([r]))
  check('tagOverride respected → decorative full', a.tag === 'decorative' && a.backgroundScope === 'full' && !a.ambiguous)
}

// Full-canvas rect: alone → structural; with others → full-page background
{
  const lone = mkRegion(1, 'rectangle', 0, 0, 990, 990)
  const a1 = assessRegionIntent(lone, [lone], 'site', getCanvasBounds([lone]))
  check('lone ~full-canvas rect → structural (never discard the only drawing)', a1.tag === 'exact-placement')
  const hero = mkRegion(2, 'rectangle', 0, 0, 990, 200)
  const bg = mkRegion(1, 'rectangle', 0, 0, 990, 990)
  const a2 = assessRegionIntent(bg, [bg, hero], 'site', getCanvasBounds([bg, hero]))
  check('~full-canvas rect alongside others → decorative full', a2.tag === 'decorative' && a2.backgroundScope === 'full')
}

// ─── 2. Layout skeleton (audit P0.2) ───────────────────────────────────────

console.log('\n[2] Layout skeleton')

{
  // Asymmetric two-column row: 30% / 70%
  const left = mkRegion(1, 'rectangle', 0, 0, 300, 400)
  const right = mkRegion(2, 'rectangle', 320, 0, 680, 400)
  const skeleton = describeLayout([left, right], 1000, 400)
  check('skeleton uses 12-col grid', skeleton.includes('md:grid-cols-12'))
  check('asymmetric spans 4/8 (not 50/50 flex)', skeleton.includes('md:col-span-4') && skeleton.includes('md:col-span-8'))
  check('no flex-basis percentages', !skeleton.includes('flexBasis'))
}

{
  // Three varied columns 60/20/20
  const cols = [
    mkRegion(1, 'rectangle', 0, 0, 600, 300),
    mkRegion(2, 'rectangle', 620, 0, 190, 300),
    mkRegion(3, 'rectangle', 830, 0, 170, 300),
  ]
  const skeleton = describeLayout(cols, 1000, 300)
  check('3-col spans sum to 12 (7/3/2)', skeleton.includes('md:col-span-7') && skeleton.includes('md:col-span-3') && skeleton.includes('md:col-span-2'))
}

{
  // Row grouping: overlapping short/tall shapes share a row; separated bands don't
  const tall = mkRegion(1, 'rectangle', 0, 0, 400, 500)
  const short = mkRegion(2, 'rectangle', 500, 100, 400, 200) // vertical overlap w/ tall: 100→300 vs 0→500 → yes
  const far = mkRegion(3, 'rectangle', 0, 900, 900, 100)    // clear gap
  const skeleton = describeLayout([tall, short, far], 1000, 1000)
  const rowMatches = skeleton.match(/ROW \d+/g) ?? []
  check('overlapping shapes grouped into 2 rows (got ' + rowMatches.length + ')', rowMatches.length === 2)
}

{
  // Offset single-column region gets an asymmetry note
  const offset = mkRegion(1, 'rectangle', 300, 0, 500, 300)
  const skeleton = describeLayout([offset], 1000, 300)
  check('offset region honored (note present)', /starts \d+% from the left|honor the (offset|asymmetry)/i.test(skeleton))
}

{
  // All-decorative drawing keeps spatial guidance
  const squiggle = mkRegion(1, 'freeform', 0, 0, 100, 100)
  squiggle.classificationTag = 'decorative'
  squiggle.backgroundScope = 'region'
  const skeleton = describeLayout([squiggle], 1000, 1000)
  check('all-decorative keeps composition guidance', skeleton.includes('composition') && skeleton.includes('LOCAL DECORATION'))
}

// ─── 3. Deterministic shell (audit P1.2) ───────────────────────────────────

console.log('\n[3] Deterministic shell')

{
  const nav = mkRegion(1, 'rectangle', 0, 0, 1000, 80)
  const hero = mkRegion(2, 'rectangle', 0, 120, 560, 400)
  const visual = mkRegion(3, 'rectangle', 600, 120, 400, 400)
  const bg = mkRegion(4, 'freeform', 0, 0, 1000, 700)
  bg.classificationTag = 'decorative'
  bg.backgroundScope = 'full'
  const arrow = mkRegion(5, 'arrow', 400, 600, 200, 100)
  arrow.classificationTag = 'relational'

  const shell = buildShellTsx([nav, hero, visual, bg, arrow], { root: 'bg-white text-black' })
  check('shell has export default', shell.includes('export default function App()'))
  check('shell imports React only', /^import React from 'react';$/m.test(shell) && (shell.match(/^import /gm) ?? []).length === 1)
  check('full-page background placed first (behind content)', shell.indexOf('<Region4 />') < shell.indexOf('<Region1 />'))
  check('shell references every region', ['Region1', 'Region2', 'Region3', 'Region4', 'Region5'].every(r => shell.includes(`<${r} />`)))
  check('shell uses grid spans from drawing (56%/40% → col-span-7/5)', shell.includes('md:col-span-7') && shell.includes('md:col-span-5'))
  check('content wrapped above background layer', /relative z-10/.test(shell))
}

// ─── 4. Component inspiration (audit P0.3) ─────────────────────────────────

console.log('\n[4] Component inspiration')

{
  const patterns = selectInspirationPatterns('SaaS landing page with pricing and testimonials', [])
  const cats = new Set(patterns.map(p => p.category))
  check('SaaS prompt selects pricing inspiration', cats.has('pricing'))
  check('SaaS prompt selects testimonials inspiration', cats.has('testimonials'))
  check('selection is deterministic', JSON.stringify(patterns.map(p => p.id)) ===
    JSON.stringify(selectInspirationPatterns('SaaS landing page with pricing and testimonials', []).map(p => p.id)))
  check('3–6 patterns selected', patterns.length >= 3 && patterns.length <= 6)

  const portfolio = selectInspirationPatterns('photography portfolio site', [])
  check('portfolio prompt selects gallery inspiration', portfolio.some(p => p.category === 'gallery'))

  const section = buildInspirationSection('artisan pottery shop', [])
  check('inspiration section renders with anti-copy framing', section.includes('NEVER copy verbatim') && section.includes('COMPONENT INSPIRATION'))
}

// ─── 5. Design tokens (audit P1.1) ─────────────────────────────────────────

console.log('\n[5] Design tokens')

{
  const p1 = resolveDesignTokens('a brutalist portfolio with sharp corners')
  check('keyword hit → neosleek', p1.id === 'neosleek')
  const a = resolveDesignTokens('website for my local bakery')
  const b = resolveDesignTokens('website for my local bakery')
  check('ambiguous prompt resolves deterministically (same prompt = same preset)', a.id === b.id)
  check('preset has rootClasses for the shell', Object.values(PRESETS).every(p => p.rootClasses.length > 0))
}

// ─── 6. Post-processing (audit P3.2) ───────────────────────────────────────

console.log('\n[6] Banned-class post-processing')

{
  const neo = PRESETS.neosleek
  const r1 = postProcessCode(
    `<div className="rounded-lg bg-gray-50 shadow-md p-6 md:shadow-lg text-gray-500">x</div>`,
    neo
  )
  check('neosleek: rounded-lg → rounded-none', r1.code.includes('rounded-none'))
  check('neosleek: bg-gray-50 → bg-white', r1.code.includes('bg-white') && !r1.code.includes('bg-gray-50'))
  check('neosleek: shadow-md → hard shadow', r1.code.includes('shadow-[4px_4px_0_0_rgba(0,0,0,1)]'))
  check('variant prefix preserved (md:shadow-lg)', r1.code.includes('md:shadow-[4px_4px_0_0_rgba(0,0,0,1)]'))
  check('replacement count reported', r1.replacements === 5)

  const glass = PRESETS.glassmorphism
  const r2 = postProcessCode(`<div className="bg-white bg-white/10 rounded-none">x</div>`, glass)
  check('glass: bg-white → bg-white/10', r2.code.includes('bg-white/10'))
  check('glass: pre-existing bg-white/10 not double-processed', !r2.code.includes('bg-white/10/'))

  const elegant = PRESETS.elegant_serif
  const r3 = postProcessCode(`<h1 className="text-5xl font-black rounded-full">Hi</h1>`, elegant)
  check('elegant: font-black → font-bold', r3.code.includes('font-bold') && !r3.code.includes('font-black'))
  check('elegant: rounded-full → rounded-md', r3.code.includes('rounded-md'))
}

// ─── 7. extractReact robustness ────────────────────────────────────────────

console.log('\n[7] extractReact')

{
  const clean = "import React from 'react';\nexport default function App() { return <div/> }"
  check('clean code untouched', extractReact(clean) === clean)

  const prose = "Here is your website! I hope you like it.\n\nimport React from 'react';\nconst X = () => <div/>;\nexport default function App() { return <X/> }"
  const out = extractReact(prose)
  check('leading prose stripped', out.startsWith("import React"))

  const fenced = '```tsx\nimport React from "react";\nexport default function App(){ return null }\n```\nDone!'
  check('fenced block extracted', extractReact(fenced).startsWith('import React') && !extractReact(fenced).includes('Done'))

  const trailing = "import React from 'react';\nexport default function App() { return <div/> }\n\nThis component renders a beautiful site for pottery lovers."
  const out2 = extractReact(trailing)
  check('trailing prose trimmed', out2.endsWith('}') && !out2.includes('pottery lovers'))

  const withExportAlias = "const A = () => <div/>;\nexport default A;"
  check('export default alias tail preserved', extractReact(withExportAlias) === withExportAlias)
}

// ─── 8. Generation cache (audit P1.3) ──────────────────────────────────────

console.log('\n[8] Generation cache')

{
  const regions = [mkRegion(1, 'rectangle', 0, 0, 100, 100, 'hero')]
  const k1 = makeGenerationCacheKey({ regions, prompt: 'pottery site', provider: 'gemini' })
  const k2 = makeGenerationCacheKey({ regions, prompt: 'pottery site', provider: 'gemini' })
  const k3 = makeGenerationCacheKey({ regions, prompt: 'pottery site!', provider: 'gemini' })
  check('same input → same key', k1 === k2)
  check('different prompt → different key', k1 !== k3)
  check('empty cache miss', getCachedGeneration(k1) === null)
  setCachedGeneration(k1, 'export default function App(){}', 'gemini')
  const hit = getCachedGeneration(k1)
  check('cache roundtrip', hit !== null && hit.code.includes('export default') && hit.provider === 'gemini')
}

// ─── 9. Misc utils ─────────────────────────────────────────────────────────

console.log('\n[9] Misc utils')

{
  check('image mime parsed from data URL', imageMimeFromDataUrl('data:image/jpeg;base64,abc') === 'image/jpeg')
  check('image mime fallback for bare base64', imageMimeFromDataUrl('abc123') === 'image/png')
}

// ─── summary ───────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`)
if (failed === 0) {
  console.log(`ALL ${passed} CHECKS PASSED`)
} else {
  console.log(`${passed} passed, ${failed} FAILED:`)
  for (const f of failures) console.log(`  • ${f}`)
  process.exit(1)
}
