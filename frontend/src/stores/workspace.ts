import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Workspace data for a single audio file
export interface WorkspaceData {
  fileId: string // Unique identifier (filename + size + lastModified)
  fileName: string
  manualBeats: number[]
  deletedDetectedBeats: number[]
  history: HistoryEntry[]
  historyIndex: number
  createdAt: number
  lastModified: number
}

// History entry for undo/redo
export interface HistoryEntry {
  manualBeats: number[]
  deletedDetectedBeats: number[]
  timestamp: number
  action: string // Description of the action
}

export const useWorkspaceStore = defineStore('workspace', () => {
  // All workspaces keyed by fileId
  const workspaces = ref<Map<string, WorkspaceData>>(new Map())
  
  // Current active workspace fileId
  const currentFileId = ref<string | null>(null)

  // Generate unique file ID
  function generateFileId(file: File): string {
    return `${file.name}_${file.size}_${file.lastModified}`
  }

  // Get current workspace
  const currentWorkspace = computed(() => {
    if (!currentFileId.value) return null
    return workspaces.value.get(currentFileId.value) || null
  })

  // Check if workspace exists for a file
  function hasWorkspace(file: File): boolean {
    const fileId = generateFileId(file)
    return workspaces.value.has(fileId)
  }

  // Create or load workspace for a file
  function loadWorkspace(file: File): WorkspaceData {
    const fileId = generateFileId(file)
    
    let workspace = workspaces.value.get(fileId)
    
    if (!workspace) {
      // Create new workspace
      workspace = {
        fileId,
        fileName: file.name,
        manualBeats: [],
        deletedDetectedBeats: [],
        history: [],
        historyIndex: -1,
        createdAt: Date.now(),
        lastModified: Date.now()
      }
      
      // Save initial state to history
      addToHistory(workspace, 'Initial state')
      
      workspaces.value.set(fileId, workspace)
    }
    
    currentFileId.value = fileId
    return workspace
  }

  // Add entry to history
  function addToHistory(workspace: WorkspaceData, action: string) {
    // Remove any history after current index (when making new change after undo)
    if (workspace.historyIndex < workspace.history.length - 1) {
      workspace.history = workspace.history.slice(0, workspace.historyIndex + 1)
    }
    
    const entry: HistoryEntry = {
      manualBeats: [...workspace.manualBeats],
      deletedDetectedBeats: [...workspace.deletedDetectedBeats],
      timestamp: Date.now(),
      action
    }
    
    workspace.history.push(entry)
    workspace.historyIndex = workspace.history.length - 1
    workspace.lastModified = Date.now()
    
    // Limit history to 100 entries
    if (workspace.history.length > 100) {
      workspace.history.shift()
      workspace.historyIndex--
    }
  }

  // Save current state to history
  function saveState(action: string) {
    const workspace = currentWorkspace.value
    if (!workspace) return
    
    addToHistory(workspace, action)
  }

  // Undo
  function undo(): boolean {
    const workspace = currentWorkspace.value
    if (!workspace || workspace.historyIndex <= 0) return false
    
    workspace.historyIndex--
    const entry = workspace.history[workspace.historyIndex]
    
    workspace.manualBeats = [...entry.manualBeats]
    workspace.deletedDetectedBeats = [...entry.deletedDetectedBeats]
    workspace.lastModified = Date.now()
    
    return true
  }

  // Redo
  function redo(): boolean {
    const workspace = currentWorkspace.value
    if (!workspace || workspace.historyIndex >= workspace.history.length - 1) return false
    
    workspace.historyIndex++
    const entry = workspace.history[workspace.historyIndex]
    
    workspace.manualBeats = [...entry.manualBeats]
    workspace.deletedDetectedBeats = [...entry.deletedDetectedBeats]
    workspace.lastModified = Date.now()
    
    return true
  }

  // Check if can undo
  const canUndo = computed(() => {
    const workspace = currentWorkspace.value
    return workspace ? workspace.historyIndex > 0 : false
  })

  // Check if can redo
  const canRedo = computed(() => {
    const workspace = currentWorkspace.value
    return workspace ? workspace.historyIndex < workspace.history.length - 1 : false
  })

  // Get current action description
  const currentAction = computed(() => {
    const workspace = currentWorkspace.value
    if (!workspace || workspace.historyIndex < 0) return ''
    return workspace.history[workspace.historyIndex]?.action || ''
  })

  // Update beats data
  function updateBeats(manualBeats: number[], deletedDetectedBeats: number[], action: string) {
    const workspace = currentWorkspace.value
    if (!workspace) return
    
    workspace.manualBeats = [...manualBeats]
    workspace.deletedDetectedBeats = [...deletedDetectedBeats]
    
    addToHistory(workspace, action)
  }

  // Import beats from JSON
  function importBeats(beatsData: number[] | string): { success: boolean; message: string } {
    try {
      let beats: number[]
      
      if (typeof beatsData === 'string') {
        beats = JSON.parse(beatsData)
      } else {
        beats = beatsData
      }
      
      if (!Array.isArray(beats)) {
        return { success: false, message: '无效的格式：期望数组' }
      }
      
      // Convert milliseconds to seconds if needed (values > 1000 likely in ms)
      const convertedBeats = beats.map(t => {
        if (typeof t !== 'number') {
          throw new Error('无效的节拍值')
        }
        return t > 1000 ? t / 1000 : t
      }).sort((a, b) => a - b)
      
      const workspace = currentWorkspace.value
      if (!workspace) {
        return { success: false, message: '没有活动的工作区' }
      }
      
      // Replace current manual beats with imported beats
      workspace.manualBeats = convertedBeats
      addToHistory(workspace, `导入 ${convertedBeats.length} 个节拍`)
      
      return { success: true, message: `成功导入 ${convertedBeats.length} 个节拍` }
    } catch (error) {
      return { success: false, message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  // Delete workspace
  function deleteWorkspace(fileId: string) {
    workspaces.value.delete(fileId)
    if (currentFileId.value === fileId) {
      currentFileId.value = null
    }
  }

  // Clear all workspaces
  function clearAllWorkspaces() {
    workspaces.value.clear()
    currentFileId.value = null
  }

  // Get all workspace summaries
  const workspaceSummaries = computed(() => {
    return Array.from(workspaces.value.values()).map(ws => ({
      fileId: ws.fileId,
      fileName: ws.fileName,
      beatCount: ws.manualBeats.length,
      deletedCount: ws.deletedDetectedBeats.length,
      lastModified: ws.lastModified,
      isCurrent: ws.fileId === currentFileId.value
    })).sort((a, b) => b.lastModified - a.lastModified)
  })

  return {
    workspaces,
    currentFileId,
    currentWorkspace,
    generateFileId,
    hasWorkspace,
    loadWorkspace,
    saveState,
    undo,
    redo,
    canUndo,
    canRedo,
    currentAction,
    updateBeats,
    importBeats,
    deleteWorkspace,
    clearAllWorkspaces,
    workspaceSummaries
  }
})
