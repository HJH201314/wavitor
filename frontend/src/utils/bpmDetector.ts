/**
 * Dynamic BPM Detection - detects actual beat positions rather than assuming fixed intervals
 */

export interface BeatInfo {
  bpm: number           // Average BPM
  confidence: number    // Detection confidence
  beats: number[]       // Actual beat timestamps in seconds
  localBPMs: { time: number; bpm: number }[] // Local BPM at different time points
}

export type BPMDetectionStrategy = 'standard' | 'advanced' | 'heartsound';

export type HeartSoundMode = 'simple' | 'standard' | 'precise';

export type S1S2Mode = 'auto' | 's1-only' | 's1-s2-pair';

export interface HeartSoundOptions {
  mode?: HeartSoundMode           // Detection mode: 'simple' (fast), 'standard' (balanced), 'precise' (accurate)
  sensitivity?: number            // Sensitivity level: 0.3-1.0, higher = more sensitive
  filterStrength?: number         // Low-pass filter cutoff: 150-250 Hz
  s1s2Mode?: S1S2Mode            // S1/S2 handling: 'auto' (intelligent), 's1-only' (ignore S2), 's1-s2-pair' (require pairs)
  noiseReduction?: boolean        // Enable noise reduction (default: false, uses fast moving average when enabled)
  minBPM?: number                 // Minimum heart rate (default: 40)
  maxBPM?: number                 // Maximum heart rate (default: 300)
}

export interface BPMDetectorOptions {
  minBPM?: number
  maxBPM?: number
  strategy?: BPMDetectionStrategy  // Detection strategy: 'standard' (simple), 'advanced' (with BPM change detection), or 'heartsound' (for heart sound audio)
  heartSoundOptions?: HeartSoundOptions  // Options for heart sound detection
  onProgress?: (progress: number, stage: string) => void  // Progress callback (0-1)
}

/**
 * Detect beats dynamically from an AudioBuffer (synchronous)
 * Returns actual beat positions, not a fixed grid
 */
export function detectBPM(
  audioBuffer: AudioBuffer,
  options: BPMDetectorOptions = {}
): BeatInfo {
  const { strategy = 'advanced' } = options;
  
  // Use wider BPM range for heart sounds
  let { minBPM = 60, maxBPM = 200 } = options;
  if (strategy === 'heartsound') {
    // For heart sounds, use options from heartSoundOptions if available
    const hsOptions = options.heartSoundOptions || {};
    minBPM = hsOptions.minBPM ?? options.minBPM ?? 40;
    maxBPM = hsOptions.maxBPM ?? options.maxBPM ?? 300;
  }
  
  console.log(`Using BPM detection strategy: ${strategy}, range: ${minBPM}-${maxBPM} BPM`);
  
  if (strategy === 'standard') {
    return detectBPMStandard(audioBuffer, minBPM, maxBPM);
  } else if (strategy === 'heartsound') {
    return detectBPMHeartSound(audioBuffer, minBPM, maxBPM, options.heartSoundOptions);
  } else {
    return detectBPMAdvanced(audioBuffer, minBPM, maxBPM);
  }
}

/**
 * Detect beats asynchronously (non-blocking)
 * Recommended for heart sound detection to avoid UI freeze
 */
export async function detectBPMAsync(
  audioBuffer: AudioBuffer,
  options: BPMDetectorOptions = {}
): Promise<BeatInfo> {
  const { strategy = 'advanced', onProgress } = options;
  
  // Use wider BPM range for heart sounds
  let { minBPM = 60, maxBPM = 200 } = options;
  if (strategy === 'heartsound') {
    // For heart sounds, use options from heartSoundOptions if available
    const hsOptions = options.heartSoundOptions || {};
    minBPM = hsOptions.minBPM ?? options.minBPM ?? 40;
    maxBPM = hsOptions.maxBPM ?? options.maxBPM ?? 300;
  }
  
  console.log(`[Async] Using BPM detection strategy: ${strategy}, range: ${minBPM}-${maxBPM} BPM`);
  
  // Report initial progress
  onProgress?.(0, '开始检测');
  
  // Yield to main thread
  await yieldToMainThread();
  
  let result: BeatInfo;
  
  if (strategy === 'standard') {
    result = await detectBPMStandardAsync(audioBuffer, minBPM, maxBPM, onProgress);
  } else if (strategy === 'heartsound') {
    result = await detectBPMHeartSoundAsync(audioBuffer, minBPM, maxBPM, options.heartSoundOptions, onProgress);
  } else {
    result = await detectBPMAdvancedAsync(audioBuffer, minBPM, maxBPM, onProgress);
  }
  
  onProgress?.(1, '检测完成');
  
  return result;
}

/**
 * Yield control back to the main thread
 */
function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Standard detection strategy (async version)
 */
async function detectBPMStandardAsync(
  audioBuffer: AudioBuffer,
  minBPM: number,
  maxBPM: number,
  onProgress?: (progress: number, stage: string) => void
): Promise<BeatInfo> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  onProgress?.(0.2, '检测 onset');
  const { onsetTimes, onsetStrengths } = detectOnsets(channelData, sampleRate, minBPM, maxBPM);
  
  await yieldToMainThread();
  onProgress?.(0.5, '选择节拍');
  const beats = selectBeatsSimple(onsetTimes, onsetStrengths, minBPM, maxBPM);
  console.log(`[Standard] Detected ${beats.length} beats`);

  await yieldToMainThread();
  onProgress?.(0.7, '计算 BPM');
  const localBPMs = calculateLocalBPM(beats, duration);
  const avgBPM = calculateAverageBPM(beats);
  const confidence = calculateConfidence(beats, avgBPM);

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats,
    localBPMs,
  };
}

/**
 * Standard detection strategy (synchronous version)
 */
function detectBPMStandard(
  audioBuffer: AudioBuffer,
  minBPM: number,
  maxBPM: number
): BeatInfo {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  const { onsetTimes, onsetStrengths } = detectOnsets(channelData, sampleRate, minBPM, maxBPM);
  const beats = selectBeatsSimple(onsetTimes, onsetStrengths, minBPM, maxBPM);
  console.log(`[Standard] Detected ${beats.length} beats`);

  const localBPMs = calculateLocalBPM(beats, duration);
  const avgBPM = calculateAverageBPM(beats);
  const confidence = calculateConfidence(beats, avgBPM);

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats,
    localBPMs,
  };
}

/**
 * Advanced detection strategy (async version)
 */
async function detectBPMAdvancedAsync(
  audioBuffer: AudioBuffer,
  minBPM: number,
  maxBPM: number,
  onProgress?: (progress: number, stage: string) => void
): Promise<BeatInfo> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  onProgress?.(0.2, '检测 onset');
  const { onsetTimes, onsetStrengths } = detectOnsets(channelData, sampleRate, minBPM, maxBPM);

  await yieldToMainThread();
  onProgress?.(0.4, '高级选择');
  let beats = selectBeatsAdvanced(onsetTimes, onsetStrengths, minBPM, maxBPM);
  console.log(`[Advanced] Initial beat selection: ${beats.length} beats`);

  await yieldToMainThread();
  onProgress?.(0.6, '填补缺失节拍');
  const beatsBeforeFill = beats.length;
  beats = detectAndFillMissingBeats(beats, onsetTimes, onsetStrengths, minBPM, maxBPM);
  if (beats.length > beatsBeforeFill) {
    console.log(`[Advanced] Filled ${beats.length - beatsBeforeFill} missing beats`);
  }

  await yieldToMainThread();
  onProgress?.(0.8, '计算 BPM');
  const localBPMs = calculateLocalBPM(beats, duration);
  const avgBPM = calculateAverageBPM(beats);
  const confidence = calculateConfidence(beats, avgBPM);

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats,
    localBPMs,
  };
}

