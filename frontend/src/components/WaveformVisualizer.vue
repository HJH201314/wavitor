<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useAudioStore } from '../stores/audio'

const audioStore = useAudioStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const waveformData = ref<Float32Array | null>(null)
const isLoading = ref(false)
const localAudioBuffer = ref<AudioBuffer | null>(null)

const canvasWidth = ref(800)
const canvasHeight = 150

// Window duration in seconds (adjustable 1s ~ audio duration)
const windowDuration = ref(8)
const minWindowDuration = 1

// Max window duration is computed based on audio length
const maxWindowDuration = computed(() => {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 60
  return Math.max(minWindowDuration, Math.ceil(duration))
})

// Pixels per second for rendering
const pixelsPerSecond = computed(() => canvasWidth.value / windowDuration.value)

async function loadAudioBuffer() {
  if (!audioStore.audioFile) return
  
  isLoading.value = true
  waveformData.value = null
  
  try {
    const decodeContext = new AudioContext()
    const arrayBuffer = await audioStore.audioFile.arrayBuffer()
    const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer)
    localAudioBuffer.value = audioBuffer
    audioStore.setAudioBuffer(audioBuffer)
    
    await decodeContext.close()
    
    extractWaveformData(audioBuffer)
  } catch (error) {
    console.error('Failed to load audio buffer:', error)
  } finally {
    isLoading.value = false
  }
}

function extractWaveformData(audioBuffer: AudioBuffer) {
  const channelData = audioBuffer.getChannelData(0)
  
  // Calculate samples per pixel based on sample rate and pixels per second
  const samplesPerPixel = Math.floor(audioBuffer.sampleRate / pixelsPerSecond.value)
  const totalPixels = Math.ceil(channelData.length / samplesPerPixel)
  
  // Pre-compute normalized waveform data for the entire audio
  const data = new Float32Array(totalPixels)
  let maxVal = 0
  
  for (let i = 0; i < totalPixels; i++) {
    let sum = 0
    const start = i * samplesPerPixel
    const end = Math.min(start + samplesPerPixel, channelData.length)
    for (let j = start; j < end; j++) {
      sum += Math.abs(channelData[j])
    }
    const avg = sum / (end - start)
    data[i] = avg
    if (avg > maxVal) maxVal = avg
  }
  
  // Normalize
  if (maxVal > 0) {
    for (let i = 0; i < data.length; i++) {
      data[i] = data[i] / maxVal
    }
  }
  
  waveformData.value = data
  drawWaveform()
}

