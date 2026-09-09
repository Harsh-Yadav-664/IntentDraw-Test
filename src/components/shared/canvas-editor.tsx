// =============================================================================
// Canvas Editor Wrapper
// src/components/shared/canvas-editor.tsx
// =============================================================================
// 3-panel dashboard layout shared by /dashboard and /project/[id].
// View modes: canvas (draw), split (canvas + live preview side by side,
// resizable divider), preview (output only).
// =============================================================================

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { ChevronRight, Menu, MousePointer2, MessageSquareText, Terminal, Sparkles, X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import Toolbar from '@/components/canvas/toolbar'
import ControlsPanel from '@/components/controls/controls-panel'
import PreviewPanel from '@/components/preview/preview-panel'
import useKeyboardShortcuts from '@/hooks/use-keyboard-shortcuts'
import { useCanvasStore } from '@/store/canvas-store'

// Dynamic import — Konva needs browser APIs
const DrawingCanvas = dynamic(
  () => import('@/components/canvas/drawing-canvas'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full rounded-2xl border border-white/10 bg-black/20 flex items-center justify-center backdrop-blur-sm">
        <Skeleton className="w-16 h-16 rounded-full bg-white/5" />
      </div>
    ),
  }
)

const ONBOARDING_KEY = 'intentdraw-onboarding-dismissed'

const ONBOARDING_STEPS = [
  { icon: MousePointer2, label: 'Draw', hint: 'Boxes, circles, freeform or arrows — your layout skeleton' },
  { icon: MessageSquareText, label: 'Annotate', hint: 'Select a region and tell us what it is (or use the chips)' },
  { icon: Terminal, label: 'Prompt', hint: 'Describe the site; reference "Region 3" to assign content' },
  { icon: Sparkles, label: 'Generate', hint: 'One free-tier call turns the drawing into a real site' },
]