/**
 * Advanced detection strategy (synchronous version)
 */
function detectBPMAdvanced(
  audioBuffer: AudioBuffer,
  minBPM: number,
  maxBPM: number
): BeatInfo {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  const { onsetTimes, onsetStrengths } = detectOnsets(channelData, sampleRate, minBPM, maxBPM);
  let beats = selectBeatsAdvanced(onsetTimes, onsetStrengths, minBPM, maxBPM);
  console.log(`[Advanced] Initial beat selection: ${beats.length} beats`);

  const beatsBeforeFill = beats.length;
  beats = detectAndFillMissingBeats(beats, onsetTimes, onsetStrengths, minBPM, maxBPM);
  if (beats.length > beatsBeforeFill) {
    console.log(`[Advanced] Filled ${beats.length - beatsBeforeFill} missing beats`);
  }

  const localBPMs = calculateLocalBPM(beats, duration);
  const avgBPM = calculateAverageBPM(beats);
  const confidence = calculateConfidence(beats, avgBPM);

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats,
    localBPMs,
  };
}

/**
 * Heart sound detection strategy (synchronous fallback)
 */
function detectBPMHeartSound(
  audioBuffer: AudioBuffer,
  minBPM: number,
  maxBPM: number,
  options: HeartSoundOptions = {}
): BeatInfo {
  console.warn('[HeartSound] Using synchronous detection - may cause UI freeze. Consider using detectBPMAsync instead.');
  
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  const {
    mode = 'standard',
    sensitivity = 0.6,
    filterStrength = 200,
    s1s2Mode = 'auto',
    noiseReduction = false
  } = options;

  let processedData = channelData;
  processedData = applyLowPassFilter(processedData, sampleRate, filterStrength);
  
  if (noiseReduction) {
    processedData = applyNoiseReduction(processedData, sampleRate);
  }

  const { onsetTimes, onsetStrengths } = detectHeartSoundOnsets(
    processedData, sampleRate, minBPM, maxBPM, mode, sensitivity
  );

  let beats: number[];
  beats = selectHeartSoundBeatsIntelligent(onsetTimes, onsetStrengths, minBPM, maxBPM, s1s2Mode, sensitivity);

  beats = validateAndRefineBeats(beats, minBPM, maxBPM);
  const localBPMs = calculateLocalBPM(beats, duration);
  const avgBPM = calculateAverageBPM(beats);
  const confidence = calculateHeartSoundConfidence(beats, avgBPM, mode);

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats: beats,
    localBPMs,
  };
}

/**
 * Heart sound detection strategy (async, non-blocking)
 * Specialized for detecting heart beats from heart sound audio
 */
async function detectBPMHeartSoundAsync(
  audioBuffer: AudioBuffer,
  minBPM: number,
  maxBPM: number,
  options: HeartSoundOptions = {},
  onProgress?: (progress: number, stage: string) => void
): Promise<BeatInfo> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const channelData = audioBuffer.getChannelData(0);

  // Default options
  const {
    mode = 'standard',
    sensitivity = 0.6,
    filterStrength = 200,
    s1s2Mode = 'auto',
    noiseReduction = false
  } = options;

  console.log(`[HeartSound] Starting detection (${minBPM}-${maxBPM} BPM)`, {
    mode,
    sensitivity,
    filterStrength,
    s1s2Mode,
    noiseReduction
  });

  // Step 1: Preprocessing - filter and noise reduction
  onProgress?.(0.1, '预处理音频');
  let processedData = channelData;
  
  // Apply low-pass filter for heart sound frequency range
  processedData = await applyLowPassFilterAsync(processedData, sampleRate, filterStrength);
  
  await yieldToMainThread();
  onProgress?.(0.2, '滤波完成');
  
  // Apply noise reduction if enabled
  if (noiseReduction) {
    processedData = await applyNoiseReductionAsync(processedData, sampleRate);
    await yieldToMainThread();
    onProgress?.(0.3, '降噪完成');
  }

  // Step 2: Detect all onsets based on mode
  onProgress?.(0.4, '检测 onset');
  const { onsetTimes, onsetStrengths } = await detectHeartSoundOnsetsAsync(
    processedData, 
    sampleRate, 
    minBPM, 
    maxBPM,
    mode,
    sensitivity
  );
  console.log(`[HeartSound] Detected ${onsetTimes.length} onset candidates`);
  
  await yieldToMainThread();
  onProgress?.(0.6, '选择心拍');

  // Step 3: Intelligent beat selection with S1/S2 handling
  let beats: number[];
  beats = selectHeartSoundBeatsIntelligent(onsetTimes, onsetStrengths, minBPM, maxBPM, s1s2Mode, sensitivity);
  console.log(`[HeartSound] Selected ${beats.length} heart beats (mode: ${s1s2Mode})`);

  await yieldToMainThread();
  onProgress?.(0.7, '验证节拍');

  // Step 4: Post-processing - validate and refine beats
  beats = validateAndRefineBeats(beats, minBPM, maxBPM);
  console.log(`[HeartSound] Final validated beats: ${beats.length}`);

  await yieldToMainThread();
  onProgress?.(0.8, '计算 BPM');

  // Step 5: Calculate local BPM
  const localBPMs = calculateLocalBPM(beats, duration);

  // Step 6: Calculate average BPM
  const avgBPM = calculateAverageBPM(beats);

  // Step 7: Calculate confidence
  const confidence = calculateHeartSoundConfidence(beats, avgBPM, mode);

  onProgress?.(0.9, '完成');

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats: beats,
    localBPMs,
  };
}

/**
 * Apply low-pass filter asynchronously with chunking
 */
async function applyLowPassFilterAsync(
  data: Float32Array,
  sampleRate: number,
  cutoffFreq: number
): Promise<Float32Array> {
  const filtered = new Float32Array(data.length);
  const RC = 1.0 / (2.0 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const alpha = dt / (RC + dt);

  filtered[0] = data[0];
  
  const chunkSize = 50000; // Process in chunks
  for (let start = 1; start < data.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, data.length);
    for (let i = start; i < end; i++) {
      filtered[i] = filtered[i - 1] + alpha * (data[i] - filtered[i - 1]);
    }
    
    // Yield to main thread every chunk
    if (end < data.length) {
      await yieldToMainThread();
    }
  }

  return filtered;
}

/**
 * Apply noise reduction asynchronously with chunking
 * Optimized: Uses moving average instead of median filter for better performance
 */
async function applyNoiseReductionAsync(
  data: Float32Array,
  sampleRate: number
): Promise<Float32Array> {
  const windowSize = Math.floor(sampleRate * 0.003); // 3ms window
  const result = new Float32Array(data.length);
  
  // Use moving average filter - much faster than median
  const chunkSize = 50000; // Larger chunks for faster processing
  
  for (let start = 0; start < data.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, data.length);
    
    for (let i = start; i < end; i++) {
      const windowStart = Math.max(0, i - windowSize);
      const windowEnd = Math.min(data.length, i + windowSize + 1);
      
      // Moving average (much faster than median)
      let sum = 0;
      let count = 0;
      for (let j = windowStart; j < windowEnd; j++) {
        sum += data[j] ?? 0;
        count++;
      }
      result[i] = count > 0 ? sum / count : 0;
    }
    
    // Yield to main thread every chunk
    if (end < data.length) {
      await yieldToMainThread();
    }
  }
  
  return result;
}

/**
 * Detect onsets asynchronously with chunking
 */
