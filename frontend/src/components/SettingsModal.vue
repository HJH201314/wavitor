<script setup lang="ts">
import { useUIStore } from '../stores/ui';

defineProps<{
  show: boolean
}>();

const emit = defineEmits<{
  close: []
}>();

const uiStore = useUIStore();

function close() {
  emit('close');
}
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      @click.self="close"
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50" @click="close" />
      
      <!-- Modal -->
      <div class="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto">
        <!-- Header -->
        <div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-2xl">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-semibold text-gray-800">
              设置
            </h2>
            <button
              class="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              @click="close"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        <!-- Content -->
        <div class="p-6 space-y-6">
          <!-- Mobile UI Section -->
          <div>
            <h3 class="text-sm font-semibold text-gray-700 mb-3">
              移动端界面
            </h3>
            
            <div class="space-y-3">
              <!-- Bottom Navigation Toggle -->
              <div class="flex items-center justify-between py-2">
                <div>
                  <div class="text-sm font-medium text-gray-700">
                    底部导航栏
                  </div>
                  <div class="text-xs text-gray-500 mt-0.5">
                    显示快速访问导航栏
                  </div>
                </div>
                <button
                  class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  :class="uiStore.showBottomNav ? 'bg-blue-600' : 'bg-gray-300'"
                  @click="uiStore.toggleBottomNav"
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                    :class="uiStore.showBottomNav ? 'translate-x-6' : 'translate-x-1'"
                  />
                </button>
              </div>
            </div>
          </div>
          
          <!-- App Info Section -->
          <div class="pt-4 border-t border-gray-200">
            <h3 class="text-sm font-semibold text-gray-700 mb-3">
              关于
            </h3>
            <div class="text-sm text-gray-600 space-y-2">
              <p><strong>Wavitor</strong></p>
              <p class="text-xs text-gray-500">音频播放与可视化工具</p>
              <p class="text-xs text-gray-500">支持 BPM 检测、波形编辑、ECG 对照等功能</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-active .relative,
.modal-leave-active .relative {
  transition: transform 0.3s ease, opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .relative,
.modal-leave-to .relative {
  transform: scale(0.95);
  opacity: 0;
}
</style>
