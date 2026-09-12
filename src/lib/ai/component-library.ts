// =============================================================================
// COMPONENT INSPIRATION LIBRARY (audit P0.3)
// =============================================================================
// Curated pattern DESCRIPTIONS — not copyable code. The generation prompt
// injects a handful of these as structural inspiration ("learn the moves,
// never copy verbatim"), which steers the model away from its training-bias
// default (centered column + 3 equal cards + icon-in-rounded-square).
//
// Principle: we INSPIRE from proven component patterns; we never ship or copy
// open-source component code.

import type { Region } from '@/types'

export type PatternCategory =
  | 'hero' | 'nav' | 'features' | 'pricing' | 'testimonials'
  | 'gallery' | 'cta' | 'footer' | 'stats' | 'faq' | 'team'

export interface InspirationPattern {
  id: string
  category: PatternCategory
  name: string
  /** One-line structural summary. */
  summary: string
  /** Concrete structural moves the model can adapt. */
  moves: string[]
  /** Typography guidance specific to this pattern. */
  typography: string
}

export const PATTERNS: InspirationPattern[] = [
  // ── HERO ──────────────────────────────────────────────────────────────────
  {
    id: 'hero-mega-type', category: 'hero', name: 'Mega-type statement',
    summary: 'The headline IS the design — one enormous typographic block with almost nothing else.',
    moves: [
      'Headline at 12-16vw, 2-3 words per line, leading-[0.85]',
      'Everything else tiny: small eyebrow label, one-line sub, one text link',
      'Optional hairline rules top/bottom framing the type',
    ],
    typography: 'font-black tracking-tighter; body/label contrast 900 vs 400 at text-xs',
  },
  {
    id: 'hero-split-offset', category: 'hero', name: 'Asymmetric split, visual bleeding off-edge',
    summary: 'Text column and oversized visual in an uneven split; the image crops past the viewport edge.',
    moves: [
      'grid md:grid-cols-12 with 5/7 or 4/8 split — never 50/50',
      'Visual overflows its column (negative margin / object-cover taller than the text block)',
      'One overlapping element (badge, price tag, rotated caption) crossing the seam',
    ],
    typography: 'Display heading text-5xl md:text-7xl tracking-tight; caption text-xs uppercase tracking-[0.2em]',
  },
  {
    id: 'hero-full-bleed', category: 'hero', name: 'Full-bleed image, anchored headline block',
    summary: 'Full-viewport image with a gradient scrim; headline block anchored to one corner.',
    moves: [
      'h-[90vh] image, object-cover, scrim gradient from black/70',
      'Headline block bottom-left with max-w-2xl, not centered',
      'Micro-details: coordinates, index number, or date in tiny mono type at the edges',
    ],
    typography: 'Headline text-6xl+ font-bold text-white; meta text-[11px] uppercase tracking-[0.25em]',
  },
  {
    id: 'hero-marquee', category: 'hero', name: 'Headline + keyword marquee band',
    summary: 'Statement headline above a high-contrast scrolling band of keywords or product names.',
    moves: [
      'Edge-to-edge solid band (inverted color) with repeating keywords separated by ✦ or /',
      'CSS animation translateX marquee, duplicated content for seamless loop',
      'Band clips slightly past both edges (overflow hidden on parent)',
    ],
    typography: 'Band text-2xl font-extrabold uppercase tracking-tight; alternating outline/solid text',
  },
  {
    id: 'hero-center-stage', category: 'hero', name: 'Centered museum placard',
    summary: 'Deliberately centered, gallery-like statement with enormous whitespace discipline.',
    moves: [
      'py-32 or more; tiny eyebrow, medium headline, one-line sub, single underlined link',
      'Perfect optical centering; nothing else competes',
      'A single hairline or dot as the only ornament',
    ],
    typography: 'Serif display (font-serif) text-5xl md:text-7xl; eyebrow text-[11px] tracking-[0.3em] uppercase',
  },
  {
    id: 'hero-product-float', category: 'hero', name: 'Product floating over a color field',
    summary: 'Flat bold color background; product image floating with a small overlapping detail card.',
    moves: [
      'Solid or subtly gradient color field, no image background',
      'Product shot with soft drop shadow, slightly rotated or off-center',
      'Detail card (price / CTA) overlapping the product corner on white',
    ],
    typography: 'Headline text-6xl font-black; price in tabular-nums; card text-sm',
  },

  // ── NAV ───────────────────────────────────────────────────────────────────
  {
    id: 'nav-editorial-rule', category: 'nav', name: 'Editorial hairline bar',
    summary: 'Thin top bar, brand left, links right, hairline bottom border — quiet and confident.',
    moves: [
      'h-14/16, border-b border-black/10, generous horizontal padding',
      'Small-caps or tracking-wider link labels, no buttons except one quiet text link',
      'Sticky with backdrop-blur and bg-white/80',
    ],
    typography: 'Brand wordmark text-lg font-semibold; links text-[13px] tracking-wide',
  },
  {
    id: 'nav-floating-pill', category: 'nav', name: 'Floating detached pill',
    summary: 'Rounded pill nav floating over the hero with blur and a translucent surface.',
    moves: [
      'max-w-fit mx-auto mt-4 rounded-full border bg-white/70 backdrop-blur-md shadow-sm',
      'Brand dot/mark + links + one solid pill CTA inside',
      'Absolute positioned over the hero, not in flow',
    ],
    typography: 'Links text-[13px] font-medium text-neutral-600; CTA text-xs font-semibold',
  },
  {
    id: 'nav-side-rail', category: 'nav', name: 'Vertical side rail',
    summary: 'Fixed narrow left rail with stacked links — editorial/portfolio feel.',
    moves: [
      'w-16/20 fixed rail with icon+label stack, hairline right border',
      'Content offset by rail width; rail stays on scroll',
      'Rotated vertical wordmark at the rail bottom',
    ],
    typography: 'Labels text-[10px] uppercase tracking-[0.2em]; active state bold + accent bar',
  },

  // ── FEATURES ──────────────────────────────────────────────────────────────
  {
    id: 'features-numbered-editorial', category: 'features', name: 'Numbered editorial list',
    summary: 'Stacked full-width rows with index numbers and hairline dividers — a table of contents, not cards.',
    moves: [
      'Each row: 01 / title (left, w-1/3) / description (right), py-8, border-t hairline',
      'Numbers in large light type or mono; hover shifts row content 4px right',
      'No boxes, no shadows, no icon chips',
    ],
    typography: 'Numbers text-xl font-light tabular-nums text-neutral-400; titles text-2xl font-semibold',
  },
  {
    id: 'features-bento', category: 'features', name: 'Bento grid, unequal cells',
    summary: 'Grid of deliberately unequal cells — one hero cell, varied small ones, mixed content types.',
    moves: [
      'grid md:grid-cols-12, cells spanning 7/5, 4/4/4, 6/3/3 — never uniform',
      'Mix content: one cell image, one big stat, one text-only, one dark inverted',
      'Cells keep their drawn proportions; consistent radius/border across cells',
    ],
    typography: 'Cell titles text-lg font-semibold; stat numerals text-5xl font-black tracking-tight',
  },
  {
    id: 'features-staggered', category: 'features', name: 'Staggered alternating blocks',
    summary: 'Left/right alternating blocks with deliberate vertical offset rhythm.',
    moves: [
      'Alternate text/visual sides every block; text block narrower (5 cols) than visual (7)',
      'Offset the second column down by a few rem to break the horizontal alignment',
      'Connect with a thin vertical rule or generous shared whitespace',
    ],
    typography: 'Block titles text-3xl font-bold tracking-tight; kicker text-xs uppercase tracking-widest',
  },
  {
    id: 'features-spec-sheet', category: 'features', name: 'Dense spec sheet',
    summary: 'Technical, monospace-flavored table of capabilities — reads like a datasheet.',
    moves: [
      'Two-column definition rows: label mono uppercase left, value right, hairline dividers',
      'Tabular numbers, tight leading, small text, no cards',
      'One highlighted row (accent left border or inverted) as the headline stat',
    ],
    typography: 'Labels font-mono text-xs uppercase tracking-wider text-neutral-500; values text-sm',
  },
  {
    id: 'features-icon-ledger', category: 'features', name: 'Inline icon ledger',
    summary: 'Icons live inline with text lines — a ledger, not a card grid.',
    moves: [
      'Rows: small icon (16-20px) inline before the title, description on the same line or next',
      'border-t hairlines, py-6, icon and text share the baseline',
      'Icons monochrome stroke, no chips/squares around them',
    ],
    typography: 'Title text-base font-semibold; description text-sm text-neutral-600 max-w-md',
  },

  // ── PRICING ───────────────────────────────────────────────────────────────
  {
    id: 'pricing-contrast-duo', category: 'pricing', name: 'Two-tier contrast',
    summary: 'Two plans only; the recommended one inverted (dark) against a light page.',
    moves: [
      'Two unequal columns (the featured plan visually heavier / larger padding)',
      'Featured plan: dark card, light text, single accent CTA; other plan: outline card',
      'Feature lists as two columns of checkmarks inside each card',
    ],
    typography: 'Price text-5xl font-black tabular-nums with tiny /mo suffix; plan names text-xs uppercase tracking-widest',
  },
  {
    id: 'pricing-three-elevated', category: 'pricing', name: 'Three tiers, elevated middle',
    summary: 'Classic three tiers where the middle card is physically raised and badged.',
    moves: [
      'Middle card: border-2, badge label on top edge, slightly negative margin to lift it',
      'Side cards quiet: hairline border, muted CTA',
      'Align price baselines across cards',
    ],
    typography: 'Prices text-4xl font-extrabold; "Popular" badge text-[10px] uppercase tracking-[0.2em]',
  },
  {
    id: 'pricing-single-statement', category: 'pricing', name: 'Single plan statement',
    summary: 'One plan, one huge price, a plain list — no comparison tables.',
    moves: [
      'Giant price (text-7xl+) centered or left, per-period in small type',
      'Included items as a simple two-column checklist',
      'One primary CTA + one quiet secondary link',
    ],
    typography: 'Price text-7xl font-black tracking-tighter; list text-sm with check icons',
  },

  // ── TESTIMONIALS ──────────────────────────────────────────────────────────
  {
    id: 'testimonial-pull-quote', category: 'testimonials', name: 'Oversized pull quote',
    summary: 'One huge quote, oversized quotation glyph, right-aligned attribution.',
    moves: [
      'Quote at 2-3xl/4xl serif, max-w-4xl, hanging punctuation',
      'Giant decorative “ glyph (text-8xl, 10% opacity) behind or above',
      'Attribution: name bold, role muted, small avatar circle right-aligned',
    ],
    typography: 'Quote font-serif text-3xl md:text-4xl leading-snug; attribution text-sm',
  },
  {
    id: 'testimonial-masonry', category: 'testimonials', name: 'Masonry quote wall',
    summary: 'Three-plus quotes of different lengths in a masonry column layout.',
    moves: [
      'columns-1 md:columns-3 gap-6 with break-inside-avoid cards',
      'Cards differ: one with photo, one text-only, one with star row / metric',
      'Muted borders, one card inverted for rhythm',
    ],
    typography: 'Quote text-base leading-relaxed; names text-sm font-semibold',
  },
  {
    id: 'testimonial-logo-strip', category: 'testimonials', name: 'Quote + grayscale logo strip',
    summary: 'A single strong quote above a quiet row of customer logos in uniform gray.',
    moves: [
      'Logo row: grayscale, opacity-60, evenly spaced, equal heights (~24-28px)',
      'Use wordmarks in text (font-semibold) when real logos aren\'t available',
      'Quote block above centered, modest size',
    ],
    typography: 'Logos text-lg font-bold text-neutral-400; quote text-xl font-medium',
  },

  // ── GALLERY / PORTFOLIO ───────────────────────────────────────────────────
  {
    id: 'gallery-editorial-grid', category: 'gallery', name: 'Asymmetric editorial grid',
    summary: 'One dominant image plus smaller supporting ones with index-number captions.',
    moves: [
      'grid md:grid-cols-12: hero image spans 8, two stacked images span 4, then a 4/4/4 row',
      'Captions: mono index (01, 02…) + title, tiny type under each image',
      'Images share one aspect discipline (object-cover), varied sizes',
    ],
    typography: 'Captions text-[11px] font-mono uppercase tracking-wider text-neutral-500',
  },
  {
    id: 'gallery-full-bleed-rows', category: 'gallery', name: 'Alternating full-bleed rows',
    summary: 'Full-width image rows alternating with text rows, big counters.',
    moves: [
      'Each project: full-width h-[60vh] image, then a text row (title left, meta right)',
      'Oversized counter numerals (01/02/03) overlapping the image corner',
      'Hover: slight image scale or grayscale→color',
    ],
    typography: 'Project titles text-4xl font-bold tracking-tight; counters text-7xl font-black text-white/90',
  },
  {
    id: 'gallery-tight-mosaic', category: 'gallery', name: 'Tight mosaic with hover reveal',
    summary: 'Gapless/2px-gap thumbnail mosaic; titles reveal on hover overlay.',
    moves: [
      'grid grid-cols-2 md:grid-cols-4 gap-1 or gap-2 only',
      'Overlay gradient + title appears on hover (opacity transition)',
      'Vary row spans occasionally (one tall cell) for rhythm',
    ],
    typography: 'Hover titles text-sm font-semibold text-white; category label text-[10px] uppercase',
  },

  // ── CTA ───────────────────────────────────────────────────────────────────
  {
    id: 'cta-contrast-band', category: 'cta', name: 'Inverted full-width band',
    summary: 'A solid inverted color band with one imperative headline and a single button.',
    moves: [
      'Full-bleed band (page bg inverted), py-20/28',
      'Headline 2-4 words, imperative; ONE button, high contrast, no outline variants',
      'Optional single line of reassurance text under the button (text-xs)',
    ],
    typography: 'Headline text-5xl md:text-6xl font-black tracking-tighter; button text-sm font-semibold',
  },
  {
    id: 'cta-card-overlap', category: 'cta', name: 'Overlapping CTA card',
    summary: 'A card that physically overlaps the section boundary above it.',
    moves: [
      'Card with shadow/border pulled up over the previous section (-mt-12/16)',
      'Inside: split layout — message left, button right',
      'Card uses the accent color or a subtle gradient',
    ],
    typography: 'Message text-2xl font-bold; button compact and solid',
  },
  {
    id: 'cta-terminal', category: 'cta', name: 'Command-line invite',
    summary: 'CTA styled as a terminal/command line — great for dev tools.',
    moves: [
      'Dark rounded card, mono font, $ prompt line with the action as a command',
      'Blinking cursor via CSS animation; one small button as "Run"',
      'Comment line above explaining the command in muted color',
    ],
    typography: 'font-mono text-sm; prompt symbol in accent color; cursor via animate-pulse',
  },

  // ── FOOTER ────────────────────────────────────────────────────────────────
  {
    id: 'footer-mega-wordmark', category: 'footer', name: 'Columns + mega wordmark',
    summary: 'Link columns above a brand wordmark so large it fills the footer width.',
    moves: [
      '4-5 tight link columns (text-xs, muted) on top',
      'Below: wordmark at ~14vw width filling the row, light color/opacity',
      'Bottom bar: © + social icons, hairline top border',
    ],
    typography: 'Links text-xs text-neutral-500 hover:text-black; wordmark font-black tracking-tighter',
  },
  {
    id: 'footer-minimal-rule', category: 'footer', name: 'Minimal single rule',
    summary: 'One hairline, one row: brand, three links, copyright. Done.',
    moves: [
      'border-t only, py-8, flex justify-between items-center',
      'No columns, no icons beyond optional social marks',
    ],
    typography: 'Everything text-xs text-neutral-500; brand text-sm font-semibold',
  },
  {
    id: 'footer-newsletter-lockup', category: 'footer', name: 'Newsletter lockup',
    summary: 'Footer built around a signup: big prompt left, inline form right.',
    moves: [
      'Two-column lockup: oversized prompt (text-2xl+) left; underline-style input + arrow button right',
      'No boxed inputs — bottom-border-only field',
      'Mini link row + socials beneath, muted',
    ],
    typography: 'Prompt text-2xl md:text-3xl font-bold; input text-sm; button icon-only',
  },

  // ── STATS ─────────────────────────────────────────────────────────────────
  {
    id: 'stats-bignum-row', category: 'stats', name: 'Big number row',
    summary: 'A row of huge numerals with tiny labels and hairline separators.',
    moves: [
      'grid grid-cols-2 md:grid-cols-4 divide-x divide-y hairlines',
      'Numerals text-5xl md:text-6xl font-black tabular-nums tracking-tight',
      'Labels text-xs uppercase tracking-widest muted, below numerals',
    ],
    typography: 'Numerals font-black; consider a + suffix or unit in accent color',
  },
  {
    id: 'stats-inline-annotated', category: 'stats', name: 'Inline annotated stats',
    summary: 'Stats embedded inside a prose paragraph as oversized inline numerals.',
    moves: [
      'Paragraph at text-xl/2xl leading-relaxed; key numbers inline at text-4xl font-black',
      'Numbers in accent color or with underline offset',
      'Small footnote markers after each number if needed',
    ],
    typography: 'Prose text-xl leading-relaxed; inline numerals text-4xl font-black align-baseline',
  },

  // ── FAQ ───────────────────────────────────────────────────────────────────
  {
    id: 'faq-accordion-hairline', category: 'faq', name: 'Hairline accordion',
    summary: 'Questions stacked with hairline dividers; no card chrome, plus/minus rotation.',
    moves: [
      'border-t per row, py-5; question text-base font-semibold left, + icon right',
      'Answer reveals with grid-rows animation or simple conditional render, text-sm muted',
      'One row open by default; icon rotates 45° when open',
    ],
    typography: 'Questions text-base font-medium; answers text-sm text-neutral-600 leading-relaxed',
  },
  {
    id: 'faq-two-column', category: 'faq', name: 'Sticky questions column',
    summary: 'Questions summary sticky on the left; the current answer on the right.',
    moves: [
      'grid md:grid-cols-12: sticky md:col-span-5 heading + intro; md:col-span-7 answer list',
      'Each answer: index number, question restated bold, then body',
      'Anchor/scrollspy-style highlight on the active question',
    ],
    typography: 'Left heading text-4xl font-bold tracking-tight; Q text-base font-semibold',
  },

  // ── TEAM ──────────────────────────────────────────────────────────────────
  {
    id: 'team-portrait-grid', category: 'team', name: 'Portrait grid, hover roles',
    summary: 'Equal portraits in a grid; name/role revealed as an overlay on hover.',
    moves: [
      'grid grid-cols-2 md:grid-cols-4 gap-4; portraits aspect-[3/4] object-cover grayscale',
      'Overlay slides up on hover with name + role',
      'Below-grid line for open roles / contact',
    ],
    typography: 'Overlay name text-sm font-semibold; role text-xs uppercase tracking-wide',
  },
  {
    id: 'team-roster-list', category: 'team', name: 'Roster list',
    summary: 'People as list rows — thumb, name, role, one-line bio.',
    moves: [
      'Rows: 40px thumb circle, name (bold) + role (muted) inline, bio right-aligned or second line',
      'Hairline dividers, hover background tint',
      'Compact, information-dense, no cards',
    ],
    typography: 'Name text-sm font-semibold; role text-xs text-neutral-500; bio text-sm',
  },
]

