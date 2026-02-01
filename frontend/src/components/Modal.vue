<script setup lang="ts">
import { ref, watch } from 'vue';

interface Props {
  show: boolean;
  title?: string;
  width?: string;
  showCancel?: boolean;
  showConfirm?: boolean;
  cancelText?: string;
  confirmText?: string;
  confirmVariant?: 'primary' | 'success' | 'danger' | 'warning';
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  width: '480px',
  showCancel: true,
  showConfirm: true,
  cancelText: '取消',
  confirmText: '确定',
  confirmVariant: 'primary'
});

const emit = defineEmits<{
  close: [];
  confirm: [];
  cancel: [];
}>();

const isVisible = ref(props.show);

watch(() => props.show, (newVal) => {
  isVisible.value = newVal;
});

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    handleClose();
  }
}

function handleClose() {
  emit('close');
  emit('cancel');
}

function handleConfirm() {
  emit('confirm');
}

// 按键监听
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    handleClose();
  }
}

watch(isVisible, (newVal) => {
  if (newVal) {
    document.addEventListener('keydown', handleKeydown);
    document.body.style.overflow = 'hidden';
  } else {
    document.removeEventListener('keydown', handleKeydown);
    document.body.style.overflow = '';
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="isVisible"
        class="modal-backdrop"
        @click="handleBackdropClick"
      >
        <div
          class="modal-container"
          :style="{ maxWidth: width }"
        >
          <!-- 标题栏 -->
          <div v-if="title || $slots.header" class="modal-header">
            <slot name="header">
              <h3 class="modal-title">{{ title }}</h3>
            </slot>
            <button
              class="modal-close-btn"
              @click="handleClose"
              title="关闭"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 内容区域 -->
          <div class="modal-body">
            <slot />
          </div>

          <!-- 底部按钮 -->
          <div v-if="showCancel || showConfirm || $slots.footer" class="modal-footer">
            <slot name="footer">
              <button
                v-if="showCancel"
                class="modal-btn modal-btn-cancel"
                @click="handleClose"
              >
                {{ cancelText }}
              </button>
              <button
                v-if="showConfirm"
                class="modal-btn"
                :class="`modal-btn-${confirmVariant}`"
                @click="handleConfirm"
              >
                {{ confirmText }}
              </button>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  background-color: rgba(0, 0, 0, 0.4);
  transition: backdrop-filter 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-container {
  position: relative;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 
              0 10px 10px -5px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.modal-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  color: #6b7280;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
  background: transparent;
  cursor: pointer;
}

.modal-close-btn:hover {
  background-color: #f3f4f6;
  color: #111827;
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.modal-btn {
  flex: 1;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.modal-btn-cancel {
  background-color: #f3f4f6;
  color: #374151;
}

.modal-btn-cancel:hover {
  background-color: #e5e7eb;
}

.modal-btn-primary {
  background-color: #3b82f6;
  color: white;
}

.modal-btn-primary:hover {
  background-color: #2563eb;
}

.modal-btn-success {
  background-color: #10b981;
  color: white;
}

.modal-btn-success:hover {
  background-color: #059669;
}

.modal-btn-danger {
  background-color: #ef4444;
  color: white;
}

.modal-btn-danger:hover {
  background-color: #dc2626;
}

.modal-btn-warning {
  background-color: #f59e0b;
  color: white;
}

.modal-btn-warning:hover {
  background-color: #d97706;
}

/* 动画 */
.modal-enter-active {
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-leave-active {
  transition: opacity 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-active .modal-container {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-leave-active .modal-container {
  transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.modal-enter-from {
  opacity: 0;
}

.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container {
  transform: scale(0.9) translateY(-20px);
  opacity: 0;
}

.modal-leave-to .modal-container {
  transform: scale(0.95) translateY(-10px);
  opacity: 0;
}

/* 响应式 */
@media (max-width: 640px) {
  .modal-container {
    max-height: 95vh;
  }
  
  .modal-header {
    padding: 1rem;
  }
  
  .modal-body {
    padding: 1rem;
  }
  
  .modal-footer {
    padding: 0.75rem 1rem;
  }
  
  .modal-title {
    font-size: 1rem;
  }
}
</style>
