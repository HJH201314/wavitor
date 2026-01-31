<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useAudioStore } from '../stores/audio';
import { useWorkspaceStore } from '../stores/workspace';

const audioStore = useAudioStore();
const workspaceStore = useWorkspaceStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const waveformData = ref<Float32Array | null>(null);
const isLoading = ref(false);
const localAudioBuffer = ref<AudioBuffer | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

const canvasWidth = ref(800);
const canvasHeight = 150;

// Window duration in seconds (adjustable 1s ~ audio duration)
const windowDuration = ref(8);
const minWindowDuration = 1;

// Max window duration is computed based on audio length
const maxWindowDuration = computed(() => {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 60;
  return Math.max(minWindowDuration, Math.ceil(duration));
});

// View offset - allows scrolling to view different parts of the waveform
// 0 = centered on current playhead, negative = past, positive = future
const viewOffset = ref(0);

// Fixed view center time when not following playhead
const fixedViewCenterTime = ref(0);

// Auto-follow playhead when playing
const autoFollow = ref(true);

// Scrollbar drag state
const isDragging = ref(false);

// Real-time position for smooth animation (updated in animation loop)
const realTimePosition = ref(0);

// Edit mode for adding/removing beats
const isEditMode = ref(false);

// Beat dragging state
const isDraggingBeat = ref(false);
const draggingBeatTime = ref<number | null>(null);
const draggingBeatOriginalTime = ref<number | null>(null); // Store original position for history

// Total beats count
const totalBeatsCount = computed(() => audioStore.getAllBeats().length);

// Pixels per second for rendering
const pixelsPerSecond = computed(() => canvasWidth.value / windowDuration.value);

// Scrollbar position (0-1) - uses realTimePosition for smooth animation
const scrollPosition = computed(() => {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (duration === 0) return 0;
  
  // Use fixed center time when not following
  const centerTime = autoFollow.value 
    ? realTimePosition.value + viewOffset.value 
    : fixedViewCenterTime.value;
  return Math.max(0, Math.min(1, centerTime / duration));
});

// Scrollbar thumb width based on window/total ratio
const scrollThumbWidth = computed(() => {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (duration === 0) return 100;
  return Math.max(10, Math.min(100, (windowDuration.value / duration) * 100));
});

async function loadAudioBuffer() {
  if (!audioStore.audioFile) return;
  
  isLoading.value = true;
  waveformData.value = null;
  viewOffset.value = 0;
  
  try {
    const decodeContext = new AudioContext();
    const arrayBuffer = await audioStore.audioFile.arrayBuffer();
    const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
    localAudioBuffer.value = audioBuffer;
    audioStore.setAudioBuffer(audioBuffer);
    
    await decodeContext.close();
    
    extractWaveformData(audioBuffer);
  } catch (error) {
    console.error('Failed to load audio buffer:', error);
  } finally {
    isLoading.value = false;
  }
}

function extractWaveformData(audioBuffer: AudioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  
  // Calculate samples per pixel based on sample rate and pixels per second
  const samplesPerPixel = Math.floor(audioBuffer.sampleRate / pixelsPerSecond.value);
  const totalPixels = Math.ceil(channelData.length / samplesPerPixel);
  
  // Pre-compute normalized waveform data for the entire audio
  const data = new Float32Array(totalPixels);
  let maxVal = 0;
  
  for (let i = 0; i < totalPixels; i++) {
    let sum = 0;
    const start = i * samplesPerPixel;
    const end = Math.min(start + samplesPerPixel, channelData.length);
    for (let j = start; j < end; j++) {
      sum += Math.abs(channelData[j]);
    }
    const avg = sum / (end - start);
    data[i] = avg;
    if (avg > maxVal) maxVal = avg;
  }
  
  // Normalize
  if (maxVal > 0) {
    for (let i = 0; i < data.length; i++) {
      data[i] = data[i] / maxVal;
    }
  }
  
  waveformData.value = data;
  drawWaveform();
}

// Get real-time current time from audio element for smooth scrolling
function getRealTimeCurrentTime(): number {
  // During playback, read directly from audio element for smoother updates
  if (audioStore.audioElement && audioStore.isPlaying) {
    return audioStore.audioElement.currentTime;
  }
  return audioStore.currentTime;
}

