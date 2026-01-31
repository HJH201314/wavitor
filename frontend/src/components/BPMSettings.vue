<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAudioStore } from '../stores/audio';
import type { BPMDetectionStrategy, HeartSoundMode, S1S2Mode } from '../utils/bpmDetector';

const audioStore = useAudioStore();
const showAdvancedOptions = ref(false);

const strategies: { value: BPMDetectionStrategy; label: string; description: string }[] = [
  {
    value: 'standard',
    label: '标准',
    description: '快速简单的节拍检测，适合节奏稳定的音乐'
  },
  {
    value: 'advanced',
    label: '高级',
    description: '智能识别 BPM 变化，自动填充遗漏节拍，适合变速音乐'
  },
  {
    value: 'heartsound',
    label: '心音',
    description: '专为心音设计，识别心跳节律，适合心音听诊音频'
  }
];

const heartSoundModes: { value: HeartSoundMode; label: string; description: string }[] = [
  { value: 'simple', label: '简单', description: '快速检测，适合清晰的心音' },
  { value: 'standard', label: '标准', description: '平衡速度与准确度' },
  { value: 'precise', label: '精确', description: '最高精度，适合复杂心音' }
];

const s1s2Modes: { value: S1S2Mode; label: string; description: string }[] = [
  { value: 'auto', label: '自动', description: '智能识别 S1/S2，适应不同情况' },
  { value: 's1-only', label: '仅 S1', description: '只检测 S1 心音，忽略 S2' },
  { value: 's1-s2-pair', label: 'S1-S2 配对', description: '要求 S1-S2 配对出现' }
];

const currentStrategy = computed(() => audioStore.detectionStrategy);
const isHeartSound = computed(() => currentStrategy.value === 'heartsound');

const heartSoundMode = computed({
  get: () => audioStore.heartSoundOptions.mode || 'standard',
  set: (value: HeartSoundMode) => {
    audioStore.updateHeartSoundOptions({ mode: value });
  }
});

const s1s2Mode = computed({
  get: () => audioStore.heartSoundOptions.s1s2Mode || 'auto',
  set: (value: S1S2Mode) => {
    audioStore.updateHeartSoundOptions({ s1s2Mode: value });
  }
});

const sensitivity = computed({
  get: () => audioStore.heartSoundOptions.sensitivity || 0.6,
  set: (value: number) => {
    audioStore.updateHeartSoundOptions({ sensitivity: value });
  }
});

const filterStrength = computed({
  get: () => audioStore.heartSoundOptions.filterStrength || 200,
  set: (value: number) => {
    audioStore.updateHeartSoundOptions({ filterStrength: value });
  }
});

const minBPM = computed({
  get: () => audioStore.heartSoundOptions.minBPM || 40,
  set: (value: number) => {
    audioStore.updateHeartSoundOptions({ minBPM: value });
  }
});

const maxBPM = computed({
  get: () => audioStore.heartSoundOptions.maxBPM || 300,
  set: (value: number) => {
    audioStore.updateHeartSoundOptions({ maxBPM: value });
  }
});

const noiseReduction = computed({
  get: () => audioStore.heartSoundOptions.noiseReduction ?? false,
  set: (value: boolean) => {
    audioStore.updateHeartSoundOptions({ noiseReduction: value });
  }
});

function handleStrategyChange(strategy: BPMDetectionStrategy) {
  audioStore.setDetectionStrategy(strategy);
  if (strategy === 'heartsound') {
    showAdvancedOptions.value = true;
  }
}

async function handleRedetect() {
  await audioStore.redetectBPM();
}

const canRedetect = computed(() => {
  return audioStore.audioBuffer !== null && !audioStore.isDetectingBPM;
});
</script>

