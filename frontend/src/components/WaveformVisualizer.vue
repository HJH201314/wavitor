<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useAudioStore } from '../stores/audio';
import { useWorkspaceStore } from '../stores/workspace';
import { useWaveformViewStore } from '../stores/waveformView';
import { success, error } from '../utils/message';

const audioStore = useAudioStore();
const workspaceStore = useWorkspaceStore();
const viewStore = useWaveformViewStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
const waveformData = ref<Float32Array | null>(null);
const isLoading = ref(false);
const localAudioBuffer = ref<AudioBuffer | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// ECG-related refs
interface ECGWaveformData {
  fileId: string
  fileName: string
  data: Float32Array
  beats: number[]
}
const ecgContainerRef = ref<HTMLDivElement | null>(null);
const ecgCanvasContainerRef = ref<HTMLDivElement | null>(null);
const ecgWaveforms = ref<ECGWaveformData[]>([]);
const isLoadingECG = ref(false);

const canvasWidth = ref(800);
const canvasHeight = 150;
const canvasHeightPerECG = 100;

// Use shared view parameters from viewStore
const windowDuration = computed({
  get: () => viewStore.windowDuration,
  set: (val) => viewStore.setWindowDuration(val)
});

// Pixels per second is no longer used - we use actual canvas width for rendering
// const pixelsPerSecond = computed(() => canvasWidth.value / windowDuration.value);

const minWindowDuration = 1;

// Max window duration is computed based on audio length
const maxWindowDuration = computed(() => {
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 60;
  return Math.max(minWindowDuration, Math.ceil(duration));
});

// Use shared view offset and auto-follow from viewStore
const viewOffset = computed({
  get: () => viewStore.viewOffset,
  set: (val) => viewStore.setViewOffset(val)
});

const fixedViewCenterTime = computed({
  get: () => viewStore.fixedViewCenterTime,
  set: (val) => viewStore.setFixedViewCenterTime(val)
});

const autoFollow = computed({
  get: () => viewStore.autoFollow,
  set: (val) => viewStore.setAutoFollow(val)
});

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

// Touch gesture state
const touchStartTime = ref(0);
const touchStartX = ref(0);
const touchStartY = ref(0);
const longPressTimer = ref<number | null>(null);
const isLongPressing = ref(false);
const isTouchDragging = ref(false);
const LONG_PRESS_DURATION = 500; // ms
const TOUCH_MOVE_THRESHOLD = 10; // px

// Total beats count
const totalBeatsCount = computed(() => audioStore.getAllBeats().length);

// Total R-peaks count across all ECG files
const totalRPeaksCount = computed(() => {
  return ecgWaveforms.value.reduce((sum, ecg) => sum + ecg.beats.length, 0);
});

