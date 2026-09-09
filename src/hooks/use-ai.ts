import { useState, useCallback } from 'react'
import { useCanvasStore } from '@/store/canvas-store'
import { useWorkflowStore } from '@/store/workflow-store'

/**
 * Hook for AI operations: generate code and regenerate regions.
 * Handles loading states, errors, and store updates.
 *
 * Note: shape geometry comes directly from the Konva canvas store
 * (exact, since the user drew it) — no separate vision "analyze" step.
 * The drawing image is sent along with generation so the AI can read
 * the visual character of decorative strokes.
 */
export function useAI() {
  const [isGenerating, setIsGenerating] = useState(false)

  const regions = useCanvasStore((s) => s.regions)
  const exportDrawingImage = useCanvasStore((s) => s.exportDrawingImage)

  const prompt = useWorkflowStore((s) => s.prompt)
  const globalTheme = useWorkflowStore((s) => s.globalTheme)
  const setStatus = useWorkflowStore((s) => s.setStatus)
  const setError = useWorkflowStore((s) => s.setError)
  const setPreviewCode = useWorkflowStore((s) => s.setPreviewCode)
  const aiProvider = useWorkflowStore((s) => s.aiProvider)
  const nvidiaModelId = useWorkflowStore((s) => s.nvidiaModelId)

  /**
   * Generates React TSX from regions and user prompt.
   */
  const generateCode = useCallback(async (): Promise<boolean> => {
    if (!prompt.trim()) {
      setError('Please enter a prompt describing your design.')
      return false
    }

    setIsGenerating(true)
    setStatus('generating')

    try {
      // Only capture/send the canvas image when something was drawn.
      // exportDrawingImage returns a compressed JPEG (≤1024px) so vision
      // calls stay inside free-tier token budgets.
      const imageData = regions.length > 0 ? exportDrawingImage() : null
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regions,
          imageData, // Drawing image — visual reference for decorative strokes
          prompt: prompt.trim(),
          globalTheme: globalTheme.trim() || undefined,
          provider: aiProvider,
          nvidiaModelId,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        setError(result.error || 'Generation failed. Please try again.')
        return false
      }

      setPreviewCode(result.data.code)
      setStatus('preview_ready')
      return true
    } catch (error) {
      console.error('[useAI] Generation error:', error)
      setError('Network error. Please check your connection and try again.')
      return false
    } finally {
      setIsGenerating(false)
    }
  }, [regions, prompt, globalTheme, aiProvider, nvidiaModelId, exportDrawingImage, setStatus, setError, setPreviewCode])

  /**
   * Regenerates a single region while keeping others intact.
   */
  const regenerateRegion = useCallback(async (
    regionNumber: number,
    regionPrompt: string,
    existingCode: string
  ): Promise<boolean> => {
    if (!regionPrompt.trim()) {
      setError('Please enter a prompt for this region.')
      return false
    }

    setIsGenerating(true)
    setStatus('generating')

    try {
      const response = await fetch('/api/regenerate-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regionNumber,
          prompt: regionPrompt.trim(),
          existingCode,
          regions,
          provider: aiProvider,
          nvidiaModelId,
        }),
      })

      const result = await response.json()

      if (!result.success) {
        setError(result.error || 'Regeneration failed. Please try again.')
        return false
      }

      setPreviewCode(result.data.code)
      return true
    } catch (error) {
      console.error('[useAI] Regeneration error:', error)
      setError('Network error. Please check your connection and try again.')
      return false
    } finally {
      setIsGenerating(false)
    }
  }, [regions, aiProvider, nvidiaModelId, setStatus, setError, setPreviewCode])

  return {
    isGenerating,
    generateCode,
    regenerateRegion,
  }
}
