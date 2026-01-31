<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import { useAudioStore } from '../stores/audio';
import { storageManager } from '../utils/storage';

const workspaceStore = useWorkspaceStore();
const audioStore = useAudioStore();

const workspaces = computed(() => workspaceStore.workspaceSummaries);
const storageUsage = ref(0);
const storageQuota = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);

const acceptedFormats = '.wav,.mp3,.ogg,.flac,.aac,.m4a';

const storagePercentage = computed(() => {
  if (storageQuota.value === 0) return 0;
  return (storageUsage.value / storageQuota.value) * 100;
});

async function updateStorageInfo() {
  const info = await storageManager.getStorageUsage();
  storageUsage.value = info.usage;
  storageQuota.value = info.quota;
}

onMounted(() => {
  updateStorageInfo();
});

// File upload functions
function triggerFileInput() {
  fileInput.value?.click();
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
  target.value = '';
}

async function handleFile(file: File) {
  const validTypes = ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/x-wav'];
  if (validTypes.includes(file.type) || file.name.toLowerCase().endsWith('.wav')) {
    await audioStore.setAudioFile(file);
    updateStorageInfo();
  } else {
    alert('请上传有效的音频文件 (WAV, MP3, OGG, FLAC, AAC)');
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // Less than 1 minute
  if (diff < 60000) {
    return '刚刚';
  }
  // Less than 1 hour
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)} 分钟前`;
  }
  // Less than 1 day
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)} 小时前`;
  }
  // Less than 7 days
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)} 天前`;
  }
  
  // Show date
  return date.toLocaleDateString('zh-CN', { 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function handleDeleteWorkspace(fileId: string, event: Event) {
  event.stopPropagation();
  
  if (confirm('确定要删除这个工作区吗？此操作不可恢复。')) {
    const isCurrentWorkspace = workspaceStore.currentFileId === fileId;
    
    workspaceStore.deleteWorkspace(fileId).then(success => {
      if (success) {
        // If deleting current workspace, reset audio state
        if (isCurrentWorkspace) {
          audioStore.reset();
        }
        updateStorageInfo();
      }
    });
  }
}

function handleClearAll() {
  if (confirm('确定要清除所有工作区吗？此操作不可恢复。')) {
    workspaceStore.clearAllWorkspaces();
    audioStore.reset();
    updateStorageInfo();
  }
}

async function switchWorkspace(fileId: string) {
  if (workspaceStore.currentFileId === fileId) return;
  
  const success = await audioStore.loadWorkspaceById(fileId);
  if (!success) {
    alert('无法加载工作区，音频文件可能已被删除');
  }
}

function getWorkspaceName(fileName: string): string {
  // Truncate long filenames
  if (fileName.length > 30) {
    const ext = fileName.split('.').pop();
    return fileName.substring(0, 27) + '...' + (ext ? `.${ext}` : '');
  }
  return fileName;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
</script>

<template>
  <div class="h-full flex flex-col bg-white rounded-xl shadow-sm overflow-hidden">
    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      :accept="acceptedFormats"
      class="hidden"
      @change="handleFileSelect"
    >
    
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-200 bg-gray-50">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold text-gray-700">
          工作区列表
        </h2>
        <button
          class="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
          title="新建工作区"
          @click="triggerFileInput"
        >
          <svg
            class="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
          新建
        </button>
      </div>
      <p class="text-xs text-gray-500">
        {{ workspaces.length }} 个工作区
      </p>
    </div>
    
    <!-- Workspace List -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="workspaces.length === 0"
        class="flex flex-col items-center justify-center h-full py-12 px-4 text-gray-400"
      >
        <svg
          class="w-12 h-12 mb-3 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <p class="text-sm text-center">
          暂无工作区
        </p>
        <p class="text-xs text-center mt-1">
          上传音频文件自动创建
        </p>
      </div>
      
      <div
        v-else
        class="divide-y divide-gray-100"
      >
        <div
          v-for="workspace in workspaces"
          :key="workspace.fileId"
          class="group px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer relative"
          :class="{ 'bg-blue-50 hover:bg-blue-50': workspace.isCurrent }"
          @click="switchWorkspace(workspace.fileId)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <h3 
                  class="text-sm font-medium truncate"
                  :class="workspace.isCurrent ? 'text-blue-700' : 'text-gray-800'"
                  :title="workspace.fileName"
                >
                  {{ getWorkspaceName(workspace.fileName) }}
                </h3>
                <span
                  v-if="workspace.isCurrent"
                  class="flex-shrink-0 px-1.5 py-0.5 bg-blue-500 text-white text-[10px] font-medium rounded"
                >
                  当前
                </span>
              </div>
              
              <div class="flex items-center gap-3 text-xs text-gray-500">
                <span class="flex items-center gap-1">
                  <svg
                    class="w-3 h-3"
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
                  {{ workspace.beatCount }} 节拍
                </span>
                <span class="flex items-center gap-1">
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {{ formatDate(workspace.lastModified) }}
                </span>
              </div>
            </div>
            
            <button
              class="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-1"
              title="删除工作区"
              @click="(e) => handleDeleteWorkspace(workspace.fileId, e)"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Storage Info -->
    <div class="px-4 py-3 border-t border-gray-200 bg-gray-50">
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs text-gray-600">
          存储空间
        </div>
        <button
          v-if="workspaces.length > 0"
          class="text-xs text-red-500 hover:text-red-700 transition-colors font-medium"
          title="清除所有工作区"
          @click="handleClearAll"
        >
          清空全部
        </button>
      </div>
      <div class="mb-2">
        <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            class="h-full bg-blue-500 transition-all duration-300"
            :style="{ width: `${Math.min(storagePercentage, 100)}%` }"
          />
        </div>
      </div>
      <div class="flex justify-between text-xs text-gray-500">
        <span>{{ formatBytes(storageUsage) }} / {{ formatBytes(storageQuota) }}</span>
        <span>{{ storagePercentage.toFixed(1) }}%</span>
      </div>
    </div>
  </div>
</template>
