<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { useBreakpoints } from '@vueuse/core';
import { useAudioStore } from '../stores/audio';
import { useWorkspaceStore } from '../stores/workspace';
import { useUIStore } from '../stores/ui';
import AudioUploader from '../components/AudioUploader.vue';
import ECGUploader from '../components/ECGUploader.vue';
import AudioPlayer from '../components/AudioPlayer.vue';
import WaveformVisualizer from '../components/WaveformVisualizer.vue';
import FrequencyVisualizer from '../components/FrequencyVisualizer.vue';
import BPMCurveChart from '../components/BPMCurveChart.vue';
import BPMSettings from '../components/BPMSettings.vue';
import WorkspaceList from '../components/WorkspaceList.vue';
import BottomNav from '../components/BottomNav.vue';

const audioStore = useAudioStore();
const workspaceStore = useWorkspaceStore();
const uiStore = useUIStore();
const _audioRef = ref<HTMLAudioElement | null>(null);

// Responsive breakpoints
const breakpoints = useBreakpoints({
  mobile: 640,
  tablet: 768,
  desktop: 1024,
});

const isMobile = breakpoints.smaller('tablet');
const isDesktop = breakpoints.greaterOrEqual('desktop');

function handleSeek(e: CustomEvent) {
  const audio = document.querySelector('audio') as HTMLAudioElement;
  if (audio) {
    audio.currentTime = e.detail;
  }
}

function handleKeydown(e: KeyboardEvent) {
  // Space key to toggle play/pause
  if (e.code === 'Space' && audioStore.audioUrl) {
    // Prevent default scroll behavior
    e.preventDefault();
    
    const audio = document.querySelector('audio') as HTMLAudioElement;
    if (!audio) return;
    
    // Initialize audio context on first play if needed
    if (!audioStore.sourceNode) {
      audioStore.initAudioContext();
    }
    
    if (audioStore.audioContext?.state === 'suspended') {
      audioStore.audioContext.resume();
    }
    
    if (audioStore.isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }
}

// Auto-restore last opened workspace on page load
async function restoreLastWorkspace() {
  const lastFileId = workspaceStore.lastOpenedFileId;
  if (lastFileId && workspaceStore.workspaces.has(lastFileId)) {
    console.log('Restoring last opened workspace:', lastFileId);
    await audioStore.loadWorkspaceById(lastFileId);
  }
}

onMounted(async () => {
  window.addEventListener('seek', handleSeek as EventListener);
  window.addEventListener('keydown', handleKeydown);
  
  // Wait for storage to be initialized, then restore last workspace
  if (workspaceStore.storageInitialized) {
    await restoreLastWorkspace();
  } else {
    // Watch for storage initialization
    const unwatch = watch(
      () => workspaceStore.storageInitialized,
      async (initialized) => {
        if (initialized) {
          await restoreLastWorkspace();
          unwatch();
        }
      }
    );
  }
});

onUnmounted(() => {
  window.removeEventListener('seek', handleSeek as EventListener);
  window.removeEventListener('keydown', handleKeydown);
  audioStore.reset();
});
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Header -->
    <header class="bg-white border-b border-gray-200 px-4 md:px-6 py-3 md:py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <!-- Mobile menu button -->
          <button
            v-if="isMobile"
            class="lg:hidden p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            @click="uiStore.toggleBottomSheet"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          
          <div>
            <h1 class="text-xl md:text-2xl font-bold text-gray-800">
              Wavitor
            </h1>
            <p class="text-xs md:text-sm text-gray-500">
              音频播放与可视化工具
            </p>
          </div>
        </div>
        <div class="hidden md:block text-xs text-gray-400">
          支持 WAV, MP3, OGG, FLAC, AAC
        </div>
      </div>
    </header>
    
    <!-- Main Content -->
    <div class="p-3 md:p-4 lg:p-6">
      <div class="flex gap-4 lg:gap-6" :class="isMobile ? 'h-[calc(100vh-156px)]' : 'h-[calc(100vh-100px)] md:h-[calc(100vh-120px)] lg:h-[calc(100vh-140px)]'">
        <!-- Left Sidebar: Workspace List (Desktop only) -->
        <aside class="hidden lg:block w-80 flex-shrink-0">
          <WorkspaceList />
        </aside>
        
        <!-- Right Content: Operation Area -->
        <main class="flex-1 flex flex-col gap-3 md:gap-4 lg:gap-6 min-w-0 overflow-y-auto overflow-x-hidden">
          <!-- Audio Content (when file is loaded) -->
          <div
            v-if="audioStore.audioUrl"
            class="flex flex-col gap-3 md:gap-4 lg:gap-6"
          >
            <AudioPlayer />
            <BPMSettings>
              <template #ecg-uploader>
                <ECGUploader />
              </template>
            </BPMSettings>
            <WaveformVisualizer />
            <BPMCurveChart />
            <FrequencyVisualizer />
          </div>
          
          <!-- Upload Section (only when no file) -->
          <div
            v-else
            class="flex-1 flex flex-col gap-3 md:gap-4 lg:gap-6"
          >
            <AudioUploader />
            
            <!-- Empty State -->
            <div class="flex-1 flex items-center justify-center">
              <div class="text-center py-8 md:py-12 text-gray-400">
                <svg
                  class="w-16 h-16 md:w-20 md:h-20 mx-auto mb-4 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1"
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
                <p class="text-base md:text-lg font-medium mb-2">
                  从工作区选择或上传新文件
                </p>
                <p class="text-sm">
                  支持拖拽上传或点击选择文件
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
    
    <!-- Bottom Sheet for Workspace List (Mobile only) -->
    <Transition name="bottom-sheet">
      <div
        v-if="isMobile && uiStore.showBottomSheet"
        class="fixed inset-0 z-50 lg:hidden"
        @click.self="uiStore.closeBottomSheet"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/50" @click="uiStore.closeBottomSheet" />
        
        <!-- Bottom Sheet -->
        <div class="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col">
          <!-- Handle -->
          <div class="flex items-center justify-center py-3 border-b border-gray-200">
            <div class="w-10 h-1 bg-gray-300 rounded-full" />
          </div>
          
          <!-- Content -->
          <div class="flex-1 overflow-y-auto">
            <WorkspaceList @workspace-selected="uiStore.closeBottomSheet" />
          </div>
        </div>
      </div>
    </Transition>
    
    <!-- Bottom Navigation Bar (Mobile only) -->
    <BottomNav v-if="isMobile" />
  </div>
</template>

<style scoped>
.bottom-sheet-enter-active,
.bottom-sheet-leave-active {
  transition: opacity 0.3s ease;
}

.bottom-sheet-enter-active .absolute:last-child,
.bottom-sheet-leave-active .absolute:last-child {
  transition: transform 0.3s ease;
}

.bottom-sheet-enter-from,
.bottom-sheet-leave-to {
  opacity: 0;
}

.bottom-sheet-enter-from .absolute:last-child,
.bottom-sheet-leave-to .absolute:last-child {
  transform: translateY(100%);
}
</style>
