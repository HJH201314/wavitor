<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useAudioStore } from '../stores/audio';
import { useWorkspaceStore } from '../stores/workspace';
import AudioUploader from '../components/AudioUploader.vue';
import AudioPlayer from '../components/AudioPlayer.vue';
import WaveformVisualizer from '../components/WaveformVisualizer.vue';
import FrequencyVisualizer from '../components/FrequencyVisualizer.vue';
import BPMCurveChart from '../components/BPMCurveChart.vue';
import BPMSettings from '../components/BPMSettings.vue';
import WorkspaceList from '../components/WorkspaceList.vue';

const audioStore = useAudioStore();
const workspaceStore = useWorkspaceStore();
const _audioRef = ref<HTMLAudioElement | null>(null);

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
    <header class="bg-white border-b border-gray-200 px-6 py-4">
      <div class="max-w-screen-2xl mx-auto flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">
            Wavitor
          </h1>
          <p class="text-sm text-gray-500">
            音频播放与可视化工具
          </p>
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
          <!-- Audio Content (when file is loaded) -->
          <div
            v-if="audioStore.audioUrl"
            class="flex flex-col gap-6"
          >
            <AudioPlayer />
            <BPMSettings />
            <WaveformVisualizer />
            <BPMCurveChart />
            <FrequencyVisualizer />
          </div>
          
          <!-- Upload Section (only when no file) -->
          <div
            v-else
            class="flex-1 flex flex-col gap-6"
          >
            <AudioUploader />
            
            <!-- Empty State -->
            <div class="flex-1 flex items-center justify-center">
              <div class="text-center py-12 text-gray-400">
                <svg
                  class="w-20 h-20 mx-auto mb-4 opacity-50"
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
                <p class="text-lg font-medium mb-2">
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
  </div>
</template>