async function detectHeartSoundOnsetsAsync(
  channelData: Float32Array,
  sampleRate: number,
  minBPM: number,
  maxBPM: number,
  mode: HeartSoundMode = 'standard',
  sensitivity: number = 0.6
): Promise<{ onsetTimes: number[]; onsetStrengths: number[] }> {
  // Adjust parameters based on mode
  let hopSize: number;
  let windowSize: number;
  let thresholdMultiplier: number;
  
  switch (mode) {
    case 'simple':
      hopSize = Math.floor(sampleRate * 0.01);  // 10ms hop (faster)
      windowSize = hopSize * 2;  // 20ms window
      thresholdMultiplier = 0.5 - (sensitivity - 0.6) * 0.5;
      break;
    case 'precise':
      hopSize = Math.floor(sampleRate * 0.003);  // 3ms hop (highest resolution)
      windowSize = hopSize * 3;  // 9ms window
      thresholdMultiplier = 0.35 - (sensitivity - 0.6) * 0.5;
      break;
    case 'standard':
    default:
      hopSize = Math.floor(sampleRate * 0.005);  // 5ms hop (balanced)
      windowSize = hopSize * 2;  // 10ms window
      thresholdMultiplier = 0.4 - (sensitivity - 0.6) * 0.5;
  }
  
  console.log(`[HeartSound] Onset detection params: hopSize=${hopSize}, windowSize=${windowSize}, threshold=${thresholdMultiplier.toFixed(2)}`);
  
  // Calculate energy in each frame (with chunking)
  const numFrames = Math.floor((channelData.length - windowSize) / hopSize);
  const energies = new Float32Array(numFrames);
  
  const frameChunkSize = 5000;
  for (let frameStart = 0; frameStart < numFrames; frameStart += frameChunkSize) {
    const frameEnd = Math.min(frameStart + frameChunkSize, numFrames);
    
    for (let i = frameStart; i < frameEnd; i++) {
      const start = i * hopSize;
      let energy = 0;
      for (let j = 0; j < windowSize; j++) {
        const sample = channelData[start + j] ?? 0;
        energy += sample * sample;
      }
      energies[i] = Math.sqrt(energy / windowSize);
    }
    
    if (frameEnd < numFrames) {
      await yieldToMainThread();
    }
  }

  // Calculate first-order difference (onset strength)
  const onsetStrength = new Float32Array(numFrames - 1);
  for (let i = 1; i < numFrames; i++) {
    onsetStrength[i - 1] = Math.max(0, energies[i] - energies[i - 1]);
  }

  // Normalize
  const maxStrength = Math.max(...onsetStrength);
  if (maxStrength > 0) {
    for (let i = 0; i < onsetStrength.length; i++) {
      onsetStrength[i] /= maxStrength;
    }
  }

  await yieldToMainThread();

  // Adaptive thresholding
  const thresholdWindowSize = Math.floor(sampleRate / hopSize * 0.3); // 300ms window
  const threshold = calculateAdaptiveThreshold(onsetStrength, thresholdWindowSize, thresholdMultiplier);

  // Debug: Check threshold statistics
  const thresholdStats = {
    min: Math.min(...threshold),
    max: Math.max(...threshold),
    avg: threshold.reduce((sum, val) => sum + val, 0) / threshold.length
  };
  console.log(`[HeartSound] Adaptive threshold stats:`, thresholdStats);
  console.log(`[HeartSound] OnsetStrength range: ${Math.min(...onsetStrength).toFixed(3)} - ${Math.max(...onsetStrength).toFixed(3)}`);

  // Peak picking with chunking
  const minPeakDistance = mode === 'precise' 
    ? Math.floor(sampleRate / hopSize * 0.015)  // 15ms for precise
    : Math.floor(sampleRate / hopSize * 0.02);  // 20ms for others
    
  const onsetTimes: number[] = [];
  const onsetStrengths: number[] = [];
  
  let lastOnsetFrame = -minPeakDistance;
  const checkRange = mode === 'precise' ? 3 : 2;

  // Process peak picking in chunks to avoid blocking
  const peakChunkSize = 10000;
  for (let chunkStart = 2; chunkStart < onsetStrength.length - 2; chunkStart += peakChunkSize) {
    const chunkEnd = Math.min(chunkStart + peakChunkSize, onsetStrength.length - 2);
    
    for (let i = chunkStart; i < chunkEnd; i++) {
      if (onsetStrength[i] <= threshold[i]) continue;
      
      // Check if local maximum
      let isLocalMax = true;
      for (let offset = -checkRange; offset <= checkRange; offset++) {
        if (offset === 0) continue;
        const checkIdx = i + offset;
        if (checkIdx >= 0 && checkIdx < onsetStrength.length) {
          if (onsetStrength[i] < onsetStrength[checkIdx]) {
            isLocalMax = false;
            break;
          }
        }
      }
      
      if (!isLocalMax) continue;
      if (i - lastOnsetFrame < minPeakDistance) continue;

      const time = (i * hopSize) / sampleRate;
      onsetTimes.push(time);
      onsetStrengths.push(onsetStrength[i]);
      lastOnsetFrame = i;
    }
    
    // Yield to main thread every chunk
    if (chunkEnd < onsetStrength.length - 2) {
      await yieldToMainThread();
    }
  }

  console.log(`[HeartSound] Peak picking: found ${onsetTimes.length} onset candidates (last at ${onsetTimes[onsetTimes.length - 1]?.toFixed(2)}s)`);

  return { onsetTimes, onsetStrengths };
}

/**
 * Apply simple low-pass filter for heart sound frequency range
 */
function applyLowPassFilter(
  data: Float32Array,
  sampleRate: number,
  cutoffFreq: number
): Float32Array {
  const filtered = new Float32Array(data.length);
  const RC = 1.0 / (2.0 * Math.PI * cutoffFreq);
  const dt = 1.0 / sampleRate;
  const alpha = dt / (RC + dt);

  filtered[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    filtered[i] = filtered[i - 1] + alpha * (data[i] - filtered[i - 1]);
  }

  return filtered;
}

/**
 * Apply noise reduction using moving average filtering
 * Optimized: Uses moving average instead of median for better performance
 */
function applyNoiseReduction(
  data: Float32Array,
  sampleRate: number
): Float32Array {
  const windowSize = Math.floor(sampleRate * 0.003); // 3ms window
  const result = new Float32Array(data.length);
  
  // Use moving average filter - much faster than median
  for (let i = 0; i < data.length; i++) {
    const windowStart = Math.max(0, i - windowSize);
    const windowEnd = Math.min(data.length, i + windowSize + 1);
    
    let sum = 0;
    let count = 0;
    for (let j = windowStart; j < windowEnd; j++) {
      sum += data[j] ?? 0;
      count++;
    }
    result[i] = count > 0 ? sum / count : 0;
  }
  
  return result;
}

/**
 * Detect onsets in heart sound with adaptive parameters based on mode
 */
