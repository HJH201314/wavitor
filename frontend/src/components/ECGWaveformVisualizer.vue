<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useAudioStore } from '../stores/audio';
import { useWaveformViewStore } from '../stores/waveformView';
import { useWorkspaceStore } from '../stores/workspace';

const audioStore = useAudioStore();
const viewStore = useWaveformViewStore();
const workspaceStore = useWorkspaceStore();

interface ECGWaveformData {
  fileId: string
  fileName: string
  data: Float32Array
  beats: number[]
  ecgDuration: number              // ECG buffer duration (actual ECG audio length)
  ecgStartTime: number             // ECG start time relative to main audio (in seconds)
  extractedWindowDuration: number  // Record window duration used during extraction
  extractedCanvasWidth: number     // Record canvas width used during extraction
}

const containerRef = ref<HTMLDivElement | null>(null);
const ecgWaveforms = ref<ECGWaveformData[]>([]);
const isLoading = ref(false);

// 缓存 canvas 元素，避免频繁创建销毁
const canvasElements = ref<Map<string, HTMLCanvasElement>>(new Map());

const canvasWidth = ref(0);  // Will be set from actual container width
const canvasHeightPerECG = 100; // Height per ECG track

// Use shared view parameters from viewStore
const windowDuration = computed(() => viewStore.windowDuration);
const viewOffset = computed(() => viewStore.viewOffset);
const fixedViewCenterTime = computed(() => viewStore.fixedViewCenterTime);
const autoFollow = computed(() => viewStore.autoFollow);

// Real-time position for smooth animation
const realTimePosition = ref(0);

// Pixels per second for rendering
const pixelsPerSecond = computed(() => canvasWidth.value / windowDuration.value);

// Total R-peaks count across all ECG files
const totalRPeaksCount = computed(() => {
  return ecgWaveforms.value.reduce((sum, ecg) => sum + ecg.beats.length, 0);
});

async function extractWaveformData(
  ecgData: { fileId: string; fileName: string; buffer: AudioBuffer; beats: number[] },
  ecgStartTime: number
) {
  try {
    const channelData = ecgData.buffer.getChannelData(0);

    // CRITICAL: Use a FIXED pixels-per-second ratio for consistent waveform density
    // This ensures the waveform looks the same regardless of when it was extracted
    // Using 30 px/s as a reasonable density for ECG visualization
    const FIXED_PIXELS_PER_SECOND = 30;
    const totalPixels = Math.ceil(ecgData.buffer.duration * FIXED_PIXELS_PER_SECOND);
    const samplesPerPixel = Math.floor(channelData.length / totalPixels);

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

    console.log(`[ECG-WV] Extracted waveform data: duration=${ecgData.buffer.duration.toFixed(2)}s, pixelsPerSecond=${FIXED_PIXELS_PER_SECOND}, totalPixels=${totalPixels}, beats=${ecgData.beats.length}, ecgStartTime=${ecgStartTime}s`);

    return {
      fileId: ecgData.fileId,
      fileName: ecgData.fileName,
      data,
      beats: ecgData.beats,
      ecgDuration: ecgData.buffer.duration,  // Store ECG buffer duration
      ecgStartTime,                          // Store ECG start time
      extractedWindowDuration: 0,            // Not used anymore
      extractedCanvasWidth: totalPixels,     // Store total pixels for reference
    };
  } catch (error) {
    console.error('Failed to extract ECG waveform:', error);
    return null;
  }
}

