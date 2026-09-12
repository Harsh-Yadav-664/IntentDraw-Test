// =============================================================================
// CODE POST-PROCESSING (audit P3.2 / P0.5)
// =============================================================================
// Banned-class enforcement must not rely on LLM obedience. After every
// provider returns code, replace each preset's banned + universally-generic
// classes with preset-appropriate equivalents. Applied to monolithic output,
// every chunk, and regenerations — the final assembled file is what gets
// post-processed last so nothing slips through the stitching.

import type { DesignTokenSet } from './design-tokens'

type ReplacementMap = Record<string, string>

const BRUTALIST_SHADOW = 'shadow-[4px_4px_0_0_rgba(0,0,0,1)]'
const SOFT_COLORFUL_SHADOW = 'shadow-[0_8px_30px_rgb(0,0,0,0.12)]'

const PRESET_REPLACEMENTS: Record<string, ReplacementMap> = {
  neosleek: {
    'rounded-sm': 'rounded-none', rounded: 'rounded-none', 'rounded-md': 'rounded-none',
    'rounded-lg': 'rounded-none', 'rounded-xl': 'rounded-none', 'rounded-2xl': 'rounded-none',
    'rounded-3xl': 'rounded-none', 'rounded-full': 'rounded-none',
    'shadow-sm': BRUTALIST_SHADOW, shadow: BRUTALIST_SHADOW, 'shadow-md': BRUTALIST_SHADOW,
    'shadow-lg': BRUTALIST_SHADOW, 'shadow-xl': BRUTALIST_SHADOW, 'shadow-2xl': BRUTALIST_SHADOW,
    'bg-gray-50': 'bg-white', 'bg-slate-50': 'bg-white', 'bg-gray-100': 'bg-white',
    'bg-slate-100': 'bg-white', 'bg-neutral-50': 'bg-white', 'bg-neutral-100': 'bg-white',
    'text-gray-500': 'text-black/60', 'text-slate-500': 'text-black/60',
    'text-gray-400': 'text-black/50', 'text-slate-400': 'text-black/50',
  },
  playful_pop: {
    'rounded-none': 'rounded-2xl', 'rounded-sm': 'rounded-xl',
    'border-black': 'border-purple-400',
    'shadow-sm': SOFT_COLORFUL_SHADOW, 'shadow-md': SOFT_COLORFUL_SHADOW,
    'shadow-lg': SOFT_COLORFUL_SHADOW, 'shadow-xl': SOFT_COLORFUL_SHADOW,
    'bg-gray-900': 'bg-purple-100', 'bg-gray-50': 'bg-yellow-50', 'bg-slate-50': 'bg-pink-50',
    'bg-neutral-900': 'bg-purple-100', 'bg-neutral-50': 'bg-yellow-50',
    'text-gray-500': 'text-purple-700/70', 'text-gray-400': 'text-purple-700/60',
  },
  elegant_serif: {
    'rounded-full': 'rounded-md', 'rounded-3xl': 'rounded-md', 'rounded-2xl': 'rounded-sm',
    'rounded-xl': 'rounded-md',
    'shadow-xl': 'shadow-sm', 'shadow-2xl': 'shadow-sm', 'shadow-lg': 'shadow-sm',
    'font-black': 'font-bold',
    'bg-blue-600': 'bg-[#1F3A4D]', 'bg-red-500': 'bg-[#7A2E2E]', 'bg-blue-500': 'bg-[#1F3A4D]',
    'bg-gray-50': 'bg-[#FAF7F2]', 'bg-slate-50': 'bg-[#FAF7F2]', 'bg-gray-100': 'bg-[#F0EBE3]',
    'bg-neutral-50': 'bg-[#FAF7F2]',
  },
  glassmorphism: {
    'rounded-none': 'rounded-2xl',
    'bg-white': 'bg-white/10',
    'bg-gray-50': 'bg-white/5', 'bg-slate-50': 'bg-white/5', 'bg-gray-100': 'bg-white/10',
    'bg-neutral-50': 'bg-white/5', 'bg-neutral-100': 'bg-white/10',
    'shadow-sm': 'shadow-[0_8px_30px_rgb(0,0,0,0.35)]', 'shadow-md': 'shadow-[0_8px_30px_rgb(0,0,0,0.35)]',
    'text-gray-900': 'text-slate-100', 'text-black': 'text-slate-100', 'text-gray-800': 'text-slate-200',
  },
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface PostProcessResult {
  code: string
  /** Number of class replacements applied. */
  replacements: number
}

/**
 * Replaces banned/generic Tailwind classes with preset-appropriate ones.
 * Handles responsive/state variants (`md:rounded-lg` → `md:rounded-none`)
 * and never touches longer classes that merely contain the target as a
 * substring (`bg-white/10` is NOT matched by `bg-white`).
 */
export function postProcessCode(code: string, tokens: DesignTokenSet): PostProcessResult {
  const map = PRESET_REPLACEMENTS[tokens.id] ?? {}
  let out = code
  let replacements = 0

  for (const [from, to] of Object.entries(map)) {
    // Optional variant prefix (md:, lg:, hover:, focus-visible:, …) preserved
    // on replace. Lookarounds prevent matching inside longer class tokens or
    // template strings.
    const re = new RegExp(
      `(?<![\\w:/\\-])((?:[a-zA-Z][a-zA-Z0-9-]*:)?)${escapeRegExp(from)}(?![\\w/\\-])`,
      'g'
    )
    out = out.replace(re, (_m, prefix: string) => {
      replacements++
      return `${prefix}${to}`
    })
  }

  // Belt-and-braces: never let a stray markdown fence survive into the preview.
  out = out.replace(/```\w*\s*\n?/g, '')

  // Collapse 3+ consecutive blank lines left by replacements.
  out = out.replace(/\n{3,}/g, '\n\n')

  if (replacements > 0) {
    console.log(`[PostProcess] ${tokens.id}: applied ${replacements} class replacements`)
  }

  return { code: out, replacements }
}
