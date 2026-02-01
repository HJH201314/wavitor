<script setup lang="ts">
import { ref, watch } from 'vue';
import Modal from './Modal.vue';

interface Props {
  show: boolean;
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  confirmText?: string;
  showCancel?: boolean;
  cancelText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '提示',
  type: 'info',
  confirmText: '确定',
  showCancel: false,
  cancelText: '取消'
});

const emit = defineEmits<{
  close: [confirmed: boolean];
}>();

const isVisible = ref(props.show);

watch(() => props.show, (newVal) => {
  isVisible.value = newVal;
});

const iconMap = {
  info: {
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    class: 'text-blue-500 bg-blue-100'
  },
  success: {
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    class: 'text-green-500 bg-green-100'
  },
  warning: {
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    class: 'text-yellow-500 bg-yellow-100'
  },
  error: {
    icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    class: 'text-red-500 bg-red-100'
  }
};

const currentIcon = iconMap[props.type];

const confirmVariant = props.type === 'error' || props.type === 'warning' 
  ? (props.type === 'error' ? 'danger' : 'warning')
  : (props.type === 'success' ? 'success' : 'primary');

function handleClose() {
  emit('close', false);
}

function handleConfirm() {
  emit('close', true);
}
</script>

<template>
  <Modal
    :show="isVisible"
    :title="title"
    width="420px"
    :show-cancel="showCancel"
    :cancel-text="cancelText"
    :confirm-text="confirmText"
    :confirm-variant="confirmVariant"
    @close="handleClose"
    @confirm="handleConfirm"
  >
    <div class="flex items-start gap-3">
      <div 
        class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
        :class="currentIcon.class"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path 
            stroke-linecap="round" 
            stroke-linejoin="round" 
            stroke-width="2" 
            :d="currentIcon.icon"
          />
        </svg>
      </div>
      <div class="flex-1 pt-1">
        <p class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
          {{ message }}
        </p>
      </div>
    </div>
  </Modal>
</template>
