import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { detectBPM, type BeatInfo } from '../utils/bpmDetector'
import { useWorkspaceStore } from './workspace'

export const useAudioStore = defineStore('audio', () => {
  const workspaceStore = useWorkspaceStore()
  const audioFile = ref<File | null>(null)
  const audioUrl = ref<string>('')
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(1)
  const audioContext = ref<AudioContext | null>(null)
  const audioBuffer = ref<AudioBuffer | null>(null)
  const audioElement = ref<HTMLAudioElement | null>(null)
  const analyserNode = ref<AnalyserNode | null>(null)
  const sourceNode = ref<MediaElementAudioSourceNode | null>(null)
  
  // BPM detection state
  const bpmInfo = ref<BeatInfo | null>(null)
  const isDetectingBPM = ref(false)
  const showBeats = ref(true)
  
  // Manual beats (user-added beats)
  const manualBeats = ref<number[]>([])
  
  // Deleted detected beats (user removed from auto-detected)
  const deletedDetectedBeats = ref<number[]>([])
  
  // Auto-correction feature
  const autoCorrectBeats = ref(false)
  const correctedBeats = ref<number[]>([]) // Store corrected detected beats

  const fileName = computed(() => audioFile.value?.name || '')
  const progress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0))

  function setAudioFile(file: File) {
    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value)
    }
    // Reset audio nodes when file changes
    analyserNode.value = null
    sourceNode.value = null
    if (audioContext.value) {
      audioContext.value.close()
      audioContext.value = null
    }
    
    audioFile.value = file
    audioUrl.value = URL.createObjectURL(file)
    currentTime.value = 0
    duration.value = 0
    isPlaying.value = false
    
    // Load or create workspace for this file
    const workspace = workspaceStore.loadWorkspace(file)
    manualBeats.value = [...workspace.manualBeats]
    deletedDetectedBeats.value = [...workspace.deletedDetectedBeats]
    
    bpmInfo.value = null
  }

  function setAudioElement(el: HTMLAudioElement | null) {
    audioElement.value = el
  }

  function initAudioContext() {
    if (!audioElement.value || sourceNode.value) return
    
    const ctx = new AudioContext()
    audioContext.value = ctx
    
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyserNode.value = analyser
    
    const source = ctx.createMediaElementSource(audioElement.value)
    source.connect(analyser)
    analyser.connect(ctx.destination)
    sourceNode.value = source
  }

  function setPlaying(playing: boolean) {
    isPlaying.value = playing
  }

  function setCurrentTime(time: number) {
    currentTime.value = time
  }

  function setDuration(dur: number) {
    duration.value = dur
  }

  function setVolume(vol: number) {
    volume.value = Math.max(0, Math.min(1, vol))
  }

  function setAudioContext(ctx: AudioContext) {
    audioContext.value = ctx
  }

  function setAudioBuffer(buffer: AudioBuffer) {
    audioBuffer.value = buffer
    // Auto-detect BPM when buffer is set
    detectBPMFromBuffer(buffer)
  }

  async function detectBPMFromBuffer(buffer: AudioBuffer) {
    isDetectingBPM.value = true
    bpmInfo.value = null
    
    try {
      // Run detection in next tick to not block UI
      await new Promise(resolve => setTimeout(resolve, 0))
      
      const result = detectBPM(buffer, { minBPM: 60, maxBPM: 200 })
      bpmInfo.value = result
      
      console.log(`Detected ${result.beats.length} beats, avg BPM: ${result.bpm}`)
    } catch (error) {
      console.error('BPM detection failed:', error)
    } finally {
      isDetectingBPM.value = false
    }
  }

  function toggleShowBeats() {
    showBeats.value = !showBeats.value
  }
  
  function toggleAutoCorrectBeats() {
    autoCorrectBeats.value = !autoCorrectBeats.value
    if (autoCorrectBeats.value) {
      applyAutoCorrection()
    } else {
      // Clear corrections when disabled
      correctedBeats.value = []
    }
  }
  
  // Learn offset pattern from manual beats and apply to detected beats
  function applyAutoCorrection() {
    const detectedBeats = bpmInfo.value?.beats || []
    if (detectedBeats.length === 0 || manualBeats.value.length < 3) {
      // Need at least 3 manual beats to learn pattern
      correctedBeats.value = []
      return
    }
    
    // Find offsets between manual beats and nearby detected beats
    const offsets: number[] = []
    const tolerance = 0.15 // 150ms tolerance to find nearby detected beats
    
    for (const manualTime of manualBeats.value) {
      // Find nearest detected beat
      let nearestDetected: number | null = null
      let minDistance = Infinity
      
      for (const detectedTime of detectedBeats) {
        const distance = Math.abs(detectedTime - manualTime)
        if (distance < tolerance && distance < minDistance) {
          minDistance = distance
          nearestDetected = detectedTime
        }
      }
      
      // If found a nearby detected beat, calculate offset
      if (nearestDetected !== null) {
        const offset = manualTime - nearestDetected
        offsets.push(offset)
      }
    }
    
    if (offsets.length < 3) {
      correctedBeats.value = []
      return
    }
    
    // Calculate median offset (more robust than mean)
    const sortedOffsets = [...offsets].sort((a, b) => a - b)
    const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)]
    
    // Calculate standard deviation to filter outliers
    const mean = offsets.reduce((sum, v) => sum + v, 0) / offsets.length
    const variance = offsets.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / offsets.length
    const stdDev = Math.sqrt(variance)
    
    // Only use offsets within 1.5 standard deviations
    const filteredOffsets = offsets.filter(o => Math.abs(o - mean) <= 1.5 * stdDev)
    
    if (filteredOffsets.length < 2) {
      correctedBeats.value = []
      return
    }
    
    // Calculate final correction offset (average of filtered offsets)
    const correctionOffset = filteredOffsets.reduce((sum, v) => sum + v, 0) / filteredOffsets.length
    
    console.log(`Auto-correction: learned offset = ${(correctionOffset * 1000).toFixed(1)}ms from ${filteredOffsets.length} samples`)
    
    // Apply correction to all detected beats that aren't manually modified
    const manualBeatSet = new Set(manualBeats.value)
    const deletedBeatSet = new Set(deletedDetectedBeats.value)
    
    correctedBeats.value = detectedBeats
      .filter(t => {
        // Don't correct if already manually adjusted or deleted
        const hasManualNearby = [...manualBeatSet].some(mt => Math.abs(mt - t) < 0.05)
        const isDeleted = [...deletedBeatSet].some(dt => Math.abs(dt - t) < 0.05)
        return !hasManualNearby && !isDeleted
      })
      .map(t => t + correctionOffset)
      .filter(t => t >= 0 && t <= (duration.value || 0)) // Keep within bounds
  }

  // Add a manual beat at the specified time (in seconds)
  function addManualBeat(time: number) {
    // Avoid duplicate beats (within 50ms tolerance)
    const tolerance = 0.05
    const exists = manualBeats.value.some(t => Math.abs(t - time) < tolerance)
    if (!exists) {
      manualBeats.value.push(time)
      manualBeats.value.sort((a, b) => a - b)
      
      // Update workspace
      workspaceStore.updateBeats(manualBeats.value, deletedDetectedBeats.value, '添加节拍')
      
      // Re-apply auto-correction if enabled
      if (autoCorrectBeats.value) {
        applyAutoCorrection()
      }
      
      // Recalculate BPM curve
      recalculateBPMFromBeats()
    }
  }

  // Remove a manual beat at the specified time
  function removeManualBeat(time: number) {
    const tolerance = 0.05
    const index = manualBeats.value.findIndex(t => Math.abs(t - time) < tolerance)
    if (index !== -1) {
      manualBeats.value.splice(index, 1)
      
      // Update workspace
      workspaceStore.updateBeats(manualBeats.value, deletedDetectedBeats.value, '删除节拍')
      
      // Re-apply auto-correction if enabled
      if (autoCorrectBeats.value) {
        applyAutoCorrection()
      }
      
      // Recalculate BPM curve
      recalculateBPMFromBeats()
    }
  }

  // Remove a detected beat (add to deleted list)
  function removeDetectedBeat(time: number) {
    const tolerance = 0.05
    const exists = deletedDetectedBeats.value.some(t => Math.abs(t - time) < tolerance)
    if (!exists) {
      deletedDetectedBeats.value.push(time)
      
      // Update workspace
      workspaceStore.updateBeats(manualBeats.value, deletedDetectedBeats.value, '删除检测到的节拍')
      
      // Recalculate BPM curve
      recalculateBPMFromBeats()
    }
  }

  // Check if a detected beat is deleted
  function isDetectedBeatDeleted(time: number): boolean {
    const tolerance = 0.05
    return deletedDetectedBeats.value.some(t => Math.abs(t - time) < tolerance)
  }

  // Move a beat from one time to another (internal, no history)
  function moveBeatInternal(oldTime: number, newTime: number): boolean {
    const tolerance = 0.05
    
    // Check if it's a manual beat first (has priority)
    const manualIndex = manualBeats.value.findIndex(t => Math.abs(t - oldTime) < tolerance)
    if (manualIndex !== -1) {
      manualBeats.value.splice(manualIndex, 1)
      // Avoid duplicate beats
      const exists = manualBeats.value.some(t => Math.abs(t - newTime) < tolerance)
      if (!exists) {
        manualBeats.value.push(newTime)
        manualBeats.value.sort((a, b) => a - b)
      }
      return true
    }
    
    // Check if it's a detected beat (only check original detected beats, not recalculated ones)
    const detectedBeats = bpmInfo.value?.beats || []
    
    // Make sure it's not already in manual beats (to avoid treating recalculated beats as detected)
    const isManualBeat = manualBeats.value.some(t => Math.abs(t - oldTime) < tolerance)
    const isAlreadyDeleted = deletedDetectedBeats.value.some(t => Math.abs(t - oldTime) < tolerance)
    
    // Only treat as detected beat if it's in detected list AND not in manual beats
    const isDetected = detectedBeats.some(t => Math.abs(t - oldTime) < tolerance) && !isManualBeat
    
    if (isDetected && !isAlreadyDeleted) {
      // Remove detected beat and add as manual beat at new position
      deletedDetectedBeats.value.push(oldTime)
      
      const beatExists = manualBeats.value.some(t => Math.abs(t - newTime) < tolerance)
      if (!beatExists) {
        manualBeats.value.push(newTime)
        manualBeats.value.sort((a, b) => a - b)
      }
      return true
    }
    
    return false
  }

  // Move a beat from one time to another (with history)
  function moveBeat(oldTime: number, newTime: number) {
    if (moveBeatInternal(oldTime, newTime)) {
      // Update workspace with history
      workspaceStore.updateBeats(manualBeats.value, deletedDetectedBeats.value, '移动节拍')
      
      // Re-apply auto-correction if enabled
      if (autoCorrectBeats.value) {
        applyAutoCorrection()
      }
      
      // Recalculate BPM curve
      recalculateBPMFromBeats()
    }
  }

  // Clear all manual beats
  function clearManualBeats() {
    manualBeats.value = []
    workspaceStore.updateBeats(manualBeats.value, deletedDetectedBeats.value, '清除手动节拍')
    // Recalculate BPM curve
    recalculateBPMFromBeats()
  }

  // Reset all beat edits (clear manual beats and restore deleted detected beats)
  function resetBeatEdits() {
    manualBeats.value = []
    deletedDetectedBeats.value = []
    workspaceStore.updateBeats(manualBeats.value, deletedDetectedBeats.value, '重置所有编辑')
    // Recalculate BPM curve
    recalculateBPMFromBeats()
  }

  // Get active detected beats (excluding deleted ones)
  function getActiveDetectedBeats(): number[] {
    // Use corrected beats if auto-correction is enabled
    if (autoCorrectBeats.value && correctedBeats.value.length > 0) {
      return correctedBeats.value.filter(t => !isDetectedBeatDeleted(t))
    }
    
    const detected = bpmInfo.value?.beats || []
    return detected.filter(t => !isDetectedBeatDeleted(t))
  }

  // Get all beats (detected + manual) sorted, excluding deleted detected beats
  function getAllBeats(): number[] {
    const detected = getActiveDetectedBeats()
    const all = [...detected, ...manualBeats.value]
    // Remove duplicates within tolerance and sort
    const tolerance = 0.05
    const unique: number[] = []
    for (const t of all.sort((a, b) => a - b)) {
      if (unique.length === 0 || t - unique[unique.length - 1] >= tolerance) {
        unique.push(t)
      }
    }
    return unique
  }

  // Export beats as milliseconds array
  function exportBeatsAsMilliseconds(): number[] {
    return getAllBeats().map(t => Math.round(t * 1000))
  }

  // Export beats as JSON string
  function exportBeatsAsJSON(): string {
    return JSON.stringify(exportBeatsAsMilliseconds(), null, 2)
  }

  // Download beats as JSON file
  function downloadBeatsAsJSON() {
    const json = exportBeatsAsJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.value || 'beats'}_beats.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Import beats from file or JSON
  function importBeats(beatsData: number[] | string): { success: boolean; message: string } {
    const result = workspaceStore.importBeats(beatsData)
    
    if (result.success && workspaceStore.currentWorkspace) {
      // Sync with current store state
      manualBeats.value = [...workspaceStore.currentWorkspace.manualBeats]
      deletedDetectedBeats.value = [...workspaceStore.currentWorkspace.deletedDetectedBeats]
      
      // Recalculate BPM info based on imported beats
      recalculateBPMFromBeats()
    }
    
    return result
  }
  
  // Recalculate BPM info from current beats (manual + detected)
  function recalculateBPMFromBeats() {
    const allBeats = getAllBeats()
    if (allBeats.length < 2) {
      return
    }
    
    const dur = duration.value || audioBuffer.value?.duration || 0
    if (dur === 0) return
    
    // Calculate local BPMs using sliding window
    const localBPMs: { time: number; bpm: number }[] = []
    const windowBeats = 4
    
    for (let i = 0; i <= allBeats.length - windowBeats; i++) {
      const startTime = allBeats[i]
      const endTime = allBeats[i + windowBeats - 1]
      
      if (startTime === undefined || endTime === undefined) continue
      
      const numIntervals = windowBeats - 1
      const avgInterval = (endTime - startTime) / numIntervals
      
      if (avgInterval > 0) {
        const bpm = 60 / avgInterval
        const midTime = (startTime + endTime) / 2
        
        localBPMs.push({
          time: midTime,
          bpm: Math.round(bpm)
        })
      }
    }
    
    // Calculate average BPM
    const intervals: number[] = []
    for (let i = 1; i < allBeats.length; i++) {
      const curr = allBeats[i]
      const prev = allBeats[i - 1]
      if (curr !== undefined && prev !== undefined) {
        intervals.push(curr - prev)
      }
    }
    
    if (intervals.length === 0) return
    
    intervals.sort((a, b) => a - b)
    const medianInterval = intervals[Math.floor(intervals.length / 2)]
    const avgBPM = medianInterval !== undefined && medianInterval > 0 ? Math.round(60 / medianInterval) : 0
    
    // Calculate confidence
    let confidence = 0
    if (allBeats.length >= 3 && avgBPM > 0) {
      const expectedInterval = 60 / avgBPM
      let consistentCount = 0
      
      for (let i = 1; i < allBeats.length; i++) {
        const curr = allBeats[i]
        const prev = allBeats[i - 1]
        if (curr === undefined || prev === undefined) continue
        
        const interval = curr - prev
        const deviation = Math.abs(interval - expectedInterval) / expectedInterval
        
        if (deviation < 0.2) {
          consistentCount++
        }
      }
      
      confidence = consistentCount / (allBeats.length - 1)
    }
    
    // Update bpmInfo - preserve original detected beats array if it exists
    const originalBeats = bpmInfo.value?.beats || []
    bpmInfo.value = {
      bpm: avgBPM,
      confidence,
      beats: originalBeats, // Keep original detected beats, don't overwrite with allBeats
      localBPMs
    }
  }

  // Undo last action
  function undo() {
    if (workspaceStore.undo() && workspaceStore.currentWorkspace) {
      manualBeats.value = [...workspaceStore.currentWorkspace.manualBeats]
      deletedDetectedBeats.value = [...workspaceStore.currentWorkspace.deletedDetectedBeats]
      // Recalculate BPM curve
      recalculateBPMFromBeats()
    }
  }

  // Redo last undone action
  function redo() {
    if (workspaceStore.redo() && workspaceStore.currentWorkspace) {
      manualBeats.value = [...workspaceStore.currentWorkspace.manualBeats]
      deletedDetectedBeats.value = [...workspaceStore.currentWorkspace.deletedDetectedBeats]
      // Recalculate BPM curve
      recalculateBPMFromBeats()
    }
  }

  function reset() {
    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value)
    }
    if (audioContext.value) {
      audioContext.value.close()
    }
    audioFile.value = null
    audioUrl.value = ''
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    audioBuffer.value = null
    audioElement.value = null
    analyserNode.value = null
    sourceNode.value = null
    audioContext.value = null
    bpmInfo.value = null
    isDetectingBPM.value = false
    manualBeats.value = []
    deletedDetectedBeats.value = []
    autoCorrectBeats.value = false
    correctedBeats.value = []
  }

  return {
    audioFile,
    audioUrl,
    isPlaying,
    currentTime,
    duration,
    volume,
    audioContext,
    audioBuffer,
    audioElement,
    analyserNode,
    sourceNode,
    bpmInfo,
    isDetectingBPM,
    showBeats,
    autoCorrectBeats,
    manualBeats,
    deletedDetectedBeats,
    fileName,
    progress,
    setAudioFile,
    setAudioElement,
    initAudioContext,
    setPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    setAudioContext,
    setAudioBuffer,
    detectBPMFromBuffer,
    toggleShowBeats,
    toggleAutoCorrectBeats,
    applyAutoCorrection,
    addManualBeat,
    removeManualBeat,
    removeDetectedBeat,
    isDetectedBeatDeleted,
    moveBeat,
    moveBeatInternal,
    clearManualBeats,
    resetBeatEdits,
    getActiveDetectedBeats,
    getAllBeats,
    exportBeatsAsMilliseconds,
    exportBeatsAsJSON,
    downloadBeatsAsJSON,
    importBeats,
    undo,
    redo,
    reset,
  }
})
