<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useAudioStore } from '../stores/audio';

const audioStore = useAudioStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

const canvasWidth = ref(800);
const canvasHeight = ref(200); // 默认高度改为 200，支持动态调整
const minHeight = 120;
const maxHeight = 600;

// 计算 BPM 范围
const bpmRange = computed(() => {
  const localBPMs = audioStore.bpmInfo?.localBPMs || [];
  if (localBPMs.length === 0) return { min: 60, max: 200 };
  
  const bpms = localBPMs.map(p => p.bpm);
  const min = Math.min(...bpms);
  const max = Math.max(...bpms);
  
  // 添加一点上下边距（5%）
  const range = max - min;
  const padding = range * 0.1 || 10;
  
  return {
    min: Math.max(0, Math.floor(min - padding)),
    max: Math.ceil(max + padding),
  };
});

// 平均 BPM 线
const avgBPM = computed(() => audioStore.bpmInfo?.bpm || 0);

function drawChart() {
  const canvas = canvasRef.value;
  const localBPMs = audioStore.bpmInfo?.localBPMs || [];
  
  if (!canvas || localBPMs.length === 0) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvasWidth.value * dpr;
  canvas.height = canvasHeight.value * dpr;
  ctx.scale(dpr, dpr);
  
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value);
  
  const duration = audioStore.duration || 0;
  if (duration === 0) return;
  
  const { min: minBPM, max: maxBPM } = bpmRange.value;
  const bpmSpan = maxBPM - minBPM;
  
  // 绘制背景网格
  drawGrid(ctx, duration, minBPM, maxBPM, bpmSpan);
  
  // 绘制平均 BPM 参考线
  if (avgBPM.value > 0) {
    drawAverageLine(ctx, avgBPM.value, minBPM, bpmSpan);
  }
  
  // 绘制 BPM 曲线
  drawBPMCurve(ctx, localBPMs, duration, minBPM, bpmSpan);
  
  // 绘制当前播放位置
  drawPlayhead(ctx, duration, minBPM, bpmSpan);
}

function drawGrid(ctx: CanvasRenderingContext2D, duration: number, minBPM: number, maxBPM: number, bpmSpan: number) {
  const padding = { left: 40, right: 20, top: 15, bottom: 25 };
  const chartWidth = canvasWidth.value - padding.left - padding.right;
  const chartHeight = canvasHeight.value - padding.top - padding.bottom;
  
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px system-ui';
  
  // 水平网格线（BPM 刻度）
  const bpmStep = bpmSpan < 20 ? 5 : bpmSpan < 50 ? 10 : 20;
  for (let bpm = Math.ceil(minBPM / bpmStep) * bpmStep; bpm <= maxBPM; bpm += bpmStep) {
    const y = padding.top + chartHeight * (1 - (bpm - minBPM) / bpmSpan);
    
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
    
    // Y 轴标签
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(bpm.toString(), padding.left - 5, y);
  }
  
  // 垂直网格线（时间刻度）
  const timeStep = duration <= 30 ? 5 : duration <= 120 ? 15 : 30;
  for (let t = 0; t <= duration; t += timeStep) {
    const x = padding.left + (t / duration) * chartWidth;
    
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
    
    // X 轴标签
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(formatTime(t), x, padding.top + chartHeight + 5);
  }
  
  // 绘制坐标轴边框
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(padding.left, padding.top, chartWidth, chartHeight);
  
  // Y 轴标题
  ctx.save();
  ctx.translate(12, padding.top + chartHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4b5563';
  ctx.font = '11px system-ui';
  ctx.fillText('BPM', 0, 0);
  ctx.restore();
  
  // X 轴标题
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#4b5563';
  ctx.font = '11px system-ui';
  ctx.fillText('时间', padding.left + chartWidth / 2, canvasHeight.value - 2);
}

function drawAverageLine(ctx: CanvasRenderingContext2D, avgBPM: number, minBPM: number, bpmSpan: number) {
  const padding = { left: 40, right: 20, top: 15, bottom: 25 };
  const chartWidth = canvasWidth.value - padding.left - padding.right;
  const chartHeight = canvasHeight.value - padding.top - padding.bottom;
  
  const y = padding.top + chartHeight * (1 - (avgBPM - minBPM) / bpmSpan);
  
  // 虚线
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  
  ctx.beginPath();
  ctx.moveTo(padding.left, y);
  ctx.lineTo(padding.left + chartWidth, y);
  ctx.stroke();
  
  ctx.setLineDash([]);
  
  // 标签
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`平均 ${avgBPM}`, canvasWidth.value - padding.right - 5, y - 2);
}

