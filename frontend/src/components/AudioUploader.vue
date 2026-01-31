<script setup lang="ts">
import { ref } from 'vue'
import { useAudioStore } from '../stores/audio'

const audioStore = useAudioStore()
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const acceptedFormats = '.wav,.mp3,.ogg,.flac,.aac,.m4a'

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
  // Reset input to allow selecting the same file again
  target.value = ''
}

async function handleFile(file: File) {
  const validTypes = ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/x-wav']
  if (validTypes.includes(file.type) || file.name.toLowerCase().endsWith('.wav')) {
    await audioStore.setAudioFile(file)
  } else {
    alert('请上传有效的音频文件 (WAV, MP3, OGG, FLAC, AAC)')
  }
}

function triggerFileInput() {
  fileInput.value?.click()
}
</script>

<template>
  <div
    class="border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer"
    :class="isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-white'"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @click="triggerFileInput"
  >
    <input
      ref="fileInput"
      type="file"
      :accept="acceptedFormats"
      class="hidden"
      @change="handleFileSelect"
    />
    
    <div class="flex flex-col items-center gap-3">
      <svg class="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
      <div>
        <p class="text-gray-600 font-medium">拖拽音频文件到这里</p>
        <p class="text-gray-400 text-sm mt-1">或点击选择文件</p>
      </div>
      <p class="text-gray-400 text-xs">支持 WAV, MP3, OGG, FLAC, AAC</p>
    </div>
  </div>
</template>
