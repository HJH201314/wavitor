import { defineStore } from 'pinia';
import { ref } from 'vue';

// Shared waveform view state for synchronization
export const useWaveformViewStore = defineStore('waveformView', () => {
  // Window duration in seconds (adjustable 1s ~ audio duration)
  const windowDuration = ref(8);
  
  // View offset - allows scrolling to view different parts of the waveform
  const viewOffset = ref(0);
  
  // Fixed view center time when not following playhead
  const fixedViewCenterTime = ref(0);
  
  // Auto-follow playhead when playing
  const autoFollow = ref(true);
  
  // Reset view to follow mode
  function resetView() {
    viewOffset.value = 0;
    autoFollow.value = true;
  }
  
  // Set window duration
  function setWindowDuration(duration: number) {
    windowDuration.value = duration;
  }
  
  // Set view offset
  function setViewOffset(offset: number) {
    viewOffset.value = offset;
  }
  
  // Set fixed view center time
  function setFixedViewCenterTime(time: number) {
    fixedViewCenterTime.value = time;
  }
  
  // Set auto follow
  function setAutoFollow(follow: boolean) {
    autoFollow.value = follow;
  }
  
  return {
    windowDuration,
    viewOffset,
    fixedViewCenterTime,
    autoFollow,
    resetView,
    setWindowDuration,
    setViewOffset,
    setFixedViewCenterTime,
    setAutoFollow,
  };
});