function drawBPMCurve(ctx: CanvasRenderingContext2D, localBPMs: { time: number; bpm: number }[], duration: number, minBPM: number, bpmSpan: number) {
  const padding = { left: 40, right: 20, top: 15, bottom: 25 };
  const chartWidth = canvasWidth.value - padding.left - padding.right;
  const chartHeight = canvasHeight.value - padding.top - padding.bottom;
  
  if (localBPMs.length === 0) return;
  
  // 绘制曲线下方的渐变填充
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)');
  
  ctx.beginPath();
  
  // 起始点
  const firstX = padding.left + (localBPMs[0].time / duration) * chartWidth;
  const firstY = padding.top + chartHeight * (1 - (localBPMs[0].bpm - minBPM) / bpmSpan);
  ctx.moveTo(firstX, firstY);
  
  // 绘制曲线点
  for (let i = 0; i < localBPMs.length; i++) {
    const point = localBPMs[i];
    const x = padding.left + (point.time / duration) * chartWidth;
    const y = padding.top + chartHeight * (1 - (point.bpm - minBPM) / bpmSpan);
    
    if (i === 0) {
      ctx.lineTo(x, y);
    } else {
      // 使用贝塞尔曲线平滑连接
      const prevPoint = localBPMs[i - 1];
      const prevX = padding.left + (prevPoint.time / duration) * chartWidth;
      const prevY = padding.top + chartHeight * (1 - (prevPoint.bpm - minBPM) / bpmSpan);
      
      const cpX = (prevX + x) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
      ctx.lineTo(x, y);
    }
  }
  
  // 完成填充区域
  const lastX = padding.left + (localBPMs[localBPMs.length - 1].time / duration) * chartWidth;
  ctx.lineTo(lastX, padding.top + chartHeight);
  ctx.lineTo(firstX, padding.top + chartHeight);
  ctx.closePath();
  
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // 绘制曲线边线
  ctx.beginPath();
  ctx.moveTo(firstX, firstY);
  
  for (let i = 0; i < localBPMs.length; i++) {
    const point = localBPMs[i];
    const x = padding.left + (point.time / duration) * chartWidth;
    const y = padding.top + chartHeight * (1 - (point.bpm - minBPM) / bpmSpan);
    
    if (i === 0) {
      ctx.lineTo(x, y);
    } else {
      const prevPoint = localBPMs[i - 1];
      const prevX = padding.left + (prevPoint.time / duration) * chartWidth;
      const prevY = padding.top + chartHeight * (1 - (prevPoint.bpm - minBPM) / bpmSpan);
      
      const cpX = (prevX + x) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
      ctx.lineTo(x, y);
    }
  }
  
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  
  // 绘制数据点
  for (const point of localBPMs) {
    const x = padding.left + (point.time / duration) * chartWidth;
    const y = padding.top + chartHeight * (1 - (point.bpm - minBPM) / bpmSpan);
    
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, duration: number, minBPM: number, bpmSpan: number) {
  const padding = { left: 40, right: 20, top: 15, bottom: 25 };
  const chartWidth = canvasWidth.value - padding.left - padding.right;
  const chartHeight = canvasHeight.value - padding.top - padding.bottom;
  
  const currentTime = audioStore.currentTime;
  if (currentTime <= 0 || currentTime > duration) return;
  
  const x = padding.left + (currentTime / duration) * chartWidth;
  
  // 绘制播放位置线
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  
  ctx.beginPath();
  ctx.moveTo(x, padding.top);
  ctx.lineTo(x, padding.top + chartHeight);
  ctx.stroke();
  
  // 绘制当前 BPM 值（如果有的话）
  const localBPMs = audioStore.bpmInfo?.localBPMs || [];
  if (localBPMs.length > 0) {
    // 找到最接近当前时间的 BPM 值
    let closestBPM = localBPMs[0];
    let minDist = Math.abs(localBPMs[0].time - currentTime);
    
    for (const point of localBPMs) {
      const dist = Math.abs(point.time - currentTime);
      if (dist < minDist) {
        minDist = dist;
        closestBPM = point;
      }
    }
    
    // 如果距离足够近，显示当前 BPM
    if (minDist < 2) {
      const y = padding.top + chartHeight * (1 - (closestBPM.bpm - minBPM) / bpmSpan);
      
      // 绘制圆点
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 显示 BPM 值
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = x > canvasWidth.value / 2 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      const textX = x + (x > canvasWidth.value / 2 ? -8 : 8);
      ctx.fillText(`${closestBPM.bpm} BPM`, textX, y - 5);
    }
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateCanvasSize() {
  if (containerRef.value) {
    // 获取容器的实际宽度（减去 padding）
    const containerWidth = containerRef.value.clientWidth;
    const computedStyle = window.getComputedStyle(containerRef.value);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const newWidth = containerWidth - paddingLeft - paddingRight;
    
    if (newWidth > 0 && newWidth !== canvasWidth.value) {
      canvasWidth.value = newWidth;
      drawChart();
    }
  }
}

// 导出为图片
function exportAsImage() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  
  try {
    // 创建下载链接
    canvas.toBlob((blob) => {
      if (!blob) return;
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.download = `bpm-curve-${timestamp}.png`;
      link.href = url;
      link.click();
      
      // 清理
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (error) {
    console.error('导出图片失败:', error);
  }
}

// 调整高度
function adjustHeight(delta: number) {
  const newHeight = canvasHeight.value + delta;
  if (newHeight >= minHeight && newHeight <= maxHeight) {
    canvasHeight.value = newHeight;
    drawChart();
  }
}

// 监听数据变化
watch(() => [audioStore.bpmInfo, audioStore.currentTime], () => {
  drawChart();
}, { deep: true });

// 动画循环（仅在播放时）
let animationFrameId: number | null = null;

function startAnimationLoop() {
  function loop() {
    drawChart();
    animationFrameId = requestAnimationFrame(loop);
  }
  loop();
}

function stopAnimationLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

watch(() => audioStore.isPlaying, (isPlaying) => {
  if (isPlaying) {
    startAnimationLoop();
  } else {
    stopAnimationLoop();
    drawChart();
  }
});

onMounted(() => {
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
  
  if (audioStore.bpmInfo) {
    drawChart();
  }
});

onUnmounted(() => {
  stopAnimationLoop();
  window.removeEventListener('resize', updateCanvasSize);
});
</script>

<template>
  <div 
    v-if="audioStore.bpmInfo && audioStore.bpmInfo.localBPMs.length > 0"
    ref="containerRef"
    class="bg-white rounded-xl p-6 shadow-sm"
  >
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-medium text-gray-500">
          BPM 时间曲线
        </h3>
        <span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
          {{ audioStore.bpmInfo.localBPMs.length }} 个采样点
        </span>
      </div>
      
      <div class="flex items-center gap-3">
        <div class="text-xs text-gray-400">
          范围: {{ bpmRange.min }} - {{ bpmRange.max }} BPM
        </div>
        
        <!-- 高度调整控件 -->
        <div class="flex items-center gap-1.5 border-l pl-3 border-gray-200">
          <button
            @click="adjustHeight(-50)"
            :disabled="canvasHeight <= minHeight"
            class="p-1.5 rounded hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="减小高度"
          >
            <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
            </svg>
          </button>
          <span class="text-xs text-gray-500 min-w-[3rem] text-center">{{ canvasHeight }}px</span>
          <button
            @click="adjustHeight(50)"
            :disabled="canvasHeight >= maxHeight"
            class="p-1.5 rounded hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="增加高度"
          >
            <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        
        <!-- 导出按钮 -->
        <button
          @click="exportAsImage"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          title="导出为图片"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>导出图片</span>
        </button>
      </div>
    </div>
    
    <canvas
      ref="canvasRef"
      :style="{ width: '100%', height: canvasHeight + 'px' }"
      class="bg-gray-50 rounded-lg"
    />
    
    <div class="mt-3 flex items-center justify-center gap-4 text-xs text-gray-500">
      <div class="flex items-center gap-1.5">
        <div class="w-3 h-0.5 bg-blue-500" />
        <span>实时 BPM</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="w-3 h-0.5 border-t-2 border-dashed border-amber-500" />
        <span>平均值</span>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="w-0.5 h-3 bg-red-500" />
        <span>播放位置</span>
      </div>
    </div>
  </div>
</template>
