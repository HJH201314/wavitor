import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { detectBPM, type BeatInfo } from '../utils/bpmDetector'

export const useAudioStore = defineStore('audio', () => {
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
    
    // Reset beat editing data
    manualBeats.value = []
    deletedDetectedBeats.value = []
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

  // Add a manual beat at the specified time (in seconds)
  function addManualBeat(time: number) {
    // Avoid duplicate beats (within 50ms tolerance)
    const tolerance = 0.05
    const exists = manualBeats.value.some(t => Math.abs(t - time) < tolerance)
    if (!exists) {
      manualBeats.value.push(time)
      manualBeats.value.sort((a, b) => a - b)
    }
  }

  // Remove a manual beat at the specified time
  function removeManualBeat(time: number) {
    const tolerance = 0.05
    const index = manualBeats.value.findIndex(t => Math.abs(t - time) < tolerance)
    if (index !== -1) {
      manualBeats.value.splice(index, 1)
    }
  }

  // Remove a detected beat (add to deleted list)
  function removeDetectedBeat(time: number) {
    const tolerance = 0.05
    const exists = deletedDetectedBeats.value.some(t => Math.abs(t - time) < tolerance)
    if (!exists) {
      deletedDetectedBeats.value.push(time)
    }
  }

  // Check if a detected beat is deleted
  function isDetectedBeatDeleted(time: number): boolean {
    const tolerance = 0.05
    return deletedDetectedBeats.value.some(t => Math.abs(t - time) < tolerance)
  }

  // Move a beat from one time to another
  function moveBeat(oldTime: number, newTime: number) {
    const tolerance = 0.05
    
    // Check if it's a manual beat
    const manualIndex = manualBeats.value.findIndex(t => Math.abs(t - oldTime) < tolerance)
    if (manualIndex !== -1) {
      manualBeats.value.splice(manualIndex, 1)
      addManualBeat(newTime)
      return
    }
    
    // Check if it's a detected beat
    const detectedBeats = bpmInfo.value?.beats || []
    const isDetected = detectedBeats.some(t => Math.abs(t - oldTime) < tolerance)
    if (isDetected) {
      // Remove detected beat and add as manual beat at new position
      removeDetectedBeat(oldTime)
      addManualBeat(newTime)
    }
  }

  // Clear all manual beats
  function clearManualBeats() {
    manualBeats.value = []
  }

  // Reset all beat edits (clear manual beats and restore deleted detected beats)
  function resetBeatEdits() {
    manualBeats.value = []
    deletedDetectedBeats.value = []
  }

  // Get active detected beats (excluding deleted ones)
  function getActiveDetectedBeats(): number[] {
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
    addManualBeat,
    removeManualBeat,
    removeDetectedBeat,
    isDetectedBeatDeleted,
    moveBeat,
    clearManualBeats,
    resetBeatEdits,
    getActiveDetectedBeats,
    getAllBeats,
    exportBeatsAsMilliseconds,
    exportBeatsAsJSON,
    downloadBeatsAsJSON,
    reset,
  }
})