const CATEGORY_KEYWORDS: Record<PatternCategory, string[]> = {
  hero: ['hero', 'landing', 'headline', 'masthead', 'banner', 'above the fold', 'first screen'],
  nav: ['nav', 'header', 'menu', 'navigation', 'top bar', 'navbar'],
  features: ['feature', 'features', 'services', 'service', 'what we do', 'capabilities', 'benefits', 'offerings', 'how it works', 'pillars', 'highlights'],
  pricing: ['pricing', 'price', 'plans', 'tiers', 'packages', 'subscription', 'subscription'],
  testimonials: ['testimonial', 'testimonials', 'review', 'reviews', 'quote', 'quotes', 'customers', 'social proof', 'what people say'],
  gallery: ['gallery', 'portfolio', 'photos', 'images', 'showcase', 'work', 'projects', 'products', 'catalog', 'collection', 'menu items', 'dishes'],
  cta: ['cta', 'call to action', 'sign up', 'get started', 'contact', 'book', 'demo', 'trial', 'newsletter', 'subscribe', 'waitlist'],
  footer: ['footer', 'sitemap', 'site map', 'bottom'],
  stats: ['stats', 'statistics', 'numbers', 'metrics', 'results', 'impact', 'kpi', 'by the numbers'],
  faq: ['faq', 'faqs', 'questions', 'answers', 'frequently asked'],
  team: ['team', 'about', 'founders', 'people', 'staff', 'crew', 'us'],
}

