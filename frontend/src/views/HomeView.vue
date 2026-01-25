<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAudioStore } from '../stores/audio'
import AudioUploader from '../components/AudioUploader.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import WaveformVisualizer from '../components/WaveformVisualizer.vue'
import FrequencyVisualizer from '../components/FrequencyVisualizer.vue'
import WorkspaceList from '../components/WorkspaceList.vue'

const audioStore = useAudioStore()
const audioRef = ref<HTMLAudioElement | null>(null)

function handleSeek(e: CustomEvent) {
  const audio = document.querySelector('audio') as HTMLAudioElement
  if (audio) {
    audio.currentTime = e.detail
  }
}

function handleKeydown(e: KeyboardEvent) {
  // Space key to toggle play/pause
  if (e.code === 'Space' && audioStore.audioUrl) {
    // Prevent default scroll behavior
    e.preventDefault()
    
    const audio = document.querySelector('audio') as HTMLAudioElement
    if (!audio) return
    
    // Initialize audio context on first play if needed
    if (!audioStore.sourceNode) {
      audioStore.initAudioContext()
    }
    
    if (audioStore.audioContext?.state === 'suspended') {
      audioStore.audioContext.resume()
    }
    
    if (audioStore.isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
  }
}

onMounted(() => {
  window.addEventListener('seek', handleSeek as EventListener)
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('seek', handleSeek as EventListener)
  window.removeEventListener('keydown', handleKeydown)
  audioStore.reset()
})
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 px-6 py-4">
      <div class="max-w-screen-2xl mx-auto flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">Wavitor</h1>
          <p class="text-sm text-gray-500">音频播放与可视化工具</p>
        </div>
        <div class="text-xs text-gray-400">
          支持 WAV, MP3, OGG, FLAC, AAC
        </div>
      </div>
    </header>
    
    <!-- Main Content -->
    <div class="max-w-screen-2xl mx-auto p-6">
      <div class="flex gap-6 h-[calc(100vh-140px)]">
        <!-- Left Sidebar: Workspace List -->
        <aside class="w-80 flex-shrink-0">
          <WorkspaceList />
        </aside>
        
        <!-- Right Content: Operation Area -->
        <main class="flex-1 flex flex-col gap-6 min-w-0 overflow-y-auto">
          <!-- Upload Section -->
          <AudioUploader />
          
          <!-- Audio Content -->
          <div v-if="audioStore.audioUrl" class="flex flex-col gap-6">
            <AudioPlayer />
            <WaveformVisualizer />
            <FrequencyVisualizer />
          </div>
          
          <!-- Empty State -->
          <div v-else class="flex-1 flex items-center justify-center">
            <div class="text-center py-12 text-gray-400">
              <svg class="w-20 h-20 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <p class="text-lg font-medium mb-2">上传音频文件开始</p>
              <p class="text-sm">支持拖拽上传或点击选择文件</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>