function detectHeartSoundOnsets(
  channelData: Float32Array,
  sampleRate: number,
  minBPM: number,
  maxBPM: number,
  mode: HeartSoundMode = 'standard',
  sensitivity: number = 0.6
): { onsetTimes: number[]; onsetStrengths: number[] } {
  // Adjust parameters based on mode
  let hopSize: number;
  let windowSize: number;
  let thresholdMultiplier: number;
  
  switch (mode) {
    case 'simple':
      hopSize = Math.floor(sampleRate * 0.01);  // 10ms hop (faster)
      windowSize = hopSize * 2;  // 20ms window
      thresholdMultiplier = 0.5 - (sensitivity - 0.6) * 0.5;
      break;
    case 'precise':
      hopSize = Math.floor(sampleRate * 0.003);  // 3ms hop (highest resolution)
      windowSize = hopSize * 3;  // 9ms window
      thresholdMultiplier = 0.35 - (sensitivity - 0.6) * 0.5;
      break;
    case 'standard':
    default:
      hopSize = Math.floor(sampleRate * 0.005);  // 5ms hop (balanced)
      windowSize = hopSize * 2;  // 10ms window
      thresholdMultiplier = 0.4 - (sensitivity - 0.6) * 0.5;
  }
  
  console.log(`[HeartSound] Onset detection params: hopSize=${hopSize}, windowSize=${windowSize}, threshold=${thresholdMultiplier.toFixed(2)}`);
  
  // Calculate energy in each frame
  const numFrames = Math.floor((channelData.length - windowSize) / hopSize);
  const energies = new Float32Array(numFrames);
  
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      const sample = channelData[start + j];
      energy += sample * sample;
    }
    energies[i] = Math.sqrt(energy / windowSize);
  }

  // Calculate first-order difference (onset strength)
  const onsetStrength = new Float32Array(numFrames - 1);
  for (let i = 1; i < numFrames; i++) {
    onsetStrength[i - 1] = Math.max(0, energies[i] - energies[i - 1]);
  }

  // Normalize
  const maxStrength = Math.max(...onsetStrength);
  if (maxStrength > 0) {
    for (let i = 0; i < onsetStrength.length; i++) {
      onsetStrength[i] /= maxStrength;
    }
  }

  // Adaptive thresholding
  const thresholdWindowSize = Math.floor(sampleRate / hopSize * 0.3); // 300ms window
  const threshold = calculateAdaptiveThreshold(onsetStrength, thresholdWindowSize, thresholdMultiplier);

  // Peak picking with mode-dependent constraints
  const minPeakDistance = mode === 'precise' 
    ? Math.floor(sampleRate / hopSize * 0.015)  // 15ms for precise
    : Math.floor(sampleRate / hopSize * 0.02);  // 20ms for others
    
  const onsetTimes: number[] = [];
  const onsetStrengths: number[] = [];
  
  let lastOnsetFrame = -minPeakDistance;

  for (let i = 2; i < onsetStrength.length - 2; i++) {
    // Check if above threshold
    if (onsetStrength[i] <= threshold[i]) continue;
    
    // Check if local maximum (strictness depends on mode)
    const checkRange = mode === 'precise' ? 3 : 2;
    let isLocalMax = true;
    
    for (let offset = -checkRange; offset <= checkRange; offset++) {
      if (offset === 0) continue;
      const checkIdx = i + offset;
      if (checkIdx >= 0 && checkIdx < onsetStrength.length) {
        if (onsetStrength[i] < onsetStrength[checkIdx]) {
          isLocalMax = false;
          break;
        }
      }
    }
    
    if (!isLocalMax) continue;
    
    // Check minimum distance from last onset
    if (i - lastOnsetFrame < minPeakDistance) continue;

    // This is a valid onset
    const time = (i * hopSize) / sampleRate;
    onsetTimes.push(time);
    onsetStrengths.push(onsetStrength[i]);
    lastOnsetFrame = i;
  }

  console.log(`[HeartSound] Synchronous detection: found ${onsetTimes.length} onset candidates (duration: ${(onsetTimes[onsetTimes.length - 1] || 0).toFixed(2)}s)`);

  return { onsetTimes, onsetStrengths };
}

/**
 * Intelligent heart sound beat selection with adaptive S1/S2 handling
 * Supports three modes:
 * - 'auto': Automatically detect and handle S1/S2 pairs adaptively (handles missing S2)
 * - 's1-only': Only detect S1 sounds, ignore S2
 * - 's1-s2-pair': Require S1-S2 pairs, use S1 as beat marker
 */
function selectHeartSoundBeatsIntelligent(
  onsetTimes: number[],
  onsetStrengths: number[],
  minBPM: number,
  maxBPM: number,
  s1s2Mode: S1S2Mode = 'auto',
  sensitivity: number = 0.6
): number[] {
  if (onsetTimes.length === 0) return [];
  if (onsetTimes.length === 1) return [onsetTimes[0]];

  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;
  
  console.log(`[HeartSound] Intelligent selection mode: ${s1s2Mode}`);

  // Step 1: Analyze onset patterns to identify potential S1/S2 pairs
  interface OnsetInfo {
    time: number;
    strength: number;
    isS2: boolean;      // Marked as S2
    isPaired: boolean;   // Part of an S1-S2 pair
    pairIndex: number;   // Index of pair partner (-1 if not paired)
  }

  const onsetInfo: OnsetInfo[] = onsetTimes.map((time, i) => ({
    time,
    strength: onsetStrengths[i],
    isS2: false,
    isPaired: false,
    pairIndex: -1
  }));

  // Constants for S1/S2 timing
  const minS1S2Gap = 0.02;  // 20ms minimum to distinguish S1 and S2
  const maxS1S2Gap = 0.18;  // 180ms maximum systole duration
  const minS2S1Gap = 0.15;  // 150ms minimum diastole (gap from S2 to next S1)

  // Step 2: Identify S1-S2 pairs based on timing and strength patterns
  for (let i = 0; i < onsetInfo.length - 1; i++) {
    if (onsetInfo[i].isPaired) continue;

    const current = onsetInfo[i];
    const next = onsetInfo[i + 1];
    const gap = next.time - current.time;

    // Check if this gap matches S1-S2 timing (systole)
    if (gap >= minS1S2Gap && gap <= maxS1S2Gap) {
      // Typically S1 is louder, but not always
      // Consider strength ratio and absolute strengths
      const strengthRatio = current.strength / next.strength;

      // Determine which is S1 and which is S2
      let s1Index = i;
      let s2Index = i + 1;

      // If next is significantly stronger, swap
      if (strengthRatio < 0.7) {  // Next is >40% stronger
        s1Index = i + 1;
        s2Index = i;
      }

      // Both should be reasonably strong to be a valid pair
      const minPairStrength = 0.15;
      if (onsetInfo[s1Index].strength > minPairStrength && 
          onsetInfo[s2Index].strength > minPairStrength * 0.5) {
        
        // Check if next onset is far enough (diastole) to confirm this is a valid pair
        const hasValidDiastole = i + 2 >= onsetInfo.length || 
                                 (onsetInfo[i + 2].time - next.time >= minS2S1Gap);

        if (hasValidDiastole) {
          // Mark as S1-S2 pair
          onsetInfo[s1Index].isPaired = true;
          onsetInfo[s1Index].pairIndex = s2Index;
          onsetInfo[s2Index].isPaired = true;
          onsetInfo[s2Index].isS2 = true;
          onsetInfo[s2Index].pairIndex = s1Index;
        }
      }
    }
  }

  const pairCount = onsetInfo.filter(o => o.isPaired && !o.isS2).length;
  const s2Count = onsetInfo.filter(o => o.isS2).length;
  console.log(`[HeartSound] Identified ${pairCount} S1-S2 pairs (${s2Count} S2 sounds)`);

  // Step 3: Select beats based on mode
  let beats: number[];

  if (s1s2Mode === 's1-only') {
    // Mode 1: Only select S1 sounds (strongest onsets)
    beats = selectS1Only(onsetInfo, minBPM, maxBPM, sensitivity);
  } else if (s1s2Mode === 's1-s2-pair') {
    // Mode 2: Require S1-S2 pairs, skip unpaired onsets
    beats = selectS1S2Pairs(onsetInfo, minBPM, maxBPM, sensitivity);
  } else {
    // Mode 3 (auto): Adaptive selection - handle both paired and unpaired
    beats = selectAdaptive(onsetInfo, minBPM, maxBPM, sensitivity);
  }

  console.log(`[HeartSound] Selected ${beats.length} beats using mode: ${s1s2Mode}`);
  if (beats.length > 0) {
    console.log(`[HeartSound] Beat range: ${beats[0].toFixed(2)}s - ${beats[beats.length - 1].toFixed(2)}s`);
  }

  return beats;
}

/**
 * Select only S1 sounds (ignore S2)
 */
