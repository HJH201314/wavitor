/**
 * Dynamic BPM Detection - detects actual beat positions rather than assuming fixed intervals
 */

export interface BeatInfo {
  bpm: number           // Average BPM
  confidence: number    // Detection confidence
  beats: number[]       // Actual beat timestamps in seconds
  localBPMs: { time: number; bpm: number }[] // Local BPM at different time points
}

export interface BPMDetectorOptions {
  minBPM?: number
  maxBPM?: number
}

/**
 * Detect beats dynamically from an AudioBuffer
 * Returns actual beat positions, not a fixed grid
 */
export function detectBPM(
  audioBuffer: AudioBuffer,
  options: BPMDetectorOptions = {}
): BeatInfo {
  const { minBPM = 60, maxBPM = 200 } = options;
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  // Get mono channel data
  const channelData = audioBuffer.getChannelData(0);

  // Step 1: Calculate onset detection function
  const { onsetTimes, onsetStrengths } = detectOnsets(channelData, sampleRate, minBPM, maxBPM);

  // Step 2: Select strongest onsets as beat candidates
  const beats = selectBeats(onsetTimes, onsetStrengths, minBPM, maxBPM);

  // Step 3: Calculate local BPM at different points
  const localBPMs = calculateLocalBPM(beats, duration);

  // Step 4: Calculate average BPM
  const avgBPM = calculateAverageBPM(beats);

  // Step 5: Calculate confidence
  const confidence = calculateConfidence(beats, avgBPM);

  return {
    bpm: Math.round(avgBPM),
    confidence,
    beats,
    localBPMs,
  };
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
 * Select beats from onset candidates using dynamic programming
 */
function selectBeats(
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

  for (let i = 0; i <= beats.length - windowBeats; i++) {
    const startTime = beats[i];
    const endTime = beats[i + windowBeats - 1];
    const numIntervals = windowBeats - 1;
    const avgInterval = (endTime - startTime) / numIntervals;
    
    if (avgInterval > 0) {
      const bpm = 60 / avgInterval;
      const midTime = (startTime + endTime) / 2;
      
      localBPMs.push({
        time: midTime,
        bpm: Math.round(bpm),
      });
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

  if (medianInterval > 0) {
    return 60 / medianInterval;
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