/** Full-site cues: when present, always give nav + footer + cta inspiration. */
const FULL_SITE_KEYWORDS = ['website', 'web site', 'landing page', 'site for', 'page for', 'homepage', 'home page', 'full site']

/** Deterministic 32-bit hash so the same prompt always picks the same variants. */
function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function scoreCategories(prompt: string): Array<{ category: PatternCategory; score: number }> {
  const p = ` ${prompt.toLowerCase()} `
  const scores = (Object.keys(CATEGORY_KEYWORDS) as PatternCategory[]).map(category => {
    let score = 0
    for (const kw of CATEGORY_KEYWORDS[category]) {
      if (p.includes(kw)) score += kw.includes(' ') ? 2 : 1 // phrase cues are stronger
    }
    return { category, score }
  })
  return scores.sort((a, b) => b.score - a.score)
}

/**
 * Picks 3–6 relevant inspiration patterns for the given prompt + drawing.
 * Deterministic: the same prompt always selects the same variants (only the
 * keyword-scored categories rotate through the pattern list by hash).
 */
export function selectInspirationPatterns(prompt: string, regions: Region[]): InspirationPattern[] {
  const scored = scoreCategories(prompt)
  const hits = scored.filter(s => s.score > 0)
  const isFullSite = FULL_SITE_KEYWORDS.some(kw => prompt.toLowerCase().includes(kw)) || regions.length >= 4

  // Categories to include: explicit keyword hits first; pad to a full-site
  // baseline (nav, hero, cta, footer) when the prompt implies a whole page.
  const categories = new Set<PatternCategory>()
  for (const h of hits) categories.add(h.category)
  if (isFullSite || categories.size === 0) {
    categories.add('hero')
    categories.add('nav')
    if (isFullSite) categories.add('cta')
    if (isFullSite && regions.length >= 5) categories.add('footer')
  }

  // Cap at 5 categories, keeping the strongest scores.
  const orderedCategories = [
    ...hits.map(h => h.category),
    ...(['hero', 'nav', 'cta', 'footer'] as PatternCategory[]),
  ].filter(c => categories.has(c))
  const uniqueCategories = [...new Set(orderedCategories)].slice(0, 5)

  const seed = hashString(prompt.trim().toLowerCase())
  const selected: InspirationPattern[] = []
  uniqueCategories.forEach((category, index) => {
    const inCategory = PATTERNS.filter(p => p.category === category)
    if (inCategory.length === 0) return
    // Rotate deterministically per prompt so different prompts explore
    // different variants, but the same prompt is always consistent.
    selected.push(inCategory[(seed + index * 7) % inCategory.length])
  })

  return selected
}

/** Renders the selected patterns as the prompt injection block. */
export function buildInspirationSection(prompt: string, regions: Region[]): string {
  const patterns = selectInspirationPatterns(prompt, regions)
  if (patterns.length === 0) return ''

  const lines = patterns.map(p =>
    `• ${p.category.toUpperCase()} — "${p.name}": ${p.summary}\n   Moves: ${p.moves.join('; ')}.\n   Type: ${p.typography}.`
  )

  return `COMPONENT INSPIRATION (learn the structural moves — NEVER copy verbatim; adapt them to the user's subject, the layout skeleton, and the design tokens):
${lines.join('\n')}`
}
