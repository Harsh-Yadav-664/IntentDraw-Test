// =============================================================================
// Project Editor Page
// src/app/(dashboard)/project/[id]/page.tsx
// =============================================================================
// Loads a specific project, renders the canvas editor,
// auto-saves every 3 seconds when changes are made
// =============================================================================

'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { useWorkflowStore } from '@/store/workflow-store'
import { useCanvasStore } from '@/store/canvas-store'
import { SaveStatus } from '@/components/shared/save-status'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

// Import your existing dashboard canvas layout
// This is the same 3-panel layout from the old dashboard/page.tsx
// We just wrap it here and wire up the project loading/saving
import { CanvasEditor } from '@/components/shared/canvas-editor'

type PageProps = { params: Promise<{ id: string }> }

export default function ProjectPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()

  const loadProject = useWorkflowStore((s) => s.loadProject)
  const triggerAutoSave = useWorkflowStore((s) => s.triggerAutoSave)
  const projectName = useWorkflowStore((s) => s.projectName)
  const setRegions = useCanvasStore((s) => s.setRegions)
  const viewMode = useCanvasStore((s) => s.viewMode)
  
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // ─── Load project on mount ────────────────────────────────────────────────

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await fetch(`/api/projects/${id}`)
        const json = await res.json()

        if (!json.success || !json.data?.project) {
          setNotFound(true)
          setLoading(false)
          return
        }

        const project = json.data.project

        // Restore canvas state from saved canvas_data
        if (project.canvas_data && Array.isArray(project.canvas_data)) {
          setRegions(project.canvas_data)
        }

        // Restore workflow state
        loadProject(project)
        setLoading(false)
      } catch (error) {
        console.error('Failed to load project', error)
        toast.error('Failed to load project')
        setNotFound(true)
        setLoading(false)
      }
    }

    fetchProject()
  }, [id, loadProject, setRegions])

  // ─── Auto-save when canvas or workflow changes ────────────────────────────

  // getCanvasData: called by auto-save to capture current canvas state
  const getCanvasData = useCallback(() => {
    return useCanvasStore.getState().regions
  }, [])

  // Trigger auto-save without causing re-renders using store subscriptions
  useEffect(() => {
    if (loading) return // Don't save while loading
    
    let lastPrompt = useWorkflowStore.getState().prompt
    let lastCode = useWorkflowStore.getState().previewCode
    let lastTheme = useWorkflowStore.getState().globalTheme
    let lastRegions = useCanvasStore.getState().regions

    const unsubWorkflow = useWorkflowStore.subscribe((state) => {
      if (state.prompt !== lastPrompt || state.previewCode !== lastCode || state.globalTheme !== lastTheme) {
        lastPrompt = state.prompt
        lastCode = state.previewCode
        lastTheme = state.globalTheme
        triggerAutoSave(getCanvasData)
      }
    })

    const unsubCanvas = useCanvasStore.subscribe((state) => {
      if (state.regions !== lastRegions) {
        lastRegions = state.regions
        triggerAutoSave(getCanvasData)
      }
    })

    return () => {
      unsubWorkflow()
      unsubCanvas()
    }
  }, [loading, triggerAutoSave, getCanvasData]) 

  // ─── Not found ────────────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-xl font-medium">Project not found</h1>
        <p className="text-sm text-muted-foreground">
          This project doesn&apos;t exist or you don&apos;t have access.
        </p>
        <Button onClick={() => router.push('/dashboard')}>
          Back to dashboard
        </Button>
      </div>
    )
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-sm text-muted-foreground">Loading project...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Top bar */}
      <div className="glass-panel flex items-center justify-between px-6 py-3 border-b border-white/5 flex-shrink-0 relative z-20">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full hover:bg-white/10 transition-colors"
            onClick={() => router.push('/dashboard')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-6 w-px bg-white/10" />
            <span className="text-sm font-display font-medium truncate max-w-[200px] text-foreground/90">
              {projectName}
            </span>
          </div>
        </div>

        {/* View Mode Toggles */}
        <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center">
          <div className="glass-panel rounded-full p-1 flex items-center border-white/10 shadow-lg bg-black/40 backdrop-blur-md">
            <button
              onClick={() => useCanvasStore.getState().setViewMode('canvas')}
              className={`px-5 py-1.5 text-sm font-medium rounded-full transition-all duration-300 ${viewMode === 'canvas' ? 'bg-primary text-primary-foreground shadow-[0_0_15px_rgba(200,150,50,0.4)]' : 'hover:bg-white/10 text-muted-foreground'}`}
            >
              Design
            </button>
            <button
              onClick={() => useCanvasStore.getState().setViewMode('split')}
              className={`px-5 py-1.5 text-sm font-medium rounded-full transition-all duration-300 ${viewMode === 'split' ? 'bg-primary text-primary-foreground shadow-[0_0_15px_rgba(200,150,50,0.4)]' : 'hover:bg-white/10 text-muted-foreground'}`}
            >
              Split
            </button>
            <button
              onClick={() => useCanvasStore.getState().setViewMode('preview')}
              className={`px-5 py-1.5 text-sm font-medium rounded-full transition-all duration-300 ${viewMode === 'preview' ? 'bg-primary text-primary-foreground shadow-[0_0_15px_rgba(200,150,50,0.4)]' : 'hover:bg-white/10 text-muted-foreground'}`}
            >
              Output
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SaveStatus />
          {/* Add a subtle decorative element */}
          <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
             <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
        </div>
      </div>

      {/* Canvas editor — your existing 3-panel layout */}
      <div className="flex-1 overflow-hidden">
        <CanvasEditor projectId={id} />
      </div>
    </div>
  )
}