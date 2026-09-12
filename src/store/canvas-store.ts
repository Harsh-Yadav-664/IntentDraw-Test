import { create } from 'zustand'
import type { Region, RegionGeometry, CanvasTool } from '@/types'
import { generateUUID } from '@/lib/utils'

interface StageExporter {
  toDataURL(config?: {
    pixelRatio?: number
    mimeType?: string
    quality?: number
  }): string
  width?: () => number
  height?: () => number
}

/** Minimal shape of the Konva globals used by the export hack. */
interface KonvaLike {
  Rect: new (config: Record<string, unknown>) => {
    destroy: () => void
    moveToBottom: () => void
  }
}

interface KonvaLayerLike {
  add: (node: unknown) => void
  draw: () => void
}

let _history: Region[][] = [[]]
let _historyIndex = 0

interface CanvasStore {
  regions: Region[]
  activeTool: CanvasTool
  selectedRegionIds: string[]
  canUndo: boolean
  canRedo: boolean
  _stageInstance: StageExporter | null
  
  // Visibility tracking
  visibility: Record<string, boolean>

  // View Mode
  viewMode: 'canvas' | 'split' | 'preview'
  setViewMode: (mode: 'canvas' | 'split' | 'preview') => void

  setActiveTool: (tool: CanvasTool) => void
  selectRegions: (ids: string[]) => void
  toggleRegionSelection: (id: string) => void
  setStageInstance: (stage: StageExporter | null) => void

  addRegion: (geometry: RegionGeometry) => void
  updateRegionGeometry: (id: string, updates: Partial<RegionGeometry>) => void
  updateRegionIntent: (id: string, intent: string) => void
  updateRegionOverrides: (id: string, overrides: {
    tagOverride?: Region['tagOverride']
    backgroundScopeOverride?: Region['backgroundScopeOverride']
  }) => void
  deleteRegions: (ids: string[]) => void
  clearRegions: () => void
  setRegions: (regions: Region[]) => void
  
  // Visibility actions
  toggleVisibility: (id: string) => void
  setVisibility: (id: string, visible: boolean) => void

  undo: () => void
  redo: () => void

  /** Compressed JPEG export of the drawing (≤1024px wide) for vision calls. */
  exportDrawingImage: () => string | null
  exportAsJson: () => string
  importFromJson: (json: string) => void
}

// Region colors - Professional wireframe palette
export const REGION_COLORS = [
  '#8b949e', // Muted Gray
  '#58a6ff', // Muted Blue
  '#3fb950', // Muted Green
  '#bc8cff', // Muted Purple
  '#d29922', // Muted Yellow
  '#f85149', // Muted Red
]