function selectS1Only(
  onsetInfo: Array<{ time: number; strength: number; isS2: boolean; isPaired: boolean }>,
  minBPM: number,
  maxBPM: number,
  sensitivity: number
): number[] {
  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;
  const beats: number[] = [];

  // Filter out S2 sounds
  const s1Candidates = onsetInfo
    .filter(o => !o.isS2)
    .map(o => ({ time: o.time, strength: o.strength }));

  // Score and select
  const scores = s1Candidates.map(o => o.strength);
  const sortedScores = [...scores].sort((a, b) => b - a);
  const medianScore = sortedScores[Math.floor(sortedScores.length / 2)] ?? 0;
  const threshold = Math.max(0.15, medianScore * (0.4 - (sensitivity - 0.6) * 0.3)); // More lenient

  let lastBeat = -Infinity;
  let consecutiveRejects = 0;
  const MAX_REJECTS = 25; // Gap recovery

  for (const candidate of s1Candidates) {
    if (candidate.strength >= threshold) {
      const interval = candidate.time - lastBeat;
      
      // More lenient interval range
      if (interval >= minInterval * 0.5 && interval <= maxInterval * 1.5) {
        beats.push(candidate.time);
        lastBeat = candidate.time;
        consecutiveRejects = 0;
      } else if (beats.length === 0 && candidate.strength > threshold * 1.3) {
        // First beat: accept if strong enough
        beats.push(candidate.time);
        lastBeat = candidate.time;
        consecutiveRejects = 0;
      } else if (consecutiveRejects >= MAX_REJECTS && interval >= minInterval * 0.4) {
        // Gap recovery
        console.log(`[HeartSound] S1-only gap recovery at ${candidate.time.toFixed(2)}s`);
        beats.push(candidate.time);
        lastBeat = candidate.time;
        consecutiveRejects = 0;
      } else {
        consecutiveRejects++;
      }
    } else {
      consecutiveRejects++;
    }
  }

  console.log(`[HeartSound] S1-only mode: ${s1Candidates.length} candidates -> ${beats.length} beats`);
  return beats;
}

/**
 * Select only S1 from S1-S2 pairs (require pairs)
 */
function selectS1S2Pairs(
  onsetInfo: Array<{ time: number; strength: number; isS2: boolean; isPaired: boolean; pairIndex: number }>,
  minBPM: number,
  maxBPM: number,
  _sensitivity: number
): number[] {
  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;
  const beats: number[] = [];

  // Select S1 sounds that are part of pairs
  const pairedS1 = onsetInfo.filter(o => o.isPaired && !o.isS2);

  let lastBeat = -Infinity;
  let consecutiveRejects = 0;
  const MAX_REJECTS = 25;

  for (const s1 of pairedS1) {
    const interval = s1.time - lastBeat;

    // More lenient interval range
    if (interval >= minInterval * 0.5 && interval <= maxInterval * 1.5) {
      beats.push(s1.time);
      lastBeat = s1.time;
      consecutiveRejects = 0;
    } else if (beats.length === 0) {
      beats.push(s1.time);
      lastBeat = s1.time;
      consecutiveRejects = 0;
    } else if (consecutiveRejects >= MAX_REJECTS && interval >= minInterval * 0.4) {
      // Gap recovery
      console.log(`[HeartSound] Pair mode gap recovery at ${s1.time.toFixed(2)}s`);
      beats.push(s1.time);
      lastBeat = s1.time;
      consecutiveRejects = 0;
    } else {
      consecutiveRejects++;
    }
  }

  console.log(`[HeartSound] Pair mode: ${pairedS1.length} paired S1 -> ${beats.length} beats`);
  return beats;
}

/**
 * Adaptive selection: handle both paired and unpaired beats
 * This is the intelligent mode that handles missing S2
 */
function selectAdaptive(
  onsetInfo: Array<{ time: number; strength: number; isS2: boolean; isPaired: boolean }>,
  minBPM: number,
  maxBPM: number,
  sensitivity: number
): number[] {
  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;
  const beats: number[] = [];

  // Score each onset
  const scores = onsetInfo.map((o, i) => {
    let score = o.strength;

    // Strong penalty for S2
    if (o.isS2) {
      score *= 0.1;
    }

    // Bonus for being paired (more reliable)
    if (o.isPaired && !o.isS2) {
      score += 0.3;
    }

    // Bonus for being locally stronger
    const prev = i > 0 ? onsetInfo[i - 1] : null;
    const next = i < onsetInfo.length - 1 ? onsetInfo[i + 1] : null;
    
    if (prev && o.strength > prev.strength * 1.2) score += 0.1;
    if (next && o.strength > next.strength * 1.2) score += 0.1;

    return score;
  });

  // Adaptive threshold
  const sortedScores = [...scores].sort((a, b) => b - a);
  const medianScore = sortedScores[Math.floor(sortedScores.length / 2)] ?? 0;
  const threshold = Math.max(0.2, medianScore * (0.5 - (sensitivity - 0.6) * 0.3));

  // Track recent intervals for adaptive validation
  const recentIntervals: number[] = [];
  let consecutiveRejects = 0;
  const MAX_CONSECUTIVE_REJECTS = 25; // Increased from 12 to handle longer gaps

  for (let i = 0; i < onsetInfo.length; i++) {
    // Skip S2 sounds
    if (onsetInfo[i].isS2) continue;

    if (scores[i] >= threshold) {
      if (beats.length === 0) {
        beats.push(onsetInfo[i].time);
        consecutiveRejects = 0; // Reset on first beat
        continue;
      }

      const lastBeat = beats[beats.length - 1];
      const interval = onsetInfo[i].time - lastBeat;

      // Absolute minimum: 100ms
      if (interval < 0.1) {
        consecutiveRejects++;
        continue;
      }

      // Adaptive interval range - more lenient
      let adaptiveMin = minInterval * 0.6; // More lenient: was 0.75
      let adaptiveMax = maxInterval * 1.5; // More lenient: was 1.25

      if (recentIntervals.length >= 3) {
        const avgRecent = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
        adaptiveMin = Math.max(minInterval * 0.5, avgRecent * 0.5); // More lenient
        adaptiveMax = Math.min(maxInterval * 1.5, avgRecent * 2.0); // More lenient
      }

      // Gap recovery - more aggressive
      const forceAccept = consecutiveRejects >= MAX_CONSECUTIVE_REJECTS &&
                         interval >= minInterval * 0.4 && // More lenient: was 0.5
                         interval <= maxInterval * 2.5;    // More lenient: was 2.0

      if (forceAccept) {
        console.log(`[HeartSound] Auto gap recovery at ${onsetInfo[i].time.toFixed(2)}s after ${consecutiveRejects} rejects`);
        beats.push(onsetInfo[i].time);
        recentIntervals.length = 0;
        consecutiveRejects = 0;
        continue;
      }

      // Accept if within adaptive range
      if (interval >= adaptiveMin && interval <= adaptiveMax) {
        beats.push(onsetInfo[i].time);
        recentIntervals.push(interval);
        if (recentIntervals.length > 5) recentIntervals.shift();
        consecutiveRejects = 0;
      } else if (interval > adaptiveMax && scores[i] > medianScore * 1.1) {
        // Large gap but strong signal - more lenient threshold
        console.log(`[HeartSound] Accepting large gap (${(interval * 1000).toFixed(0)}ms) with strong signal at ${onsetInfo[i].time.toFixed(2)}s`);
        beats.push(onsetInfo[i].time);
        recentIntervals.push(interval);
        if (recentIntervals.length > 5) recentIntervals.shift();
        consecutiveRejects = 0;
      } else {
        consecutiveRejects++;
      }
    } else {
      consecutiveRejects++;
    }
  }

  console.log(`[HeartSound] Auto mode: ${onsetInfo.length} onsets -> ${beats.length} beats (${(beats.length / onsetInfo.length * 100).toFixed(1)}%)`);
  return beats;
}

