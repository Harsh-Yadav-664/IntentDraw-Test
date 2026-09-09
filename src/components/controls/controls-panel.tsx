'use client'

import { useState, useEffect } from 'react'

import { useCanvasStore, REGION_COLORS } from '@/store/canvas-store'
import { useWorkflowStore } from '@/store/workflow-store'
import { useAI } from '@/hooks/use-ai'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Sparkles, Wand2, AlertCircle, Eye, EyeOff, Layers, Trash2, Square, Circle, PenTool, Navigation, Tag } from 'lucide-react'
import { assessRegionIntent, getCanvasBounds, describeAssessment, type RegionIntentTag } from '@/lib/ai/intent-heuristics'
import type { Region } from '@/types'

// Helper to get shape icon
const getShapeIcon = (type: string, color: string) => {
  const props = { className: "h-4 w-4", style: { color } }
  switch (type) {
    case 'rectangle': return <Square {...props} />
    case 'circle': return <Circle {...props} />
    case 'freeform': return <PenTool {...props} />
    case 'arrow': return <Navigation {...props} />
    default: return <Square {...props} />
  }
}

// Quick intent chips — one tap annotates the selected region
const INTENT_CHIPS = ['Hero', 'Nav bar', 'Features', 'Pricing', 'Testimonials', 'CTA', 'Footer', 'Background art']

const TAG_OVERRIDE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'exact-placement', label: 'Structural — exact placement' },
  { value: 'approximate-area', label: 'Structural — loose area' },
  { value: 'decorative', label: 'Decorative' },
  { value: 'relational', label: 'Relational (connector)' },
]

/** Badge color for an effective tag. */
function tagBadgeClass(tag: RegionIntentTag): string {
  switch (tag) {
    case 'exact-placement': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    case 'approximate-area': return 'bg-sky-500/15 text-sky-300 border-sky-500/30'
    case 'relational': return 'bg-violet-500/15 text-violet-300 border-violet-500/30'
    case 'decorative': return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  }
}