/** Dismissible 4-step onboarding strip over the canvas (issue #17). */
function OnboardingStrip() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Deliberately deferred to an effect (not lazy state init): reading
    // localStorage during render would mismatch the SSR'd markup.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!window.localStorage.getItem(ONBOARDING_KEY)) setVisible(true)
    } catch {
      /* localStorage unavailable — skip onboarding rather than block the canvas */
    }
  }, [])

  const dismiss = () => {
    setVisible(false)
    try {
      window.localStorage.setItem(ONBOARDING_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  if (!visible) return null

  return (
    <div className="relative z-30 mx-auto mb-3 flex w-full max-w-4xl items-center gap-2 rounded-xl border border-primary/25 bg-[#121214]/90 px-3 py-2 shadow-[0_0_25px_rgba(200,150,50,0.15)] backdrop-blur-md">
      {ONBOARDING_STEPS.map((step, i) => (
        <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
            <step.icon className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold leading-tight text-foreground/90">
              <span className="text-primary/70">{i + 1}. </span>{step.label}
            </p>
            <p className="truncate text-[10px] leading-tight text-muted-foreground">{step.hint}</p>
          </div>
          {i < ONBOARDING_STEPS.length - 1 && (
            <ChevronRight className="hidden h-3 w-3 flex-shrink-0 text-muted-foreground/40 md:block" />
          )}
        </div>
      ))}
      <button
        onClick={dismiss}
        className="flex-shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        title="Dismiss — show me the canvas"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface CanvasEditorProps {
  projectId: string
}

export function CanvasEditor({ projectId: _projectId }: CanvasEditorProps) {
  useKeyboardShortcuts()
  const viewMode = useCanvasStore((s) => s.viewMode)
  const [isControlsOpen, setControlsOpen] = useState(true)

  // Split view state: share of the content area given to the canvas pane.
  const [splitRatio, setSplitRatio] = useState(0.6)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<{ dragging: boolean }>({ dragging: false })

  const onDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragState.current.dragging = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) return
    const container = splitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    setSplitRatio(Math.min(0.85, Math.max(0.25, ratio)))
  }, [])

  const onDividerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current.dragging = false
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }, [])

  // Automatically collapse controls in split view to save space
  useEffect(() => {
    if (viewMode === 'split') {
      setControlsOpen(false)
    } else {
      setControlsOpen(true)
    }
  }, [viewMode])

  return (
    <div className="h-full relative overflow-hidden bg-[#0A0A0B]">
      {/* Dark dotted background pattern for the infinite canvas feel */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '24px 24px'
        }}
      />
      {/* Subtle ambient glows for premium feel */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen opacity-60" />
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[150px] pointer-events-none mix-blend-screen opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-transparent to-primary/5 pointer-events-none mix-blend-overlay" />

      <div className="h-full flex relative z-10">

        {/* Main Workspace Area */}
        <div className="flex-1 h-full flex flex-col relative min-w-0">

          {/* Content Area */}
          <div className="flex-1 flex flex-col w-full h-full p-6 md:p-8 gap-6 overflow-hidden">

            <OnboardingStrip />

            <div className="flex-1 flex w-full h-full min-h-0 items-center justify-center">

              {/* Canvas Artboard */}
              {viewMode === 'canvas' && (
                <div className="relative flex flex-col animate-in fade-in zoom-in-95 duration-300 w-full h-full max-w-5xl max-h-full">
                  {/* Window Wrapper */}
                  <div className="flex-1 flex flex-col w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#121214] ring-1 ring-white/5 relative">

                    {/* Top Canvas Ribbon (Toolbar) */}
                    <div className="h-12 bg-black/60 backdrop-blur-md border-b border-white/10 flex items-center px-4 flex-shrink-0 z-40 w-full justify-center">
                       <Toolbar />
                    </div>

                    {/* Canvas Area */}
                    <div className="flex-1 relative w-full overflow-hidden">
                       <DrawingCanvas />
                    </div>
                  </div>
                </div>
              )}

              {/* Preview Artboard */}
              {viewMode === 'preview' && (
                <div className="relative flex flex-col animate-in fade-in zoom-in-95 duration-300 w-full h-full max-w-5xl max-h-full">
                  <div className="w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-white/10 ring-1 ring-white/5 flex flex-col">
                    <PreviewPanel />
                  </div>
                </div>
              )}

              {/* Split Artboard — canvas + live preview side by side (issue #16) */}
              {viewMode === 'split' && (
                <div ref={splitContainerRef} className="relative flex w-full h-full min-h-0 gap-0 animate-in fade-in duration-300">

                  {/* Canvas pane */}
                  <div
                    className="flex flex-col min-w-0 h-full"
                    style={{ width: `${splitRatio * 100}%` }}
                  >
                    <div className="flex-1 flex flex-col w-full h-full rounded-l-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#121214] ring-1 ring-white/5 relative">
                      <div className="h-12 bg-black/60 backdrop-blur-md border-b border-white/10 flex items-center px-4 flex-shrink-0 z-40 w-full justify-center">
                        <Toolbar />
                      </div>
                      <div className="flex-1 relative w-full overflow-hidden">
                        <DrawingCanvas />
                      </div>
                    </div>
                  </div>

                  {/* Drag divider */}
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onPointerDown={onDividerPointerDown}
                    onPointerMove={onDividerPointerMove}
                    onPointerUp={onDividerPointerUp}
                    onPointerCancel={onDividerPointerUp}
                    className="relative z-20 -mx-1 flex h-full w-2 cursor-col-resize items-center justify-center"
                    title="Drag to resize"
                  >
                    <div className="h-16 w-1 rounded-full bg-white/20 transition-colors hover:bg-primary/60" />
                  </div>

                  {/* Preview pane */}
                  <div
                    className="flex flex-col min-w-0 h-full"
                    style={{ width: `${(1 - splitRatio) * 100}%` }}
                  >
                    <div className="w-full h-full rounded-r-2xl overflow-hidden shadow-2xl border border-white/10 ring-1 ring-white/5 flex flex-col">
                      <PreviewPanel />
                    </div>
                  </div>
                </div>
              )}

            </div>

          </div>

        </div>

        {/* Right Sidebar (Controls) */}
        <div
          className={`h-full border-l border-white/5 flex-shrink-0 bg-[#0A0A0B]/95 backdrop-blur-xl z-50 flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.5)] transition-all duration-300 ease-in-out relative ${
            isControlsOpen ? 'w-80 translate-x-0' : 'w-0 translate-x-full border-l-0 shadow-none'
          }`}
        >
          {/* Collapse Toggle Button */}
          <button
            onClick={() => setControlsOpen(!isControlsOpen)}
            className={`absolute top-4 -left-12 h-10 w-10 flex items-center justify-center rounded-l-xl bg-[#0A0A0B]/95 border border-r-0 border-white/10 text-white/70 hover:text-white transition-all backdrop-blur-xl z-50 shadow-[-5px_0_15px_rgba(0,0,0,0.5)] ${!isControlsOpen ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30 hover:text-primary-foreground' : ''}`}
            title={isControlsOpen ? "Collapse controls" : "Expand controls"}
          >
            {isControlsOpen ? <ChevronRight className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="w-80 h-full p-4 overflow-hidden flex flex-col">
            <ControlsPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