/**
 * Validate and refine detected beats
 * Remove outliers and ensure consistency
 * Optimized to prevent beat loss while still filtering false positives
 */
function validateAndRefineBeats(
  beats: number[],
  minBPM: number,
  maxBPM: number
): number[] {
  if (beats.length < 3) return beats;

  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;

  // Calculate intervals
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i] - beats[i - 1]);
  }

  // Calculate median interval (more robust than mean)
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)];

  console.log(`[HeartSound] Validation input: ${beats.length} beats, median interval: ${(medianInterval * 1000).toFixed(0)}ms`);

  // Filter beats based on interval consistency with sliding window approach
  const validBeats: number[] = [beats[0]];
  
  // Track recent intervals for adaptive validation
  const recentIntervals: number[] = [];
  const windowSize = 5; // Use last 5 intervals for adaptive threshold
  
  let removedTooClose = 0;
  let removedTooFar = 0;
  let removedIrregular = 0;
  
  for (let i = 1; i < beats.length; i++) {
    const interval = beats[i] - validBeats[validBeats.length - 1];
    
    // Calculate adaptive median from recent intervals
    let adaptiveMedian = medianInterval;
    if (recentIntervals.length >= 3) {
      const sortedRecent = [...recentIntervals].sort((a, b) => a - b);
      adaptiveMedian = sortedRecent[Math.floor(sortedRecent.length / 2)];
    }
    
    const deviation = Math.abs(interval - adaptiveMedian) / adaptiveMedian;
    
    // Absolute minimum interval check: 100ms (prevents duplicate/echo beats)
    const ABSOLUTE_MIN_INTERVAL = 0.1; // 100ms = 0.1 seconds
    if (interval < ABSOLUTE_MIN_INTERVAL) {
      removedTooClose++;
      continue;
    }
    
    // More lenient acceptance criteria to prevent beat loss:
    // 1. Must be within absolute range (with wider tolerance)
    // 2. Deviation from adaptive median < 100% (more lenient than before)
    const inAbsoluteRange = interval >= minInterval * 0.5 && interval <= maxInterval * 1.5; // More lenient
    const reasonableDeviation = deviation < 1.0; // More lenient: was 0.7
    
    // Too close relative check - likely a false positive
    const tooClose = interval < minInterval * 0.4; // More lenient: was 0.5
    if (tooClose) {
      removedTooClose++;
      continue;
    }
    
    if (inAbsoluteRange && reasonableDeviation) {
      validBeats.push(beats[i]);
      recentIntervals.push(interval);
      if (recentIntervals.length > windowSize) {
        recentIntervals.shift();
      }
    } else if (interval > maxInterval * 1.5 && interval <= maxInterval * 4.0) {
      // Large gap detected - might be missing beats
      const expectedBeats = Math.round(interval / adaptiveMedian);
      
      if (expectedBeats >= 2 && expectedBeats <= 5) {
        // Try to interpolate missing beats
        console.log(`[HeartSound] Interpolating ${expectedBeats - 1} missing beats`);
        for (let j = 1; j < expectedBeats; j++) {
          const interpolatedBeat = validBeats[validBeats.length - 1] + (adaptiveMedian * j);
          validBeats.push(interpolatedBeat);
        }
        validBeats.push(beats[i]);
        
        // Add interpolated intervals to recent tracking
        for (let j = 0; j < expectedBeats; j++) {
          recentIntervals.push(adaptiveMedian);
          if (recentIntervals.length > windowSize) {
            recentIntervals.shift();
          }
        }
      } else if (expectedBeats === 1 && deviation < 1.5) {
        // Single beat gap but reasonable - accept it
        validBeats.push(beats[i]);
        recentIntervals.push(interval);
        if (recentIntervals.length > windowSize) {
          recentIntervals.shift();
        }
      } else {
        // Very large gap - still accept if not too extreme
        if (interval <= maxInterval * 4.0) {
          console.log(`[HeartSound] Accepting large gap: ${(interval * 1000).toFixed(0)}ms`);
          validBeats.push(beats[i]);
          recentIntervals.length = 0; // Reset tracking on large gap
        } else {
          removedTooFar++;
        }
      }
    } else if (interval >= minInterval * 0.4 && interval < minInterval * 0.5) {
      // Slightly short interval - might be a tempo change
      // More lenient: accept if recent beats support this
      if (recentIntervals.length >= 2) {
        const recentAvg = recentIntervals.reduce((sum, val) => sum + val, 0) / recentIntervals.length;
        if (Math.abs(interval - recentAvg) / recentAvg < 0.6) { // More lenient: was 0.5
          validBeats.push(beats[i]);
          recentIntervals.push(interval);
          if (recentIntervals.length > windowSize) {
            recentIntervals.shift();
          }
        } else {
          removedIrregular++;
        }
      } else {
        // Not enough history - accept it anyway to avoid early cutoff
        validBeats.push(beats[i]);
        recentIntervals.push(interval);
      }
    } else if (!inAbsoluteRange && interval > maxInterval * 1.5) {
      // Out of range but not filtered above - be more lenient
      validBeats.push(beats[i]);
      recentIntervals.length = 0; // Reset on anomaly
    } else {
      removedIrregular++;
    }
  }

  console.log(`[HeartSound] Validation: ${beats.length} -> ${validBeats.length} beats (kept ${(validBeats.length / beats.length * 100).toFixed(1)}%)`);
  console.log(`[HeartSound] Removed: ${removedTooClose} too close, ${removedIrregular} irregular, ${removedTooFar} too far`);
  if (validBeats.length > 0) {
    console.log(`[HeartSound] Final beat range: ${validBeats[0].toFixed(2)}s - ${validBeats[validBeats.length - 1].toFixed(2)}s`);
  }
  
  return validBeats;
}



/**
 * Calculate confidence for heart sound detection
 * More comprehensive scoring based on multiple factors
 */
function calculateHeartSoundConfidence(
  beats: number[], 
  avgBPM: number,
  mode: HeartSoundMode = 'standard'
): number {
  if (beats.length < 3 || avgBPM === 0) return 0;

  const expectedInterval = 60 / avgBPM;
  
  // Factor 1: Regularity score (how consistent are the intervals)
  let regularCount = 0;
  let totalDeviation = 0;
  const intervals: number[] = [];

  for (let i = 1; i < beats.length; i++) {
    const interval = beats[i] - beats[i - 1];
    intervals.push(interval);
    const deviation = Math.abs(interval - expectedInterval) / expectedInterval;
    totalDeviation += deviation;
    
    // Tolerance based on mode
    const tolerance = mode === 'precise' ? 0.2 : mode === 'simple' ? 0.35 : 0.3;
    if (deviation < tolerance) {
      regularCount++;
    }
  }

  const regularityScore = regularCount / (beats.length - 1);
  const avgDeviation = totalDeviation / (beats.length - 1);
  
  // Factor 2: Deviation score (how close to expected)
  const deviationScore = Math.max(0, 1 - avgDeviation * 0.5);

  // Factor 3: Consistency score (how similar are consecutive intervals)
  let consistencyScore = 0;
  if (intervals.length >= 2) {
    let consistentPairs = 0;
    for (let i = 1; i < intervals.length; i++) {
      const ratio = intervals[i] / intervals[i - 1];
      if (ratio >= 0.8 && ratio <= 1.25) {
        consistentPairs++;
      }
    }
    consistencyScore = consistentPairs / (intervals.length - 1);
  }

  // Factor 4: Sample size score (more beats = more reliable)
  const sampleSizeScore = Math.min(1, beats.length / 10);

  // Weighted combination based on mode
  let confidence: number;
  if (mode === 'precise') {
    // Precise mode: emphasize regularity and consistency
    confidence = regularityScore * 0.45 + deviationScore * 0.25 + consistencyScore * 0.25 + sampleSizeScore * 0.05;
  } else if (mode === 'simple') {
    // Simple mode: more lenient, focus on deviation
    confidence = regularityScore * 0.4 + deviationScore * 0.4 + consistencyScore * 0.15 + sampleSizeScore * 0.05;
  } else {
    // Standard mode: balanced
    confidence = regularityScore * 0.4 + deviationScore * 0.3 + consistencyScore * 0.25 + sampleSizeScore * 0.05;
  }

  console.log(`[HeartSound] Confidence breakdown: regularity=${regularityScore.toFixed(2)}, deviation=${deviationScore.toFixed(2)}, consistency=${consistencyScore.toFixed(2)}, sample=${sampleSizeScore.toFixed(2)} -> ${confidence.toFixed(2)}`);

  return confidence;
}

