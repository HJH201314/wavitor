<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue';
import { useAudioStore } from '../stores/audio';
import Modal from './Modal.vue';

const audioStore = useAudioStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);

const canvasWidth = ref(800);
const canvasHeight = ref(200); // 默认高度改为 200，支持动态调整
const minHeight = 120;
const maxHeight = 600;

// 显示控制
const showExportDialog = ref(false);
const showDisplaySettings = ref(false);

// 显示模式：原始点或按秒采样
type DisplayMode = 'points' | 'seconds';
const displayMode = ref<DisplayMode>('points');
const samplingWindowSize = ref(3); // 按秒采样时的窗口大小

// 计算用于显示的 BPM 数据
const displayBPMs = computed(() => {
  if (displayMode.value === 'points') {
    return audioStore.bpmInfo?.localBPMs || [];
  } else {
    // 按秒采样模式
    return calculateSecondBasedBPMs();
  }
});

// 按秒计算 BPM
function calculateSecondBasedBPMs(): { time: number; bpm: number }[] {
  const beats = audioStore.beats || [];
  const duration = audioStore.duration || 0;
  
  if (beats.length < 2 || duration === 0) {
    return [];
  }

  const windowSize = samplingWindowSize.value;
  const totalSeconds = Math.ceil(duration);
  const result: { time: number; bpm: number }[] = [];

  for (let second = 0; second < totalSeconds; second++) {
    // 该秒的时间范围 [second, second+1)
    const secondStart = second;
    const secondEnd = second + 1;
    
    // 扩展窗口：以该秒为中心，向前后各扩展
    const halfWindow = (windowSize - 1) / 2; // 减1是因为已经包含该秒本身
    const windowStart = secondStart - halfWindow;
    const windowEnd = secondEnd + halfWindow;

    // 找到扩展窗口内的所有节拍
    const beatsInWindow = beats.filter(
      beat => beat >= windowStart && beat < windowEnd
    );

    if (beatsInWindow.length >= 2) {
      // 计算窗口内所有节拍的平均间隔
      let totalInterval = 0;
      for (let i = 1; i < beatsInWindow.length; i++) {
        totalInterval += beatsInWindow[i] - beatsInWindow[i - 1];
      }
      const avgInterval = totalInterval / (beatsInWindow.length - 1);
      
      // 转换为 BPM（该秒的平均心率）
      const bpm = Math.round(60 / avgInterval);
      result.push({ time: second, bpm });
    } else if (beatsInWindow.length === 1) {
      // 只有一个节拍，使用全局平均
      const avgBPM = audioStore.bpmInfo?.bpm || 0;
      result.push({ time: second, bpm: avgBPM });
    } else {
      // 没有节拍
      result.push({ time: second, bpm: 0 });
    }
  }

  return result;
}

