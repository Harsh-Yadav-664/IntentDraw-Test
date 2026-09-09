import { NextResponse } from 'next/server'
import { generateCode } from '@/lib/ai/provider'
import { checkRateLimit, incrementUsage, getUsageStats } from '@/lib/middleware/rate-limit'
import { createClient } from '@/lib/supabase/server'
import type { Region } from '@/types'

export async function POST(request: Request) {
  try {
    // --- Auth: get real user ID ---
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      )
    }

    const userId = user.id

    // --- Rate limiting: check first, increment only after a successful
    // generation so failed attempts don't burn the user's daily quota ---
    const rateLimit = await checkRateLimit(userId)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Daily limit reached (${rateLimit.limit} generations). Resets at ${new Date(rateLimit.resetAt).toLocaleTimeString()}.`,
          remaining: 0,
          resetAt: rateLimit.resetAt,
        },
        { status: 429 }
      )
    }

    // --- Parse body ---
    const body = await request.json()
    const { regions, prompt, globalTheme, provider, nvidiaModelId, imageData } = body as {
      regions?: Region[]
      prompt?: string
      globalTheme?: string
      provider?: 'gemini' | 'groq' | 'nvidia'
      nvidiaModelId?: string
      imageData?: string
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required' },
        { status: 400 }
      )
    }

    if (prompt.length > 10000) {
      return NextResponse.json(
        { success: false, error: 'Prompt too long. Max 10000 characters.' },
        { status: 400 }
      )
    }

    let validRegions = Array.isArray(regions) ? regions : []
    let finalPrompt = prompt.trim()

    // --- Intent classification (only when there is a drawing to classify) ---
    // Local heuristics resolve ~all regions with ZERO model calls (arrows,
    // boxes, annotated/large freeforms, prompt references). The vision model
    // is consulted only for genuinely ambiguous shapes, and per-region manual
    // overrides from the Controls panel are respected as-is.
    if (validRegions.length > 0) {
      console.log(`[Generate] Running region intent classification for user=${userId} (${validRegions.length} regions)`)

      const { classifyRegionIntents } = await import('@/lib/ai/intent-classifier')
      const { tags, backgroundScopes } = await classifyRegionIntents(validRegions, finalPrompt, imageData)

      validRegions = validRegions.map(r => {
        const tag = r.tagOverride ?? (tags[r.id] || 'exact-placement')
        const scope = tag === 'decorative'
          ? (r.backgroundScopeOverride ?? backgroundScopes[r.id] ?? 'region')
          : undefined
        return { ...r, classificationTag: tag, backgroundScope: scope }
      })

      const tagsCounts = validRegions.reduce((acc, r) => {
        acc[r.classificationTag!] = (acc[r.classificationTag!] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      console.log(`[Generate] Region tags:`, tagsCounts)

      // If ALL regions are decorative, the drawing is a pure style reference
      if (validRegions.every(r => r.classificationTag === 'decorative')) {
        console.log(`[Generate] Entire drawing classified as style reference.`)
        finalPrompt += `\n\n(Note: The user provided a drawing as a style/pattern/background reference. Do not treat the strokes as literal layout boundaries — use them as aesthetic inspiration, respecting each element's described scope.)`
      }
    }

    console.log(`[Generate] user=${userId} | ${validRegions.length} regions | prompt: "${finalPrompt.substring(0, 100)}..."`)

    // --- Call AI ---
    const result = await generateCode(validRegions, finalPrompt, globalTheme, provider, nvidiaModelId, imageData)

    if (!result.success || !result.code) {
      return NextResponse.json(
        { success: false, error: result.error || 'Generation failed' },
        { status: 502 }
      )
    }

    // --- Generation succeeded: consume a quota slot (never for cache hits) ---
    if (!result.cached) {
      await incrementUsage(userId)
    } else {
      console.log(`[Generate] Cache hit — quota not consumed for user=${userId}`)
    }
    const usage = await getUsageStats(userId)

    // NOTE: we intentionally do NOT run sanitizeHtml() over the generated code.
    // The output is React/TSX source, and the HTML attribute stripper corrupts
    // valid JSX event handlers (e.g. `onClick={() => ...}` → syntax error).
    // The preview always renders inside a sandboxed iframe (allow-scripts only,
    // no allow-same-origin), which is the real security boundary.
    return NextResponse.json({
      success: true,
      data: {
        code: result.code,
        provider: result.provider,
        cached: result.cached ?? false,
        // Return usage info so UI can show remaining count
        usage: {
          remaining: usage.remaining,
          used: usage.used,
          limit: usage.limit,
          resetAt: usage.resetAt,
        },
      },
    })
  } catch (error) {
    console.error('[API generate]', error)
    return NextResponse.json(
      { success: false, error: 'Generation failed. Please try again.' },
      { status: 500 }
    )
  }
}
