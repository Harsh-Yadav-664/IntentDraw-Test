# IntentDraw — Full Audit Report
Date: 2026-09-09
Branch: arena/01a086d9-intentdraw-test
Auditor: Arena Agent (read-only)

---

## 1. Executive Summary

**What IntentDraw is:** A spatial-intent website builder. You draw boxes/circles/freeform/ arrows on a Konva canvas, optionally annotate each region with intent ("hero", "pricing"), write a global prompt, and an LLM turns it into a single-file React+Tailwind TSX site rendered in a sandboxed iframe.

**Current state: ~70% of scaffolding built, ~30% of core value working.**

- ✅ Auth, projects, canvas drawing, persistence, preview iframe, rate limiting, provider fallback chain — all exist.
- ⚠️ Intent layer exists but misfires often (classifies everything as decorative).
- ❌ Output quality is poor — generic AI look, broken layouts when using freeform, inconsistent styling.
- ❌ Cost model is backwards — you pay MORE when user draws MORE (chunked path + 2 extra classifier calls), exactly opposite of your goal.
- ❌ GUI is dark, premium-styled shell, but UX flow is confusing (no true split view, small intent boxes).

**Why output is "shit" now:** 3 root causes:
1. Intent classifier over-tags freeform as `decorative` when `intent=""` → layout skeleton becomes empty → model goes freeform.
2. Layout skeleton generator forces generic `flex flex-col gap-8` + `flex-basis %` — looks AI-template.
3. No component inspiration / few-shot / content strategy — model has to invent everything from zero with only banned-classes as guidance.

You are right: fixing GUI now is waste. Fix generation pipeline first.

---

## 2. What The Repo Actually Does — File by File

### 2.1 Stack
- Next.js 16, React 19, Tailwind 4, shadcn, Zustand, Konva/react-konva, Supabase (auth+db), Gemini/Groq/NVIDIA, Babel Standalone + React UMD in iframe.

### 2.2 Data Model (`src/types/index.ts`)
- `Region`: id, regionNumber, geometry {x,y,w,h,type, path?}, intent (free text), classificationTag (exact/approx/decorative/relational), backgroundScope (region|full), lockState, generatedCode
- `Project`: id, userId, name, regions (via canvas_data JSONB), prompt, generatedCode, theme
- Good separation, but `lockState` is never used in generation (dead code).

### 2.3 Canvas (`drawing-canvas.tsx` + `canvas-store.ts`)
- 4 tools: rectangle, circle, freeform, arrow. Normalized geometry (bbox top-left). History (50 depth), selection, transformer, visibility toggle (Photoshop-like dimming), multi-select box.
- Exports PNG via `toDataURL({pixelRatio:2})` with dark bg rect hack. This PNG is sent as vision reference.
- **Issues:**
  - pixelRatio 2 + full canvas size = 2-4 MB base64. That blows Groq's 8k TPM and Gemini's free quota. No resize/compression.
  - Freeform path simplification only drops points <3px, but still large path JSON sent in prompt.
  - Snapshot logic: live iframe posts height + screenshot via html2canvas, parent shows frozen img to avoid live recompile behind drawing. Clever, but html2canvas CDN may fail, lucide icons via proxy likely broken.

### 2.4 Intent Classifier (`intent-classifier.ts`)
- One Gemini vision call per generation (when regions>0). Sends canvas size, simplified regions, user prompt, + PNG.
- Returns `tags` + `backgroundScopes`. Writes debug to `.system_generated/region-intent-debug.json`.
- **Prompt rules:** arrow→relational, freeform→decorative unless prompt assigns content, rectangle/circle decorative only if prompt says bg.
- **Why it fails:** Your debug file example: 6 freeform regions, no per-region intent, prompt "make a website with a similar drawing as the regions 1 to 6 show as solid background..." — classifier tagged ALL 6 as decorative region-scope. That's technically correct per its rules, but then `describeLayout` says "NO STRUCTURAL REGIONS — design page freely". So user's layout is ignored. If user doesn't fill per-region intent boxes, freeform always becomes decorative.
- **Cost:** 1 extra model call per generation. 45s timeout, fail-open to exact-placement.