function getVisibleTimeRange() {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (duration === 0) return { startTime: 0, endTime: 0 };
  
  const halfWindow = windowDuration.value / 2;
  
  // Use fixed center time when not following, otherwise follow playhead
  let centerTime: number;
  if (autoFollow.value) {
    const currentTime = getRealTimeCurrentTime();
    centerTime = currentTime + viewOffset.value;
  } else {
    centerTime = fixedViewCenterTime.value;
  }
  
  let startTime = centerTime - halfWindow;
  let endTime = centerTime + halfWindow;
  
  // Clamp to audio bounds
  if (startTime < 0) {
    startTime = 0;
    endTime = Math.min(windowDuration.value, duration);
  }
  if (endTime > duration) {
    endTime = duration;
    startTime = Math.max(0, duration - windowDuration.value);
  }
  
  return { startTime, endTime };
}

function drawWaveform() {
  const canvas = canvasRef.value;
  const data = waveformData.value;
  if (!canvas || !data || data.length === 0) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvasWidth.value * dpr;
  canvas.height = canvasHeight * dpr;
  ctx.scale(dpr, dpr);
  
  ctx.clearRect(0, 0, canvasWidth.value, canvasHeight);
  
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (duration === 0) return;
  
  const currentTime = getRealTimeCurrentTime();
  const { startTime, endTime } = getVisibleTimeRange();
  
  // Calculate which data indices to render
  const dataPerSecond = data.length / duration;
  const startIndex = Math.floor(startTime * dataPerSecond);
  const endIndex = Math.ceil(endTime * dataPerSecond);
  const visibleData = endIndex - startIndex;
  
  if (visibleData <= 0) return;
  
  const barWidth = canvasWidth.value / visibleData;
  const halfHeight = canvasHeight / 2;
  
  // Draw beat markers first (behind waveform)
  if (audioStore.showBeats) {
    const allBeats = audioStore.getAllBeats();
    
    for (const beatTime of allBeats) {
      if (beatTime >= startTime && beatTime <= endTime) {
        const x = ((beatTime - startTime) / (endTime - startTime)) * canvasWidth.value;
        
        // Use consistent color for all beats
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      }
    }
  }
  
  // Draw waveform bars
  for (let i = 0; i < visibleData; i++) {
    const dataIndex = startIndex + i;
    if (dataIndex >= data.length) break;
    
    const val = data[dataIndex];
    const barHeight = val * halfHeight * 0.85;
    const x = i * barWidth;
    const time = (dataIndex / dataPerSecond);
    
    // Color based on whether this part has been played
    if (time < currentTime) {
      ctx.fillStyle = '#3b82f6'; // Blue for played
    } else {
      ctx.fillStyle = '#d1d5db'; // Gray for unplayed
    }
    
    ctx.fillRect(x, halfHeight - barHeight, Math.max(barWidth - 1, 1), barHeight * 2);
  }
  
  // Draw beat markers on top (more visible dots at bottom)
  if (audioStore.showBeats) {
    const allBeats = audioStore.getAllBeats();
    
    for (const beatTime of allBeats) {
      if (beatTime >= startTime && beatTime <= endTime) {
        const x = ((beatTime - startTime) / (endTime - startTime)) * canvasWidth.value;
        
        // Red for all beats
        ctx.fillStyle = '#ef4444';
        
        // Draw small triangle/marker at bottom
        ctx.beginPath();
        ctx.moveTo(x, canvasHeight - 16);
        ctx.lineTo(x - 4, canvasHeight - 22);
        ctx.lineTo(x + 4, canvasHeight - 22);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  
  // Draw center playhead line (only if visible)
  if (currentTime >= startTime && currentTime <= endTime) {
    const playheadX = ((currentTime - startTime) / (endTime - startTime)) * canvasWidth.value;
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvasHeight);
    ctx.stroke();
  }
  
  // Draw time markers
  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  
  const timeStep = windowDuration.value <= 5 ? 1 : windowDuration.value <= 30 ? 2 : 5;
  for (let t = Math.ceil(startTime); t <= Math.floor(endTime); t += timeStep) {
    const x = ((t - startTime) / (endTime - startTime)) * canvasWidth.value;
    ctx.fillText(formatTime(t), x, canvasHeight - 4);
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Find beat near a given time
function findNearbyBeat(time: number, tolerance: number = 0.08): { time: number } | null {
  const allBeats = audioStore.getAllBeats();
  const nearbyBeat = allBeats.find(t => Math.abs(t - time) < tolerance);
  if (nearbyBeat !== undefined) {
    return { time: nearbyBeat };
  }
  return null;
}

// Convert x position to time
function xToTime(x: number): number {
  const { startTime, endTime } = getVisibleTimeRange();
  const percent = x / canvasWidth.value;
  return startTime + percent * (endTime - startTime);
}

function handleCanvasMouseDown(e: MouseEvent) {
  if (!isEditMode.value) return;
  
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (!duration || !canvasRef.value) return;
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const clickedTime = xToTime(x);
  
  // Check if clicking on an existing beat for dragging
  const nearbyBeat = findNearbyBeat(clickedTime);
  
  if (nearbyBeat) {
    // Start dragging the beat
    isDraggingBeat.value = true;
    draggingBeatTime.value = nearbyBeat.time;
    draggingBeatOriginalTime.value = nearbyBeat.time; // Store original position
    
    document.addEventListener('mousemove', handleCanvasMouseMove);
    document.addEventListener('mouseup', handleCanvasMouseUp);
    
    e.preventDefault(); // Prevent click from firing immediately
  }
}

function handleCanvasMouseMove(e: MouseEvent) {
  if (!isDraggingBeat.value || !canvasRef.value || draggingBeatTime.value === null) return;
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const newTime = xToTime(x);
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  const clampedTime = Math.max(0, Math.min(duration, newTime));
  
  // Move the beat
  audioStore.moveBeat(draggingBeatTime.value, clampedTime);
  draggingBeatTime.value = clampedTime;
  
  drawWaveform();
}

function handleCanvasMouseUp() {
  // If we were dragging a beat, save the operation to history
  if (isDraggingBeat.value && draggingBeatOriginalTime.value !== null && draggingBeatTime.value !== null) {
    // Only save if the beat actually moved
    if (Math.abs(draggingBeatOriginalTime.value - draggingBeatTime.value) > 0.001) {
      audioStore.finishMoveBeat();
    }
  }
  
  isDraggingBeat.value = false;
  draggingBeatTime.value = null;
  draggingBeatOriginalTime.value = null;
  
  document.removeEventListener('mousemove', handleCanvasMouseMove);
  document.removeEventListener('mouseup', handleCanvasMouseUp);
}

function handleCanvasContextMenu(e: MouseEvent) {
  if (!isEditMode.value) return;
  
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (!duration || !canvasRef.value) return;
  
  e.preventDefault(); // Prevent default context menu
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const clickedTime = xToTime(x);
  
  // Check if right-clicking on an existing beat
  const nearbyBeat = findNearbyBeat(clickedTime);
  
  if (nearbyBeat) {
    // Delete the beat
    audioStore.removeBeat(nearbyBeat.time);
    drawWaveform();
  }
}

function handleCanvasClick(e: MouseEvent) {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (!duration || !canvasRef.value) return;
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const clickedTime = xToTime(x);
  const clampedTime = Math.max(0, Math.min(duration, clickedTime));
  
  // In edit mode, add beats (removal is handled in mouseup)
  if (isEditMode.value) {
    // Check if clicking near an existing beat - if so, do nothing (handled by mousedown/mouseup)
    const nearbyBeat = findNearbyBeat(clampedTime);
    
    if (!nearbyBeat) {
      // Add a new beat only if not near an existing beat
      audioStore.addBeat(clampedTime);
      drawWaveform();
    }
    return;
  }
  
  // Normal mode: seek to position
  // Reset view offset when clicking to seek
  viewOffset.value = 0;
  autoFollow.value = true;
  audioStore.setCurrentTime(clampedTime);
  
  const event = new CustomEvent('seek', { detail: clampedTime });
  window.dispatchEvent(event);
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  
  // Ctrl/Cmd + wheel = zoom, regular wheel = scroll
  if (e.ctrlKey || e.metaKey) {
    // Zoom
    const step = windowDuration.value < 10 ? 1 : windowDuration.value < 30 ? 2 : 5;
    const delta = e.deltaY > 0 ? step : -step;
    const newDuration = Math.max(minWindowDuration, Math.min(maxWindowDuration.value, windowDuration.value + delta));
    if (newDuration !== windowDuration.value) {
      windowDuration.value = newDuration;
      if (localAudioBuffer.value) {
        extractWaveformData(localAudioBuffer.value);
      }
    }
  } else {
    // Scroll horizontally
    const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
    if (duration === 0) return;
    
    const scrollStep = windowDuration.value * 0.2; // Scroll 20% of window
    const delta = e.deltaY > 0 ? scrollStep : -scrollStep;
    const halfWindow = windowDuration.value / 2;
    
    // Get current center time
    let currentCenterTime: number;
    if (autoFollow.value) {
      currentCenterTime = getRealTimeCurrentTime() + viewOffset.value;
    } else {
      currentCenterTime = fixedViewCenterTime.value;
    }
    
    // Calculate new center time and clamp
    const newCenterTime = Math.max(halfWindow, Math.min(duration - halfWindow, currentCenterTime + delta));
    
    // Set fixed view center and disable auto-follow
    fixedViewCenterTime.value = newCenterTime;
    autoFollow.value = false;
    
    drawWaveform();
  }
}

let scrollbarElement: HTMLElement | null = null;
let dragStartX: number = 0;
let dragStartCenterTime: number = 0;

function handleScrollbarMouseDown(e: MouseEvent) {
  isDragging.value = true;
  scrollbarElement = e.currentTarget as HTMLElement;
  dragStartX = e.clientX;
  
  // Record initial center time
  const _duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (autoFollow.value) {
    dragStartCenterTime = realTimePosition.value + viewOffset.value;
  } else {
    dragStartCenterTime = fixedViewCenterTime.value;
  }
  
  // Disable auto-follow when starting drag
  autoFollow.value = false;
  fixedViewCenterTime.value = dragStartCenterTime;
  
  // Add document-level listeners for drag
  document.addEventListener('mousemove', handleScrollbarMouseMove);
  document.addEventListener('mouseup', handleScrollbarMouseUp);
}

function handleScrollbarMouseMove(e: MouseEvent) {
  if (!isDragging.value || !scrollbarElement) return;
  e.preventDefault();
  
  const rect = scrollbarElement.getBoundingClientRect();
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (duration === 0) return;
  
  // Calculate delta in pixels and convert to time
  const deltaX = e.clientX - dragStartX;
  const deltaTime = (deltaX / rect.width) * duration;
  
  const halfWindow = windowDuration.value / 2;
  const minCenter = halfWindow;
  const maxCenter = duration - halfWindow;
  const rawCenterTime = dragStartCenterTime + deltaTime;
  const newCenterTime = Math.max(minCenter, Math.min(maxCenter, rawCenterTime));
  
  // If clamped at boundary, reset the drag start point to prevent lag
  if (rawCenterTime !== newCenterTime) {
    dragStartX = e.clientX;
    dragStartCenterTime = newCenterTime;
  }
  
  fixedViewCenterTime.value = newCenterTime;
  drawWaveform();
}

function handleScrollbarMouseUp() {
  isDragging.value = false;
  scrollbarElement = null;
  document.removeEventListener('mousemove', handleScrollbarMouseMove);
  document.removeEventListener('mouseup', handleScrollbarMouseUp);
}

function resetView() {
  viewOffset.value = 0;
  autoFollow.value = true;
  drawWaveform();
}

function updateCanvasSize() {
  if (containerRef.value) {
    const newWidth = containerRef.value.clientWidth - 48;
    if (newWidth > 0 && newWidth !== canvasWidth.value) {
      canvasWidth.value = newWidth;
      if (localAudioBuffer.value) {
        extractWaveformData(localAudioBuffer.value);
      }
    }
  }
}

watch(() => audioStore.audioFile, () => {
  if (audioStore.audioFile) {
    waveformData.value = null;
    localAudioBuffer.value = null;
    viewOffset.value = 0;
    autoFollow.value = true;
    fixedViewCenterTime.value = 0;
    isEditMode.value = false;
    setTimeout(() => {
      updateCanvasSize();
      loadAudioBuffer();
    }, 100);
  }
}, { immediate: true });

watch(() => audioStore.currentTime, () => {
  // Update realTimePosition when not playing (for seek operations)
  if (!audioStore.isPlaying) {
    realTimePosition.value = audioStore.currentTime;
  }
  
  // Auto-reset to follow playhead when playing
  if (autoFollow.value && audioStore.isPlaying) {
    viewOffset.value = 0;
  }
  
  if (waveformData.value && waveformData.value.length > 0) {
    drawWaveform();
  }
});

watch(() => [audioStore.bpmInfo, audioStore.showBeats, audioStore.beats.length], () => {
  if (waveformData.value && waveformData.value.length > 0) {
    drawWaveform();
  }
});

let animationFrameId: number | null = null;

function startAnimationLoop() {
  function loop() {
    // Update real-time position for smooth scrollbar animation
    realTimePosition.value = getRealTimeCurrentTime();
    
    if (waveformData.value && waveformData.value.length > 0) {
      drawWaveform();
    }
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

// Handle undo
function handleUndo() {
  audioStore.undo();
  drawWaveform();
}

// Handle redo
function handleRedo() {
  audioStore.redo();
  drawWaveform();
}

// Handle import beats
function handleImportBeats() {
  fileInputRef.value?.click();
}

// Handle file input change
async function handleFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (!file) return;
  
  try {
    const text = await file.text();
    const result = await audioStore.importBeats(text);
    
    if (result.success) {
      alert(result.message);
      drawWaveform();
    } else {
      alert(`导入失败: ${result.message}`);
    }
  } catch (error) {
    alert(`读取文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    // Reset input
    target.value = '';
  }
}

// Keyboard shortcuts
function handleKeyDown(e: KeyboardEvent) {
  // Ctrl/Cmd + Z = Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (workspaceStore.canUndo) {
      handleUndo();
    }
  }
  // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y = Redo
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    if (workspaceStore.canRedo) {
      handleRedo();
    }
  }
}

watch(() => audioStore.isPlaying, (isPlaying) => {
  if (isPlaying) {
    // Reset to follow when starting playback
    if (autoFollow.value) {
      viewOffset.value = 0;
    }
    startAnimationLoop();
  } else {
    stopAnimationLoop();
    drawWaveform();
  }
});

onMounted(() => {
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
  window.addEventListener('keydown', handleKeyDown);
  
  if (audioStore.audioFile && !waveformData.value) {
    loadAudioBuffer();
  }
});

onUnmounted(() => {
  stopAnimationLoop();
  window.removeEventListener('resize', updateCanvasSize);
  window.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('mousemove', handleScrollbarMouseMove);
  document.removeEventListener('mouseup', handleScrollbarMouseUp);
  document.removeEventListener('mousemove', handleCanvasMouseMove);
  document.removeEventListener('mouseup', handleCanvasMouseUp);
});
</script>

<template>
  <div 
    v-if="audioStore.audioUrl"
    ref="containerRef"
    class="bg-white rounded-xl p-6 shadow-sm"
  >
    <!-- Header with controls - now wrapped for better responsiveness -->
    <div class="mb-4">
      <div class="flex items-start justify-between gap-4 mb-3">
        <div class="flex items-center gap-4 flex-wrap">
          <h3 class="text-sm font-medium text-gray-500">
            波形图
          </h3>
          
          <!-- BPM Info -->
          <div
            v-if="audioStore.isDetectingBPM"
            class="flex items-center gap-2 text-xs text-gray-400"
          >
            <div class="animate-spin rounded-full h-3 w-3 border border-blue-500 border-t-transparent" />
            <span>检测节拍...</span>
          </div>
          <div
            v-else
            class="flex items-center gap-2 flex-wrap"
          >
            <span
              v-if="audioStore.bpmInfo && audioStore.bpmInfo.bpm > 0"
              class="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded whitespace-nowrap"
            >
              平均 {{ audioStore.bpmInfo.bpm }} BPM
            </span>
            <span class="text-xs text-gray-400 whitespace-nowrap">
              {{ totalBeatsCount }} 个节拍
            </span>
          </div>
        </div>
        
        <div class="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
          <button
            v-if="!autoFollow"
            class="px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition-colors whitespace-nowrap"
            @click="resetView"
          >
            回到播放
          </button>
          <span class="whitespace-nowrap">窗口: {{ windowDuration }}s</span>
        </div>
      </div>
      
      <!-- Action buttons row -->
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <button
            class="text-xs px-2 py-1 rounded transition-colors"
            :class="audioStore.showBeats ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'"
            @click="audioStore.toggleShowBeats"
          >
            {{ audioStore.showBeats ? '隐藏节拍' : '显示节拍' }}
          </button>
          <button
            class="text-xs px-2 py-1 rounded transition-colors"
            :class="isEditMode ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="isEditMode = !isEditMode"
          >
            {{ isEditMode ? '退出编辑' : '编辑节拍' }}
          </button>
          <button
            v-if="audioStore.audioBuffer"
            class="text-xs px-2 py-1 bg-orange-100 text-orange-600 rounded hover:bg-orange-200 transition-colors"
            title="重新检测节拍"
            @click="audioStore.redetectBPM"
          >
            重新检测
          </button>
          <button
            v-if="totalBeatsCount > 0"
            class="text-xs px-2 py-1 bg-purple-100 text-purple-600 rounded hover:bg-purple-200 transition-colors"
            @click="audioStore.downloadBeatsAsJSON"
          >
            导出节拍
          </button>
          <button
            class="text-xs px-2 py-1 bg-orange-100 text-orange-600 rounded hover:bg-orange-200 transition-colors"
            @click="handleImportBeats"
          >
            导入节拍
          </button>
          
          <!-- Undo/Redo buttons -->
          <div class="flex items-center gap-1 border-l border-gray-300 pl-2 ml-1">
            <button
              :disabled="!workspaceStore.canUndo"
              class="text-xs px-2 py-1 rounded transition-colors"
              :class="workspaceStore.canUndo ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-50 text-gray-300 cursor-not-allowed'"
              title="撤销 (Ctrl+Z)"
              @click="handleUndo"
            >
              ↶
            </button>
            <button
              :disabled="!workspaceStore.canRedo"
              class="text-xs px-2 py-1 rounded transition-colors"
              :class="workspaceStore.canRedo ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-50 text-gray-300 cursor-not-allowed'"
              title="重做 (Ctrl+Y)"
              @click="handleRedo"
            >
              ↷
            </button>
          </div>
        </div>
        
        <div class="text-xs flex items-center gap-3">
          <span
            v-if="isEditMode"
            class="text-green-600 font-medium whitespace-nowrap"
          >
            左键添加 | 右键删除 | 拖拽移动
          </span>
          <span class="text-gray-400 whitespace-nowrap">Ctrl+滚轮缩放</span>
        </div>
      </div>
    </div>
    
    <div
      v-if="isLoading"
      class="flex items-center justify-center h-[150px] bg-gray-50 rounded-lg"
    >
      <div class="flex flex-col items-center gap-2">
        <div class="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
        <span class="text-sm text-gray-400">加载波形数据...</span>
      </div>
    </div>
    
    <canvas
      v-show="!isLoading && waveformData && waveformData.length > 0"
      ref="canvasRef"
      :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }"
      :class="[
        'w-full bg-gray-50 rounded-t-lg transition-all select-none',
        isEditMode ? 'cursor-crosshair ring-2 ring-green-400' : 'cursor-pointer'
      ]"
      @mousedown="handleCanvasMouseDown"
      @click="handleCanvasClick"
      @contextmenu="handleCanvasContextMenu"
      @wheel="handleWheel"
    />
    
    <!-- Scrollbar -->
    <div
      v-show="!isLoading && waveformData && waveformData.length > 0"
      class="h-4 bg-gray-100 rounded-b-lg cursor-pointer relative select-none"
      @mousedown="handleScrollbarMouseDown"
    >
      <!-- Track -->
      <div class="absolute inset-0 flex items-center px-1">
        <div class="w-full h-1.5 bg-gray-200 rounded-full relative">
          <!-- Played portion -->
          <div
            class="absolute left-0 top-0 h-full bg-blue-300 rounded-full"
            :style="{ width: `${(realTimePosition / (audioStore.duration || 1)) * 100}%` }"
          />
          <!-- Thumb (visible window) -->
          <div
            class="absolute top-1/2 -translate-y-1/2 h-3 bg-blue-500 rounded-full opacity-70 hover:opacity-100 transition-opacity"
            :style="{
              width: `${scrollThumbWidth}%`,
              left: `${Math.max(0, Math.min(100 - scrollThumbWidth, scrollPosition * 100 - scrollThumbWidth / 2))}%`
            }"
          />
        </div>
      </div>
    </div>
    
    <!-- Hidden file input for importing beats -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="handleFileInputChange"
    >
    
    <div 
      v-if="!isLoading && (!waveformData || waveformData.length === 0)" 
      class="flex items-center justify-center h-[150px] bg-gray-50 rounded-lg text-gray-400"
    >
      等待加载...
    </div>
  </div>
</template>