function drawWaveform() {
  const canvas = canvasRef.value
  const data = waveformData.value
  if (!canvas || !data || data.length === 0) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvasWidth.value * dpr
  canvas.height = canvasHeight * dpr
  ctx.scale(dpr, dpr)
  
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight)
  
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0
  if (duration === 0) return
  
  const currentTime = audioStore.currentTime
  const halfWindow = windowDuration.value / 2
  
  // Calculate visible time range (center on current time)
  let startTime = currentTime - halfWindow
  let endTime = currentTime + halfWindow
  
  // Clamp to audio bounds
  if (startTime < 0) {
    startTime = 0
    endTime = Math.min(windowDuration.value, duration)
  }
  if (endTime > duration) {
    endTime = duration
    startTime = Math.max(0, duration - windowDuration.value)
  }
  
  // Calculate which data indices to render
  const dataPerSecond = data.length / duration
  const startIndex = Math.floor(startTime * dataPerSecond)
  const endIndex = Math.ceil(endTime * dataPerSecond)
  const visibleData = endIndex - startIndex
  
  if (visibleData <= 0) return
  
  const barWidth = canvasWidth.value / visibleData
  const halfHeight = canvasHeight / 2
  
  // Draw beat markers first (behind waveform)
  if (audioStore.showBeats && audioStore.bpmInfo?.beats) {
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)' // Light red
    ctx.lineWidth = 1
    
    for (const beatTime of audioStore.bpmInfo.beats) {
      if (beatTime >= startTime && beatTime <= endTime) {
        const x = ((beatTime - startTime) / (endTime - startTime)) * canvasWidth.value
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, canvasHeight)
        ctx.stroke()
      }
    }
  }
  
  // Draw waveform bars
  for (let i = 0; i < visibleData; i++) {
    const dataIndex = startIndex + i
    if (dataIndex >= data.length) break
    
    const val = data[dataIndex]
    const barHeight = val * halfHeight * 0.85
    const x = i * barWidth
    const time = (dataIndex / dataPerSecond)
    
    // Color based on whether this part has been played
    if (time < currentTime) {
      ctx.fillStyle = '#3b82f6' // Blue for played
    } else {
      ctx.fillStyle = '#d1d5db' // Gray for unplayed
    }
    
    ctx.fillRect(x, halfHeight - barHeight, Math.max(barWidth - 1, 1), barHeight * 2)
  }
  
  // Draw beat markers on top (more visible dots at bottom)
  if (audioStore.showBeats && audioStore.bpmInfo?.beats) {
    ctx.fillStyle = '#ef4444' // Red
    
    for (const beatTime of audioStore.bpmInfo.beats) {
      if (beatTime >= startTime && beatTime <= endTime) {
        const x = ((beatTime - startTime) / (endTime - startTime)) * canvasWidth.value
        // Draw small triangle/marker at bottom
        ctx.beginPath()
        ctx.moveTo(x, canvasHeight - 16)
        ctx.lineTo(x - 4, canvasHeight - 22)
        ctx.lineTo(x + 4, canvasHeight - 22)
        ctx.closePath()
        ctx.fill()
      }
    }
  }
  
  // Draw center playhead line
  const playheadX = ((currentTime - startTime) / (endTime - startTime)) * canvasWidth.value
  ctx.strokeStyle = '#1d4ed8'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(playheadX, 0)
  ctx.lineTo(playheadX, canvasHeight)
  ctx.stroke()
  
  // Draw time markers
  ctx.fillStyle = '#9ca3af'
  ctx.font = '10px system-ui'
  ctx.textAlign = 'center'
  
  const timeStep = windowDuration.value <= 5 ? 1 : 2
  for (let t = Math.ceil(startTime); t <= Math.floor(endTime); t += timeStep) {
    const x = ((t - startTime) / (endTime - startTime)) * canvasWidth.value
    ctx.fillText(formatTime(t), x, canvasHeight - 4)
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function handleCanvasClick(e: MouseEvent) {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0
  if (!duration || !canvasRef.value) return
  
  const rect = canvasRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const percent = x / rect.width
  
  const currentTime = audioStore.currentTime
  const halfWindow = windowDuration.value / 2
  
  let startTime = currentTime - halfWindow
  let endTime = currentTime + halfWindow
  
  if (startTime < 0) {
    startTime = 0
    endTime = Math.min(windowDuration.value, duration)
  }
  if (endTime > duration) {
    endTime = duration
    startTime = Math.max(0, duration - windowDuration.value)
  }
  
  const newTime = startTime + percent * (endTime - startTime)
  const clampedTime = Math.max(0, Math.min(duration, newTime))
  
  audioStore.setCurrentTime(clampedTime)
  
  const event = new CustomEvent('seek', { detail: clampedTime })
  window.dispatchEvent(event)
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  // Adjust step size based on current window duration
  const step = windowDuration.value < 10 ? 1 : windowDuration.value < 30 ? 2 : 5
  const delta = e.deltaY > 0 ? step : -step
  const newDuration = Math.max(minWindowDuration, Math.min(maxWindowDuration.value, windowDuration.value + delta))
  if (newDuration !== windowDuration.value) {
    windowDuration.value = newDuration
    if (localAudioBuffer.value) {
      extractWaveformData(localAudioBuffer.value)
    }
  }
}

function updateCanvasSize() {
  if (containerRef.value) {
    const newWidth = containerRef.value.clientWidth - 48
    if (newWidth > 0 && newWidth !== canvasWidth.value) {
      canvasWidth.value = newWidth
      if (localAudioBuffer.value) {
        extractWaveformData(localAudioBuffer.value)
      }
    }
  }
}

watch(() => audioStore.audioFile, () => {
  if (audioStore.audioFile) {
    waveformData.value = null
    localAudioBuffer.value = null
    setTimeout(() => {
      updateCanvasSize()
      loadAudioBuffer()
    }, 100)
  }
}, { immediate: true })

watch(() => audioStore.currentTime, () => {
  if (waveformData.value && waveformData.value.length > 0) {
    drawWaveform()
  }
})

watch(() => [audioStore.bpmInfo, audioStore.showBeats], () => {
  if (waveformData.value && waveformData.value.length > 0) {
    drawWaveform()
  }
})

let animationFrameId: number | null = null

function startAnimationLoop() {
  function loop() {
    if (waveformData.value && waveformData.value.length > 0) {
      drawWaveform()
    }
    animationFrameId = requestAnimationFrame(loop)
  }
  loop()
}

function stopAnimationLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
}