// Pixels per second for rendering - will be calculated dynamically based on actual width
const pixelsPerSecond = computed(() => {
  // Use a reasonable default width initially, will be recalculated in drawWaveform
  return 800 / windowDuration.value;
});

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

  // Use a fixed standard width (800px) for consistent sampling density
  // This ensures waveform data stays aligned with beats regardless of actual display width
  const STANDARD_CANVAS_WIDTH = 800;
  const pixelsPerSecond = STANDARD_CANVAS_WIDTH / windowDuration.value;
  const samplesPerPixel = Math.floor(audioBuffer.sampleRate / pixelsPerSecond);
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
  // CRITICAL: Use audio buffer's actual duration, not audio store duration
  // Audio store duration may be estimated when loading workspace
  const duration = localAudioBuffer.value?.duration || audioStore.duration || 0;
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

  // Use container width (canvasWidth.value) for full width rendering
  const actualWidth = canvasWidth.value;
  
  // If canvas width is still 0, delay and retry
  if (actualWidth === 0) {
    console.log('[Audio] Canvas width is 0, retrying...');
    requestAnimationFrame(() => drawWaveform());
    return;
  }
  
  const dpr = window.devicePixelRatio || 1;
  canvas.width = actualWidth * dpr;
  canvas.height = canvasHeight * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, actualWidth, canvasHeight);

  // CRITICAL: Use audio buffer's actual duration, not audio store duration
  // Audio store duration may be estimated when loading workspace
  const duration = localAudioBuffer.value?.duration || audioStore.duration || 0;
  if (duration === 0) return;

  const currentTime = getRealTimeCurrentTime();
  const { startTime, endTime } = getVisibleTimeRange();
  
  // Debug logging
  console.log('[Audio] drawWaveform:', {
    canvasWidth: canvasWidth.value,
    actualWidth,
    clientWidth: canvas.clientWidth,
    startTime,
    endTime,
    duration,
    durationSource: localAudioBuffer.value ? 'Audio buffer' : 'audio store',
    hasECG: audioStore.hasECG,
    ecgBeatsCount: audioStore.ecgBeats.length
  });

  // Calculate which data indices to render
  // Audio data covers [0, duration] in time
  const dataPerSecond = data.length / duration;
  const startIndex = Math.floor(startTime * dataPerSecond);
  const endIndex = Math.min(data.length, Math.ceil(endTime * dataPerSecond));
  const visibleData = endIndex - startIndex;

  if (visibleData <= 0) return;

  // Calculate canvas position for audio waveform
  // The visible data should map to the exact canvas region it represents
  const visibleDataStart = startIndex / dataPerSecond; // Actual start time of visible data
  const visibleDataEnd = endIndex / dataPerSecond; // Actual end time of visible data
  const canvasStartX = ((visibleDataStart - startTime) / (endTime - startTime)) * actualWidth;
  const canvasEndX = ((visibleDataEnd - startTime) / (endTime - startTime)) * actualWidth;
  const canvasDataWidth = canvasEndX - canvasStartX;

  const barWidth = canvasDataWidth / visibleData;
  const halfHeight = canvasHeight / 2;
  
  // Draw beat markers first (behind waveform)
  if (audioStore.showBeats) {
    const allBeats = audioStore.getAllBeats();
    
    for (const beatTime of allBeats) {
      if (beatTime >= startTime && beatTime <= endTime) {
        const x = ((beatTime - startTime) / (endTime - startTime)) * actualWidth;
        
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
    const x = canvasStartX + i * barWidth; // Offset by canvasStartX
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
    const isTouchDevice = 'ontouchstart' in window;
    const markerSize = isTouchDevice ? 6 : 4; // Larger markers on touch devices
    
    for (const beatTime of allBeats) {
      if (beatTime >= startTime && beatTime <= endTime) {
        const x = ((beatTime - startTime) / (endTime - startTime)) * actualWidth;
        
        // Red for all beats (heart sound)
        ctx.fillStyle = '#ef4444';
        
        // Draw larger triangle/marker at bottom for touch devices
        ctx.beginPath();
        ctx.moveTo(x, canvasHeight - 16);
        ctx.lineTo(x - markerSize, canvasHeight - 22);
        ctx.lineTo(x + markerSize, canvasHeight - 22);
        ctx.closePath();
        ctx.fill();
        
        // Add touch target indicator in edit mode
        if (isEditMode.value && isTouchDevice) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, canvasHeight - 19, 12, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }
    
    // Draw ECG R-peaks if available
    if (audioStore.hasECG && audioStore.ecgBeats.length > 0) {
      console.log('[DEBUG-WaveformVis] Drawing ECG R-peaks on audio waveform:', {
        timestamp: new Date().toISOString(),
        ecgBeatsCount: audioStore.ecgBeats.length,
        firstBeats: audioStore.ecgBeats.slice(0, 5),
        lastBeats: audioStore.ecgBeats.slice(-3),
        startTime,
        endTime,
        actualWidth,
        duration: audioStore.duration
      });
      
      for (const ecgBeat of audioStore.ecgBeats) {
        if (ecgBeat >= startTime && ecgBeat <= endTime) {
          const x = ((ecgBeat - startTime) / (endTime - startTime)) * actualWidth;
          
          // Debug first few peaks
          if (audioStore.ecgBeats.indexOf(ecgBeat) < 3) {
            console.log('[DEBUG-WaveformVis] ECG R-peak position:', {
              beatIndex: audioStore.ecgBeats.indexOf(ecgBeat),
              ecgBeat,
              x,
              startTime,
              endTime,
              actualWidth,
              calculation: `((${ecgBeat} - ${startTime}) / (${endTime} - ${startTime})) * ${actualWidth} = ${x}`
            });
          }
          
          // Purple for ECG R-peaks
          ctx.fillStyle = '#a855f7';
          ctx.strokeStyle = '#a855f7';
          
          // Draw inverted triangle at top
          ctx.beginPath();
          ctx.moveTo(x, 16);
          ctx.lineTo(x - 4, 22);
          ctx.lineTo(x + 4, 22);
          ctx.closePath();
          ctx.fill();
          
          // Dashed line for ECG peaks
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 22);
          ctx.lineTo(x, canvasHeight - 22);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }
  
  // Draw center playhead line (only if visible)
  if (currentTime >= startTime && currentTime <= endTime) {
    const playheadX = ((currentTime - startTime) / (endTime - startTime)) * actualWidth;
    
    // Draw a subtle shadow/glow effect
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvasHeight);
    ctx.stroke();
    
    // Draw main line with reduced opacity
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvasHeight);
    ctx.stroke();
    
    // Draw small indicator at top
    ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX - 4, 8);
    ctx.lineTo(playheadX + 4, 8);
    ctx.closePath();
    ctx.fill();
  }
  
  // Draw time markers
  ctx.fillStyle = '#9ca3af';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  
  const timeStep = windowDuration.value <= 5 ? 1 : windowDuration.value <= 30 ? 2 : 5;
  for (let t = Math.ceil(startTime); t <= Math.floor(endTime); t += timeStep) {
    const x = ((t - startTime) / (endTime - startTime)) * actualWidth;
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
  
  // On touch devices, increase the tolerance for better UX
  const effectiveTolerance = ('ontouchstart' in window) ? Math.max(tolerance, 0.15) : tolerance;
  
  const nearbyBeat = allBeats.find(t => Math.abs(t - time) < effectiveTolerance);
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

// ==================== Touch Gesture Handlers ====================

function clearLongPressTimer() {
  if (longPressTimer.value !== null) {
    window.clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
}

function handleCanvasTouchStart(e: TouchEvent) {
  if (!isEditMode.value) {
    // In non-edit mode, allow default scrolling behavior
    return;
  }
  
  const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  if (!duration || !canvasRef.value || e.touches.length === 0) return;
  
  const touch = e.touches[0];
  if (!touch) return;
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  
  touchStartTime.value = Date.now();
  touchStartX.value = x;
  touchStartY.value = y;
  isLongPressing.value = false;
  isTouchDragging.value = false;
  
  const touchedTime = xToTime(x);
  const nearbyBeat = findNearbyBeat(touchedTime, 0.12); // Larger tolerance for touch
  
  // Start long press timer
  clearLongPressTimer();
  longPressTimer.value = window.setTimeout(() => {
    if (!isTouchDragging.value && nearbyBeat) {
      // Long press detected - delete beat
      isLongPressing.value = true;
      audioStore.removeBeat(nearbyBeat.time);
      drawWaveform();
      
      // Provide haptic feedback if available
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
      
      e.preventDefault();
    }
  }, LONG_PRESS_DURATION);
  
  // Check if touching an existing beat for dragging
  if (nearbyBeat) {
    isDraggingBeat.value = true;
    draggingBeatTime.value = nearbyBeat.time;
    draggingBeatOriginalTime.value = nearbyBeat.time;
  }
}

function handleCanvasTouchMove(e: TouchEvent) {
  if (!isEditMode.value || e.touches.length === 0) return;
  
  const touch = e.touches[0];
  if (!touch || !canvasRef.value) return;
  
  const rect = canvasRef.value.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  
  const deltaX = Math.abs(x - touchStartX.value);
  const deltaY = Math.abs(y - touchStartY.value);
  
  // If moved beyond threshold, cancel long press and start dragging
  if (deltaX > TOUCH_MOVE_THRESHOLD || deltaY > TOUCH_MOVE_THRESHOLD) {
    clearLongPressTimer();
    
    if (isDraggingBeat.value && draggingBeatTime.value !== null) {
      isTouchDragging.value = true;
      
      const newTime = xToTime(Math.max(0, Math.min(rect.width, x)));
      const duration = audioStore.duration || localAudioBuffer.value?.duration || 0;
      const clampedTime = Math.max(0, Math.min(duration, newTime));
      
      // Move the beat
      audioStore.moveBeat(draggingBeatTime.value, clampedTime);
      draggingBeatTime.value = clampedTime;
      drawWaveform();
      
      e.preventDefault();
    }
  }
}

function handleCanvasTouchEnd(e: TouchEvent) {
  if (!isEditMode.value) return;
  
  clearLongPressTimer();
  
  const touchDuration = Date.now() - touchStartTime.value;
  const rect = canvasRef.value?.getBoundingClientRect();
  
  if (!rect) return;
  
  // If was dragging, save the operation
  if (isTouchDragging.value && draggingBeatOriginalTime.value !== null && draggingBeatTime.value !== null) {
    if (Math.abs(draggingBeatOriginalTime.value - draggingBeatTime.value) > 0.001) {
      audioStore.finishMoveBeat();
    }
  }
  // If it's a quick tap (not long press, not drag), add beat
  else if (!isLongPressing.value && !isTouchDragging.value && touchDuration < LONG_PRESS_DURATION && e.changedTouches.length > 0) {
    const changedTouch = e.changedTouches[0];
    if (!changedTouch) return;
    
    const x = changedTouch.clientX - rect.left;
    const touchedTime = xToTime(x);
    const clampedTime = Math.max(0, Math.min(audioStore.duration || 0, touchedTime));
    
    const nearbyBeat = findNearbyBeat(clampedTime, 0.12);
    
    if (!nearbyBeat) {
      // Add new beat
      audioStore.addBeat(clampedTime);
      drawWaveform();
      
      // Provide haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }
  }
  
  // Reset states
  isDraggingBeat.value = false;
  draggingBeatTime.value = null;
  draggingBeatOriginalTime.value = null;
  isLongPressing.value = false;
  isTouchDragging.value = false;
}

function handleCanvasTouchCancel() {
  clearLongPressTimer();
  isDraggingBeat.value = false;
  draggingBeatTime.value = null;
  draggingBeatOriginalTime.value = null;
  isLongPressing.value = false;
  isTouchDragging.value = false;
}

// ==================== End Touch Gesture Handlers ====================

// Handle global seek events (from BPM chart, etc.)
function handleGlobalSeek(e: Event) {
  const customEvent = e as CustomEvent;
  if (customEvent.detail !== undefined) {
    // Reset to follow mode when seeking from other components
    viewOffset.value = 0;
    autoFollow.value = true;
    drawWaveform();
  }
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  
  // Throttle wheel events
  if (wheelThrottleTimer !== null) {
    return;
  }
  
  wheelThrottleTimer = window.setTimeout(() => {
    wheelThrottleTimer = null;
  }, WHEEL_THROTTLE_DELAY);
  
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
    
    // Trigger redraw immediately
    drawWaveform();
    
    // Also redraw ECG waveforms if they exist
    if (ecgWaveforms.value.length > 0) {
      drawAllECGWaveforms();
    }
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
  viewStore.resetView();
  drawWaveform();
}

function updateCanvasSize() {
  if (containerRef.value) {
    // Match the actual content width (subtract padding if needed)
    const newWidth = containerRef.value.clientWidth;
    if (newWidth > 0 && newWidth !== canvasWidth.value) {
      canvasWidth.value = newWidth;
      // Only redraw, don't re-extract (to keep waveform data consistent with beats)
      if (waveformData.value) {
        drawWaveform();
      }
    }
  }
}

watch(() => audioStore.audioFile, () => {
  if (audioStore.audioFile) {
    waveformData.value = null;
    localAudioBuffer.value = null;
    viewStore.resetView();
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
let lastDrawTime = 0;
const DRAW_INTERVAL = 1000 / 30; // 30 FPS 限制，降低绘制频率

// Throttle for wheel events
let wheelThrottleTimer: number | null = null;
const WHEEL_THROTTLE_DELAY = 16; // ~60fps

function startAnimationLoop() {
  function loop(currentTime: number) {
    // 限制绘制频率，避免过度绘制
    if (currentTime - lastDrawTime < DRAW_INTERVAL) {
      animationFrameId = requestAnimationFrame(loop);
      return;
    }
    lastDrawTime = currentTime;
    
    // Update real-time position for smooth scrollbar animation
    realTimePosition.value = getRealTimeCurrentTime();
    
    if (waveformData.value && waveformData.value.length > 0) {
      drawWaveform();
    }
    
    if (ecgWaveforms.value.length > 0) {
      drawAllECGWaveforms();
    }
    
    animationFrameId = requestAnimationFrame(loop);
  }
  animationFrameId = requestAnimationFrame(loop);
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
      await success(result.message);
      drawWaveform();
    } else {
      await error(`导入失败: ${result.message}`);
    }
  } catch (err) {
    await error(`读取文件失败: ${err instanceof Error ? err.message : '未知错误'}`);
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

// ==================== ECG Waveform Functions ====================

async function extractECGWaveformData(ecgData: { fileId: string; fileName: string; buffer: AudioBuffer; beats: number[] }) {
  try {
    const channelData = ecgData.buffer.getChannelData(0);

    // Use a fixed standard width (800px) for consistent sampling density
    const STANDARD_CANVAS_WIDTH = 800;
    const pixelsPerSecond = STANDARD_CANVAS_WIDTH / windowDuration.value;
    const samplesPerPixel = Math.floor(ecgData.buffer.sampleRate / pixelsPerSecond);
    const totalPixels = Math.ceil(channelData.length / samplesPerPixel);

    console.log('[ECG-WV] ======== extractECGWaveformData ========', {
      fileName: ecgData.fileName,
      STANDARD_CANVAS_WIDTH,
      windowDuration: windowDuration.value,
      pixelsPerSecond,
      sampleRate: ecgData.buffer.sampleRate,
      samplesPerPixel,
      channelDataLength: channelData.length,
      bufferDuration: ecgData.buffer.duration,
      totalPixels,
      currentCanvasWidth: canvasWidth.value
    });

    // Pre-compute normalized waveform data
    // For true waveform, we need to sample the actual signal values (not just amplitude envelope)
    const data = new Float32Array(totalPixels);
    let maxVal = 0;
    let minVal = 0;

    for (let i = 0; i < totalPixels; i++) {
      const start = i * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);

      // Take the median value in this pixel to represent the waveform
      // This preserves the actual signal characteristics
      const pixelSamples = channelData.subarray(start, end);
      const sorted = pixelSamples.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      data[i] = median;

      if (median > maxVal) maxVal = median;
      if (median < minVal) minVal = median;
    }

    // Normalize to [0, 1] range
    const range = maxVal - minVal;
    if (range > 0) {
      for (let i = 0; i < data.length; i++) {
        data[i] = (data[i] - minVal) / range;
      }
    }

    return {
      fileId: ecgData.fileId,
      fileName: ecgData.fileName,
      data,
      beats: ecgData.beats,
    };
  } catch (error) {
    console.error('Failed to extract ECG waveform:', error);
    return null;
  }
}

// Track retry count to prevent infinite loops
let loadRetryCount = 0;
const MAX_LOAD_RETRIES = 10;

async function loadAllECGWaveforms() {
  isLoadingECG.value = true;
  
  // CRITICAL: Wait for container to be ready before processing
  // If container width is 0, it's not ready yet - retry after a delay
  if (ecgContainerRef.value) {
    const containerWidth = ecgContainerRef.value.clientWidth;
    
    if (containerWidth <= 0) {
      if (loadRetryCount >= MAX_LOAD_RETRIES) {
        console.error('[ECG-WV] Container not ready after max retries, giving up', {
          retries: loadRetryCount,
          containerExists: !!ecgContainerRef.value,
          canvasWidth: canvasWidth.value
        });
        isLoadingECG.value = false;
        loadRetryCount = 0;
        return;
      }
      
      loadRetryCount++;
      console.warn('[ECG-WV] Container not ready (width=0), retrying...', {
        retryCount: loadRetryCount,
        maxRetries: MAX_LOAD_RETRIES,
        oldCanvasWidth: canvasWidth.value,
        containerExists: !!ecgContainerRef.value
      });
      
      // Retry after container is rendered
      setTimeout(() => {
        loadAllECGWaveforms();
      }, 100);
      isLoadingECG.value = false;
      return;
    }
    
    // Container is ready, reset retry count
    loadRetryCount = 0;
    
    // Use container width
    const oldCanvasWidth = canvasWidth.value;
    canvasWidth.value = containerWidth;
    
    console.log('[ECG-WV] ============ loadAllECGWaveforms start ============', {
      ecgDataCount: audioStore.ecgDataList.length,
      containerExists: !!ecgContainerRef.value,
      containerWidth,
      canvasWidthBefore: oldCanvasWidth,
      canvasWidthAfter: canvasWidth.value,
      widthChanged: oldCanvasWidth !== canvasWidth.value
    });
  } else {
    console.error('[ECG-WV] Container ref not found');
    isLoadingECG.value = false;
    loadRetryCount = 0;
    return;
  }
  
  try {
    const ecgDataList = audioStore.ecgDataList;
    const newWaveforms: ECGWaveformData[] = [];
    
    for (const ecgData of ecgDataList) {
      const waveform = await extractECGWaveformData(ecgData);
      if (waveform) {
        console.log('[ECG-WV] Waveform extracted:', {
          fileName: waveform.fileName,
          dataLength: waveform.data.length,
          beatsCount: waveform.beats.length,
          firstBeats: waveform.beats.slice(0, 3)
        });
        newWaveforms.push(waveform);
      }
    }
    
    ecgWaveforms.value = newWaveforms;
    
    // 确保容器存在后再绘制
    if (ecgContainerRef.value && newWaveforms.length > 0) {
      console.log('[ECG-WV] About to draw waveforms:', {
        containerWidth: ecgContainerRef.value.clientWidth,
        canvasWidth: canvasWidth.value,
        waveformsCount: newWaveforms.length
      });
      drawAllECGWaveforms();
    } else {
      console.warn('[ECG-WV] Cannot draw waveforms:', {
        containerExists: !!ecgContainerRef.value,
        waveformsCount: newWaveforms.length
      });
    }
  } catch (error) {
    console.error('Failed to load ECG waveforms:', error);
  } finally {
    isLoadingECG.value = false;
  }
}

function getECGVisibleTimeRange() {
  // CRITICAL: Use audio buffer's actual duration, not audio store duration
  // Audio store duration may be estimated when loading workspace
  // ECG can be shorter than audio - we'll render blank space where ECG doesn't exist
  const duration = localAudioBuffer.value?.duration || audioStore.duration || 0;
  
  if (duration === 0) return { startTime: 0, endTime: 0 };
  
  const halfWindow = windowDuration.value / 2;
  
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

function drawECGWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: ECGWaveformData,
  yOffset: number,
  height: number
) {
  const data = waveform.data;
  if (!data || data.length === 0) return;

  // CRITICAL: Use audio duration, not ECG duration
  // ECG can be shorter - we'll only draw where ECG data exists
  const ecgData = audioStore.ecgDataList.find(ecg => ecg.fileId === waveform.fileId);
  const audioDuration = audioStore.duration || localAudioBuffer.value?.duration || 0;
  const ecgDuration = ecgData?.buffer.duration || 0;
  if (audioDuration === 0 || ecgDuration === 0) return;

  const currentTime = getRealTimeCurrentTime();
  const { startTime, endTime } = getECGVisibleTimeRange();

  // Use canvasWidth.value to match container width
  const actualWidth = canvasWidth.value;
  
  // If canvas width is still 0, we can't draw yet
  if (actualWidth === 0) {
    console.log('[ECG-WV] Canvas width is 0 for:', waveform.fileName);
    return;
  }
  
  // ECG only covers [0, ecgDuration] in time
  // If visible time range extends beyond ECG duration, we'll just not draw waveform there (blank)
  const ecgEndTime = ecgDuration;
  
  // Check if ECG time range overlaps with visible time range
  if (ecgEndTime < startTime) {
    // ECG is completely before visible range - render blank
    console.log('[ECG-WV] ECG ends before visible range, rendering blank:', {
      fileName: waveform.fileName,
      ecgEndTime,
      startTime,
      endTime
    });
    return;
  }
  
  // Calculate which portion of ECG to draw
  // Clamp visible range to ECG range
  const visibleEcgStart = Math.max(startTime, 0); // ECG starts at 0
  const visibleEcgEnd = Math.min(endTime, ecgEndTime); // ECG ends at ecgDuration
  
  if (visibleEcgEnd <= visibleEcgStart) {
    // No overlap - render blank
    return;
  }
  
  // Calculate data indices
  const dataPerSecond = data.length / ecgDuration;
  const startIndex = Math.floor(visibleEcgStart * dataPerSecond);
  const endIndex = Math.min(data.length, Math.ceil(visibleEcgEnd * dataPerSecond));
  const visibleData = endIndex - startIndex;

  if (visibleData <= 0) return;

  // Calculate canvas position for ECG waveform
  // Map [visibleEcgStart, visibleEcgEnd] to canvas coordinates
  const canvasStartX = ((visibleEcgStart - startTime) / (endTime - startTime)) * actualWidth;
  const canvasEndX = ((visibleEcgEnd - startTime) / (endTime - startTime)) * actualWidth;
  const canvasEcgWidth = canvasEndX - canvasStartX;

  const barWidth = canvasEcgWidth / visibleData;
  const halfHeight = height / 2;
  
  console.log('[ECG-WV] ======== drawECGWaveform ========', {
    fileName: waveform.fileName,
    canvasWidth: canvasWidth.value,
    actualWidth,
    dataLength: data.length,
    audioDuration,
    ecgDuration,
    dataPerSecond,
    windowDuration: windowDuration.value,
    visibleRange: [startTime, endTime],
    ecgRange: [0, ecgEndTime],
    visibleEcgRange: [visibleEcgStart, visibleEcgEnd],
    startIndex,
    endIndex,
    visibleData,
    canvasXRange: [canvasStartX, canvasEndX],
    barWidth
  });
  
  // Draw R-peak markers first (behind waveform)
  for (const rPeakTime of waveform.beats) {
    // R-peaks are in absolute audio time
    if (rPeakTime >= startTime && rPeakTime <= endTime && rPeakTime <= ecgEndTime) {
      const x = ((rPeakTime - startTime) / (endTime - startTime)) * actualWidth;
      
      // Purple dashed line for R-peaks
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      
      ctx.beginPath();
      ctx.moveTo(x, yOffset);
      ctx.lineTo(x, yOffset + height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  
  // Draw ECG waveform as a continuous line (not bars)
  ctx.beginPath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#a855f7';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let firstPoint = true;
  for (let i = 0; i < visibleData; i++) {
    const dataIndex = startIndex + i;
    if (dataIndex >= data.length) break;

    const val = data[dataIndex];
    // Map value from [0, 1] to [-1, 1] for proper waveform display
    const normalizedVal = (val * 2 - 1);
    const y = yOffset + halfHeight - (normalizedVal * halfHeight * 0.9);
    const x = canvasStartX + i * barWidth; // Offset by canvasStartX
    const time = (dataIndex / dataPerSecond);

    if (firstPoint) {
      ctx.moveTo(x, y);
      firstPoint = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Draw fill under the waveform
  if (!firstPoint) {
    // Close the path for fill
    const lastX = canvasStartX + (visibleData - 1) * barWidth;
    ctx.lineTo(lastX, yOffset + halfHeight);
    ctx.lineTo(canvasStartX, yOffset + halfHeight);
    ctx.closePath();
    
    const gradient = ctx.createLinearGradient(canvasStartX, yOffset, canvasEndX, yOffset + height);
    gradient.addColorStop(0, 'rgba(168, 85, 247, 0.1)');
    gradient.addColorStop(1, 'rgba(233, 213, 255, 0.05)');
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  
  // Draw R-peak markers on top (triangles at top)
  const isTouchDevice = 'ontouchstart' in window;
  const markerSize = isTouchDevice ? 6 : 4;

  for (const rPeakTime of waveform.beats) {
    // Only draw R-peaks that are within both visible range AND ECG range
    if (rPeakTime >= startTime && rPeakTime <= endTime && rPeakTime <= ecgEndTime) {
      const x = ((rPeakTime - startTime) / (endTime - startTime)) * actualWidth;

      // Purple triangle marker at top
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.moveTo(x, yOffset + 8);
      ctx.lineTo(x - markerSize, yOffset + 14);
      ctx.lineTo(x + markerSize, yOffset + 14);
      ctx.closePath();
      ctx.fill();
    }
  }
  
  // Draw current playhead line
  if (currentTime >= startTime && currentTime <= endTime) {
    const playheadX = ((currentTime - startTime) / (endTime - startTime)) * actualWidth;

    // Draw subtle shadow/glow
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.15)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(playheadX, yOffset);
    ctx.lineTo(playheadX, yOffset + height);
    ctx.stroke();

    // Draw main line
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, yOffset);
    ctx.lineTo(playheadX, yOffset + height);
    ctx.stroke();

    // Top indicator
    ctx.fillStyle = 'rgba(168, 85, 247, 0.8)';
    ctx.beginPath();
    ctx.moveTo(playheadX, yOffset);
    ctx.lineTo(playheadX - 4, yOffset + 8);
    ctx.lineTo(playheadX + 4, yOffset + 8);
    ctx.closePath();
    ctx.fill();
  }
}

// Store canvas elements to avoid recreating them
const ecgCanvasElements = ref<Map<string, HTMLCanvasElement>>(new Map());

function drawAllECGWaveforms() {
  if (ecgWaveforms.value.length === 0) {
    console.log('[ECG-WV] drawAllECGWaveforms: no waveforms');
    return;
  }
  
  const container = ecgCanvasContainerRef.value;
  if (!container) {
    console.log('[ECG-WV] drawAllECGWaveforms: no canvas container');
    return;
  }
  
  console.log('[ECG-WV] drawAllECGWaveforms:', {
    waveformsCount: ecgWaveforms.value.length,
    containerWidth: container.clientWidth,
    canvasWidth: canvasWidth.value
  });
  
  // Create or reuse canvases
  ecgWaveforms.value.forEach((waveform, index) => {
    let canvas = ecgCanvasElements.value.get(waveform.fileId);
    
    // Only create canvas if it doesn't exist
    if (!canvas) {
      console.log('[ECG-WV] Creating new canvas for:', waveform.fileName);
      canvas = document.createElement('canvas');
      canvas.className = 'w-full bg-purple-50 rounded-lg cursor-pointer select-none transition-all mb-2';
      canvas.style.height = `${canvasHeightPerECG}px`;
      canvas.title = `${waveform.fileName} - 点击跳转到指定位置`;
      canvas.addEventListener('click', handleECGCanvasClick);
      
      ecgCanvasElements.value.set(waveform.fileId, canvas);
      container.appendChild(canvas);
      
      // Wait for DOM update before drawing
      setTimeout(() => {
        console.log('[ECG-WV] Canvas appended, size:', {
          fileName: waveform.fileName,
          clientWidth: canvas!.clientWidth,
          offsetWidth: canvas!.offsetWidth,
          containerWidth: container.clientWidth
        });
      }, 0);
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Wait for canvas to have actual width before setting canvas dimensions
    if (canvas.clientWidth === 0) {
      console.log('[ECG-WV] Canvas not ready, scheduling redraw for:', waveform.fileName);
      // Schedule a redraw after canvas is rendered
      requestAnimationFrame(() => {
        drawAllECGWaveforms();
      });
      return;
    }
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth.value * dpr;
    canvas.height = canvasHeightPerECG * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeightPerECG);
    
    // Draw waveform
    drawECGWaveform(ctx, waveform, 0, canvasHeightPerECG);
    
    // Draw filename label
    ctx.fillStyle = '#7c3aed';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(waveform.fileName, 8, 4);
    
    // Draw time markers (only on last canvas)
    if (index === ecgWaveforms.value.length - 1) {
      const { startTime, endTime } = getECGVisibleTimeRange();
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      
      const timeStep = windowDuration.value <= 5 ? 1 : windowDuration.value <= 30 ? 2 : 5;
      // Use canvasWidth.value to match waveform rendering
      for (let t = Math.ceil(startTime); t <= Math.floor(endTime); t += timeStep) {
        const x = ((t - startTime) / (endTime - startTime)) * canvasWidth.value;
        ctx.fillText(formatTime(t), x, canvasHeightPerECG - 14);
      }
    }
  });
  
  // Remove canvases for deleted ECG files
  const currentFileIds = new Set(ecgWaveforms.value.map(w => w.fileId));
  for (const [fileId, canvas] of ecgCanvasElements.value.entries()) {
    if (!currentFileIds.has(fileId)) {
      canvas.remove();
      ecgCanvasElements.value.delete(fileId);
    }
  }
}

function handleECGCanvasClick(e: MouseEvent) {
  const canvas = e.currentTarget as HTMLCanvasElement;
  const duration = audioStore.duration || 0;
  if (!duration) return;
  
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  // Use canvasWidth.value to match waveform rendering
  const { startTime, endTime } = getECGVisibleTimeRange();
  const percent = x / canvasWidth.value;
  const clickedTime = startTime + percent * (endTime - startTime);
  const clampedTime = Math.max(0, Math.min(duration, clickedTime));
  
  // Seek to position and reset view
  viewStore.setViewOffset(0);
  viewStore.setAutoFollow(true);
  audioStore.setCurrentTime(clampedTime);
  
  const event = new CustomEvent('seek', { detail: clampedTime });
  window.dispatchEvent(event);
}

// Watch ECG data list changes
watch(() => audioStore.ecgDataList.length, (newLength, oldLength) => {
  console.log('[ECG] ecgDataList changed:', { newLength, oldLength, hasContainer: !!ecgContainerRef.value });
  
  if (newLength > 0) {
    // CRITICAL: Reset canvasWidth to 0 to force re-initialization from container
    // This prevents using stale width values from previous workspace
    const oldCanvasWidth = canvasWidth.value;
    canvasWidth.value = 0;
    console.log('[ECG] Reset canvasWidth from', oldCanvasWidth, 'to 0');
    
    // 延迟加载，确保 DOM 已更新
    setTimeout(() => {
      console.log('[ECG] Delayed load check:', {
        containerExists: !!ecgContainerRef.value,
        containerWidth: ecgContainerRef.value?.clientWidth,
        canvasWidth: canvasWidth.value
      });
      loadAllECGWaveforms();
    }, 150);
  } else if (oldLength > 0) {
    // 清空 ECG 数据
    ecgWaveforms.value = [];
    ecgCanvasElements.value.clear();
    if (ecgCanvasContainerRef.value) {
      while (ecgCanvasContainerRef.value.firstChild) {
        ecgCanvasContainerRef.value.removeChild(ecgCanvasContainerRef.value.firstChild);
      }
    }
  }
}, { immediate: true });

// Watch for ECG waveform updates when currentTime changes
watch(() => audioStore.currentTime, () => {
  if (!audioStore.isPlaying && ecgWaveforms.value.length > 0) {
    drawAllECGWaveforms();
  }
});

// Watch window duration changes - need to re-extract waveform data
watch(() => windowDuration.value, () => {
  if (ecgWaveforms.value.length > 0) {
    loadAllECGWaveforms();
  }
});

// Watch view position changes - only need to redraw (with throttling)
let viewChangeThrottleTimer: number | null = null;
watch(() => [viewOffset.value, fixedViewCenterTime.value, autoFollow.value], () => {
  if (ecgWaveforms.value.length > 0) {
    // Cancel previous scheduled redraw
    if (viewChangeThrottleTimer !== null) {
      cancelAnimationFrame(viewChangeThrottleTimer);
    }
    // Schedule new redraw
    viewChangeThrottleTimer = requestAnimationFrame(() => {
      drawAllECGWaveforms();
      viewChangeThrottleTimer = null;
    });
  }
}, { deep: true });

// ==================== End ECG Functions ====================


onMounted(() => {
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('seek', handleGlobalSeek as EventListener);
  
  if (audioStore.audioFile && !waveformData.value) {
    loadAudioBuffer();
  }
});

onUnmounted(() => {
  stopAnimationLoop();
  clearLongPressTimer();
  
  // 清理 ECG canvas 缓存
  ecgCanvasElements.value.clear();
  
  window.removeEventListener('resize', updateCanvasSize);
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('seek', handleGlobalSeek as EventListener);
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
    class="bg-white rounded-xl p-4 md:p-6 shadow-sm max-w-full overflow-hidden"
  >
    <!-- Header with controls - now wrapped for better responsiveness -->
    <div class="mb-4">
      <div class="flex items-start justify-between gap-2 md:gap-4 mb-3 flex-wrap">
        <div class="flex items-center gap-2 md:gap-4 flex-wrap">
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
            class="px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition-colors whitespace-nowrap text-xs"
            @click="resetView"
          >
            回到播放
          </button>
          <span class="whitespace-nowrap">窗口: {{ windowDuration }}s</span>
        </div>
      </div>
      
      <!-- Action buttons row -->
      <div class="flex items-start justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-1.5 md:gap-2 flex-wrap">
          <button
            class="text-xs px-2 md:px-3 py-1.5 md:py-2 rounded transition-colors touch-manipulation min-h-[32px] md:min-h-[36px]"
            :class="audioStore.showBeats ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'"
            @click="audioStore.toggleShowBeats"
          >
            {{ audioStore.showBeats ? '隐藏节拍' : '显示节拍' }}
          </button>
          <button
            class="text-xs px-2 md:px-3 py-1.5 md:py-2 rounded transition-colors touch-manipulation min-h-[32px] md:min-h-[36px]"
            :class="isEditMode ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="isEditMode = !isEditMode"
          >
            {{ isEditMode ? '退出编辑' : '编辑节拍' }}
          </button>
          <button
            v-if="audioStore.audioBuffer"
            class="text-xs px-2 md:px-3 py-1.5 md:py-2 bg-orange-100 text-orange-600 rounded hover:bg-orange-200 transition-colors touch-manipulation min-h-[32px] md:min-h-[36px]"
            title="重新检测节拍"
            @click="audioStore.redetectBPM"
          >
            重新检测
          </button>
          <button
            v-if="totalBeatsCount > 0"
            class="text-xs px-2 md:px-3 py-1.5 md:py-2 bg-purple-100 text-purple-600 rounded hover:bg-purple-200 transition-colors touch-manipulation min-h-[32px] md:min-h-[36px]"
            @click="audioStore.downloadBeatsAsJSON"
          >
            导出节拍
          </button>
          <button
            class="text-xs px-2 md:px-3 py-1.5 md:py-2 bg-orange-100 text-orange-600 rounded hover:bg-orange-200 transition-colors touch-manipulation min-h-[32px] md:min-h-[36px]"
            @click="handleImportBeats"
          >
            导入节拍
          </button>
          
          <!-- Undo/Redo buttons -->
          <div class="flex items-center gap-1 border-l border-gray-300 pl-1.5 md:pl-2 ml-1">
            <button
              :disabled="!workspaceStore.canUndo"
              class="text-xs px-2 md:px-3 py-1.5 md:py-2 rounded transition-colors touch-manipulation min-h-[32px] md:min-h-[36px] min-w-[32px] md:min-w-[36px]"
              :class="workspaceStore.canUndo ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-50 text-gray-300 cursor-not-allowed'"
              title="撤销 (Ctrl+Z)"
              @click="handleUndo"
            >
              ↶
            </button>
            <button
              :disabled="!workspaceStore.canRedo"
              class="text-xs px-2 md:px-3 py-1.5 md:py-2 rounded transition-colors touch-manipulation min-h-[32px] md:min-h-[36px] min-w-[32px] md:min-w-[36px]"
              :class="workspaceStore.canRedo ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-gray-50 text-gray-300 cursor-not-allowed'"
              title="重做 (Ctrl+Y)"
              @click="handleRedo"
            >
              ↷
            </button>
          </div>
        </div>
        
        <div class="text-xs flex items-center gap-2 md:gap-3 mt-2 sm:mt-0 w-full sm:w-auto">
          <span
            v-if="isEditMode"
            class="text-green-600 font-medium"
          >
            <span class="hidden md:inline">左键添加 | 右键删除 | 拖拽移动</span>
            <span class="inline md:hidden">点按添加 | 长按删除 | 拖动修改</span>
          </span>
          <span class="text-gray-400 hidden lg:inline">Ctrl+滚轮缩放</span>
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
      :style="{ height: canvasHeight + 'px' }"
      :class="[
        'w-full bg-gray-50 rounded-t-lg transition-all select-none touch-manipulation',
        isEditMode ? 'cursor-crosshair ring-2 ring-green-400' : 'cursor-pointer'
      ]"
      @mousedown="handleCanvasMouseDown"
      @click="handleCanvasClick"
      @contextmenu="handleCanvasContextMenu"
      @wheel="handleWheel"
      @touchstart="handleCanvasTouchStart"
      @touchmove="handleCanvasTouchMove"
      @touchend="handleCanvasTouchEnd"
      @touchcancel="handleCanvasTouchCancel"
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
    
    <!-- ECG Waveforms Section -->
    <div
      v-if="audioStore.hasECG"
      ref="ecgContainerRef"
      class="mt-6 pt-6 border-t-2 border-purple-100"
    >
      <!-- ECG Header -->
      <div class="mb-4">
        <div class="flex items-start justify-between gap-4 mb-3">
          <div class="flex items-center gap-4 flex-wrap">
            <h3 class="text-sm font-medium text-purple-600 flex items-center gap-2">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
              心电波形（ECG）
            </h3>
            
            <div
              v-if="isLoadingECG"
              class="flex items-center gap-2 text-xs text-gray-400"
            >
              <div class="animate-spin rounded-full h-3 w-3 border border-purple-500 border-t-transparent" />
              <span>加载心电数据...</span>
            </div>
            <div
              v-else
              class="flex items-center gap-2 flex-wrap"
            >
              <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded whitespace-nowrap">
                {{ ecgWaveforms.length }} 个文件
              </span>
              <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded whitespace-nowrap">
                {{ totalRPeaksCount }} 个 R 峰
              </span>
            </div>
          </div>
          
          <div class="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
            <span class="whitespace-nowrap">窗口: {{ windowDuration }}s</span>
          </div>
        </div>
      </div>
      
      <div
        v-if="isLoadingECG"
        class="flex items-center justify-center h-[120px] bg-purple-50 rounded-lg"
      >
        <div class="flex flex-col items-center gap-2">
          <div class="animate-spin rounded-full h-8 w-8 border-2 border-purple-500 border-t-transparent" />
          <span class="text-sm text-purple-600">加载心电波形数据...</span>
        </div>
      </div>
      
      <!-- ECG waveform canvases will be dynamically added here -->
      <div
        ref="ecgCanvasContainerRef"
        v-show="!isLoadingECG && ecgWaveforms.length > 0"
        class="space-y-2"
      />
      
      <div 
        v-if="!isLoadingECG && ecgWaveforms.length === 0" 
        class="flex items-center justify-center h-[120px] bg-purple-50 rounded-lg text-purple-400"
      >
        等待加载心电数据...
      </div>
      
      <!-- Legend -->
      <div class="mt-3 flex items-center justify-center gap-4 text-xs text-gray-500">
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-3 bg-purple-500 rounded-sm" />
          <span>心电信号</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-0.5 border-t-2 border-dashed border-purple-400" />
          <span>R 峰标记</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-0.5 h-3 bg-purple-500 opacity-60" />
          <span>播放位置</span>
        </div>
      </div>
    </div>
    
    <div 
      v-if="!isLoading && (!waveformData || waveformData.length === 0)" 
      class="flex items-center justify-center h-[150px] bg-gray-50 rounded-lg text-gray-400"
    >
      等待加载...
    </div>
  </div>
</template>
