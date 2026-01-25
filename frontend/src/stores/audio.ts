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
    reset,
  }
})