watch(() => audioStore.isPlaying, (isPlaying) => {
  if (isPlaying) {
    startAnimationLoop()
  } else {
    stopAnimationLoop()
    drawWaveform()
  }
})

onMounted(() => {
  updateCanvasSize()
  window.addEventListener('resize', updateCanvasSize)
  
  if (audioStore.audioFile && !waveformData.value) {
    loadAudioBuffer()
  }
})

onUnmounted(() => {
  stopAnimationLoop()
  window.removeEventListener('resize', updateCanvasSize)
})
</script>

<template>
  <div 
    v-if="audioStore.audioUrl"
    ref="containerRef"
    class="bg-white rounded-xl p-6 shadow-sm"
  >
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-4">
        <h3 class="text-sm font-medium text-gray-500">波形图</h3>
        
        <!-- BPM Info -->
        <div v-if="audioStore.isDetectingBPM" class="flex items-center gap-2 text-xs text-gray-400">
          <div class="animate-spin rounded-full h-3 w-3 border border-blue-500 border-t-transparent"></div>
          <span>检测节拍...</span>
        </div>
        <div v-else-if="audioStore.bpmInfo && audioStore.bpmInfo.bpm > 0" class="flex items-center gap-3">
          <span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
            平均 {{ audioStore.bpmInfo.bpm }} BPM
          </span>
          <span class="text-xs text-gray-400">
            {{ audioStore.bpmInfo.beats.length }} 个节拍
          </span>
          <button
            class="text-xs px-2 py-1 rounded transition-colors"
            :class="audioStore.showBeats ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'"
            @click="audioStore.toggleShowBeats"
          >
            {{ audioStore.showBeats ? '隐藏节拍' : '显示节拍' }}
          </button>
        </div>
      </div>
      
      <div class="flex items-center gap-2 text-xs text-gray-400">
        <span>窗口: {{ windowDuration }}s</span>
        <span class="text-gray-300">|</span>
        <span>滚轮调整</span>
      </div>
    </div>
    
    <div v-if="isLoading" class="flex items-center justify-center h-[150px] bg-gray-50 rounded-lg">
      <div class="flex flex-col items-center gap-2">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent"></div>
        <span class="text-sm text-gray-400">加载波形数据...</span>
      </div>
    </div>
    
    <canvas
      v-show="!isLoading && waveformData && waveformData.length > 0"
      ref="canvasRef"
      :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }"
      class="cursor-pointer w-full bg-gray-50 rounded-lg"
      @click="handleCanvasClick"
      @wheel="handleWheel"
    />
    
    <div 
      v-if="!isLoading && (!waveformData || waveformData.length === 0)" 
      class="flex items-center justify-center h-[150px] bg-gray-50 rounded-lg text-gray-400"
    >
      等待加载...
    </div>
  </div>
</template>