/** The per-region intent editor with live classification preview + overrides. */
function RegionIntentEditor({ region, regions, prompt, disabled }: {
  region: Region
  regions: Region[]
  prompt: string
  disabled: boolean
}) {
  const updateRegionIntent = useCanvasStore((s) => s.updateRegionIntent)
  const updateRegionOverrides = useCanvasStore((s) => s.updateRegionOverrides)

  // Same heuristic the server uses — client-safe import, zero AI calls.
  const bounds = getCanvasBounds(regions)
  const assessment = assessRegionIntent(region, regions, prompt, bounds)
  const effectiveTag = region.tagOverride ?? assessment.tag
  const effectiveScope = region.backgroundScopeOverride ?? assessment.backgroundScope ?? 'region'

  const addChip = (chip: string) => {
    if (disabled) return
    const current = region.intent.trim()
    const lower = chip.charAt(0).toLowerCase() + chip.slice(1)
    updateRegionIntent(region.id, current ? `${current}, ${lower}` : lower)
  }

  return (
    <div className="flex-shrink-0 p-3 rounded-xl border border-white/10 bg-black/20 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm text-primary">
          Region {region.regionNumber} selected
        </p>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${tagBadgeClass(effectiveTag)}`}
          title={assessment.reason}
        >
          <Tag className="h-2.5 w-2.5" />
          {assessment.ambiguous && !region.tagOverride ? 'Ambiguous · AI decides' : describeAssessment({ ...assessment, tag: effectiveTag, backgroundScope: effectiveTag === 'decorative' ? effectiveScope : null })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {region.geometry.type} · {Math.round(region.geometry.width)}×
        {Math.round(region.geometry.height)}px
      </p>

      {/* Per-region intent: what this specific shape represents */}
      <Textarea
        value={region.intent}
        onChange={(e) => updateRegionIntent(region.id, e.target.value)}
        placeholder={`What is Region ${region.regionNumber}? e.g. "hero section with big headline", "pricing table", "background wave behind the hero"`}
        className="min-h-[88px] resize-none text-xs bg-black/20 border-white/10 focus:border-primary/50 focus:ring-primary/20 placeholder:text-muted-foreground/50"
        disabled={disabled}
      />

      {/* Quick-pick chips */}
      <div className="flex flex-wrap gap-1.5">
        {INTENT_CHIPS.map(chip => (
          <button
            key={chip}
            type="button"
            disabled={disabled}
            onClick={() => addChip(chip)}
            className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            + {chip}
          </button>
        ))}
      </div>

      {/* Manual classification override */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">Treated as</p>
        <Select
          value={region.tagOverride ?? 'auto'}
          onValueChange={(v) => updateRegionOverrides(region.id, {
            tagOverride: v === 'auto' ? undefined : (v as Region['tagOverride']),
          })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full bg-black/20 border-white/10 text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAG_OVERRIDE_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Background scope — only relevant for decorative regions */}
      {effectiveTag === 'decorative' && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">Background scope</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => updateRegionOverrides(region.id, { backgroundScopeOverride: 'region' })}
              className={`px-2 py-1.5 rounded-lg border text-[11px] transition-colors disabled:opacity-50 ${
                effectiveScope === 'region'
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-white/10 bg-white/5 text-muted-foreground hover:text-foreground'
              }`}
            >
              Local background
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => updateRegionOverrides(region.id, { backgroundScopeOverride: 'full' })}
              className={`px-2 py-1.5 rounded-lg border text-[11px] transition-colors disabled:opacity-50 ${
                effectiveScope === 'full'
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-white/10 bg-white/5 text-muted-foreground hover:text-foreground'
              }`}
            >
              Full-page background
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {effectiveScope === 'full'
              ? 'Rendered as the background of the entire page.'
              : 'Confined to where it was drawn / behind the region it overlaps.'}
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground/70">
        Tip: You can also reference &quot;Region {region.regionNumber}&quot; in the main prompt below.
      </p>
    </div>
  )
}

export default function ControlsPanel() {
  const regions = useCanvasStore((s) => s.regions)
  const selectedRegionIds = useCanvasStore((s) => s.selectedRegionIds)
  const selectRegions = useCanvasStore((s) => s.selectRegions)
  const toggleRegionSelection = useCanvasStore((s) => s.toggleRegionSelection)
  const visibility = useCanvasStore((s) => s.visibility)
  const toggleVisibility = useCanvasStore((s) => s.toggleVisibility)
  const deleteRegions = useCanvasStore((s) => s.deleteRegions)

  const prompt = useWorkflowStore((s) => s.prompt)
  const setPrompt = useWorkflowStore((s) => s.setPrompt)
  const errorMessage = useWorkflowStore((s) => s.error)
  const clearError = () => useWorkflowStore.getState().setError(null)
  
  const aiProvider = useWorkflowStore((s) => s.aiProvider)
  const setAiProvider = useWorkflowStore((s) => s.setAiProvider)
  const nvidiaModelId = useWorkflowStore((s) => s.nvidiaModelId)
  const setNvidiaModelId = useWorkflowStore((s) => s.setNvidiaModelId)

  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  // Fetch NVIDIA models dynamically
  useEffect(() => {
    if (aiProvider === 'nvidia' && availableModels.length === 0 && !isLoadingModels) {
      setIsLoadingModels(true)
      fetch('/api/models')
        .then(r => r.json())
        .then(data => {
          if (data.success && data.models) {
            setAvailableModels(data.models)
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingModels(false))
    }
  }, [aiProvider, availableModels.length, isLoadingModels])

  const { isGenerating, generateCode } = useAI()

  const isLoading = isGenerating
  const canGenerate = prompt.trim().length > 0 && !isLoading

  const handleGenerate = async () => {
    clearError()
    await generateCode()
  }

  return (
    <Card className="h-full flex flex-col glass-panel border-white/10 bg-card/40 backdrop-blur-md">
      <CardHeader className="pb-3 border-b border-white/5">
        <CardTitle className="text-lg flex items-center gap-2 font-display">
          <Wand2 className="h-5 w-5 text-primary" />
          Controls
        </CardTitle>
        <CardDescription>Layers & prompt</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col space-y-4 overflow-y-auto overflow-x-hidden pt-4 pb-6">
        {/* Layer Panel */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5 text-foreground/90">
              <Layers className="h-4 w-4 text-primary/70" />
              Layers
            </h4>
            <Badge variant="secondary" className="text-xs bg-primary/20 text-primary border-0">
              {regions.length}
            </Badge>
          </div>

          {regions.length === 0 ? (
            <div className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center text-muted-foreground text-sm bg-black/20">
              Draw shapes on the canvas to create layers.
              <br />
              <span className="text-xs mt-1 block opacity-70">Or just write a prompt!</span>
            </div>
          ) : (
            <div className="border border-white/10 rounded-xl overflow-hidden bg-black/20">
              <div className="max-h-40 overflow-y-auto">
                {/* Reverse to show top layer first (like Photoshop) */}
                {[...regions].reverse().map((region, reverseIndex) => {
                  const actualIndex = regions.length - 1 - reverseIndex
                  const isSelected = selectedRegionIds.includes(region.id)
                  const isVisible = visibility[region.id] !== false
                  const color = REGION_COLORS[actualIndex % REGION_COLORS.length]

                  return (
                    <div
                      key={region.id}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-white/5 last:border-b-0 ${
                        isSelected
                          ? 'bg-primary/15'
                          : 'hover:bg-white/5'
                      } ${!isVisible ? 'opacity-50' : ''}`}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          toggleRegionSelection(region.id)
                        } else {
                          selectRegions([region.id])
                        }
                      }}
                    >
                      {/* Shape icon */}
                      <div className="flex-shrink-0 flex items-center justify-center opacity-80 shadow-[0_0_8px_currentColor] rounded-full p-1 bg-black/20" style={{ color: color }}>
                        {getShapeIcon(region.geometry.type, color)}
                      </div>

                      {/* Layer name */}
                      <span className={`flex-1 text-sm truncate ${isSelected ? 'font-medium text-primary' : 'text-foreground/80'}`}>
                        Region {region.regionNumber}
                      </span>

                      {/* Visibility toggle */}
                      <button
                        className="p-1 hover:bg-white/10 rounded transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleVisibility(region.id)
                        }}
                      >
                        {isVisible ? (
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                        )}
                      </button>

                      {/* Delete button (only show on hover/selected) */}
                      {isSelected && (
                        <button
                          className="p-1 hover:bg-destructive/20 rounded transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteRegions([region.id])
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Selected Region Info + Intent */}
        {selectedRegionIds.length === 1 && (() => {
          const selectedRegion = regions.find(r => r.id === selectedRegionIds[0])
          if (!selectedRegion) return null
          return (
            <RegionIntentEditor
              region={selectedRegion}
              regions={regions}
              prompt={prompt}
              disabled={isLoading}
            />
          )
        })()}
        {selectedRegionIds.length > 1 && (
          <div 
            className="flex-shrink-0 p-3 rounded-xl border border-white/10 bg-black/20"
          >
            <p className="font-medium text-sm text-primary">
              {selectedRegionIds.length} regions selected
            </p>
            <p className="text-xs mt-1 text-muted-foreground">
              Multiple shapes selected
            </p>
            <Button 
              variant="outline" 
              size="sm"
              className="mt-2 w-full text-xs h-7 border-destructive/30 hover:bg-destructive/10 hover:text-destructive text-destructive/80"
              onClick={() => deleteRegions(selectedRegionIds)}
            >
              <Trash2 className="h-3 w-3 mr-1.5" />
              Delete {selectedRegionIds.length} regions
            </Button>
          </div>
        )}

        {/* Error Message */}
        {errorMessage && (
          <div className="flex-shrink-0 p-3 bg-destructive/10 border border-destructive/30 rounded-xl flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-destructive-foreground text-sm">{errorMessage}</p>
              <button
                onClick={clearError}
                className="text-destructive/80 hover:text-destructive text-xs underline mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <Separator className="bg-white/5" />

        {/* Prompt Input */}
        <div className="flex-1 flex flex-col min-h-0">
          <h4 className="text-sm font-medium mb-2 text-foreground/90">Prompt</h4>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              regions.length > 0
                ? `Describe your design...\n\nExamples:\n• "Region 1 is a hero with gradient"\n• "Create a landing page with my layout"\n• "Region 2 has feature cards"`
                : `Describe your design...\n\nExamples:\n• "Create a SaaS landing page"\n• "Build a portfolio site"\n• "Design a signup form"`
            }
            className="flex-1 min-h-[100px] resize-none text-sm bg-black/20 border-white/10 focus:border-primary/50 focus:ring-primary/20 placeholder:text-muted-foreground/50"
            disabled={isLoading}
          />
        </div>

        {/* AI Provider Selection */}
        <div className="flex-shrink-0 pt-2">
          <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as 'gemini' | 'groq' | 'nvidia')}>
            <SelectTrigger className="w-full bg-black/20 border-white/10 text-sm h-10">
              <SelectValue placeholder="Select AI Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini">Gemini Pro (Google)</SelectItem>
              <SelectItem value="groq">Groq (GPT-OSS 120B)</SelectItem>
              <SelectItem value="nvidia">NVIDIA NIM (legacy — slow)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* NVIDIA Specific Model Selection */}
        {aiProvider === 'nvidia' && (
          <div className="flex-shrink-0 pt-2">
            <Select value={nvidiaModelId} onValueChange={setNvidiaModelId}>
              <SelectTrigger className="w-full bg-black/20 border-white/10 text-xs h-9">
                <SelectValue placeholder={isLoadingModels ? "Loading models..." : "Select NIM Model"} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {availableModels.length === 0 ? (
                  <SelectItem value="nvidia/nemotron-3.5-lightning-30b-a3b">nvidia/nemotron-3.5-lightning-30b-a3b</SelectItem>
                ) : (
                  availableModels.map(model => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Generate Button */}
        <div className="flex-shrink-0 space-y-2 pt-2">
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`w-full h-12 rounded-xl transition-all duration-300 font-medium ${
              canGenerate 
                ? 'shadow-[0_0_20px_rgba(200,150,50,0.4)] hover:shadow-[0_0_35px_rgba(200,150,50,0.6)] hover-lift bg-primary text-primary-foreground' 
                : 'opacity-50'
            }`}
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-5 w-5" />
                Generate Design
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}