// 计算 BPM 范围
const bpmRange = computed(() => {
  const localBPMs = displayBPMs.value;
  if (localBPMs.length === 0) return { min: 60, max: 200 };
  
  const bpms = localBPMs.map(p => p.bpm).filter(bpm => bpm > 0);
  if (bpms.length === 0) return { min: 60, max: 200 };
  
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

// 导出数据
function exportBPMData() {
  // 构建每一秒的BPM数组
  const duration = audioStore.duration || 0;
  if (duration === 0) return;
  
  const bpmArray: number[] = [];
  const points = displayBPMs.value;
  
  // 为每一秒填充BPM值
  for (let second = 0; second < Math.ceil(duration); second++) {
    // 找到最接近这一秒的BPM点
    let closestPoint = points[0];
    let minDistance = Math.abs(points[0].time - second);
    
    for (const point of points) {
      const distance = Math.abs(point.time - second);
      if (distance < minDistance) {
        minDistance = distance;
        closestPoint = point;
      }
      // 如果已经超过当前秒，不需要继续查找
      if (point.time > second) break;
    }
    
    bpmArray.push(Math.round(closestPoint.bpm));
  }
  
  const json = JSON.stringify(bpmArray, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  const mode = displayMode.value === 'points' ? 'points' : `${samplingWindowSize.value}s`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  a.download = `bpm-curve-${mode}-${timestamp}.json`;
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showExportDialog.value = false;
}

function drawChart() {
  const canvas = canvasRef.value;
  const localBPMs = displayBPMs.value;
  
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

// Convert x position to time
function xToTime(x: number): number {
  const padding = { left: 40, right: 20, top: 15, bottom: 25 };
  const chartWidth = canvasWidth.value - padding.left - padding.right;
  const duration = audioStore.duration || 0;
  
  // Check if click is within chart area
  if (x < padding.left || x > padding.left + chartWidth) {
    return -1; // Outside chart area
  }
  
  const percent = (x - padding.left) / chartWidth;
  return percent * duration;
}

// Handle canvas click to seek
function handleCanvasClick(e: MouseEvent) {
  const duration = audioStore.duration || 0;
  if (!duration || !canvasRef.value) return;
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const clickedTime = xToTime(x);
  
  // Only seek if click is within chart area
  if (clickedTime >= 0 && clickedTime <= duration) {
    audioStore.setCurrentTime(clickedTime);
    
    // Dispatch seek event to update audio element
    const event = new CustomEvent('seek', { detail: clickedTime });
    window.dispatchEvent(event);
  }
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
watch(() => [audioStore.bpmInfo, audioStore.currentTime, audioStore.beats, displayMode.value, samplingWindowSize.value], async () => {
  // 如果是 bpmInfo 首次加载，确保尺寸正确
  if (audioStore.bpmInfo && canvasWidth.value === 800) {
    await nextTick();
    updateCanvasSize();
  } else {
    drawChart();
  }
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

onMounted(async () => {
  // 等待 DOM 完全渲染后再更新尺寸
  await nextTick();
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
  
  // 如果首次更新后宽度仍然不对，延迟再试一次
  if (containerRef.value && canvasWidth.value === 800) {
    setTimeout(() => {
      updateCanvasSize();
    }, 50);
  }
});

onUnmounted(() => {
  stopAnimationLoop();
  window.removeEventListener('resize', updateCanvasSize);
});
</script>

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

<template>
  <div 
    v-if="audioStore.bpmInfo && audioStore.beats.length > 0"
    ref="containerRef"
    class="bg-white rounded-xl p-4 md:p-6 shadow-sm max-w-full overflow-hidden"
  >
    <div class="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div class="flex items-center gap-2 md:gap-3 flex-wrap">
        <h3 class="text-sm font-medium text-gray-500">
          BPM 时间曲线
        </h3>
        <span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded whitespace-nowrap">
          {{ displayBPMs.length }} 个采样点
        </span>
        <div class="text-xs text-gray-400 whitespace-nowrap">
          范围: {{ bpmRange.min }} - {{ bpmRange.max }} BPM
        </div>
      </div>
      
      <div class="flex items-center gap-2 md:gap-3 flex-wrap">
        <!-- 显示设置按钮 -->
        <button
          @click="showDisplaySettings = !showDisplaySettings"
          class="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
          :class="showDisplaySettings 
            ? 'bg-blue-100 text-blue-700' 
            : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'"
          title="显示设置"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <span class="hidden sm:inline">{{ showDisplaySettings ? '收起' : '设置' }}</span>
        </button>
        
        <!-- 高度调整控件 -->
        <div class="flex items-center gap-1.5 border-l pl-2 md:pl-3 border-gray-200">
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
          <span class="text-xs text-gray-500 min-w-[2.5rem] md:min-w-[3rem] text-center">{{ canvasHeight }}px</span>
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
          @click="showExportDialog = true"
          class="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors whitespace-nowrap"
          title="导出数据"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span class="hidden sm:inline">导出数据</span>
          <span class="inline sm:hidden">导出</span>
        </button>
        
        <!-- 导出图片按钮 -->
        <button
          @click="exportAsImage"
          class="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
          title="导出为图片"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span class="hidden sm:inline">导出图片</span>
        </button>
      </div>
    </div>

    <!-- 显示设置面板 -->
    <div
      v-if="showDisplaySettings"
      class="mb-4 p-4 bg-gray-50 rounded-lg space-y-3 animate-fadeIn"
    >
      <div class="text-xs font-medium text-gray-700 mb-2">显示模式</div>
      
      <!-- 模式选择 -->
      <div class="flex gap-2">
        <button
          @click="displayMode = 'points'"
          class="flex-1 px-3 py-2 text-xs rounded-lg transition-all"
          :class="displayMode === 'points'
            ? 'bg-blue-500 text-white shadow-sm'
            : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'"
        >
          <div class="font-medium">原始节拍点</div>
          <div class="text-xs opacity-80 mt-0.5">
            {{ audioStore.bpmInfo?.localBPMs?.length || 0 }} 个点
          </div>
        </button>
        <button
          @click="displayMode = 'seconds'"
          class="flex-1 px-3 py-2 text-xs rounded-lg transition-all"
          :class="displayMode === 'seconds'
            ? 'bg-blue-500 text-white shadow-sm'
            : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'"
        >
          <div class="font-medium">按秒采样</div>
          <div class="text-xs opacity-80 mt-0.5">
            {{ Math.ceil(audioStore.duration) }} 个点
          </div>
        </button>
      </div>

      <!-- 窗口大小调节（仅在按秒模式下显示） -->
      <div v-if="displayMode === 'seconds'" class="space-y-2 pt-2 border-t border-gray-200">
        <div class="flex justify-between items-center">
          <label class="text-xs font-medium text-gray-700">计算窗口</label>
          <span class="text-xs font-semibold text-blue-600">{{ samplingWindowSize }}s</span>
        </div>
        <input
          v-model.number="samplingWindowSize"
          type="range"
          min="1"
          max="10"
          step="1"
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <div class="text-xs text-gray-500">
          以第 n 秒为中心的 {{ samplingWindowSize }}s 窗口内节拍的平均 BPM
        </div>
      </div>
    </div>
    
    <canvas
      ref="canvasRef"
      :style="{ width: '100%', height: canvasHeight + 'px' }"
      class="bg-gray-50 rounded-lg cursor-pointer"
      @click="handleCanvasClick"
      title="点击跳转到指定位置"
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

    <!-- 导出对话框 -->
    <Modal
      :show="showExportDialog"
      title="导出 BPM 曲线数据"
      width="480px"
      confirm-text="导出 JSON"
      confirm-variant="success"
      @close="showExportDialog = false"
      @confirm="exportBPMData"
    >
      <div class="space-y-4">
        <div class="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-600">显示模式：</span>
            <span class="font-medium text-gray-800">
              {{ displayMode === 'points' ? '原始节拍点' : '按秒采样' }}
            </span>
          </div>
          <div v-if="displayMode === 'seconds'" class="flex justify-between">
            <span class="text-gray-600">计算窗口：</span>
            <span class="font-medium text-gray-800">{{ samplingWindowSize }} 秒</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">数据点数：</span>
            <span class="font-medium text-blue-600">{{ displayBPMs.length }} 个</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-600">时长范围：</span>
            <span class="font-medium text-gray-800">0 - {{ Math.ceil(audioStore.duration) }}s</span>
          </div>
        </div>

        <div class="text-xs text-gray-500 space-y-1">
          <div class="font-medium text-gray-700 mb-1">数据格式：</div>
          <div>• 每个数据点包含 time（时间）和 bpm（BPM值）</div>
          <div>• JSON 格式，可直接用于数据分析</div>
          <div v-if="displayMode === 'seconds'">• 按秒采样，适合时序分析</div>
          <div v-else>• 基于实际节拍，适合详细分析</div>
        </div>
      </div>
    </Modal>
  </div>
</template>