async function loadAllECGWaveforms() {
  isLoading.value = true;
  
  // CRITICAL: Wait for container to be ready before processing
  // If container width is 0, it's not ready yet - retry after a delay
  if (containerRef.value) {
    const containerWidth = containerRef.value.clientWidth;
    
    if (containerWidth <= 0) {
      console.warn('[ECG-WV] Container not ready (width=0), retrying in 100ms...', {
        oldCanvasWidth: canvasWidth.value,
        containerExists: !!containerRef.value
      });
      
      // Retry after container is rendered
      setTimeout(() => {
        loadAllECGWaveforms();
      }, 100);
      isLoading.value = false;
      return;
    }
    
    // Container is ready, use its width
    const oldCanvasWidth = canvasWidth.value;
    canvasWidth.value = containerWidth;
    
    console.log('[ECG-WV] ============ loadAllECGWaveforms start ============', {
      ecgDataCount: audioStore.ecgDataList.length,
      containerExists: !!containerRef.value,
      containerWidth,
      canvasWidthBefore: oldCanvasWidth,
      canvasWidthAfter: canvasWidth.value,
      widthChanged: oldCanvasWidth !== canvasWidth.value,
      cachedWaveformsCount: ecgWaveforms.value.length
    });
  } else {
    console.error('[ECG-WV] Container ref not found');
    isLoading.value = false;
    return;
  }
  
  try {
    const ecgDataList = audioStore.ecgDataList;
    const workspace = workspaceStore.currentWorkspace;
    const newWaveforms: ECGWaveformData[] = [];
    
    // Check if we need to re-extract waveform data
    const needsReExtraction = shouldReExtractWaveforms();
    
    for (const ecgData of ecgDataList) {
      // Get ECG start time from workspace
      const ecgRef = workspace?.ecgReferences?.find(ref => ref.fileId === ecgData.fileId);
      const ecgStartTime = ecgRef?.ecgStartTime || 0;
      
      console.log('[ECG-WV] Processing ECG:', {
        fileName: ecgData.fileName,
        fileId: ecgData.fileId.substring(0, 8),
        ecgStartTime,
        beatsCount: ecgData.beats.length
      });
      
      // Try to reuse existing waveform if extraction parameters haven't changed significantly
      const existingWaveform = ecgWaveforms.value.find(w => w.fileId === ecgData.fileId);
      
      // Check if beats data has changed (R-peaks re-detected)
      let beatsChanged = false;
      if (existingWaveform) {
        beatsChanged = existingWaveform.beats.length !== ecgData.beats.length ||
                       !existingWaveform.beats.every((beat, i) => Math.abs(beat - ecgData.beats[i]) < 0.001);
      }
      
      // Check if buffer duration has changed (different ECG file with same ID shouldn't happen, but be safe)
      let bufferChanged = false;
      if (existingWaveform) {
        bufferChanged = Math.abs(existingWaveform.ecgDuration - ecgData.buffer.duration) > 0.01;
      }
      
      if (existingWaveform && !needsReExtraction && !beatsChanged && !bufferChanged) {
        console.log('[ECG-WV] Reusing existing waveform for:', ecgData.fileName, {
          dataLength: existingWaveform.data.length,
          beatsCount: existingWaveform.beats.length
        });
        // Update ecgDuration and ecgStartTime in case they're missing from old cached data
        const updatedWaveform = {
          ...existingWaveform,
          ecgDuration: ecgData.buffer.duration,
          ecgStartTime,
          beats: ecgData.beats  // Also update beats in case they changed
        };
        newWaveforms.push(updatedWaveform);
      } else {
        let reason = '';
        if (existingWaveform) {
          if (beatsChanged) {
            reason = 'beats data changed';
            console.log('[ECG-WV] Re-extracting waveform - beats changed:', {
              fileName: ecgData.fileName,
              oldBeatsCount: existingWaveform.beats.length,
              newBeatsCount: ecgData.beats.length,
              firstOldBeats: existingWaveform.beats.slice(0, 3),
              firstNewBeats: ecgData.beats.slice(0, 3)
            });
          } else if (bufferChanged) {
            reason = 'buffer duration changed';
            console.log('[ECG-WV] Re-extracting waveform - buffer changed:', {
              fileName: ecgData.fileName,
              oldDuration: existingWaveform.ecgDuration,
              newDuration: ecgData.buffer.duration
            });
          } else {
            reason = 'parameter changes';
            console.log('[ECG-WV] Re-extracting waveform - parameter changes:', {
              fileName: ecgData.fileName,
              oldWindowDuration: existingWaveform.extractedWindowDuration,
              newWindowDuration: windowDuration.value,
              oldCanvasWidth: existingWaveform.extractedCanvasWidth,
              newCanvasWidth: canvasWidth.value
            });
          }
        } else {
          reason = 'new waveform';
          console.log('[ECG-WV] Extracting new waveform for:', ecgData.fileName);
        }
        
        const waveform = await extractWaveformData(ecgData, ecgStartTime);
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
    }
    
    ecgWaveforms.value = newWaveforms;
    
    console.log('[ECG-WV] ============ All waveforms processed ============', {
      count: newWaveforms.length,
      canvasWidth: canvasWidth.value,
      containerWidth: containerRef.value?.clientWidth,
      waveforms: newWaveforms.map(w => ({
        fileName: w.fileName,
        dataLength: w.data.length,
        extractedCanvasWidth: w.extractedCanvasWidth,
        ecgDuration: w.ecgDuration,
        beatsCount: w.beats.length
      }))
    });
    
    // 确保容器存在后再绘制
    if (containerRef.value && newWaveforms.length > 0) {
      console.log('[ECG-WV] About to draw waveforms:', {
        containerWidth: containerRef.value.clientWidth,
        canvasWidth: canvasWidth.value,
        waveformsCount: newWaveforms.length
      });
      drawAllWaveforms();
    } else if (newWaveforms.length === 0) {
      console.log('[ECG-WV] No waveforms to draw');
    } else {
      console.log(' [ECG-WV] Cannot draw waveforms: {containerExists: false, waveformsCount: ' + newWaveforms.length + '}');
    }
  } catch (error) {
    console.error('[ECG-WV] Failed to load ECG waveforms:', error);
  } finally {
    isLoading.value = false;
  }
}

// Check if waveform data needs to be re-extracted due to parameter changes
function shouldReExtractWaveforms(): boolean {
  // Always re-extract if no waveforms exist
  if (ecgWaveforms.value.length === 0) {
    return true;
  }
  
  // Since we now use FIXED pixels-per-second, waveform data doesn't need re-extraction
  // based on windowDuration or canvas width changes
  // However, we should still check if the waveform cache matches current ECG data
  
  // If number of waveforms doesn't match ECG data count, re-extract
  if (ecgWaveforms.value.length !== audioStore.ecgDataList.length) {
    console.log('[ECG-WV] Waveform count mismatch, needs re-extraction:', {
      cachedCount: ecgWaveforms.value.length,
      currentCount: audioStore.ecgDataList.length
    });
    return true;
  }
  
  // Check if all fileIds match
  const cachedFileIds = new Set(ecgWaveforms.value.map(w => w.fileId));
  const currentFileIds = new Set(audioStore.ecgDataList.map(e => e.fileId));
  
  for (const fileId of currentFileIds) {
    if (!cachedFileIds.has(fileId)) {
      console.log('[ECG-WV] FileId mismatch detected, needs re-extraction');
      return true;
    }
  }
  
  return false;
}

function getRealTimeCurrentTime(): number {
  if (audioStore.audioElement && audioStore.isPlaying) {
    return audioStore.audioElement.currentTime;
  }
  return audioStore.currentTime;
}

function getVisibleTimeRange() {
  const duration = audioStore.duration || 0;
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

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: ECGWaveformData,
  yOffset: number,
  height: number
) {
  const data = waveform.data;
  if (!data || data.length === 0) return;

  // ECG has its own time range: [ecgStartTime, ecgStartTime + ecgDuration]
  const ecgStartTime = waveform.ecgStartTime;
  const ecgEndTime = ecgStartTime + waveform.ecgDuration;

  const currentTime = getRealTimeCurrentTime();
  const { startTime, endTime } = getVisibleTimeRange();

  // Check if ECG time range overlaps with visible time range
  if (ecgEndTime < startTime || ecgStartTime > endTime) {
    // ECG is completely outside visible range, don't draw
    return;
  }

  // Use canvasWidth.value to ensure consistency with audio waveform
  const actualWidth = canvasWidth.value;
  
  // Debug logging
  console.log('[DEBUG-ECGWaveformVis] drawWaveform:', {
    timestamp: new Date().toISOString(),
    fileName: waveform.fileName,
    fileId: waveform.fileId.substring(0, 8),
    canvasWidth: canvasWidth.value,
    actualWidth,
    beatsCount: waveform.beats.length,
    firstBeats: waveform.beats.slice(0, 5),
    lastBeats: waveform.beats.slice(-3),
    visibleRange: [startTime, endTime],
    ecgRange: [ecgStartTime, ecgEndTime],
    ecgDuration: waveform.ecgDuration,
    currentTime
  });

  // Calculate visible portion of ECG data
  // ECG data covers [ecgStartTime, ecgEndTime] in audio time
  // We need to map [startTime, endTime] to ECG data indices
  
  // Clamp visible range to ECG range
  const visibleEcgStart = Math.max(startTime, ecgStartTime);
  const visibleEcgEnd = Math.min(endTime, ecgEndTime);
  
  // Convert to ECG-relative time (0-based)
  const relativeStartTime = visibleEcgStart - ecgStartTime;
  const relativeEndTime = visibleEcgEnd - ecgStartTime;
  
  // Calculate data indices
  const ecgDataPerSecond = data.length / waveform.ecgDuration;
  const startIndex = Math.floor(relativeStartTime * ecgDataPerSecond);
  const endIndex = Math.min(data.length, Math.ceil(relativeEndTime * ecgDataPerSecond));
  const visibleData = endIndex - startIndex;

  if (visibleData <= 0) return;

  // Calculate canvas position for ECG waveform
  // ECG should only occupy its portion of the canvas
  const canvasStartX = ((visibleEcgStart - startTime) / (endTime - startTime)) * actualWidth;
  const canvasEndX = ((visibleEcgEnd - startTime) / (endTime - startTime)) * actualWidth;
  const canvasEcgWidth = canvasEndX - canvasStartX;

  const barWidth = canvasEcgWidth / visibleData;
  const halfHeight = height / 2;
  
  // Draw R-peak markers first (behind waveform)
  // R-peak times are in absolute audio time, so use them directly
  for (const rPeakTime of waveform.beats) {
    if (rPeakTime >= startTime && rPeakTime <= endTime) {
      const x = ((rPeakTime - startTime) / (endTime - startTime)) * actualWidth;
      
      // Debug first few peaks
      if (waveform.beats.indexOf(rPeakTime) < 3) {
        console.log('[DEBUG-ECGWaveformVis] R-peak position:', {
          beatIndex: waveform.beats.indexOf(rPeakTime),
          rPeakTime,
          x,
          startTime,
          endTime,
          actualWidth,
          calculation: `((${rPeakTime} - ${startTime}) / (${endTime} - ${startTime})) * ${actualWidth} = ${x}`
        });
      }
      
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
  
  // Draw ECG waveform as a continuous line
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

    if (firstPoint) {
      ctx.moveTo(x, y);
      firstPoint = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Draw fill under the waveform for played/unplayed distinction
  const gradient = ctx.createLinearGradient(0, yOffset, actualWidth, yOffset + height);
  gradient.addColorStop(0, 'rgba(168, 85, 247, 0.1)');
  gradient.addColorStop(1, 'rgba(233, 213, 255, 0.05)');
  ctx.lineTo(actualWidth, yOffset + halfHeight);
  ctx.lineTo(0, yOffset + halfHeight);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Draw R-peak markers on top (triangles at top)
  for (const rPeakTime of waveform.beats) {
    if (rPeakTime >= startTime && rPeakTime <= endTime) {
      const x = ((rPeakTime - startTime) / (endTime - startTime)) * actualWidth;

      // Purple triangle marker at top
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.moveTo(x, yOffset + 8);
      ctx.lineTo(x - 4, yOffset + 14);
      ctx.lineTo(x + 4, yOffset + 14);
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
  
  // Draw time markers (only on the last waveform)
  // This will be drawn once at the bottom
}

function drawAllWaveforms() {
  if (ecgWaveforms.value.length === 0) {
    console.log('[DEBUG-ECGWaveformVis] drawAllWaveforms: no waveforms');
    return;
  }
  
  const container = containerRef.value;
  if (!container) {
    console.log('[DEBUG-ECGWaveformVis] drawAllWaveforms: no container');
    return;
  }
  
  // CRITICAL: Ensure canvasWidth is valid before drawing
  if (canvasWidth.value <= 0) {
    console.warn('[DEBUG-ECGWaveformVis] drawAllWaveforms: invalid canvasWidth, skipping draw');
    return;
  }
  
  console.log('[DEBUG-ECGWaveformVis] drawAllWaveforms START:', {
    timestamp: new Date().toISOString(),
    waveformsCount: ecgWaveforms.value.length,
    containerWidth: container.clientWidth,
    canvasWidth: canvasWidth.value,
    windowDuration: windowDuration.value,
    waveforms: ecgWaveforms.value.map(w => ({
      fileId: w.fileId.substring(0, 8),
      fileName: w.fileName,
      beatsCount: w.beats.length,
      firstBeats: w.beats.slice(0, 5),
      dataLength: w.data.length,
      extractedWindowDuration: w.extractedWindowDuration,
      extractedCanvasWidth: w.extractedCanvasWidth
    }))
  });
  
  // 创建或重用 canvas 元素
  ecgWaveforms.value.forEach((waveform, index) => {
    let canvas = canvasElements.value.get(waveform.fileId);
    
    // 只在 canvas 不存在时创建
    if (!canvas) {
      console.log('[ECG] Creating new canvas for:', waveform.fileName);
      canvas = document.createElement('canvas');
      canvas.className = 'w-full bg-purple-50 rounded-lg cursor-pointer select-none transition-all mb-2';
      canvas.style.height = `${canvasHeightPerECG}px`;
      canvas.title = `${waveform.fileName} - 点击跳转到指定位置`;
      canvas.addEventListener('click', handleCanvasClick);
      
      canvasElements.value.set(waveform.fileId, canvas);
      container.appendChild(canvas);
      
      // 等待 DOM 更新后再绘制
      setTimeout(() => {
        console.log('[ECG] Canvas appended, size:', {
          clientWidth: canvas!.clientWidth,
          offsetWidth: canvas!.offsetWidth,
          style: canvas!.style.width
        });
      }, 0);
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // CRITICAL: Ensure canvas dimensions match current canvasWidth
    // If canvasWidth doesn't match canvas.clientWidth, use clientWidth
    const actualCanvasWidth = canvas.clientWidth || canvasWidth.value;
    if (Math.abs(actualCanvasWidth - canvasWidth.value) > 1) {
      console.warn('[ECG-WV] Canvas width mismatch detected:', {
        canvasWidth: canvasWidth.value,
        canvasClientWidth: canvas.clientWidth,
        containerWidth: containerRef.value?.clientWidth,
        fileName: waveform.fileName
      });
      // Use actual client width to avoid scaling issues
      canvasWidth.value = actualCanvasWidth;
    }
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasWidth.value * dpr;
    canvas.height = canvasHeightPerECG * dpr;
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeightPerECG);
    
    console.log('[DEBUG-ECGWaveformVis] Canvas setup:', {
      fileName: waveform.fileName,
      canvasWidth: canvasWidth.value,
      canvasClientWidth: canvas.clientWidth,
      canvasPhysicalWidth: canvas.width,
      dpr,
      containerWidth: containerRef.value?.clientWidth
    });
    
    // Draw waveform
    drawWaveform(ctx, waveform, 0, canvasHeightPerECG);
    
    // Draw filename label
    ctx.fillStyle = '#7c3aed';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(waveform.fileName, 8, 4);
    
    // Draw time markers (only on last canvas)
    if (index === ecgWaveforms.value.length - 1) {
      const { startTime, endTime } = getVisibleTimeRange();
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      
      const timeStep = windowDuration.value <= 5 ? 1 : windowDuration.value <= 30 ? 2 : 5;
      // CRITICAL: Use canvasWidth.value to match R-peak and waveform rendering
      for (let t = Math.ceil(startTime); t <= Math.floor(endTime); t += timeStep) {
        const x = ((t - startTime) / (endTime - startTime)) * canvasWidth.value;
        ctx.fillText(formatTime(t), x, canvasHeightPerECG - 14);
      }
    }
  });
  
  // 移除已删除的 ECG 文件对应的 canvas
  const currentFileIds = new Set(ecgWaveforms.value.map(w => w.fileId));
  for (const [fileId, canvas] of canvasElements.value.entries()) {
    if (!currentFileIds.has(fileId)) {
      canvas.remove();
      canvasElements.value.delete(fileId);
    }
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function handleCanvasClick(e: MouseEvent) {
  const canvas = e.currentTarget as HTMLCanvasElement;
  const duration = audioStore.duration || 0;
  if (!duration) return;
  
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  // CRITICAL: Use canvasWidth.value to match R-peak and waveform rendering
  const { startTime, endTime } = getVisibleTimeRange();
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

// Handle global seek events
function handleGlobalSeek(e: Event) {
  const customEvent = e as CustomEvent;
  if (customEvent.detail !== undefined) {
    drawAllWaveforms();
  }
}

function updateCanvasSize() {
  if (containerRef.value) {
    // Match the parent container's actual content width
    const newWidth = containerRef.value.clientWidth;
    console.log('[ECG] updateCanvasSize:', {
      oldWidth: canvasWidth.value,
      newWidth,
      containerClientWidth: containerRef.value.clientWidth,
      containerOffsetWidth: containerRef.value.offsetWidth,
      hasWaveforms: ecgWaveforms.value.length > 0,
      widthDiff: Math.abs(newWidth - canvasWidth.value)
    });
    
    // Always update canvasWidth if newWidth is valid (> 0)
    if (newWidth > 0) {
      const widthDiff = Math.abs(newWidth - canvasWidth.value);
      const oldWidth = canvasWidth.value;
      
      // Update canvas width
      canvasWidth.value = newWidth;
      
      // Only trigger re-extraction/redraw if we already have waveforms
      // (initial load will be handled by loadAllECGWaveforms)
      if (ecgWaveforms.value.length > 0 && oldWidth > 0) {
        if (widthDiff > 1) {
          console.log(`[ECG-WV] Canvas width changed by ${widthDiff}px (${oldWidth}px -> ${newWidth}px), re-extracting waveforms`);
          // Use nextTick to ensure DOM is updated, then re-extract waveforms
          requestAnimationFrame(() => {
            loadAllECGWaveforms();
          });
        } else {
          console.log(`[ECG-WV] Canvas width changed by ${widthDiff}px (within 1px tolerance), only redrawing`);
          // Minor change - just redraw
          requestAnimationFrame(() => {
            drawAllWaveforms();
          });
        }
      } else if (oldWidth === 0 && newWidth > 0) {
        console.log(`[ECG-WV] Canvas width initialized from 0 to ${newWidth}px`);
        // Initial setup - width just became available
        // No need to trigger load here as it will be called by watch or onMounted
      }
    }
  }
}

watch(() => audioStore.ecgDataList.length, (newLength, oldLength) => {
  console.log('[ECG-WV] ecgDataList.length changed:', {
    oldLength,
    newLength,
    currentWaveformsCount: ecgWaveforms.value.length,
    timestamp: new Date().toISOString()
  });
  
  if (newLength > 0) {
    // CRITICAL: Clear old waveform cache when loading new ECG data
    // This prevents reusing waveforms from previous workspace
    console.log('[ECG-WV] Clearing old waveform cache before loading new ECG data');
    ecgWaveforms.value = [];
    
    // CRITICAL: Reset canvasWidth to 0 to force re-initialization from container
    // This prevents using stale width values from previous workspace
    const oldCanvasWidth = canvasWidth.value;
    canvasWidth.value = 0;
    console.log('[ECG-WV] Reset canvasWidth from', oldCanvasWidth, 'to 0');
    
    // 延迟加载，确保容器已渲染
    requestAnimationFrame(() => {
      setTimeout(() => {
        updateCanvasSize();
        loadAllECGWaveforms();  // Will wait for container if width is still 0
      }, 100);
    });
  } else if (oldLength > 0) {
    // ECG data removed - clear everything
    console.log('[ECG-WV] Clearing waveforms and canvas elements');
    ecgWaveforms.value = [];
    canvasElements.value.clear();
    if (containerRef.value) {
      while (containerRef.value.firstChild) {
        containerRef.value.removeChild(containerRef.value.firstChild);
      }
    }
  }
}, { immediate: true });

watch(() => audioStore.currentTime, () => {
  if (!audioStore.isPlaying) {
    realTimePosition.value = audioStore.currentTime;
  }
  
  if (ecgWaveforms.value.length > 0) {
    drawAllWaveforms();
  }
});

// Watch shared view parameters
watch(() => [windowDuration.value, viewOffset.value, fixedViewCenterTime.value, autoFollow.value], () => {
  if (ecgWaveforms.value.length > 0) {
    // Check if we need to re-extract waveform data
    const needsReExtraction = shouldReExtractWaveforms();
    
    if (needsReExtraction) {
      // Window duration or canvas width changed significantly - re-extract waveforms
      console.log('[ECG-WV] View parameters changed, re-extracting waveforms');
      loadAllECGWaveforms();
    } else {
      // Only view offset/center changed - just redraw with existing waveform data
      drawAllWaveforms();
    }
  }
}, { deep: true });

let animationFrameId: number | null = null;
let lastDrawTime = 0;
const DRAW_INTERVAL = 1000 / 30; // 30 FPS 限制

function startAnimationLoop() {
  function loop(currentTime: number) {
    // 限制绘制频率
    if (currentTime - lastDrawTime < DRAW_INTERVAL) {
      animationFrameId = requestAnimationFrame(loop);
      return;
    }
    lastDrawTime = currentTime;
    
    realTimePosition.value = getRealTimeCurrentTime();
    
    if (ecgWaveforms.value.length > 0) {
      drawAllWaveforms();
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

watch(() => audioStore.isPlaying, (isPlaying) => {
  if (isPlaying) {
    startAnimationLoop();
  } else {
    stopAnimationLoop();
    drawAllWaveforms();
  }
});

onMounted(() => {
  console.log('[ECG] Component mounted:', {
    containerExists: !!containerRef.value,
    containerWidth: containerRef.value?.clientWidth,
    ecgDataCount: audioStore.ecgDataList.length
  });
  
  // 确保容器已渲染后再更新尺寸和加载波形
  requestAnimationFrame(() => {
    updateCanvasSize();
    if (audioStore.ecgDataList.length > 0) {
      setTimeout(() => {
        loadAllECGWaveforms();
      }, 100);
    }
  });
  
  window.addEventListener('resize', updateCanvasSize);
  window.addEventListener('seek', handleGlobalSeek as EventListener);
});

onUnmounted(() => {
  stopAnimationLoop();
  canvasElements.value.clear();
  window.removeEventListener('resize', updateCanvasSize);
  window.removeEventListener('seek', handleGlobalSeek as EventListener);
});
</script>

<template>
  <div 
    v-if="audioStore.hasECG"
    class="bg-white rounded-xl shadow-sm border-2 border-purple-100"
  >
    <div class="p-6">
      <!-- Header -->
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
              v-if="isLoading"
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
        v-if="isLoading"
        class="flex items-center justify-center h-[120px] bg-purple-50 rounded-lg"
      >
        <div class="flex flex-col items-center gap-2">
          <div class="animate-spin rounded-full h-8 w-8 border-2 border-purple-500 border-t-transparent" />
          <span class="text-sm text-purple-600">加载心电波形数据...</span>
        </div>
      </div>
    </div>
    
    <!-- ECG waveform canvases will be dynamically added here -->
    <div
      v-show="!isLoading && ecgWaveforms.length > 0"
      ref="containerRef"
      class="space-y-2 px-6"
    />
    
    <div class="p-6 pt-0">
      <div 
        v-if="!isLoading && ecgWaveforms.length === 0" 
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
  </div>
</template>