/**
 * Onset detection using spectral flux
 */
function detectOnsets(
  channelData: Float32Array,
  sampleRate: number,
  minBPM: number,
  maxBPM: number
): { onsetTimes: number[]; onsetStrengths: number[] } {
  // Parameters
  const hopSize = Math.floor(sampleRate * 0.01);  // 10ms hop
  const windowSize = hopSize * 4;  // 40ms window
  
  // Calculate energy in each frame
  const numFrames = Math.floor((channelData.length - windowSize) / hopSize);
  const energies = new Float32Array(numFrames);
  
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let energy = 0;
    for (let j = 0; j < windowSize; j++) {
      const sample = channelData[start + j];
      energy += sample * sample;
    }
    energies[i] = Math.sqrt(energy / windowSize);
  }

  // Calculate spectral flux (positive differences only)
  const flux = new Float32Array(numFrames - 1);
  for (let i = 1; i < numFrames; i++) {
    flux[i - 1] = Math.max(0, energies[i] - energies[i - 1]);
  }

  // Normalize flux
  const maxFlux = Math.max(...flux);
  if (maxFlux > 0) {
    for (let i = 0; i < flux.length; i++) {
      flux[i] /= maxFlux;
    }
  }

  // Adaptive thresholding
  const thresholdWindowSize = Math.floor(sampleRate / hopSize * 0.5); // 500ms window
  const threshold = calculateAdaptiveThreshold(flux, thresholdWindowSize, 0.3);

  // Peak picking with minimum distance
  const minBeatInterval = (60 / maxBPM) * sampleRate / hopSize;
  const _maxBeatInterval = (60 / minBPM) * sampleRate / hopSize;

  const onsetTimes: number[] = [];
  const onsetStrengths: number[] = [];
  
  let lastOnsetFrame = -minBeatInterval;

  for (let i = 1; i < flux.length - 1; i++) {
    // Check if above threshold
    if (flux[i] <= threshold[i]) continue;
    
    // Check if local maximum
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    
    // Check minimum distance from last onset
    if (i - lastOnsetFrame < minBeatInterval) continue;

    // This is a valid onset
    const time = (i * hopSize) / sampleRate;
    onsetTimes.push(time);
    onsetStrengths.push(flux[i]);
    lastOnsetFrame = i;
  }

  return { onsetTimes, onsetStrengths };
}

/**
 * Calculate adaptive threshold using local statistics
 */
function calculateAdaptiveThreshold(
  data: Float32Array,
  windowSize: number,
  multiplier: number
): Float32Array {
  const threshold = new Float32Array(data.length);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(data.length, i + halfWindow);
    
    let sum = 0;
    let sumSq = 0;
    const count = end - start;
    
    for (let j = start; j < end; j++) {
      sum += data[j];
      sumSq += data[j] * data[j];
    }
    
    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    const std = Math.sqrt(Math.max(0, variance));
    
    // Threshold = mean + multiplier * std
    threshold[i] = mean + multiplier * std + 0.05; // Small base threshold
  }

  return threshold;
}

/**
 * Simple beat selection (standard strategy)
 * Fast selection based on strength and basic consistency
 */
function selectBeatsSimple(
  onsetTimes: number[],
  onsetStrengths: number[],
  minBPM: number,
  maxBPM: number
): number[] {
  if (onsetTimes.length === 0) return [];
  if (onsetTimes.length === 1) return [onsetTimes[0]];

  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;

  // Score each onset based on strength and consistency with neighbors
  const scores = new Float32Array(onsetTimes.length);
  
  for (let i = 0; i < onsetTimes.length; i++) {
    let score = onsetStrengths[i];
    
    // Bonus for consistent intervals with previous beats
    if (i > 0) {
      const interval = onsetTimes[i] - onsetTimes[i - 1];
      if (interval >= minInterval && interval <= maxInterval) {
        score += 0.3;
      }
    }
    
    // Bonus for consistent intervals with next beats
    if (i < onsetTimes.length - 1) {
      const interval = onsetTimes[i + 1] - onsetTimes[i];
      if (interval >= minInterval && interval <= maxInterval) {
        score += 0.3;
      }
    }

    scores[i] = score;
  }

  // Select beats with score above threshold
  const beats: number[] = [];
  const scoreThreshold = 0.3;

  for (let i = 0; i < onsetTimes.length; i++) {
    if (scores[i] >= scoreThreshold) {
      // Check if we need to skip due to being too close to last selected beat
      if (beats.length > 0) {
        const lastBeat = beats[beats.length - 1];
        const interval = onsetTimes[i] - lastBeat;
        
        if (interval < minInterval) {
          // Too close - keep the stronger one
          if (scores[i] > scores[i - 1]) {
            beats[beats.length - 1] = onsetTimes[i];
          }
          continue;
        }
      }
      
      beats.push(onsetTimes[i]);
    }
  }

  return beats;
}

/**
 * Advanced beat selection (advanced strategy)
 * Improved to handle BPM changes better with adaptive scoring
 */
function selectBeatsAdvanced(
  onsetTimes: number[],
  onsetStrengths: number[],
  minBPM: number,
  maxBPM: number
): number[] {
  if (onsetTimes.length === 0) return [];
  if (onsetTimes.length === 1) return [onsetTimes[0]];

  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;

  // Score each onset based on strength and local consistency
  const scores = new Float32Array(onsetTimes.length);
  
  for (let i = 0; i < onsetTimes.length; i++) {
    let score = onsetStrengths[i];
    
    // Look at surrounding onsets to calculate local consistency
    const windowSize = 3;
    const start = Math.max(0, i - windowSize);
    const end = Math.min(onsetTimes.length, i + windowSize + 1);
    
    let consistencyBonus = 0;
    let validNeighbors = 0;
    
    // Check intervals with neighbors
    for (let j = start; j < end; j++) {
      if (j === i) continue;
      
      const interval = Math.abs(onsetTimes[j] - onsetTimes[i]);
      if (interval >= minInterval && interval <= maxInterval) {
        consistencyBonus += 0.2;
        validNeighbors++;
      }
    }
    
    // Apply consistency bonus (but cap it to avoid over-weighting)
    if (validNeighbors > 0) {
      score += Math.min(consistencyBonus, 0.5);
    }

    scores[i] = score;
  }

  // Adaptive threshold based on score distribution
  const sortedScores = Array.from(scores).sort((a, b) => b - a);
  const medianScore = sortedScores[Math.floor(sortedScores.length / 2)];
  const scoreThreshold = Math.max(0.3, medianScore * 0.6);

  // Select beats using adaptive selection
  const beats: number[] = [];

  for (let i = 0; i < onsetTimes.length; i++) {
    if (scores[i] >= scoreThreshold) {
      // Check if we need to skip due to being too close to last selected beat
      if (beats.length > 0) {
        const lastBeat = beats[beats.length - 1];
        const interval = onsetTimes[i] - lastBeat;
        
        if (interval < minInterval) {
          // Too close - keep the stronger one
          const lastIndex = onsetTimes.indexOf(lastBeat);
          if (scores[i] > scores[lastIndex]) {
            beats[beats.length - 1] = onsetTimes[i];
          }
          continue;
        }
      }
      
      beats.push(onsetTimes[i]);
    }
  }

  return beats;
}