export const useCanvasStore = create<CanvasStore>((set, get) => {
  const syncHistoryFlags = () => {
    set({
      canUndo: _historyIndex > 0,
      canRedo: _historyIndex < _history.length - 1,
    })
  }

  const pushHistory = () => {
    const { regions } = get()
    _history = _history.slice(0, _historyIndex + 1)
    _history.push(JSON.parse(JSON.stringify(regions)) as Region[])
    if (_history.length > 50) _history = _history.slice(-50)
    _historyIndex = _history.length - 1
    syncHistoryFlags()
  }

  const renumber = (regions: Region[]): Region[] =>
    regions.map((r, i) => ({ ...r, regionNumber: i + 1 }))

  // Normalize a geometry so x/y is ALWAYS the top-left of the bounding box
  // and width/height are the full bbox span. Freeform/arrow paths stay
  // relative to that origin. This keeps every downstream consumer
  // (layout analyzer, intent classifier, prompt builders) consistent.
  const normalizeGeometry = (geometry: RegionGeometry): RegionGeometry => {
    if ((geometry.type === 'freeform' || geometry.type === 'arrow') && geometry.path && geometry.path.length > 0) {
      const xs = geometry.path.map(p => p.x)
      const ys = geometry.path.map(p => p.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const maxX = Math.max(...xs)
      const maxY = Math.max(...ys)
      return {
        ...geometry,
        x: geometry.x + minX,
        y: geometry.y + minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        path: geometry.path.map(p => ({ x: p.x - minX, y: p.y - minY })),
      }
    }
    return geometry
  }

  return {
    regions: [],
    activeTool: 'select',
    selectedRegionIds: [],
    canUndo: false,
    canRedo: false,
    _stageInstance: null,
    viewMode: 'canvas',
    visibility: {},

    setViewMode: (mode) => set({ viewMode: mode }),
    setActiveTool: (tool) => set({ activeTool: tool, selectedRegionIds: [] }),
    selectRegions: (ids) => set({ selectedRegionIds: ids }),
    toggleRegionSelection: (id) => set((state) => ({
      selectedRegionIds: state.selectedRegionIds.includes(id)
        ? state.selectedRegionIds.filter((selectedId) => selectedId !== id)
        : [...state.selectedRegionIds, id]
    })),
    setStageInstance: (stage) => set({ _stageInstance: stage }),

    addRegion: (geometry) => {
      const { regions, visibility } = get()
      const now = new Date().toISOString()
      const newId = generateUUID()
      const newRegion: Region = {
        id: newId,
        regionNumber: regions.length + 1,
        geometry: normalizeGeometry(geometry),
        intent: '',
        lockState: { layout: false, style: false, animation: false },
        generatedCode: null,
        createdAt: now,
        updatedAt: now,
      }
      set({ 
        regions: [...regions, newRegion],
        visibility: { ...visibility, [newId]: true }
      })
      pushHistory()
    },

    updateRegionGeometry: (id, updates) => {
      set((state) => ({
        regions: state.regions.map((r) =>
          r.id === id
            ? { ...r, geometry: normalizeGeometry({ ...r.geometry, ...updates }), updatedAt: new Date().toISOString() }
            : r
        ),
      }))
      pushHistory()
    },

    updateRegionIntent: (id, intent) => {
      set((state) => ({
        regions: state.regions.map((r) =>
          r.id === id ? { ...r, intent, updatedAt: new Date().toISOString() } : r
        ),
      }))
    },

    updateRegionOverrides: (id, overrides) => {
      set((state) => ({
        regions: state.regions.map((r) =>
          r.id === id
            ? {
                ...r,
                tagOverride: 'tagOverride' in overrides ? overrides.tagOverride : r.tagOverride,
                backgroundScopeOverride: 'backgroundScopeOverride' in overrides ? overrides.backgroundScopeOverride : r.backgroundScopeOverride,
                updatedAt: new Date().toISOString(),
              }
            : r
        ),
      }))
    },

    deleteRegions: (ids) => {
      const { selectedRegionIds, visibility } = get()
      const newVisibility = { ...visibility }
      ids.forEach(id => delete newVisibility[id])
      
      set((state) => ({
        regions: renumber(state.regions.filter((r) => !ids.includes(r.id))),
        selectedRegionIds: selectedRegionIds.filter(id => !ids.includes(id)),
        visibility: newVisibility,
      }))
      pushHistory()
    },

    clearRegions: () => {
      set({ regions: [], selectedRegionIds: [], visibility: {} })
      pushHistory()
    },

    setRegions: (regions) => {
      const visibility: Record<string, boolean> = {}
      regions.forEach(r => { visibility[r.id] = true })
      set({ regions, visibility })
    },
    
    toggleVisibility: (id) => {
      set((state) => ({
        visibility: { 
          ...state.visibility, 
          [id]: state.visibility[id] === false ? true : false 
        }
      }))
    },
    
    setVisibility: (id, visible) => {
      set((state) => ({
        visibility: { ...state.visibility, [id]: visible }
      }))
    },

    undo: () => {
      if (_historyIndex <= 0) return
      _historyIndex--
      const regions = JSON.parse(JSON.stringify(_history[_historyIndex])) as Region[]
      const visibility: Record<string, boolean> = {}
      regions.forEach(r => { visibility[r.id] = true })
      set({ regions, selectedRegionIds: [], visibility })
      syncHistoryFlags()
    },

    redo: () => {
      if (_historyIndex >= _history.length - 1) return
      _historyIndex++
      const regions = JSON.parse(JSON.stringify(_history[_historyIndex])) as Region[]
      const visibility: Record<string, boolean> = {}
      regions.forEach(r => { visibility[r.id] = true })
      set({ regions, selectedRegionIds: [], visibility })
      syncHistoryFlags()
    },

    exportDrawingImage: () => {
      const stage = get()._stageInstance
      if (!stage) return null

      const width = stage.width?.() ?? 0
      const height = stage.height?.() ?? 0

      // Temporarily add a background rect so the image isn't transparent
      // (JPEG has no alpha channel).
      const stageAny = stage as unknown as { getLayers?: () => KonvaLayerLike[] }
      const layer = stageAny.getLayers?.()[0]
      let bgRect: { destroy: () => void; moveToBottom: () => void } | null = null
      const Konva = (typeof window !== 'undefined' ? (window as unknown as { Konva?: KonvaLike }).Konva : undefined)
      if (layer && Konva) {
        bgRect = new Konva.Rect({
          x: 0,
          y: 0,
          width,
          height,
          fill: '#0A0A0B',
          listening: false,
        })
        layer.add(bgRect)
        bgRect.moveToBottom()
        layer.draw()
      }

      try {
        // Compressed export (audit P0.4): the old `pixelRatio: 2` PNG was
        // 2–4 MB of base64 and blew free-tier token budgets. JPEG at 0.7
        // quality, downscaled to ≤1024px wide (≤1280px tall), lands around
        // 100–200 KB — ~90% smaller with no loss of layout information.
        const scale = Math.min(
          1,
          1024 / Math.max(1, width),
          1280 / Math.max(1, height)
        )
        return stage.toDataURL({
          mimeType: 'image/jpeg',
          quality: 0.7,
          pixelRatio: scale,
        })
      } finally {
        if (bgRect && layer) {
          bgRect.destroy()
          layer.draw()
        }
      }
    },

    exportAsJson: () => JSON.stringify(get().regions),

    importFromJson: (json) => {
      try {
        const regions = JSON.parse(json) as Region[]
        const visibility: Record<string, boolean> = {}
        regions.forEach(r => { visibility[r.id] = true })
        set({ regions, selectedRegionIds: [], visibility })
        pushHistory()
      } catch (e) {
        console.error('Failed to import canvas JSON:', e)
      }
    },
  }
})