<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAudioStore } from '../stores/audio'
import AudioUploader from '../components/AudioUploader.vue'
import AudioPlayer from '../components/AudioPlayer.vue'
import WaveformVisualizer from '../components/WaveformVisualizer.vue'
import FrequencyVisualizer from '../components/FrequencyVisualizer.vue'

const audioStore = useAudioStore()
const audioRef = ref<HTMLAudioElement | null>(null)

function handleSeek(e: CustomEvent) {
  const audio = document.querySelector('audio') as HTMLAudioElement
  if (audio) {
    audio.currentTime = e.detail
  }
}

onMounted(() => {
  window.addEventListener('seek', handleSeek as EventListener)
})

onUnmounted(() => {
  window.removeEventListener('seek', handleSeek as EventListener)
  audioStore.reset()
})
</script>

<template>
  <div class="min-h-screen bg-gray-50 py-8 px-4">
    <div class="max-w-4xl mx-auto">
      <header class="text-center mb-10">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">Wavitor</h1>
        <p class="text-gray-500">音频播放与可视化工具</p>
      </header>
      
      <div class="space-y-6">
        <AudioUploader />
        
        <div v-if="audioStore.audioUrl" class="grid gap-6">
          <AudioPlayer />
          <WaveformVisualizer />
          <FrequencyVisualizer />
        </div>
        
        <div v-else class="text-center py-12 text-gray-400">
          <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <p>上传音频文件开始播放</p>
        </div>
      </div>
      
      <footer class="text-center mt-12 text-gray-400 text-sm">
        <p>支持 WAV, MP3, OGG, FLAC, AAC 格式</p>
      </footer>
    </div>
  </div>
</template>