/**
 * Detect BPM changes and fill missing beats
 * When BPM changes significantly, check if there are missing beats in the gap
 */
function detectAndFillMissingBeats(
  beats: number[],
  onsetTimes: number[],
  onsetStrengths: number[],
  minBPM: number,
  maxBPM: number
): number[] {
  if (beats.length < 3) return beats;

  const result: number[] = [];
  const bpmChangeThreshold = 0.3; // 30% change threshold
  const minInterval = 60 / maxBPM;
  const maxInterval = 60 / minBPM;

  for (let i = 0; i < beats.length; i++) {
    result.push(beats[i]);

    if (i < beats.length - 1) {
      const currentInterval = beats[i + 1] - beats[i];
      
      // Calculate expected interval based on recent beats
      let expectedInterval = currentInterval;
      if (i > 0) {
        const prevInterval = beats[i] - beats[i - 1];
        expectedInterval = (prevInterval + currentInterval) / 2;
      }

      // Check if current interval is significantly different (BPM change detected)
      const intervalRatio = currentInterval / expectedInterval;
      const isBPMChange = intervalRatio > (1 + bpmChangeThreshold) || intervalRatio < (1 - bpmChangeThreshold);

      // If BPM change detected or interval is too large, check for missing beats
      if (isBPMChange || currentInterval > maxInterval * 1.5) {
        // Look for potential missing beats in onset candidates
        const missingBeats = findMissingBeatsInGap(
          beats[i],
          beats[i + 1],
          onsetTimes,
          onsetStrengths,
          expectedInterval,
          minInterval,
          maxInterval
        );

        // Add missing beats to result
        result.push(...missingBeats);
      }
    }
  }

  // Sort and remove duplicates
  const sortedResult = result.sort((a, b) => a - b);
  const uniqueResult: number[] = [];
  const tolerance = 0.01; // 10ms tolerance

  for (let i = 0; i < sortedResult.length; i++) {
    if (i === 0 || sortedResult[i] - uniqueResult[uniqueResult.length - 1] > tolerance) {
      uniqueResult.push(sortedResult[i]);
    }
  }

  return uniqueResult;
}

/**
 * Find missing beats in a gap between two beats
 */
function findMissingBeatsInGap(
  startBeat: number,
  endBeat: number,
  onsetTimes: number[],
  onsetStrengths: number[],
  expectedInterval: number,
  minInterval: number,
  maxInterval: number
): number[] {
  const gap = endBeat - startBeat;
  const missingBeats: number[] = [];

  // Estimate how many beats should be in this gap
  const estimatedBeatsInGap = Math.round(gap / expectedInterval);
  
  // If gap can fit 2+ beats, look for candidates
  if (estimatedBeatsInGap >= 2) {
    // Find onset candidates in this gap
    const candidates: { time: number; strength: number }[] = [];
    
    for (let i = 0; i < onsetTimes.length; i++) {
      const time = onsetTimes[i];
      if (time > startBeat + minInterval && time < endBeat - minInterval) {
        candidates.push({ time, strength: onsetStrengths[i] });
      }
    }

    // Sort by strength
    candidates.sort((a, b) => b.strength - a.strength);

    // Try to fill the gap with evenly spaced beats
    const targetInterval = gap / estimatedBeatsInGap;
    
    for (let j = 1; j < estimatedBeatsInGap; j++) {
      const expectedTime = startBeat + targetInterval * j;
      
      // Find the closest candidate within a reasonable window
      const searchWindow = targetInterval * 0.4; // 40% of interval
      let bestCandidate: { time: number; strength: number } | null = null;
      let bestDistance = searchWindow;

      for (const candidate of candidates) {
        const distance = Math.abs(candidate.time - expectedTime);
        if (distance < bestDistance) {
          // Check if this candidate doesn't conflict with other missing beats
          const tooClose = missingBeats.some(mb => Math.abs(mb - candidate.time) < minInterval);
          if (!tooClose) {
            bestDistance = distance;
            bestCandidate = candidate;
          }
        }
      }

      if (bestCandidate) {
        missingBeats.push(bestCandidate.time);
        // Remove from candidates to avoid reuse
        const index = candidates.indexOf(bestCandidate);
        if (index > -1) {
          candidates.splice(index, 1);
        }
      }
    }
  }

  return missingBeats.sort((a, b) => a - b);
}

/**
 * Calculate local BPM at different time points
 */
function calculateLocalBPM(
  beats: number[],
  _duration: number
): { time: number; bpm: number }[] {
  const localBPMs: { time: number; bpm: number }[] = [];
  
  if (beats.length < 3) return localBPMs;

  // Calculate BPM using sliding window of beats
  const windowBeats = 4;
  
  // Reasonable BPM limits to prevent extreme outliers
  const MIN_INTERVAL = 0.1;  // 100ms -> max 600 BPM
  const MAX_BPM = 500;       // Cap at 500 BPM to catch anomalies

  for (let i = 0; i <= beats.length - windowBeats; i++) {
    const startTime = beats[i];
    const endTime = beats[i + windowBeats - 1];
    const numIntervals = windowBeats - 1;
    const avgInterval = (endTime - startTime) / numIntervals;
    
    // Validate interval before calculating BPM
    if (avgInterval >= MIN_INTERVAL) {
      const bpm = 60 / avgInterval;
      
      // Only accept reasonable BPM values
      if (bpm <= MAX_BPM) {
        const midTime = (startTime + endTime) / 2;
        
        localBPMs.push({
          time: midTime,
          bpm: Math.round(bpm),
        });
      } else {
        console.warn(`[HeartSound] Skipping abnormal local BPM: ${Math.round(bpm)} at ${startTime.toFixed(2)}s`);
      }
    }
  }

  return localBPMs;
}

/**
 * Calculate average BPM from beat positions
 */
function calculateAverageBPM(beats: number[]): number {
  if (beats.length < 2) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i] - beats[i - 1]);
  }

  // Use median interval for robustness
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  // Reasonable limits to prevent extreme outliers
  const MIN_INTERVAL = 0.1;  // 100ms -> max 600 BPM
  const MAX_BPM = 500;       // Cap at 500 BPM to catch anomalies

  if (medianInterval >= MIN_INTERVAL) {
    const bpm = 60 / medianInterval;
    
    // Validate calculated BPM
    if (bpm <= MAX_BPM) {
      return bpm;
    } else {
      console.warn(`[HeartSound] Abnormal average BPM detected: ${Math.round(bpm)}, capping at ${MAX_BPM}`);
      return MAX_BPM;
    }
  }

  return 0;
}

/**
 * Calculate confidence score based on beat consistency
 */
function calculateConfidence(beats: number[], avgBPM: number): number {
  if (beats.length < 3 || avgBPM === 0) return 0;

  const expectedInterval = 60 / avgBPM;
  let consistentCount = 0;

  for (let i = 1; i < beats.length; i++) {
    const interval = beats[i] - beats[i - 1];
    const deviation = Math.abs(interval - expectedInterval) / expectedInterval;
    
    // Consider consistent if within 20% of expected
    if (deviation < 0.2) {
      consistentCount++;
    }
  }

  return consistentCount / (beats.length - 1);
}

/**
 * No longer needed - we detect actual beats now
 */
export function refineBeats(
  audioBuffer: AudioBuffer,
  roughBPM: number,
  roughBeats: number[]
): number[] {
  // Return beats as-is, they're already the actual detected positions
  return roughBeats;
}
