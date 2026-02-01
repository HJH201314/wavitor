<script setup lang="ts">
import { ref } from 'vue';
import { useUIStore } from '../stores/ui';
import { useWorkspaceStore } from '../stores/workspace';
import { useAudioStore } from '../stores/audio';
import SettingsModal from './SettingsModal.vue';

const uiStore = useUIStore();
const workspaceStore = useWorkspaceStore();
const audioStore = useAudioStore();

const showSettings = ref(false);

function toggleBottomSheet() {
  uiStore.toggleBottomSheet();
}

function openSettings() {
  showSettings.value = true;
}

function closeSettings() {
  showSettings.value = false;
}
</script>

<template>
  <div
    v-if="uiStore.showBottomNav"
    class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-area-bottom"
  >
    <div class="flex items-center justify-around h-14 px-2">
      <!-- Workspaces -->
      <button
        class="flex flex-col items-center justify-center flex-1 py-2 transition-colors touch-manipulation"
        :class="uiStore.showBottomSheet ? 'text-blue-600' : 'text-gray-600'"
        @click="toggleBottomSheet"
      >
        <svg class="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span class="text-[10px] font-medium">工作区</span>
      </button>

      <!-- BPM Info -->
      <div
        class="flex flex-col items-center justify-center flex-1 py-2 text-gray-600"
      >
        <svg class="w-5 h-5 mb-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" />
        </svg>
        <span
          v-if="audioStore.bpmInfo?.bpm"
          class="text-[10px] font-medium"
        >
          {{ audioStore.bpmInfo.bpm }} BPM
        </span>
        <span
          v-else
          class="text-[10px] font-medium"
        >
          节拍
        </span>
      </div>

      <!-- Current Workspace -->
      <div
        class="flex flex-col items-center justify-center flex-1 py-2 text-gray-600"
      >
        <svg class="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span class="text-[10px] font-medium truncate max-w-[60px]">
          {{ workspaceStore.currentWorkspace?.name || '未命名' }}
        </span>
      </div>

      <!-- Settings -->
      <button
        class="flex flex-col items-center justify-center flex-1 py-2 text-gray-600 transition-colors touch-manipulation"
        @click="openSettings"
      >
        <svg class="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span class="text-[10px] font-medium">设置</span>
      </button>
    </div>

    <!-- Safe area padding for iOS devices -->
    <div class="h-safe-area-inset-bottom bg-white" />
    
    <!-- Settings Modal -->
    <SettingsModal :show="showSettings" @close="closeSettings" />
  </div>
</template>

<style scoped>
/* iOS safe area support */
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

.h-safe-area-inset-bottom {
  height: env(safe-area-inset-bottom);
}
</style>
