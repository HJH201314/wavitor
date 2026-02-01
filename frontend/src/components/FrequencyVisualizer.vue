<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useAudioStore } from '../stores/audio';

const audioStore = useAudioStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const animationIdRef = ref<number | null>(null);

const canvasWidth = ref(800);
const canvasHeight = 120;

function drawFrequency() {
  const analyser = audioStore.analyserNode;
  if (!canvasRef.value || !analyser) return;
  
  const canvas = canvasRef.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvasWidth.value * dpr;
  canvas.height = canvasHeight * dpr;
  ctx.scale(dpr, dpr);
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function draw() {
    if (!ctx || !analyser) return;
    
    animationIdRef.value = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeight);
    
    const barWidth = canvasWidth.value / bufferLength * 2.5;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvasHeight;
      
      // Gradient from blue to purple
      const hue = 220 + (i / bufferLength) * 40;
      ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
      
      ctx.fillRect(x, canvasHeight - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  }
  
  draw();
}

function stopAnimation() {
  if (animationIdRef.value) {
    cancelAnimationFrame(animationIdRef.value);
    animationIdRef.value = null;
  }
}

function clearCanvas() {
  if (!canvasRef.value) return;
  const ctx = canvasRef.value.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeight);
  }
}

function updateCanvasSize() {
  if (containerRef.value) {
    canvasWidth.value = containerRef.value.clientWidth;
  }
}

watch(() => audioStore.isPlaying, (isPlaying) => {
  if (isPlaying && audioStore.analyserNode) {
    drawFrequency();
  } else {
    stopAnimation();
    clearCanvas();
  }
});

watch(() => audioStore.analyserNode, (analyser) => {
  if (analyser && audioStore.isPlaying) {
    drawFrequency();
  }
});

onMounted(() => {
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
});

onUnmounted(() => {
  stopAnimation();
  window.removeEventListener('resize', updateCanvasSize);
});
</script>

<template>
  <div 
    v-if="audioStore.audioUrl"
    ref="containerRef"
    class="bg-white rounded-xl p-4 md:p-6 shadow-sm max-w-full overflow-hidden"
  >
    <h3 class="text-sm font-medium text-gray-500 mb-4">
      频谱图
    </h3>
    
    <canvas
      ref="canvasRef"
      :style="{ width: '100%', height: canvasHeight + 'px' }"
      class="w-full bg-gray-50 rounded-lg max-w-full"
    />
    
    <p
      v-if="!audioStore.isPlaying"
      class="text-xs text-gray-400 mt-2 text-center"
    >
      播放音频时显示实时频谱
    </p>
  </div>
</template>
