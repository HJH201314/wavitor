import type { WorkspaceData } from '../stores/workspace'

// IndexedDB configuration
const DB_NAME = 'wavitor_db'
const DB_VERSION = 1
const WORKSPACE_STORE = 'workspaces'
const AUDIO_FILE_STORE = 'audioFiles'

// Audio file data structure
export interface AudioFileData {
  fileId: string
  fileName: string
  fileType: string
  fileSize: number
  lastModified: number
  audioBlob: Blob
  createdAt: number
}

class StorageManager {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  // Initialize the database
  async init(): Promise<void> {
    if (this.db) return
    
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log('IndexedDB initialized successfully')
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create workspace store
        if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
          const workspaceStore = db.createObjectStore(WORKSPACE_STORE, { keyPath: 'fileId' })
          workspaceStore.createIndex('lastModified', 'lastModified', { unique: false })
          workspaceStore.createIndex('fileName', 'fileName', { unique: false })
          console.log('Created workspace store')
        }

        // Create audio file store
        if (!db.objectStoreNames.contains(AUDIO_FILE_STORE)) {
          const audioFileStore = db.createObjectStore(AUDIO_FILE_STORE, { keyPath: 'fileId' })
          audioFileStore.createIndex('fileName', 'fileName', { unique: false })
          audioFileStore.createIndex('lastModified', 'lastModified', { unique: false })
          console.log('Created audio file store')
        }
      }
    })

    return this.initPromise
  }

  // Save workspace data
  async saveWorkspace(workspace: WorkspaceData): Promise<void> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      // Convert to plain object to ensure serialization works
      // This removes any Vue reactivity proxies or non-serializable objects
      const plainWorkspace = JSON.parse(JSON.stringify(workspace))

      const transaction = this.db.transaction([WORKSPACE_STORE], 'readwrite')
      const store = transaction.objectStore(WORKSPACE_STORE)
      const request = store.put(plainWorkspace)

      request.onsuccess = () => {
        console.log(`Workspace saved: ${workspace.fileId}`)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to save workspace:', request.error)
        reject(request.error)
      }
    })
  }

  // Load workspace data
  async loadWorkspace(fileId: string): Promise<WorkspaceData | null> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([WORKSPACE_STORE], 'readonly')
      const store = transaction.objectStore(WORKSPACE_STORE)
      const request = store.get(fileId)

      request.onsuccess = () => {
        const workspace = request.result as WorkspaceData | undefined
        if (workspace) {
          console.log(`Workspace loaded: ${fileId}`)
          resolve(workspace)
        } else {
          resolve(null)
        }
      }

      request.onerror = () => {
        console.error('Failed to load workspace:', request.error)
        reject(request.error)
      }
    })
  }

  // Load all workspaces
  async loadAllWorkspaces(): Promise<WorkspaceData[]> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([WORKSPACE_STORE], 'readonly')
      const store = transaction.objectStore(WORKSPACE_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        const workspaces = request.result as WorkspaceData[]
        console.log(`Loaded ${workspaces.length} workspaces from storage`)
        resolve(workspaces)
      }

      request.onerror = () => {
        console.error('Failed to load workspaces:', request.error)
        reject(request.error)
      }
    })
  }

  // Delete workspace
  async deleteWorkspace(fileId: string): Promise<void> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([WORKSPACE_STORE], 'readwrite')
      const store = transaction.objectStore(WORKSPACE_STORE)
      const request = store.delete(fileId)

      request.onsuccess = () => {
        console.log(`Workspace deleted: ${fileId}`)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to delete workspace:', request.error)
        reject(request.error)
      }
    })
  }

  // Save audio file
  async saveAudioFile(fileId: string, file: File): Promise<void> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const audioFileData: AudioFileData = {
        fileId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        lastModified: file.lastModified,
        audioBlob: file,
        createdAt: Date.now()
      }

      const transaction = this.db.transaction([AUDIO_FILE_STORE], 'readwrite')
      const store = transaction.objectStore(AUDIO_FILE_STORE)
      const request = store.put(audioFileData)

      request.onsuccess = () => {
        console.log(`Audio file saved: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to save audio file:', request.error)
        reject(request.error)
      }
    })
  }

  // Load audio file
  async loadAudioFile(fileId: string): Promise<File | null> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([AUDIO_FILE_STORE], 'readonly')
      const store = transaction.objectStore(AUDIO_FILE_STORE)
      const request = store.get(fileId)

      request.onsuccess = () => {
        const audioFileData = request.result as AudioFileData | undefined
        if (audioFileData) {
          // Convert Blob back to File
          const file = new File(
            [audioFileData.audioBlob],
            audioFileData.fileName,
            {
              type: audioFileData.fileType,
              lastModified: audioFileData.lastModified
            }
          )
          console.log(`Audio file loaded: ${audioFileData.fileName}`)
          resolve(file)
        } else {
          resolve(null)
        }
      }

      request.onerror = () => {
        console.error('Failed to load audio file:', request.error)
        reject(request.error)
      }
    })
  }

  // Check if audio file exists
  async hasAudioFile(fileId: string): Promise<boolean> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([AUDIO_FILE_STORE], 'readonly')
      const store = transaction.objectStore(AUDIO_FILE_STORE)
      const request = store.get(fileId)

      request.onsuccess = () => {
        resolve(!!request.result)
      }

      request.onerror = () => {
        console.error('Failed to check audio file:', request.error)
        reject(request.error)
      }
    })
  }

  // Delete audio file
  async deleteAudioFile(fileId: string): Promise<void> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([AUDIO_FILE_STORE], 'readwrite')
      const store = transaction.objectStore(AUDIO_FILE_STORE)
      const request = store.delete(fileId)

      request.onsuccess = () => {
        console.log(`Audio file deleted: ${fileId}`)
        resolve()
      }

      request.onerror = () => {
        console.error('Failed to delete audio file:', request.error)
        reject(request.error)
      }
    })
  }

  // Get all audio file info (without blobs)
  async getAllAudioFileInfo(): Promise<Omit<AudioFileData, 'audioBlob'>[]> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([AUDIO_FILE_STORE], 'readonly')
      const store = transaction.objectStore(AUDIO_FILE_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        const audioFiles = request.result as AudioFileData[]
        // Remove blob data to reduce memory usage
        const info = audioFiles.map(({ audioBlob, ...rest }) => rest)
        resolve(info)
      }

      request.onerror = () => {
        console.error('Failed to load audio file info:', request.error)
        reject(request.error)
      }
    })
  }

  // Clear all data
  async clearAll(): Promise<void> {
    await this.init()
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'))
        return
      }

      const transaction = this.db.transaction([WORKSPACE_STORE, AUDIO_FILE_STORE], 'readwrite')
      
      const workspaceStore = transaction.objectStore(WORKSPACE_STORE)
      const audioFileStore = transaction.objectStore(AUDIO_FILE_STORE)
      
      const clearWorkspaces = workspaceStore.clear()
      const clearAudioFiles = audioFileStore.clear()

      let workspacesCleared = false
      let audioFilesCleared = false

      const checkComplete = () => {
        if (workspacesCleared && audioFilesCleared) {
          console.log('All storage cleared')
          resolve()
        }
      }

      clearWorkspaces.onsuccess = () => {
        workspacesCleared = true
        checkComplete()
      }

      clearAudioFiles.onsuccess = () => {
        audioFilesCleared = true
        checkComplete()
      }

      clearWorkspaces.onerror = () => {
        console.error('Failed to clear workspaces:', clearWorkspaces.error)
        reject(clearWorkspaces.error)
      }

      clearAudioFiles.onerror = () => {
        console.error('Failed to clear audio files:', clearAudioFiles.error)
        reject(clearAudioFiles.error)
      }
    })
  }

  // Get storage usage estimate
  async getStorageUsage(): Promise<{ usage: number; quota: number; percentage: number }> {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0, percentage: 0 }
    }

    try {
      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage || 0
      const quota = estimate.quota || 0
      const percentage = quota > 0 ? (usage / quota) * 100 : 0

      return { usage, quota, percentage }
    } catch (error) {
      console.error('Failed to get storage usage:', error)
      return { usage: 0, quota: 0, percentage: 0 }
    }
  }
}

// Export singleton instance
export const storageManager = new StorageManager()