### 2.5 Design Tokens (`design-tokens.ts`)
- 4 presets: neosleek, playful_pop, elegant_serif, glassmorphism. Each has borderRadius, colorPalette, typography, shadowTreatment, bannedClasses.
- Fast path: keyword scoring (no AI). Slow path: Gemini classification (20s timeout). Fallback: random preset.
- **Good idea**, but bannedClasses enforcement relies on LLM obedience, which is weak. Random fallback causes inconsistent UI — same prompt gives different styles.

### 2.6 Region Analyzer & Layout Skeleton (`region-analyzer.ts`)
- Groups structural regions into rows by Y overlap (threshold 50px), columns by X. Builds skeleton: `<div class="w-full flex flex-col gap-8"><div class="w-full flex flex-col md:flex-row gap-6"><RegionX/></div></div>`
- Adds special instructions for decorative/relational with % positions.
- **Problems:**
  - 50px threshold fragile — small gaps create extra rows, overlapping creates wrong grouping.
  - Skeleton is generic Tailwind flex — guarantees generic look. No asymmetry, no grid, no editorial layouts.
  - `findStructuralOverlap` uses 20% overlap to assign local background, but floating detection uses 40% — inconsistent.
  - When all decorative, skeleton says "design freely" — you lose spatial intent entirely.

### 2.7 Prompt Builder (`prompts.ts`)
- `GENERATION_SYSTEM_PROMPT`: Tells AI to be premium/bold/unique, use only react + lucide-react, use skeleton exactly, respect backgroundScope.
- `buildGenerationUserPrompt`: concatenates token section + regions JSON (% positions) + layout skeleton + visual reference note + theme + user prompt wrapped in [USER_PROMPT_START].
- **Issues:**
  - Very long prompt: regions JSON + skeleton + tokens + user prompt = 2-3k tokens before image. Groq max_tokens 5000 leaves little room.
  - System prompt says "NEVER default to generic AI aesthetics" but doesn't give examples — models default anyway.
  - No few-shot components, no content guidelines, no typography scale rules.

### 2.8 Provider Chain (`provider.ts`, `gemini.ts`, `groq.ts`, `nvidia.ts`)
- `generateCode()`: resolves tokens, checks hasDrawingImage, builds fallback list (selected provider first), tries monolithic if regions <=12 else chunked.
- Monolithic: 1 call, attaches image if Gemini.
- Chunked (>12): Phase1 shell (with image), Phase2 serial chunks of 3 regions each (no image), Phase3 assembly merging imports.
- **Timeouts:** Gemini 120s + 45s backstop + 2 retries on 429 with parsed retryDelay. Groq 45s, Nvidia 75s.
- **Groq:** uses `openai/gpt-oss-120b`, max_tokens 5000 (was 8000, reduced because free-tier counts max_tokens against TPM upfront). 5k TSX is ~18KB, enough for single page but tight.
- **Nvidia:** defaults to `nvidia/nemotron-3.5-lightning-30b-a3b`, note says llama-3.1-70b EOL 2026-08-26, currently slow/unreliable.
- **Humanized errors** for UI.
- **Cost problem you flagged:** Yes, 5+ regions currently cost more because chunked path does N/3 calls serially + intent + tokens = 2 + 1 + ceil(N/3) calls. Your idea of "send screenshot so AI understands" is already implemented, but image is huge and still each region's geometry is sent as JSON. We can fix by making intent heuristic local, not AI.

