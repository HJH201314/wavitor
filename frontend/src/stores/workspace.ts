import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { storageManager } from '../utils/storage'

// Workspace data for a single audio file
export interface WorkspaceData {
  fileId: string // Unique identifier (filename + size + lastModified)
  fileName: string
  beats: number[] // Unified beats array (no distinction between manual and detected)
  bpmDetected: boolean // Flag to indicate if BPM has been detected for this file
  history: HistoryEntry[]
  historyIndex: number
  createdAt: number
  lastModified: number
}

// History entry for undo/redo
export interface HistoryEntry {
  beats: number[]
  timestamp: number
  action: string // Description of the action
}

export const useWorkspaceStore = defineStore('workspace', () => {
  // All workspaces keyed by fileId
  const workspaces = ref<Map<string, WorkspaceData>>(new Map())
  
  // Current active workspace fileId
  const currentFileId = ref<string | null>(null)

  // Flag to track if storage is initialized
  const storageInitialized = ref(false)
  
  // Last opened workspace fileId (for auto-restore on page refresh)
  const lastOpenedFileId = ref<string | null>(null)

  // Initialize storage and load all workspaces
  async function initStorage() {
    if (storageInitialized.value) return
    
    try {
      await storageManager.init()
      const savedWorkspaces = await storageManager.loadAllWorkspaces()
      
      // Load all saved workspaces into memory
      for (const workspace of savedWorkspaces) {
        workspaces.value.set(workspace.fileId, workspace)
      }
      
      // Load last opened file ID from localStorage
      const saved = localStorage.getItem('wavitor_last_opened_file_id')
      if (saved) {
        lastOpenedFileId.value = saved
      }
      
      storageInitialized.value = true
      console.log(`Initialized storage with ${savedWorkspaces.length} workspaces`)
    } catch (error) {
      console.error('Failed to initialize storage:', error)
    }
  }

  // Auto-initialize on store creation
  initStorage()

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
  async function loadWorkspace(file: File): Promise<WorkspaceData> {
    const fileId = generateFileId(file)
    
    let workspace = workspaces.value.get(fileId)
    
    if (!workspace) {
      // Try to load from storage first
      try {
        workspace = await storageManager.loadWorkspace(fileId)
      } catch (error) {
        console.error('Failed to load workspace from storage:', error)
      }
      
      if (!workspace) {
        // Create new workspace
        workspace = {
          fileId,
          fileName: file.name,
          beats: [],
          bpmDetected: false,
          history: [],
          historyIndex: -1,
          createdAt: Date.now(),
          lastModified: Date.now()
        }
        
        // Save initial state to history
        addToHistory(workspace, '初始状态')
      }
      
      workspaces.value.set(fileId, workspace)
      
      // Save to storage
      try {
        await storageManager.saveWorkspace(workspace)
      } catch (error) {
        console.error('Failed to save workspace to storage:', error)
      }
    }
    
    currentFileId.value = fileId
    lastOpenedFileId.value = fileId
    
    // Save last opened file ID to localStorage
    localStorage.setItem('wavitor_last_opened_file_id', fileId)
    
    return workspace
  }

  // Add entry to history
  function addToHistory(workspace: WorkspaceData, action: string) {
    // Remove any history after current index (when making new change after undo)
    if (workspace.historyIndex < workspace.history.length - 1) {
      workspace.history = workspace.history.slice(0, workspace.historyIndex + 1)
    }
    
    const entry: HistoryEntry = {
      beats: [...workspace.beats],
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
  async function saveState(action: string) {
    const workspace = currentWorkspace.value
    if (!workspace) return
    
    addToHistory(workspace, action)
    
    // Persist to storage
    try {
      await storageManager.saveWorkspace(workspace)
    } catch (error) {
      console.error('Failed to save workspace to storage:', error)
    }
  }

  // Undo
  async function undo(): Promise<boolean> {
    const workspace = currentWorkspace.value
    if (!workspace || workspace.historyIndex <= 0) return false
    
    workspace.historyIndex--
    const entry = workspace.history[workspace.historyIndex]
    
    workspace.beats = [...entry.beats]
    workspace.lastModified = Date.now()
    
    // Persist to storage
    try {
      await storageManager.saveWorkspace(workspace)
    } catch (error) {
      console.error('Failed to save workspace to storage:', error)
    }
    
    return true
  }

  // Redo
  async function redo(): Promise<boolean> {
    const workspace = currentWorkspace.value
    if (!workspace || workspace.historyIndex >= workspace.history.length - 1) return false
    
    workspace.historyIndex++
    const entry = workspace.history[workspace.historyIndex]
    
    workspace.beats = [...entry.beats]
    workspace.lastModified = Date.now()
    
    // Persist to storage
    try {
      await storageManager.saveWorkspace(workspace)
    } catch (error) {
      console.error('Failed to save workspace to storage:', error)
    }
    
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
  async function updateBeats(beats: number[], action: string) {
    const workspace = currentWorkspace.value
    if (!workspace) return
    
    workspace.beats = [...beats]
    
    addToHistory(workspace, action)
    
    // Persist to storage
    try {
      await storageManager.saveWorkspace(workspace)
    } catch (error) {
      console.error('Failed to save workspace to storage:', error)
    }
  }
  
  // Mark BPM as detected for current workspace
  async function markBPMDetected() {
    const workspace = currentWorkspace.value
    if (!workspace) return
    
    workspace.bpmDetected = true
    
    // Persist to storage
    try {
      await storageManager.saveWorkspace(workspace)
    } catch (error) {
      console.error('Failed to save workspace to storage:', error)
    }
  }

  // Import beats from JSON
  async function importBeats(beatsData: number[] | string): Promise<{ success: boolean; message: string; beats?: number[] }> {
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
      
      // Detect if values are in milliseconds or seconds
      // If max value > 100, assume milliseconds (because songs are usually longer than 100 seconds)
      // This better handles beats in the first second (0-1000ms)
      const maxValue = Math.max(...beats)
      const isMilliseconds = maxValue > 100
      
      const convertedBeats = beats.map(t => {
        if (typeof t !== 'number') {
          throw new Error('无效的节拍值')
        }
        return isMilliseconds ? t / 1000 : t
      }).sort((a, b) => a - b)
      
      const workspace = currentWorkspace.value
      if (!workspace) {
        return { success: false, message: '没有活动的工作区' }
      }
      
      // Replace beats with imported beats
      workspace.beats = convertedBeats
      workspace.bpmDetected = true // Mark as detected since beats are provided
      addToHistory(workspace, `导入 ${convertedBeats.length} 个节拍`)
      
      // Persist to storage
      await storageManager.saveWorkspace(workspace)
      
      return { success: true, message: `成功导入 ${convertedBeats.length} 个节拍`, beats: convertedBeats }
    } catch (error) {
      return { success: false, message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  // Delete workspace
  async function deleteWorkspace(fileId: string): Promise<boolean> {
    const isCurrentWorkspace = currentFileId.value === fileId
    
    // Delete from memory
    workspaces.value.delete(fileId)
    
    // Clear current file ID if deleting current workspace
    if (isCurrentWorkspace) {
      currentFileId.value = null
      lastOpenedFileId.value = null
      localStorage.removeItem('wavitor_last_opened_file_id')
    }
    
    // Delete from storage
    try {
      await storageManager.deleteWorkspace(fileId)
      await storageManager.deleteAudioFile(fileId)
      console.log(`Deleted workspace and audio file: ${fileId}`)
      return true
    } catch (error) {
      console.error('Failed to delete workspace from storage:', error)
      return false
    }
  }

  // Clear all workspaces
  async function clearAllWorkspaces() {
    workspaces.value.clear()
    currentFileId.value = null
    lastOpenedFileId.value = null
    localStorage.removeItem('wavitor_last_opened_file_id')
    
    // Clear storage
    try {
      await storageManager.clearAll()
    } catch (error) {
      console.error('Failed to clear storage:', error)
    }
  }

  // Get all workspace summaries
  const workspaceSummaries = computed(() => {
    return Array.from(workspaces.value.values()).map(ws => ({
      fileId: ws.fileId,
      fileName: ws.fileName,
      beatCount: ws.beats.length,
      lastModified: ws.lastModified,
      isCurrent: ws.fileId === currentFileId.value
    })).sort((a, b) => b.lastModified - a.lastModified)
  })

  return {
    workspaces,
    currentFileId,
    currentWorkspace,
    storageInitialized,
    lastOpenedFileId,
    generateFileId,
    hasWorkspace,
    loadWorkspace,
    initStorage,
    saveState,
    undo,
    redo,
    canUndo,
    canRedo,
    currentAction,
    updateBeats,
    markBPMDetected,
    importBeats,
    deleteWorkspace,
    clearAllWorkspaces,
    workspaceSummaries
  }
})
