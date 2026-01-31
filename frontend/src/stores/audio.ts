import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { detectBPM, type BeatInfo } from '../utils/bpmDetector';
import { useWorkspaceStore } from './workspace';
import { storageManager } from '../utils/storage';

export const useAudioStore = defineStore('audio', () => {
  const workspaceStore = useWorkspaceStore();
  const audioFile = ref<File | null>(null);
  const audioUrl = ref<string>('');
  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const volume = ref(1);
  const audioContext = ref<AudioContext | null>(null);
  const audioBuffer = ref<AudioBuffer | null>(null);
  const audioElement = ref<HTMLAudioElement | null>(null);
  const analyserNode = ref<AnalyserNode | null>(null);
  const sourceNode = ref<MediaElementAudioSourceNode | null>(null);
  
  // BPM detection state
  const bpmInfo = ref<BeatInfo | null>(null);
  const isDetectingBPM = ref(false);
  const showBeats = ref(true);
  
  // Unified beats array (stored in workspace)
  const beats = ref<number[]>([]);

  const fileName = computed(() => audioFile.value?.name || '');
  const progress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));

  async function setAudioFile(file: File) {
    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value);
    }
    // Reset audio nodes when file changes
    analyserNode.value = null;
    sourceNode.value = null;
    if (audioContext.value) {
      audioContext.value.close();
      audioContext.value = null;
    }
    
    audioFile.value = file;
    audioUrl.value = URL.createObjectURL(file);
    currentTime.value = 0;
    duration.value = 0;
    isPlaying.value = false;
    bpmInfo.value = null;
    
    // Load or create workspace for this file
    try {
      const workspace = await workspaceStore.loadWorkspace(file);
      beats.value = [...workspace.beats];
      
      // Save audio file to storage
      const fileId = workspaceStore.generateFileId(file);
      await storageManager.saveAudioFile(fileId, file);
      console.log(`Audio file saved to storage: ${file.name}`);
    } catch (error) {
      console.error('Failed to load workspace or save audio file:', error);
    }
  }

  // Load workspace by fileId (for switching workspaces)
  async function loadWorkspaceById(fileId: string): Promise<boolean> {
    try {
      // Load audio file from storage
      const file = await storageManager.loadAudioFile(fileId);
      if (!file) {
        console.error('Audio file not found in storage:', fileId);
        return false;
      }
      
      // Set the audio file (this will also load the workspace)
      setAudioFile(file);
      
      return true;
    } catch (error) {
      console.error('Failed to load workspace:', error);
      return false;
    }
  }

  function setAudioElement(el: HTMLAudioElement | null) {
    audioElement.value = el;
  }

  function initAudioContext() {
    if (!audioElement.value || sourceNode.value) return;
    
    const ctx = new AudioContext();
    audioContext.value = ctx;
    
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserNode.value = analyser;
    
    const source = ctx.createMediaElementSource(audioElement.value);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    sourceNode.value = source;
  }

  function setPlaying(playing: boolean) {
    isPlaying.value = playing;
  }

  function setCurrentTime(time: number) {
    currentTime.value = time;
  }

  function setDuration(dur: number) {
    duration.value = dur;
  }

  function setVolume(vol: number) {
    volume.value = Math.max(0, Math.min(1, vol));
  }

  function setAudioContext(ctx: AudioContext) {
    audioContext.value = ctx;
  }

  function setAudioBuffer(buffer: AudioBuffer) {
    audioBuffer.value = buffer;
    // Auto-detect BPM only if not already detected for this workspace
    const workspace = workspaceStore.currentWorkspace;
    if (workspace && !workspace.bpmDetected) {
      detectBPMFromBuffer(buffer);
    } else if (workspace && workspace.bpmDetected && workspace.beats.length > 0) {
      // Recalculate BPM info from existing beats
      recalculateBPMFromBeats();
    }
  }

  async function detectBPMFromBuffer(buffer: AudioBuffer) {
    isDetectingBPM.value = true;
    bpmInfo.value = null;
    
    try {
      // Run detection in next tick to not block UI
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const result = detectBPM(buffer, { minBPM: 60, maxBPM: 200 });
      bpmInfo.value = result;
      
      console.log(`Detected ${result.beats.length} beats, avg BPM: ${result.bpm}`);
      
      // Save detected beats to workspace
      beats.value = [...result.beats];
      await workspaceStore.updateBeats(beats.value, 'BPM 检测');
      await workspaceStore.markBPMDetected();
    } catch (error) {
      console.error('BPM detection failed:', error);
    } finally {
      isDetectingBPM.value = false;
    }
  }
  
  // Manual re-detection (user triggered)
  async function redetectBPM() {
    if (!audioBuffer.value) return;
    await detectBPMFromBuffer(audioBuffer.value);
  }

  function toggleShowBeats() {
    showBeats.value = !showBeats.value;
  }

  // Add a beat at the specified time (in seconds)
  function addBeat(time: number) {
    // Avoid duplicate beats (within 50ms tolerance)
    const tolerance = 0.05;
    const exists = beats.value.some(t => Math.abs(t - time) < tolerance);
    if (!exists) {
      beats.value.push(time);
      beats.value.sort((a, b) => a - b);
      
      // Update workspace
      workspaceStore.updateBeats(beats.value, '添加节拍');
      
      // Recalculate BPM curve
      recalculateBPMFromBeats();
    }
  }

  // Remove a beat at the specified time
  function removeBeat(time: number) {
    const tolerance = 0.05;
    const index = beats.value.findIndex(t => Math.abs(t - time) < tolerance);
    if (index !== -1) {
      beats.value.splice(index, 1);
      
      // Update workspace
      workspaceStore.updateBeats(beats.value, '删除节拍');
      
      // Recalculate BPM curve
      recalculateBPMFromBeats();
    }
  }

  // Move a beat from one time to another (without saving)
  // Used during drag operations - only updates in-memory data
  function moveBeat(oldTime: number, newTime: number) {
    const tolerance = 0.05;
    const index = beats.value.findIndex(t => Math.abs(t - oldTime) < tolerance);
    
    if (index !== -1) {
      beats.value.splice(index, 1);
      
      // Avoid duplicate beats at new position
      const exists = beats.value.some(t => Math.abs(t - newTime) < tolerance);
      if (!exists) {
        beats.value.push(newTime);
        beats.value.sort((a, b) => a - b);
      }
      
      // Recalculate BPM curve (but don't save to workspace yet)
      recalculateBPMFromBeats();
    }
  }

  // Finish moving a beat - saves to workspace and history
  // Should be called when drag operation ends
  function finishMoveBeat() {
    workspaceStore.updateBeats(beats.value, '移动节拍');
  }

  // Clear all beats
  function clearBeats() {
    beats.value = [];
    workspaceStore.updateBeats(beats.value, '清除所有节拍');
    // Recalculate BPM curve
    recalculateBPMFromBeats();
  }

  // Get all beats
  function getAllBeats(): number[] {
    return [...beats.value];
  }

  // Export beats as milliseconds array
  function exportBeatsAsMilliseconds(): number[] {
    return beats.value.map(t => Math.round(t * 1000));
  }

  // Export beats as JSON string
  function exportBeatsAsJSON(): string {
    return JSON.stringify(exportBeatsAsMilliseconds(), null, 2);
  }

  // Download beats as JSON file
  function downloadBeatsAsJSON() {
    const json = exportBeatsAsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.value || 'beats'}_beats.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import beats from file or JSON
  async function importBeats(beatsData: number[] | string): Promise<{ success: boolean; message: string }> {
    const result = await workspaceStore.importBeats(beatsData);
    
    if (result.success && result.beats) {
      beats.value = [...result.beats];
      
      // Recalculate BPM info from imported beats
      recalculateBPMFromBeats();
    }
    
    return result;
  }
  
  // Recalculate BPM info from current beats
  function recalculateBPMFromBeats() {
    const allBeats = beats.value;
    if (allBeats.length < 2) {
      bpmInfo.value = null;
      return;
    }
    
    const dur = duration.value || audioBuffer.value?.duration || 0;
    if (dur === 0) return;
    
    // Calculate local BPMs using sliding window
    const localBPMs: { time: number; bpm: number }[] = [];
    const windowBeats = 4;
    
    for (let i = 0; i <= allBeats.length - windowBeats; i++) {
      const startTime = allBeats[i];
      const endTime = allBeats[i + windowBeats - 1];
      
      if (startTime === undefined || endTime === undefined) continue;
      
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
    
    // Calculate average BPM
    const intervals: number[] = [];
    for (let i = 1; i < allBeats.length; i++) {
      const curr = allBeats[i];
      const prev = allBeats[i - 1];
      if (curr !== undefined && prev !== undefined) {
        intervals.push(curr - prev);
      }
    }
    
    if (intervals.length === 0) return;
    
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    const avgBPM = medianInterval !== undefined && medianInterval > 0 ? Math.round(60 / medianInterval) : 0;
    
    // Calculate confidence
    let confidence = 0;
    if (allBeats.length >= 3 && avgBPM > 0) {
      const expectedInterval = 60 / avgBPM;
      let consistentCount = 0;
      
      for (let i = 1; i < allBeats.length; i++) {
        const curr = allBeats[i];
        const prev = allBeats[i - 1];
        if (curr === undefined || prev === undefined) continue;
        
        const interval = curr - prev;
        const deviation = Math.abs(interval - expectedInterval) / expectedInterval;
        
        if (deviation < 0.2) {
          consistentCount++;
        }
      }
      
      confidence = consistentCount / (allBeats.length - 1);
    }
    
    // Update bpmInfo
    bpmInfo.value = {
      bpm: avgBPM,
      confidence,
      beats: allBeats,
      localBPMs,
    };
  }

  // Undo last action
  async function undo() {
    const result = await workspaceStore.undo();
    if (result && workspaceStore.currentWorkspace) {
      beats.value = [...workspaceStore.currentWorkspace.beats];
      // Recalculate BPM curve
      recalculateBPMFromBeats();
    }
  }

  // Redo last undone action
  async function redo() {
    const result = await workspaceStore.redo();
    if (result && workspaceStore.currentWorkspace) {
      beats.value = [...workspaceStore.currentWorkspace.beats];
      // Recalculate BPM curve
      recalculateBPMFromBeats();
    }
  }

  function reset() {
    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value);
    }
    if (audioContext.value) {
      audioContext.value.close();
    }
    audioFile.value = null;
    audioUrl.value = '';
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    audioBuffer.value = null;
    audioElement.value = null;
    analyserNode.value = null;
    sourceNode.value = null;
    audioContext.value = null;
    bpmInfo.value = null;
    isDetectingBPM.value = false;
    beats.value = [];
  }

  return {
    audioFile,
    audioUrl,
    isPlaying,
    currentTime,
    duration,
    volume,
    audioContext,
    audioBuffer,
    audioElement,
    analyserNode,
    sourceNode,
    bpmInfo,
    isDetectingBPM,
    showBeats,
    beats,
    fileName,
    progress,
    setAudioFile,
    loadWorkspaceById,
    setAudioElement,
    initAudioContext,
    setPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
    setAudioContext,
    setAudioBuffer,
    detectBPMFromBuffer,
    redetectBPM,
    toggleShowBeats,
    addBeat,
    removeBeat,
    moveBeat,
    finishMoveBeat,
    clearBeats,
    getAllBeats,
    exportBeatsAsMilliseconds,
    exportBeatsAsJSON,
    downloadBeatsAsJSON,
    importBeats,
    undo,
    redo,
    reset,
  };
});
