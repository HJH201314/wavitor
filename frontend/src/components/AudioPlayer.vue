<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue';
import { useAudioStore } from '../stores/audio';

const audioStore = useAudioStore();
const audioRef = ref<HTMLAudioElement | null>(null);

// Use audioUrl as key to force audio element recreation when file changes
const audioKey = computed(() => audioStore.audioUrl);

const formattedCurrentTime = computed(() => formatTime(audioStore.currentTime));
const formattedDuration = computed(() => formatTime(audioStore.duration));

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function togglePlay() {
  if (!audioRef.value) return;
  
  // Initialize audio context on first play (user interaction required)
  if (!audioStore.sourceNode) {
    audioStore.initAudioContext();
  }
  
  if (audioStore.audioContext?.state === 'suspended') {
    audioStore.audioContext.resume();
  }
  
  if (audioStore.isPlaying) {
    audioRef.value.pause();
  } else {
    audioRef.value.play();
  }
}

function handleTimeUpdate() {
  if (audioRef.value) {
    audioStore.setCurrentTime(audioRef.value.currentTime);
  }
}

function handleLoadedMetadata() {
  if (audioRef.value) {
    audioStore.setDuration(audioRef.value.duration);
  }
}

function handlePlay() {
  audioStore.setPlaying(true);
}

function handlePause() {
  audioStore.setPlaying(false);
}

function handleEnded() {
  audioStore.setPlaying(false);
  audioStore.setCurrentTime(0);
}

function handleSeek(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  const newTime = percent * audioStore.duration;
  
  if (audioRef.value) {
    audioRef.value.currentTime = newTime;
    audioStore.setCurrentTime(newTime);
  }
}

function handleVolumeChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const vol = parseFloat(target.value);
  audioStore.setVolume(vol);
  if (audioRef.value) {
    audioRef.value.volume = vol;
  }
}

function skipBackward() {
  if (audioRef.value) {
    audioRef.value.currentTime = Math.max(0, audioRef.value.currentTime - 5);
  }
}

function skipForward() {
  if (audioRef.value) {
    audioRef.value.currentTime = Math.min(audioStore.duration, audioRef.value.currentTime + 5);
  }
}

watch(() => audioStore.audioUrl, (newUrl) => {
  // Audio element will be recreated via :key, need to wait for next tick
  if (newUrl) {
    nextTick(() => {
      if (audioRef.value) {
        audioStore.setAudioElement(audioRef.value);
      }
    });
  }
});

onMounted(() => {
  if (audioRef.value) {
    audioStore.setAudioElement(audioRef.value);
  }
});

onUnmounted(() => {
  if (audioRef.value) {
    audioRef.value.pause();
  }
  audioStore.setAudioElement(null);
});
</script>

<template>
  <div
    v-if="audioStore.audioUrl"
    class="bg-white rounded-xl p-3 md:p-4 shadow-sm max-w-full overflow-hidden"
  >
    <audio
      :key="audioKey"
      ref="audioRef"
      :src="audioStore.audioUrl"
      @timeupdate="handleTimeUpdate"
      @loadedmetadata="handleLoadedMetadata"
      @play="handlePlay"
      @pause="handlePause"
      @ended="handleEnded"
    />
    
    <!-- Compact single-row layout -->
    <div class="flex items-center gap-2 md:gap-4 min-w-0">
      <!-- File info -->
      <div class="flex items-center gap-2 min-w-0 flex-shrink overflow-hidden">
        <svg
          class="w-4 h-4 text-gray-500 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          />
        </svg>
        <span class="text-xs md:text-sm text-gray-700 font-medium truncate">{{ audioStore.fileName }}</span>
      </div>
      
      <!-- Playback controls -->
      <div class="flex items-center gap-1 md:gap-2 flex-shrink-0">
        <button
          class="p-1 md:p-1.5 text-gray-500 hover:text-gray-700 active:bg-gray-100 rounded transition-colors touch-manipulation"
          title="后退 5 秒"
          @click="skipBackward"
        >
          <svg
            class="w-4 h-4 md:w-5 md:h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
            />
          </svg>
        </button>
        
        <button
          class="w-9 h-9 md:w-10 md:h-10 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-full flex items-center justify-center transition-colors shadow-md touch-manipulation"
          @click="togglePlay"
        >
          <svg
            v-if="!audioStore.isPlaying"
            class="w-4 h-4 md:w-5 md:h-5 ml-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg
            v-else
            class="w-4 h-4 md:w-5 md:h-5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </button>
        
        <button
          class="p-1 md:p-1.5 text-gray-500 hover:text-gray-700 active:bg-gray-100 rounded transition-colors touch-manipulation"
          title="前进 5 秒"
          @click="skipForward"
        >
          <svg
            class="w-4 h-4 md:w-5 md:h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
            />
          </svg>
        </button>
      </div>
      
      <!-- Progress bar with time -->
      <div class="flex-1 flex items-center gap-1.5 md:gap-3 min-w-0">
        <span class="text-xs text-gray-500 tabular-nums flex-shrink-0">{{ formattedCurrentTime }}</span>
        <div 
          class="flex-1 h-1.5 bg-gray-200 rounded-full cursor-pointer group touch-manipulation"
          @click="handleSeek"
        >
          <div 
            class="h-full bg-blue-500 rounded-full relative transition-all"
            :style="{ width: `${audioStore.progress}%` }"
          >
            <div class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 md:w-2.5 md:h-2.5 bg-blue-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <span class="text-xs text-gray-500 tabular-nums flex-shrink-0">{{ formattedDuration }}</span>
      </div>
      
      <!-- Volume control -->
      <div class="hidden md:flex items-center gap-2 flex-shrink-0">
        <svg
          class="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="audioStore.volume"
          class="w-20 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          @input="handleVolumeChange"
        >
      </div>
    </div>
  </div>
</template>
