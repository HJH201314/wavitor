<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAudioStore } from '../stores/audio';

const audioStore = useAudioStore();
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);

const hasECG = computed(() => audioStore.hasECG);
const ecgDataList = computed(() => audioStore.ecgDataList);
const isProcessingECG = computed(() => audioStore.isProcessingECG);
const ecgProcessingProgress = computed(() => audioStore.ecgProcessingProgress);
const ecgProcessingStage = computed(() => audioStore.ecgProcessingStage);

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}

function handleDragLeave() {
  isDragging.value = false;
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const files = target.files;
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
  // Reset input
  target.value = '';
}

async function handleFile(file: File) {
  // Only accept WAV files for ECG
  if (!file.name.toLowerCase().endsWith('.wav')) {
    alert('请上传 WAV 格式的心电文件');
    return;
  }
  
  isUploading.value = true;
  try {
    await audioStore.setECGFile(file);
  } catch (error) {
    console.error('ECG upload failed:', error);
    alert('心电文件上传失败');
  } finally {
    isUploading.value = false;
  }
}

function triggerFileInput() {
  fileInput.value?.click();
}

async function handleRemove(ecgFileId: string) {
  if (confirm('确定要移除这个心电文件吗？')) {
    await audioStore.clearECG(ecgFileId);
  }
}

async function handleRemoveAll() {
  if (confirm('确定要移除所有心电文件吗？')) {
    await audioStore.clearECG();
  }
}

async function handleRecalibrate(ecgFileId: string) {
  if (confirm('重新校准将重新检测该心电文件的 R 峰位置，确定继续吗？')) {
    const success = await audioStore.recalibrateECG(ecgFileId);
    if (success) {
      alert('重新校准成功！');
    } else {
      alert('重新校准失败');
    }
  }
}

async function handleRecalibrateAll() {
  if (confirm('重新校准将重新检测所有心电文件的 R 峰位置，确定继续吗？')) {
    const result = await audioStore.recalibrateAllECG();
    alert(`重新校准完成：${result.success}/${result.total} 个文件成功`);
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5">
        <svg
          class="w-3.5 h-3.5 text-purple-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <label class="text-xs font-medium text-gray-700">心电对照（可选）</label>
        <span
          v-if="hasECG"
          class="text-xs text-green-600 font-medium"
        >
          ✓ {{ ecgDataList.length }} 个
        </span>
      </div>
      <div
        v-if="hasECG"
        class="flex items-center gap-2"
      >
        <button
          class="text-xs text-purple-600 hover:text-purple-700 transition-colors font-medium"
          :disabled="isProcessingECG"
          @click="triggerFileInput"
        >
          + 添加
        </button>
        <button
          class="text-xs text-blue-600 hover:text-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="isProcessingECG"
          @click="handleRecalibrateAll"
          title="重新检测所有心电文件的 R 峰位置"
        >
          🔄 重新校准
        </button>
        <button
          class="text-xs text-red-500 hover:text-red-700 transition-colors"
          :disabled="isProcessingECG"
          @click="handleRemoveAll"
        >
          移除全部
        </button>
      </div>
    </div>

    <!-- ECG File List (compact) -->
    <div v-if="hasECG" class="space-y-1.5">
      <div
        v-for="ecgData in ecgDataList"
        :key="ecgData.fileId"
        class="p-1.5 bg-purple-50 rounded-md"
      >
        <div class="flex items-center gap-1.5 text-xs">
          <svg class="w-3 h-3 text-purple-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
          </svg>
          <span class="text-purple-700 font-medium truncate flex-1">{{ ecgData.fileName }}</span>
          <span class="text-purple-600 whitespace-nowrap text-xs">{{ ecgData.beats.length }} R峰</span>
          <button
            class="text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isProcessingECG"
            @click="handleRecalibrate(ecgData.fileId)"
            title="重新校准此文件"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            class="text-red-500 hover:text-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isProcessingECG"
            @click="handleRemove(ecgData.fileId)"
            title="移除"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Processing Indicator -->
    <div
      v-if="isProcessingECG"
      class="p-3 bg-blue-50 rounded-md border border-blue-200"
    >
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-blue-700 font-medium">{{ ecgProcessingStage }}</span>
          <span class="text-blue-600">{{ ecgProcessingProgress }}%</span>
        </div>
        <div class="w-full bg-blue-200 rounded-full h-1.5 overflow-hidden">
          <div
            class="bg-blue-600 h-full transition-all duration-300 ease-out"
            :style="{ width: `${ecgProcessingProgress}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Upload Area (compact) -->
    <div
      v-if="!hasECG"
      class="border border-dashed rounded-md p-2 text-center transition-all duration-200 cursor-pointer"
      :class="isDragging 
        ? 'border-purple-500 bg-purple-50' 
        : 'border-gray-300 hover:border-gray-400 bg-gray-50'"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="triggerFileInput"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".wav"
        class="hidden"
        @change="handleFileSelect"
      >
      
      <div class="flex items-center justify-center gap-2">
        <svg
          class="w-4 h-4 text-gray-400"
          :class="{ 'animate-pulse': isUploading }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p class="text-gray-600 text-xs">
          {{ isUploading ? '上传中...' : '上传心电 WAV' }}
        </p>
      </div>
    </div>

    <!-- Hidden file input for adding more ECG files -->
    <input
      v-if="hasECG"
      ref="fileInput"
      type="file"
      accept=".wav"
      class="hidden"
      @change="handleFileSelect"
    >

    <!-- Info (compact) -->
    <div class="text-xs text-gray-400">
      💡 上传心电数据后自动识别 R 峰并矫正心音拍点
    </div>
  </div>
</template>