<template>
  <div class="bg-white rounded-xl p-4 shadow-sm space-y-3">
    <!-- Main Header with inline controls -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2 flex-shrink-0">
        <svg
          class="w-4 h-4 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
        <h3 class="text-sm font-semibold text-gray-800">BPM 检测</h3>
      </div>

      <!-- Strategy Selector -->
      <div class="flex items-center gap-2 flex-1">
        <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            v-for="strategy in strategies"
            :key="strategy.value"
            class="px-3 py-1 text-xs font-medium rounded-md transition-all"
            :class="currentStrategy === strategy.value 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-600 hover:text-gray-900'"
            :title="strategy.description"
            @click="handleStrategyChange(strategy.value)"
          >
            {{ strategy.label }}
          </button>
        </div>

        <!-- BPM Info -->
        <div
          v-if="audioStore.bpmInfo && !audioStore.isDetectingBPM"
          class="flex items-center gap-3 text-xs ml-2"
        >
          <span class="text-gray-500">
            <span class="font-semibold text-blue-600">{{ audioStore.bpmInfo.bpm }}</span> BPM
          </span>
          <span class="text-gray-400">·</span>
          <span class="text-gray-500">
            <span class="font-semibold text-green-600">{{ audioStore.bpmInfo.beats.length }}</span> 拍
          </span>
          <span class="text-gray-400">·</span>
          <span class="text-gray-500">
            <span class="font-semibold text-purple-600">{{ Math.round(audioStore.bpmInfo.confidence * 100) }}%</span>
          </span>
        </div>

        <!-- Detection Status -->
        <div
          v-if="audioStore.isDetectingBPM"
          class="flex items-center gap-1.5 text-xs text-gray-600 ml-2"
        >
          <svg
            class="w-3.5 h-3.5 animate-spin text-blue-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>{{ audioStore.detectionStage || '检测中' }}...</span>
          <span v-if="audioStore.detectionProgress > 0" class="text-gray-400">
            {{ Math.round(audioStore.detectionProgress * 100) }}%
          </span>
        </div>
      </div>
      
      <!-- Control Buttons -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- Advanced Options Toggle (only for heartsound) -->
        <button
          v-if="isHeartSound"
          class="px-2.5 py-1 text-xs rounded-md transition-colors flex items-center gap-1"
          :class="showAdvancedOptions 
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          @click="showAdvancedOptions = !showAdvancedOptions"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>{{ showAdvancedOptions ? '收起' : '高级' }}</span>
        </button>
        
        <!-- Redetect Button -->
        <button
          v-if="canRedetect"
          class="px-2.5 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors flex items-center gap-1"
          :disabled="audioStore.isDetectingBPM"
          @click="handleRedetect"
        >
          <svg
            class="w-3.5 h-3.5"
            :class="{ 'animate-spin': audioStore.isDetectingBPM }"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>重检</span>
        </button>
      </div>
    </div>

    <!-- Advanced Options for Heart Sound (collapsible) -->
    <div
      v-if="isHeartSound && showAdvancedOptions"
      class="border-t border-gray-100 pt-3 space-y-3 animate-fadeIn"
    >
      <div class="text-xs text-gray-500 mb-2">心音检测高级选项</div>
      
      <!-- S1/S2 Mode Selection -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-700">S1/S2 处理模式</label>
        <div class="flex gap-2">
          <button
            v-for="mode in s1s2Modes"
            :key="mode.value"
            class="flex-1 px-2 py-1.5 text-xs rounded-md transition-all"
            :class="s1s2Mode === mode.value
              ? 'bg-purple-500 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            :title="mode.description"
            @click="s1s2Mode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
        <div class="text-xs text-gray-400 mt-1">
          {{ s1s2Modes.find(m => m.value === s1s2Mode)?.description }}
        </div>
      </div>

      <!-- Heart Rate Range -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-700">心率范围（BPM）</label>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-600">最小</span>
              <span class="text-xs font-semibold text-blue-600">{{ minBPM }}</span>
            </div>
            <input
              v-model.number="minBPM"
              type="range"
              min="30"
              max="150"
              step="5"
              class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
          <div class="space-y-1">
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-600">最大</span>
              <span class="text-xs font-semibold text-blue-600">{{ maxBPM }}</span>
            </div>
            <input
              v-model.number="maxBPM"
              type="range"
              min="100"
              max="350"
              step="10"
              class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>
        <div class="text-xs text-gray-400">
          预估心率范围：{{ minBPM }}-{{ maxBPM }} BPM（可缩小范围提高准确度）
        </div>
      </div>
      
      <!-- Detection Mode -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-700">检测模式</label>
        <div class="flex gap-2">
          <button
            v-for="mode in heartSoundModes"
            :key="mode.value"
            class="flex-1 px-3 py-1.5 text-xs rounded-md transition-all"
            :class="heartSoundMode === mode.value
              ? 'bg-blue-500 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            :title="mode.description"
            @click="heartSoundMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>

      <!-- Sensitivity Slider -->
      <div class="space-y-1.5">
        <div class="flex justify-between items-center">
          <label class="text-xs font-medium text-gray-700">灵敏度</label>
          <span class="text-xs text-gray-500">{{ sensitivity.toFixed(1) }}</span>
        </div>
        <input
          v-model.number="sensitivity"
          type="range"
          min="0.3"
          max="1.0"
          step="0.1"
          class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div class="flex justify-between text-xs text-gray-400">
          <span>低</span>
          <span>高</span>
        </div>
      </div>

      <!-- Filter Strength -->
      <div class="space-y-1.5">
        <div class="flex justify-between items-center">
          <label class="text-xs font-medium text-gray-700">滤波频率</label>
          <span class="text-xs text-gray-500">{{ filterStrength }} Hz</span>
        </div>
        <input
          v-model.number="filterStrength"
          type="range"
          min="150"
          max="250"
          step="10"
          class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div class="flex justify-between text-xs text-gray-400">
          <span>150 Hz</span>
          <span>250 Hz</span>
        </div>
      </div>

      <!-- Toggle Options -->
      <div class="space-y-2">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            v-model="noiseReduction"
            type="checkbox"
            class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span class="text-xs text-gray-700">启用降噪处理</span>
          <span class="text-xs text-gray-400">(长音频建议关闭)</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fadeIn {
  animation: fadeIn 0.2s ease-out;
}
</style>