### 2.9 Preview (`preview-frame.tsx`, `preview-panel.tsx`, `sanitize.ts`)
- `wrapReactForPreview`: strips markdown fences, builds HTML with Tailwind CDN, React UMD, Babel Standalone, lucide UMD, custom Babel plugin that rewrites `import { X } from 'lucide-react'` to `const { X } = window.lucide`, strips other imports, rewrites `export default` to `window.__RenderComponent`. Exposes React hooks as window globals so bare `useState` works. Adds error boundary.
- **Issues:**
  - Lucide proxy: creates `<i data-lucide="...">` and calls `lucide.createIcons()` on parent — but parent is the iframe's body? And it uses ref callback that may never trigger. Icons often broken.
  - Tailwind CDN without config — no custom colors, JIT may miss dynamic classes if not in content.
  - Babel standalone in production is heavy, slow.
  - `extractReact` regex only checks for ```tsx block, else if starts with import/export/const returns whole text — if model returns explanation before code, it will be included and break compilation.
  - html2canvas snapshot: extra CDN, CORS issues with Unsplash images.

### 2.10 Auth / Projects / Rate Limit
- Supabase auth, middleware, RLS. Projects table stores canvas_data JSONB (array of regions), prompt, generated_code.
- Auto-save: debounced 3s in workflow-store, subscribes to workflow + canvas stores.
- Rate limit: 10 generations/day per user, stored in `usage` table, RPC `increment_usage`. Fail-open on DB errors (allows request). Good.

### 2.11 GUI
- `canvas-editor.tsx`: dark dotted bg, ambient glows, 3-panel: toolbar top ribbon, canvas center, controls right collapsible. ViewMode: canvas / preview (split not implemented, just collapses controls). ControlsPanel: layers list (Photoshop style, top layer first, eye toggle, color dot), selected region intent textarea, main prompt textarea, provider select, generate button.
- **Issues:** No split view, no device toggle in canvas mode, intent textarea tiny, no guidance that "Region 1" in prompt links to shapes, no examples, no undo/redo visibility.

---

## 3. Your Beliefs vs Reality

| You believed | Reality |
|---|---|
| Stack allows prompt-only like Lovable, drawing optional | ✅ True. If regions empty, prompt goes to "NO REGIONS DRAWN — create complete website". Works. |
| Free APIs: Gemini, Nvidia, Groq | ✅ Implemented, with fallback chain. Gemini primary, Groq fallback. Nvidia mostly dead weight now. |
| Edit mode allows drawing, output mode only shows output | ⚠️ Partial. viewMode exists, but no true split. Canvas mode shows frozen preview backdrop, output mode shows live iframe. No edit/output toggle that hides canvas completely? Actually preview mode does hide canvas, but toolbar still visible? In project/[id] page, top bar has Design/Output toggle. Works, but split not implemented. |
| Adding 5+ regions increases API cost because each region sent at cost | ✅ True currently due to chunked path. But even monolithic sends each region as JSON object — not per-region API call, but token cost grows linearly. Your intuition correct. |
| Thought of sending screenshot so AI understands | ✅ Already done — PNG sent to Gemini when regions>0. But PNG is too large, and chunks don't get image. Need optimization. |
| Intent layer cheaper/possible with free? | ⚠️ Currently 1 extra Gemini call per generation. Can be made free with heuristics. |
| Website generation was ok before, now shit | Plausible. Recent changes added intent classifier + design tokens + stricter skeleton. Intent over-classifies freeform as decorative, skeleton generic, tokens random — quality dropped. |
| Intent is main layer to make it less AI-like | ✅ Vision correct, but current implementation doesn't achieve it — it's just tagging, not guiding design language. Need component inspiration + editorial rules. |
| Prebuilt libraries: use inspiration not copy | ✅ Good principle, not yet implemented. No component library currently. |
| Pipeline to minimize AI + scripts | ⚠️ Not yet. Everything is AI. Even layout grouping is heuristic, but generation is 100% LLM. Can add scripted shell + component injection. |

---

## 4. Why Output Looks AI-Generated / Generic

1. **No real design system:** Tokens are vague ("stark, bold") not concrete constraints. AI falls back to training bias: rounded-xl, gray-50, shadow-md, centered single column.
2. **Skeleton is generic:** `flex flex-col gap-8` + `flex-row gap-6` = every site looks same. No editorial asymmetry, no overlapping, no broken grid.
3. **Content is fake:** "Invent real-sounding placeholder" leads to lorem-like but still generic. No real copy strategy, no hierarchy.
4. **No visual references:** Only text prompt + geometry %. No images, no inspiration. Model can't know what "non-AI" means.
5. **Tailwind CDN + no config:** Can't enforce custom typography scale, colors, spacing.
6. **Lucide icons broken:** Proxy fails, so icons missing → looks cheap.
7. **No post-processing:** No prettier, no validation, no auto-fix of banned classes.

---

## 5. Cost Analysis — Your Concern Is Valid

Current cost per generation (regions=6):
- Intent classifier: 1 Gemini call (vision, ~2k input + image tokens)
- Design tokens: 0 if keywords match, else 1 Gemini call
- Generation: 1 Gemini call (vision, ~3k input + image + 5k output)
Total: 2-3 calls.

If regions=15:
- Intent: 1
- Tokens: 0-1
- Shell: 1 (with image)
- Chunks: ceil(15/3)=5 serial calls
Total: 7-8 calls → will hit free-tier RPM (Gemini 10 RPM, Groq 30 RPM) and TPM.

**Your idea: use flow like sending screenshot so AI understands** — correct direction. Optimize:
- Resize PNG to max 1024x768 JPEG 70% → ~150KB not 2MB.
- Make intent heuristic first (free), only call LLM if confidence < threshold.
- Merge intent + tokens into single call if needed.
- Never chunk unless >15 regions. For 5-12 regions, monolithic is cheaper and better.
- For chunks, don't send image each time — shell handles background, chunks only need geometry + prompt.

---

## 6. Intent Layer Deep Dive — Why Not Working

- **Heuristic vs LLM:** Currently LLM decides, but prompt says "freeform almost always decorative unless prompt assigns content". If user writes global prompt "artisan pottery site" without per-region intents, freeform gets decorative. That's wrong — user drew layout, wants it structural.
- **Missing user intent UI:** Per-region textarea exists but placeholder says "What is Region N? e.g. hero..." — user doesn't know they MUST fill it for freeform to be structural. Global prompt referencing "Region 1 is hero" works, but classifier prompt says "weight userIntent heavily" — if null, it ignores.
- **BackgroundScope logic flawed:** In debug JSON, 6 freeforms all tagged region-scope, not full, so they would be local backgrounds. But since no structural regions exist, they have no parent — ambiguous.
- **No relational handling:** Arrow detection works, but no visual cue generated.
- **Fix:** Default rectangle/circle → exact-placement, freeform with intent text → exact-placement, freeform without intent but large (>30% canvas) → approximate-area, small scribble (<10%) → decorative. Arrow → relational. Only call LLM when freeform medium size and no intent.

---

## 7. GUI Assessment (You Said Not Priority, But Quick)

- Dark theme premium, glass panels, glow — good direction.
- **Problems:** 
  - No onboarding: new user sees empty canvas, doesn't know to draw or prompt.
  - Layers panel shows Region 1,2,3 but no thumbnails.
  - Intent textarea is 54px min-height, easy to miss.
  - No split view (you have canvas OR preview, not both). Users want to see output while drawing.
  - No version history, no undo for prompt.
  - Device toggle only in preview, not responsive preview of canvas.
  - Generate button shows "Generating..." but no progress, no streaming.
  - Error messages generic.

---

## 8. Recommendations — Prioritized

### P0 — Fix Generation Quality (1-2 weeks)

**P0.1 Fix Intent Classifier Bias**
- Implement heuristic pre-pass in `intent-classifier.ts`:
  ```ts
  if geometry.type === 'rectangle' || 'circle' => exact-placement
  if arrow => relational
  if freeform:
    if intent non-empty => exact-placement
    else if area > 30% canvas => approximate-area
    else if area < 5% => decorative
    else => ambiguous → call LLM
  ```
- Only call LLM for ambiguous. This saves 80% of classifier calls, makes freeform structural by default.

**P0.2 Fix Layout Skeleton**
- Replace generic flex with smarter grid: if 1 region full width, if 2 regions side-by-side with similar height → 2-col grid, if 3+ with varied heights → masonry or bento grid.
- Add asymmetry: don't always use `gap-6`, vary gaps, add overlapping possibility for floating regions.
- For decorative region-scope, generate absolute positioned div inside parent, not separate.

**P0.3 Add Component Inspiration Library (Not Copy, Learn)**
- Create `src/lib/ai/component-library.ts` with 30 curated patterns as JSON (not code to copy, but description):
  - Hero: 5 variants (brutalist with huge typography, editorial with serif, glass with gradient, etc.)
  - Features: 5 variants (numbered list, bento, staggered, etc.)
  - Pricing, Testimonials, Footer, etc.
- In prompt builder, select 2-3 relevant patterns based on prompt keywords, inject as "INSPIRATION — do not copy verbatim, but learn structure".
- This bypasses open-source component overuse — you inspire, not copy.

**P0.4 Fix Image Size**
- In `canvas-store.exportToPng()`, resize canvas to max 1024 width, JPEG 0.7 quality, not PNG pixelRatio 2. Use `toDataURL('image/jpeg', 0.7)`.
- Saves ~90% tokens.

**P0.5 Improve System Prompt**
- Add few-shot example (1 good site, not generic). Show premium typography: `text-[12vw] leading-[0.9] tracking-tighter font-black`, `grid-cols-12`, `border-2 border-black`, etc.
- Add content rules: "Use real copy, not placeholder. Headlines 3-5 words, subhead 12-15 words, no lorem."
- Enforce banned classes via post-processing script, not just prompt.

### P1 — Reduce Cost & Minimize AI (1 week)

**P1.1 Merge Calls**
- Intent + design tokens in single call when needed, or make tokens purely keyword-based (remove LLM path).
- Monolithic generation for <=15 regions (not 12), chunked only for >15.

**P1.2 Scripted Shell**
- Generate shell layout via code (not AI) using region-analyzer grid → produce TSX skeleton with `<RegionX />` placeholders.
- Then AI only generates inner components. Stitch via string replace — no AI needed for shell.
- This is what chunked tries to do but shell still AI. Make shell deterministic.

**P1.3 Cache & Reuse**
- If user regenerates same prompt + same regions, return cached code (hash).
- For region regeneration, only send that region's geometry + existing code, not all regions.

**P1.4 Free API Strategy**
- Primary: Gemini 2.5 Flash (vision). Keep retry logic.
- Fallback: Groq gpt-oss-120b for text-only (no image) — when image too large or Gemini 429.
- Deprecate Nvidia — slow, EOL. Keep interface but don't default.
- Future: Add Claude/OpenAI as paid option, but keep same provider interface.

### P2 — Intent Layer Polish

**P2.1 Per-Region Intent UI**
- Make intent textarea larger, with examples dropdown: "Hero", "Features", "Pricing", "Footer", "Background".
- Show live tag: "Will be treated as: Structural" based on heuristic.
- Allow user to override tag manually (dropdown: exact/approx/decorative/relational).

**P2.2 BackgroundScope UI**
- If decorative, show toggle: "Local background (inside overlapping region) vs Full-page background".

**P2.3 Relational Arrows**
- When arrow drawn, show UI to pick source/target regions, then generate connector.

### P3 — Output Quality Non-AI Look

**P3.1 Typography System**
- Force scale: `text-7xl md:text-[10vw] font-black tracking-tighter`, not `text-4xl font-bold`.
- Require tight leading, contrasting weights.

**P3.2 Color & Spacing**
- Ban `bg-gray-50`, `bg-slate-50`, `rounded-lg`, `shadow-sm` via post-process script that replaces with preset colors.
- Add script that checks generated code for banned patterns, auto-fixes.

**P3.3 Real Content**
- Add copy generator: use cheap LLM call to generate realistic headlines based on prompt, then inject into main generation? Or use templates: if prompt contains "artisan", generate "Handcrafted pottery from Oaxaca" not "Welcome to our site".

**P3.4 Icons**
- Fix lucide proxy: use `lucide-react` UMD properly or bundle icons. Simplest: import lucide via CDN and map correctly, or pre-compile icon list.

### P4 — GUI (After Quality Fixed)

- Implement true split view: left canvas (60%), right preview (40%) resizable.
- Add onboarding: 3-step tooltip: Draw → Annotate → Prompt → Generate.
- Add examples gallery: 5 pre-made canvases.
- Add streaming: show code as it generates (if provider supports streaming).
- Add version history.

---

## 9. Concrete Next Steps — 7 Day Sprint

**Day 1-2: Fix Intent**
- Rewrite `intent-classifier.ts` heuristic pre-pass, make LLM fallback only.
- Test with 6 freeform regions + empty intent → should be structural.

**Day 3: Fix Image & Cost**
- Resize exportToPng to JPEG 1024px.
- Increase monolithic threshold to 15, make shell deterministic (code-generated).

**Day 4: Fix Prompts**
- Rewrite GENERATION_SYSTEM_PROMPT with few-shot premium example, add component inspiration injection.
- Add post-process banned class replacer.

**Day 5: Fix Preview**
- Fix lucide icons, test preview with 3 prompts (SaaS, portfolio, artisan).
- Compare output before/after — should be non-generic.

**Day 6: Test & Measure**
- Generate 10 sites with same prompt, check variety (should not all look same).
- Test 5+ regions cost — should be 1-2 calls not 7.

**Day 7: Polish**
- Update ControlsPanel intent UI, add tag override.
- Write docs.

---

## 10. Metrics to Track

- **Quality:** % of outputs that pass "non-AI" checklist (tight tracking, bold typography, no generic cards, real copy).
- **Intent accuracy:** % of regions correctly tagged vs user expectation (manual test).
- **Cost:** Avg model calls per generation (target: 1 for <=12 regions, 2 for >12).
- **Latency:** p50 generation time (target <30s).
- **User satisfaction:** prompt-only vs drawing+prompt quality.

---

## 11. Final Verdict

You have built 70% of the hard parts (auth, canvas, persistence, preview, provider chain). The remaining 30% is the secret sauce: intent heuristics + design tokens + component inspiration + prompt engineering. Current code is over-engineered on AI (too many calls) and under-engineered on design guidance (no examples).

Your instincts are right:
- ✅ Screenshot idea is correct, just needs compression.
- ✅ Minimize AI via scripts — do deterministic shell, heuristic intent.
- ✅ Don't copy open-source components, learn from them — build inspiration library.
- ✅ Free first, paid later — keep Gemini primary, Groq fallback, add Claude/OpenAI later.

If you fix P0 items, output should go from "shit" to "80% Lovable quality" with free APIs. Then GUI polish matters.

No code edited per request. Ready to implement when you say.

---

## Appendix: Files to Change First

1. `src/lib/ai/intent-classifier.ts` — add heuristic pre-pass
2. `src/store/canvas-store.ts` — resize exportToPng
3. `src/lib/ai/region-analyzer.ts` — smarter skeleton
4. `src/lib/ai/prompts.ts` — add few-shot + component library injection
5. `src/lib/ai/design-tokens.ts` — remove LLM path, pure keywords
6. `src/lib/ai/provider.ts` — raise threshold to 15, deterministic shell
7. `src/lib/utils/sanitize.ts` — fix lucide proxy, add banned-class post-process

