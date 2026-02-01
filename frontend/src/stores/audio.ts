import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { detectBPMAsync, type BeatInfo, type BPMDetectionStrategy, type HeartSoundOptions } from '../utils/bpmDetector';
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
  
  // ECG reference data (for multi-modal correction)
  interface ECGData {
    fileId: string
    fileName: string
    buffer: AudioBuffer
    beats: number[]
  }
  
  const ecgDataList = ref<ECGData[]>([]);
  const hasECG = computed(() => ecgDataList.value.length > 0);
  
  // ECG processing state
  const isProcessingECG = ref(false);
  const ecgProcessingProgress = ref(0);
  const ecgProcessingStage = ref('');
  
  // Legacy computed properties for backward compatibility (use first ECG)
  const ecgFile = computed(() => {
    const first = ecgDataList.value[0];
    return first ? new File([], first.fileName) : null;
  });
  const ecgBuffer = computed(() => ecgDataList.value[0]?.buffer || null);
  const ecgBeats = computed(() => {
    // Return all beats from all ECG files
    const allBeats = ecgDataList.value.flatMap(ecg => ecg.beats).sort((a, b) => a - b);
    console.log('[DEBUG-ecgBeats] Computed property called:', {
      ecgDataListLength: ecgDataList.value.length,
      ecgDataFiles: ecgDataList.value.map(ecg => ({
        fileId: ecg.fileId.substring(0, 8),
        fileName: ecg.fileName,
        beatsCount: ecg.beats.length,
        firstBeats: ecg.beats.slice(0, 3),
        lastBeats: ecg.beats.slice(-2)
      })),
      totalBeats: allBeats.length,
      firstBeats: allBeats.slice(0, 5),
      lastBeats: allBeats.slice(-3),
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
    return allBeats;
  });
  
  // BPM detection state
  const bpmInfo = ref<BeatInfo | null>(null);
  const isDetectingBPM = ref(false);
  const detectionProgress = ref(0);
  const detectionStage = ref('');
  const showBeats = ref(true);
  const detectionStrategy = ref<BPMDetectionStrategy>('advanced'); // 'standard' or 'advanced' or 'heartsound'
  const heartSoundOptions = ref<HeartSoundOptions>({
    mode: 'standard',
    sensitivity: 0.6,
    filterStrength: 200,
    s1s2Mode: 'auto',
    noiseReduction: false,
    minBPM: 40,
    maxBPM: 300
  });
  
  // Unified beats array (stored in workspace)
  const beats = ref<number[]>([]);

  const fileName = computed(() => audioFile.value?.name || '');
  const progress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0));

  async function setAudioFile(file: File, shouldSaveFile: boolean = true) {
    console.log('[DEBUG-setAudioFile] START:', {
      timestamp: new Date().toISOString(),
      fileName: file.name,
      currentEcgDataList: ecgDataList.value.map(ecg => ({
        fileId: ecg.fileId.substring(0, 8),
        fileName: ecg.fileName,
        beatsCount: ecg.beats.length
      }))
    });
    
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
    
    // IMPORTANT: Clear ECG data immediately when switching audio files
    // This prevents mixing ECG data from different workspaces
    console.log('[DEBUG-setAudioFile] Clearing ecgDataList');
    ecgDataList.value = [];
    console.log('[DEBUG-setAudioFile] ecgDataList cleared, length:', ecgDataList.value.length);
    
    // Load or create workspace for this file
    try {
      const workspace = await workspaceStore.loadWorkspace(file);
      console.log('[DEBUG-setAudioFile] Workspace loaded:', {
        workspaceId: workspace.fileId.substring(0, 8),
        beatsCount: workspace.beats.length,
        ecgReferencesCount: workspace.ecgReferences?.length || 0
      });
      beats.value = [...workspace.beats];
      
      // Load ECG references from workspace (will repopulate ecgDataList)
      await loadECGReferences();
      console.log('[DEBUG-setAudioFile] After loadECGReferences, ecgDataList length:', ecgDataList.value.length);
      
      // If workspace has beats, immediately recalculate BPM info
      // Note: This provides an initial visualization even before audio metadata loads
      // Will be recalculated again after metadata loads with accurate duration
      if (workspace.beats.length >= 2) {
        // Use estimated duration based on beats range for initial display
        const estimatedDuration = Math.max(...workspace.beats) + 2;
        duration.value = estimatedDuration;
        recalculateBPMFromBeats();
        // Keep the estimated duration until actual metadata loads
        // This ensures bpmInfo remains available for visualization
      }
      
      // Save audio file to storage only when uploading new file
      if (shouldSaveFile) {
        const fileId = workspaceStore.generateFileId(file);
        await storageManager.saveAudioFile(fileId, file);
        console.log(`Audio file saved to storage: ${file.name}`);
      }
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
      
      // Set the audio file without saving (file is already in storage)
      await setAudioFile(file, false);
      
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
    detectionProgress.value = 0;
    detectionStage.value = '准备检测';
    
    try {
      // Prepare options based on strategy
      let minBPM = 60;
      let maxBPM = 200;

      // For heart sound detection, use custom range from options
      if (detectionStrategy.value === 'heartsound') {
        minBPM = heartSoundOptions.value.minBPM ?? 40;
        maxBPM = heartSoundOptions.value.maxBPM ?? 300;
      }

      // Use async detection to avoid blocking UI
      const result = await detectBPMAsync(buffer, { 
        minBPM, 
        maxBPM,
        strategy: detectionStrategy.value,
        heartSoundOptions: detectionStrategy.value === 'heartsound' ? heartSoundOptions.value : undefined,
        onProgress: (progress, stage) => {
          detectionProgress.value = progress;
          detectionStage.value = stage;
        }
      });
      
      bpmInfo.value = result;
      
      console.log(`Detected ${result.beats.length} beats, avg BPM: ${result.bpm}`);
      
      // Save detected beats to workspace
      beats.value = [...result.beats];
      await workspaceStore.updateBeats(beats.value, 'BPM 检测');
      await workspaceStore.markBPMDetected();
    } catch (error) {
      console.error('BPM detection failed:', error);
      bpmInfo.value = null;
    } finally {
      isDetectingBPM.value = false;
      detectionProgress.value = 0;
      detectionStage.value = '';
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

  // Set detection strategy
  function setDetectionStrategy(strategy: BPMDetectionStrategy) {
    detectionStrategy.value = strategy;
    console.log(`Detection strategy set to: ${strategy}`);
  }

  // Update heart sound options
  function updateHeartSoundOptions(options: Partial<HeartSoundOptions>) {
    heartSoundOptions.value = {
      ...heartSoundOptions.value,
      ...options
    };
    console.log('Heart sound options updated:', heartSoundOptions.value);
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
  
  // Set ECG reference file and extract beats
  async function setECGFile(file: File) {
    // Set loading state
    isProcessingECG.value = true;
    ecgProcessingProgress.value = 0;
    ecgProcessingStage.value = '解码音频文件...';
    
    try {
      // Generate fileId for ECG
      const ecgFileId = workspaceStore.generateFileId(file);
      
      // Check if already added
      if (ecgDataList.value.some(ecg => ecg.fileId === ecgFileId)) {
        console.log('ECG file already added');
        return;
      }
      
      ecgProcessingProgress.value = 10;
      
      // Decode ECG audio file with lower sample rate (5000 Hz for ECG is sufficient)
      const arrayBuffer = await file.arrayBuffer();
      const decodeContext = new AudioContext({ sampleRate: 5000 }); // Limit to 5kHz
      const buffer = await decodeContext.decodeAudioData(arrayBuffer);
      await decodeContext.close();
      
      console.log(`[ECG] Decoded at ${buffer.sampleRate}Hz (${buffer.duration.toFixed(1)}s, ${buffer.length} samples)`);
      
      ecgProcessingProgress.value = 30;
      
      // Align ECG duration with heart sound duration
      if (audioBuffer.value && Math.abs(buffer.duration - audioBuffer.value.duration) > 0.5) {
        console.log(`ECG duration mismatch: ${buffer.duration}s vs ${audioBuffer.value.duration}s`);
        // Will trim the longer one during processing
      }
      
      ecgProcessingStage.value = '检测 R 峰位置...';
      ecgProcessingProgress.value = 40;
      
      // Record ECG start time (relative to main audio)
      // Use current playback time as the reference point
      const ecgStartTime = currentTime.value;
      console.log(`[ECG-Upload] ECG start time: ${ecgStartTime.toFixed(2)}s (current playback time)`);
      
      // Extract ECG beats (R-peaks detection) - with progress callback
      // These are relative to ECG buffer (starting from 0)
      const relativeBeats = await extractECGBeatsWithProgress(buffer, (progress) => {
        // Update progress from 40% to 80%
        ecgProcessingProgress.value = 40 + Math.floor(progress * 40);
      });
      
      // Convert to absolute time by adding ECG start time offset
      const extractedBeats = relativeBeats.map(t => t + ecgStartTime);
      
      ecgProcessingProgress.value = 80;
      console.log(`Extracted ${relativeBeats.length} ECG R-peaks from ${file.name}`);
      
      // Log saved beats for verification
      console.log(`[ECG-Save] ${file.name}:`, {
        ecgStartTime,
        relativeBeatsCount: relativeBeats.length,
        firstRelativeBeats: relativeBeats.slice(0, 3),
        absoluteBeatsCount: extractedBeats.length,
        firstAbsoluteBeats: extractedBeats.slice(0, 3),
        lastAbsoluteBeats: extractedBeats.slice(-2)
      });
      
      ecgProcessingStage.value = '保存数据...';
      ecgProcessingProgress.value = 85;
      
      // Add to ECG data list
      const ecgData: ECGData = {
        fileId: ecgFileId,
        fileName: file.name,
        buffer,
        beats: extractedBeats,
      };
      ecgDataList.value.push(ecgData);
      
      // Save ECG file to storage
      await storageManager.saveAudioFile(ecgFileId, file);
      
      // Save ECG reference to workspace
      await workspaceStore.addECGReference({
        fileId: ecgFileId,
        fileName: file.name,
        beats: extractedBeats,
        addedAt: Date.now(),
        ecgStartTime, // Save ECG start time
      });
      
      ecgProcessingProgress.value = 100;
      
      // Trigger multi-modal correction if heart sound is already detected
      if (beats.value.length > 0) {
        ecgProcessingStage.value = '校正心音拍点...';
        await correctBeatsWithECG();
      }
      
      ecgProcessingStage.value = '完成';
      
    } catch (error) {
      console.error('Failed to process ECG file:', error);
      throw error;
    } finally {
      // Reset loading state
      setTimeout(() => {
        isProcessingECG.value = false;
        ecgProcessingProgress.value = 0;
        ecgProcessingStage.value = '';
      }, 500); // Keep success state visible for a moment
    }
  }
  
  // Clear specific ECG reference data
  async function clearECG(ecgFileId?: string) {
    if (ecgFileId) {
      // Remove specific ECG
      const index = ecgDataList.value.findIndex(ecg => ecg.fileId === ecgFileId);
      if (index !== -1) {
        ecgDataList.value.splice(index, 1);
        await workspaceStore.removeECGReference(ecgFileId);
        await storageManager.deleteAudioFile(ecgFileId);
      }
    } else {
      // Clear all ECG data
      for (const ecg of ecgDataList.value) {
        await workspaceStore.removeECGReference(ecg.fileId);
        await storageManager.deleteAudioFile(ecg.fileId);
      }
      ecgDataList.value = [];
    }
  }
  
  // Load ECG references from workspace
  async function loadECGReferences() {
    console.log('[DEBUG-loadECGReferences] START:', {
      timestamp: new Date().toISOString(),
      currentWorkspaceId: workspaceStore.currentFileId?.substring(0, 8),
      ecgDataListBeforeClear: ecgDataList.value.map(ecg => ({
        fileId: ecg.fileId.substring(0, 8),
        fileName: ecg.fileName,
        beatsCount: ecg.beats.length
      }))
    });
    
    const workspace = workspaceStore.currentWorkspace;
    if (!workspace || !workspace.ecgReferences) {
      // Clear ECG data if no references
      console.log('[DEBUG-loadECGReferences] No workspace or references, clearing ecgDataList');
      ecgDataList.value = [];
      return;
    }
    
    if (workspace.ecgReferences.length === 0) {
      // Clear ECG data if empty references
      console.log('[DEBUG-loadECGReferences] Empty references, clearing ecgDataList');
      ecgDataList.value = [];
      return;
    }
    
    // Set loading state
    isProcessingECG.value = true;
    ecgProcessingProgress.value = 0;
    ecgProcessingStage.value = '加载心电文件...';
    
    try {
      // Clear old ECG data immediately to prevent mixing with new workspace data
      console.log('[DEBUG-loadECGReferences] Clearing ecgDataList before loading');
      ecgDataList.value = [];
      const totalFiles = workspace.ecgReferences.length;
      
      console.log('[DEBUG-loadECGReferences] Workspace references:', {
        workspaceId: workspace.fileId.substring(0, 8),
        totalFiles,
        references: workspace.ecgReferences.map(ref => ({
          fileId: ref.fileId.substring(0, 8),
          fileName: ref.fileName,
          beatsCount: ref.beats.length,
          firstBeats: ref.beats.slice(0, 3),
          lastBeats: ref.beats.slice(-2)
        }))
      });
      
      for (let i = 0; i < workspace.ecgReferences.length; i++) {
        const ecgRef = workspace.ecgReferences[i];
        try {
          ecgProcessingStage.value = `加载 ${ecgRef.fileName} (${i + 1}/${totalFiles})`;
          ecgProcessingProgress.value = Math.round((i / totalFiles) * 100);
          
          // Load ECG file from storage
          const file = await storageManager.loadAudioFile(ecgRef.fileId);
          if (!file) {
            console.warn(`ECG file not found in storage: ${ecgRef.fileId}`);
            continue;
          }
          
          // Decode ECG audio with same sample rate as upload (5000Hz)
          const arrayBuffer = await file.arrayBuffer();
          const decodeContext = new AudioContext({ sampleRate: 5000 }); // 必须与上传时一致
          const buffer = await decodeContext.decodeAudioData(arrayBuffer);
          await decodeContext.close();
          
          console.log(`[ECG-Load] Decoded at ${buffer.sampleRate}Hz (${buffer.duration.toFixed(1)}s)`);
          
          // Use stored calibrated beats (方案A)
          const beats = ecgRef.beats;
          
          // Log loaded beats for verification
          console.log(`[DEBUG-loadECGReferences] Loading ${ecgRef.fileName}:`, {
            fileId: ecgRef.fileId.substring(0, 8),
            beatsCount: beats.length,
            firstBeats: beats.slice(0, 5),
            lastBeats: beats.slice(-3),
            bufferDuration: buffer.duration,
            bufferSampleRate: buffer.sampleRate
          });
          
          // Add to ECG data list
          ecgDataList.value.push({
            fileId: ecgRef.fileId,
            fileName: ecgRef.fileName,
            buffer,
            beats,
          });
          
          console.log(`[DEBUG-loadECGReferences] Pushed to ecgDataList, current length: ${ecgDataList.value.length}`);
        } catch (error) {
          console.error(`Failed to load ECG reference ${ecgRef.fileId}:`, error);
        }
      }
      
      ecgProcessingProgress.value = 100;
      ecgProcessingStage.value = '完成';
      
      console.log('[DEBUG-loadECGReferences] COMPLETE:', {
        timestamp: new Date().toISOString(),
        workspaceId: workspace.fileId.substring(0, 8),
        finalEcgDataList: ecgDataList.value.map(ecg => ({
          fileId: ecg.fileId.substring(0, 8),
          fileName: ecg.fileName,
          beatsCount: ecg.beats.length,
          firstBeats: ecg.beats.slice(0, 3)
        }))
      });
      
    } finally {
      // Reset loading state
      setTimeout(() => {
        isProcessingECG.value = false;
        ecgProcessingProgress.value = 0;
        ecgProcessingStage.value = '';
      }, 500);
    }
  }
  
  // Recalibrate ECG beats (re-run detection and update stored data)
  async function recalibrateECG(ecgFileId: string): Promise<boolean> {
    // Set loading state
    isProcessingECG.value = true;
    ecgProcessingProgress.value = 0;
    
    try {
      // Find ECG data in memory
      const ecgData = ecgDataList.value.find(ecg => ecg.fileId === ecgFileId);
      if (!ecgData) {
        console.error('ECG data not found in memory');
        return false;
      }
      
      ecgProcessingStage.value = `重新校准 ${ecgData.fileName}...`;
      ecgProcessingProgress.value = 10;
      
      // Re-load and decode the original file with 5kHz sample rate
      const file = await storageManager.loadAudioFile(ecgFileId);
      if (!file) {
        console.error('ECG file not found in storage');
        return false;
      }
      
      ecgProcessingProgress.value = 15;
      
      const arrayBuffer = await file.arrayBuffer();
      const decodeContext = new AudioContext({ sampleRate: 5000 });
      const buffer = await decodeContext.decodeAudioData(arrayBuffer);
      await decodeContext.close();
      
      console.log(`[ECG-Recalibrate] Starting recalibration for ${ecgData.fileName} at ${buffer.sampleRate}Hz`);
      ecgProcessingProgress.value = 20;
      
      // Get ECG start time from workspace
      const workspace = workspaceStore.currentWorkspace;
      const ecgRef = workspace?.ecgReferences?.find(ref => ref.fileId === ecgFileId);
      const ecgStartTime = ecgRef?.ecgStartTime || 0;
      
      console.log(`[ECG-Recalibrate] ECG start time: ${ecgStartTime.toFixed(2)}s`);
      
      // Re-run detection - with progress callback
      // These are relative to ECG buffer (starting from 0)
      const relativeBeats = await extractECGBeatsWithProgress(buffer, (progress) => {
        // Update progress from 20% to 80%
        ecgProcessingProgress.value = 20 + Math.floor(progress * 60);
      });
      
      // Convert to absolute time by adding ECG start time offset
      const newBeats = relativeBeats.map(t => t + ecgStartTime);
      
      ecgProcessingProgress.value = 80;
      
      console.log(`[ECG-Recalibrate] ${ecgData.fileName}:`, {
        ecgStartTime,
        relativeBeatsCount: relativeBeats.length,
        absoluteBeatsCount: newBeats.length,
        oldBeatsCount: ecgData.beats.length,
        oldFirstBeats: ecgData.beats.slice(0, 5),
        newFirstBeats: newBeats.slice(0, 5)
      });
      
      ecgProcessingStage.value = '保存数据...';
      
      // Update memory with new buffer and beats
      ecgData.buffer = buffer;
      ecgData.beats = newBeats;
      
      // Update workspace storage
      const success = await workspaceStore.updateECGBeats(ecgFileId, newBeats);
      
      ecgProcessingProgress.value = 100;
      
      if (success) {
        console.log(`[ECG-Recalibrate] Successfully recalibrated ${ecgData.fileName}`);
      } else {
        console.error(`[ECG-Recalibrate] Failed to save recalibrated beats`);
      }
      
      return success;
    } catch (error) {
      console.error('[ECG-Recalibrate] Error:', error);
      return false;
    } finally {
      // Reset loading state
      setTimeout(() => {
        isProcessingECG.value = false;
        ecgProcessingProgress.value = 0;
        ecgProcessingStage.value = '';
      }, 500);
    }
  }
  
  // Recalibrate all ECG files
  async function recalibrateAllECG(): Promise<{ total: number; success: number }> {
    const total = ecgDataList.value.length;
    let success = 0;
    
    // Set loading state
    isProcessingECG.value = true;
    ecgProcessingProgress.value = 0;
    
    try {
      for (let i = 0; i < ecgDataList.value.length; i++) {
        const ecgData = ecgDataList.value[i];
        ecgProcessingStage.value = `重新校准 ${ecgData.fileName} (${i + 1}/${total})`;
        ecgProcessingProgress.value = Math.round((i / total) * 90);
        
        try {
          // Re-load and decode the original file with 5kHz sample rate
          const file = await storageManager.loadAudioFile(ecgData.fileId);
          if (!file) {
            console.error(`ECG file not found in storage: ${ecgData.fileId}`);
            continue;
          }
          
          const arrayBuffer = await file.arrayBuffer();
          const decodeContext = new AudioContext({ sampleRate: 5000 });
          const buffer = await decodeContext.decodeAudioData(arrayBuffer);
          await decodeContext.close();
          
          console.log(`[ECG-Recalibrate] Starting recalibration for ${ecgData.fileName} at ${buffer.sampleRate}Hz`);
          
          // Get ECG start time from workspace
          const workspace = workspaceStore.currentWorkspace;
          const ecgRef = workspace?.ecgReferences?.find(ref => ref.fileId === ecgData.fileId);
          const ecgStartTime = ecgRef?.ecgStartTime || 0;
          
          console.log(`[ECG-Recalibrate] ECG start time: ${ecgStartTime.toFixed(2)}s`);
          
          // Re-run detection - with progress callback
          // These are relative to ECG buffer (starting from 0)
          const baseProgress = (i / total) * 90;
          const relativeBeats = await extractECGBeatsWithProgress(buffer, (progress) => {
            ecgProcessingProgress.value = Math.round(baseProgress + (progress / total) * 90);
          });
          
          // Convert to absolute time by adding ECG start time offset
          const newBeats = relativeBeats.map(t => t + ecgStartTime);
          
          console.log(`[ECG-Recalibrate] ${ecgData.fileName}:`, {
            ecgStartTime,
            relativeBeatsCount: relativeBeats.length,
            absoluteBeatsCount: newBeats.length,
            oldBeatsCount: ecgData.beats.length,
            oldFirstBeats: ecgData.beats.slice(0, 5),
            newFirstBeats: newBeats.slice(0, 5)
          });
          
          // Update memory with new buffer and beats
          ecgData.buffer = buffer;
          ecgData.beats = newBeats;
          
          // Update workspace storage
          const saveSuccess = await workspaceStore.updateECGBeats(ecgData.fileId, newBeats);
          
          if (saveSuccess) {
            success++;
            console.log(`[ECG-Recalibrate] Successfully recalibrated ${ecgData.fileName}`);
          } else {
            console.error(`[ECG-Recalibrate] Failed to save recalibrated beats for ${ecgData.fileName}`);
          }
        } catch (error) {
          console.error(`[ECG-Recalibrate] Error processing ${ecgData.fileName}:`, error);
        }
      }
      
      ecgProcessingProgress.value = 100;
      ecgProcessingStage.value = '完成';
      
    } finally {
      // Reset loading state
      setTimeout(() => {
        isProcessingECG.value = false;
        ecgProcessingProgress.value = 0;
        ecgProcessingStage.value = '';
      }, 500);
    }
    
    return { total, success };
  }
  
  
  // Helper function to allow UI updates during heavy computation
  function yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Extract R-peaks with progress callback (non-blocking version)
  async function extractECGBeatsWithProgress(
    buffer: AudioBuffer, 
    onProgress?: (progress: number) => void
  ): Promise<number[]> {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const beats: number[] = [];
    
    onProgress?.(0);
    
    // Step 1: Bandpass filtering (5-15 Hz for QRS complex)
    await yieldToUI(); // Allow UI update
    const filtered = bandpassFilter(channelData, sampleRate, 5, 15);
    onProgress?.(0.2);
    
    // Step 2: Differentiation (emphasize slope changes)
    await yieldToUI();
    const differentiated = new Float32Array(filtered.length);
    for (let i = 1; i < filtered.length; i++) {
      differentiated[i] = filtered[i] - filtered[i - 1];
    }
    onProgress?.(0.3);
    
    // Step 3: Squaring (emphasize higher frequencies and make all values positive)
    await yieldToUI();
    const squared = new Float32Array(differentiated.length);
    for (let i = 0; i < differentiated.length; i++) {
      squared[i] = differentiated[i] * differentiated[i];
    }
    onProgress?.(0.4);
    
    // Step 4: Moving window integration (smooth the signal)
    await yieldToUI();
    const windowSize = Math.floor(sampleRate * 0.15); // 150ms window
    const integrated = movingWindowIntegration(squared, windowSize);
    onProgress?.(0.5);
    
    // Step 5: Adaptive thresholding with two-level detection
    await yieldToUI();
    const minPeakDistance = Math.floor(sampleRate * 0.2); // 200ms minimum (300 BPM max)
    const searchBack = Math.floor(sampleRate * 0.3); // Search back window
    
    // Calculate total delay introduced by all processing steps
    const filterDelay = 2;
    const differentiationDelay = 1;
    const integrationDelay = Math.floor(windowSize / 2);
    const totalProcessingDelay = filterDelay + differentiationDelay + integrationDelay;
    
    console.log(`[ECG] Processing delays: filter=${filterDelay}, diff=${differentiationDelay}, integration=${integrationDelay}, total=${totalProcessingDelay} samples (${(totalProcessingDelay / sampleRate * 1000).toFixed(1)}ms)`);
    onProgress?.(0.6);
    
    // Calculate initial signal and noise levels
    let signalPeaks: number[] = [];
    let noisePeaks: number[] = [];
    
    // Initialize thresholds
    let thresholdI1 = 0;
    let thresholdI2 = 0;
    
    // First pass: collect statistics
    await yieldToUI();
    const peaks = findLocalPeaks(integrated, windowSize, minPeakDistance);
    
    if (peaks.length === 0) {
      console.warn('No peaks found in ECG signal');
      return beats;
    }
    onProgress?.(0.7);
    
    // Initialize thresholds based on first few peaks
    const initPeaks = peaks.slice(0, Math.min(8, peaks.length));
    const sortedInitPeaks = initPeaks.map(idx => integrated[idx]).sort((a, b) => b - a);
    thresholdI1 = sortedInitPeaks[0] * 0.25;
    thresholdI2 = thresholdI1 * 0.5;
    
    let SPKI = sortedInitPeaks[0] * 0.875;
    let NPKI = sortedInitPeaks[sortedInitPeaks.length - 1] * 0.125;
    
    let lastPeakIndex = -minPeakDistance;
    let RRIntervals: number[] = [];
    
    // Second pass: adaptive detection with delay compensation
    await yieldToUI();
    const totalPeaks = peaks.length;
    for (let idx = 0; idx < totalPeaks; idx++) {
      const peakIdx = peaks[idx];
      const peakValue = integrated[peakIdx];
      
      // Yield to UI periodically (every 100 peaks)
      if (idx % 100 === 0) {
        await yieldToUI();
        onProgress?.(0.7 + (idx / totalPeaks) * 0.2);
      }
      
      // Update thresholds
      thresholdI1 = NPKI + 0.25 * (SPKI - NPKI);
      thresholdI2 = 0.5 * thresholdI1;
      
      // Check if peak exceeds threshold
      if (peakValue > thresholdI1) {
        if (peakIdx - lastPeakIndex >= minPeakDistance) {
          const actualRPeakIdx = findActualRPeak(channelData, filtered, peakIdx, totalProcessingDelay, sampleRate);
          const time = actualRPeakIdx / sampleRate;
          beats.push(time);
          
          SPKI = 0.125 * peakValue + 0.875 * SPKI;
          
          if (lastPeakIndex >= 0) {
            const rrInterval = peakIdx - lastPeakIndex;
            RRIntervals.push(rrInterval);
            if (RRIntervals.length > 8) RRIntervals.shift();
          }
          
          lastPeakIndex = peakIdx;
          signalPeaks.push(peakValue);
        } else {
          NPKI = 0.125 * peakValue + 0.875 * NPKI;
          noisePeaks.push(peakValue);
        }
      } else if (peakValue > thresholdI2) {
        if (RRIntervals.length >= 2 && lastPeakIndex >= 0) {
          const avgRR = RRIntervals.reduce((a, b) => a + b, 0) / RRIntervals.length;
          const currentGap = peakIdx - lastPeakIndex;
          
          if (currentGap > avgRR * 1.66) {
            const searchStart = Math.max(lastPeakIndex + minPeakDistance, peakIdx - searchBack);
            const missedPeak = findMissedPeak(integrated, searchStart, peakIdx, thresholdI2);
            
            if (missedPeak > 0) {
              const actualRPeakIdx = findActualRPeak(channelData, filtered, missedPeak, totalProcessingDelay, sampleRate);
              const time = actualRPeakIdx / sampleRate;
              beats.push(time);
              SPKI = 0.25 * integrated[missedPeak] + 0.75 * SPKI;
              lastPeakIndex = missedPeak;
              
              const rrInterval = missedPeak - (lastPeakIndex >= 0 ? lastPeakIndex : 0);
              RRIntervals.push(rrInterval);
              if (RRIntervals.length > 8) RRIntervals.shift();
            }
          }
        }
        
        NPKI = 0.125 * peakValue + 0.875 * NPKI;
        noisePeaks.push(peakValue);
      } else {
        NPKI = 0.125 * peakValue + 0.875 * NPKI;
        noisePeaks.push(peakValue);
      }
    }
    
    onProgress?.(0.9);
    
    // Post-processing: remove outliers based on RR intervals
    await yieldToUI();
    if (beats.length > 3) {
      beats.sort((a, b) => a - b);
      const cleanedBeats = removeOutlierBeats(beats, sampleRate);
      console.log(`ECG R-peak detection: ${beats.length} peaks → ${cleanedBeats.length} after cleaning`);
      onProgress?.(1.0);
      return cleanedBeats;
    }
    
    onProgress?.(1.0);
    return beats;
  }
  
  // Extract R-peaks from ECG audio (voltage converted to amplitude)
  // Using improved Pan-Tompkins inspired algorithm with adaptive thresholding
  async function extractECGBeats(buffer: AudioBuffer): Promise<number[]> {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const beats: number[] = [];
    
    // Step 1: Bandpass filtering (5-15 Hz for QRS complex)
    const filtered = bandpassFilter(channelData, sampleRate, 5, 15);
    
    // Step 2: Differentiation (emphasize slope changes)
    const differentiated = new Float32Array(filtered.length);
    for (let i = 1; i < filtered.length; i++) {
      differentiated[i] = filtered[i] - filtered[i - 1];
    }
    
    // Step 3: Squaring (emphasize higher frequencies and make all values positive)
    const squared = new Float32Array(differentiated.length);
    for (let i = 0; i < differentiated.length; i++) {
      squared[i] = differentiated[i] * differentiated[i];
    }
    
    // Step 4: Moving window integration (smooth the signal)
    const windowSize = Math.floor(sampleRate * 0.15); // 150ms window
    const integrated = movingWindowIntegration(squared, windowSize);
    
    // Step 5: Adaptive thresholding with two-level detection
    const minPeakDistance = Math.floor(sampleRate * 0.2); // 200ms minimum (300 BPM max)
    const searchBack = Math.floor(sampleRate * 0.3); // Search back window
    
    // Calculate total delay introduced by all processing steps
    // - Bandpass filter: ~2-3 samples delay (IIR filter)
    // - Differentiation: 1 sample delay
    // - Integration window: windowSize/2 samples delay (group delay)
    const filterDelay = 2; // Conservative estimate for bandpass filter
    const differentiationDelay = 1;
    const integrationDelay = Math.floor(windowSize / 2);
    const totalProcessingDelay = filterDelay + differentiationDelay + integrationDelay;
    
    console.log(`[ECG] Processing delays: filter=${filterDelay}, diff=${differentiationDelay}, integration=${integrationDelay}, total=${totalProcessingDelay} samples (${(totalProcessingDelay / sampleRate * 1000).toFixed(1)}ms)`);
    
    // Calculate initial signal and noise levels
    let signalPeaks: number[] = [];
    let noisePeaks: number[] = [];
    
    // Initialize thresholds
    let thresholdI1 = 0;
    let thresholdI2 = 0;
    
    // First pass: collect statistics
    const peaks = findLocalPeaks(integrated, windowSize, minPeakDistance);
    
    if (peaks.length === 0) {
      console.warn('No peaks found in ECG signal');
      return beats;
    }
    
    // Initialize thresholds based on first few peaks
    const initPeaks = peaks.slice(0, Math.min(8, peaks.length));
    const sortedInitPeaks = initPeaks.map(idx => integrated[idx]).sort((a, b) => b - a);
    thresholdI1 = sortedInitPeaks[0] * 0.25; // Primary threshold
    thresholdI2 = thresholdI1 * 0.5; // Secondary threshold for search-back
    
    let SPKI = sortedInitPeaks[0] * 0.875; // Signal peak running estimate
    let NPKI = sortedInitPeaks[sortedInitPeaks.length - 1] * 0.125; // Noise peak running estimate
    
    let lastPeakIndex = -minPeakDistance;
    let RRIntervals: number[] = [];
    
    // Second pass: adaptive detection with delay compensation
    for (const peakIdx of peaks) {
      const peakValue = integrated[peakIdx];
      
      // Update thresholds
      thresholdI1 = NPKI + 0.25 * (SPKI - NPKI);
      thresholdI2 = 0.5 * thresholdI1;
      
      // Check if peak exceeds threshold
      if (peakValue > thresholdI1) {
        // Check minimum distance
        if (peakIdx - lastPeakIndex >= minPeakDistance) {
          // Valid R-peak detected - now find actual R-peak in original signal
          const actualRPeakIdx = findActualRPeak(channelData, filtered, peakIdx, totalProcessingDelay, sampleRate);
          const time = actualRPeakIdx / sampleRate;
          beats.push(time);
          
          // Update signal peak and RR interval
          SPKI = 0.125 * peakValue + 0.875 * SPKI;
          
          if (lastPeakIndex >= 0) {
            const rrInterval = peakIdx - lastPeakIndex;
            RRIntervals.push(rrInterval);
            if (RRIntervals.length > 8) RRIntervals.shift();
          }
          
          lastPeakIndex = peakIdx;
          signalPeaks.push(peakValue);
        } else {
          // Too close to last peak - consider as noise
          NPKI = 0.125 * peakValue + 0.875 * NPKI;
          noisePeaks.push(peakValue);
        }
      } else if (peakValue > thresholdI2) {
        // Search-back logic: check if RR interval is irregular
        if (RRIntervals.length >= 2 && lastPeakIndex >= 0) {
          const avgRR = RRIntervals.reduce((a, b) => a + b, 0) / RRIntervals.length;
          const currentGap = peakIdx - lastPeakIndex;
          
          // If current gap is much larger than average, search back for missed peak
          if (currentGap > avgRR * 1.66) {
            const searchStart = Math.max(lastPeakIndex + minPeakDistance, peakIdx - searchBack);
            const missedPeak = findMissedPeak(integrated, searchStart, peakIdx, thresholdI2);
            
            if (missedPeak > 0) {
              const actualRPeakIdx = findActualRPeak(channelData, filtered, missedPeak, totalProcessingDelay, sampleRate);
              const time = actualRPeakIdx / sampleRate;
              beats.push(time);
              SPKI = 0.25 * integrated[missedPeak] + 0.75 * SPKI;
              lastPeakIndex = missedPeak;
              
              const rrInterval = missedPeak - (lastPeakIndex >= 0 ? lastPeakIndex : 0);
              RRIntervals.push(rrInterval);
              if (RRIntervals.length > 8) RRIntervals.shift();
            }
          }
        }
        
        // Update noise estimate
        NPKI = 0.125 * peakValue + 0.875 * NPKI;
        noisePeaks.push(peakValue);
      } else {
        // Below both thresholds - noise
        NPKI = 0.125 * peakValue + 0.875 * NPKI;
        noisePeaks.push(peakValue);
      }
    }
    
    // Post-processing: remove outliers based on RR intervals
    if (beats.length > 3) {
      beats.sort((a, b) => a - b);
      const cleanedBeats = removeOutlierBeats(beats, sampleRate);
      console.log(`ECG R-peak detection: ${beats.length} peaks → ${cleanedBeats.length} after cleaning`);
      return cleanedBeats;
    }
    
    return beats;
  }
  
  // Helper: Find actual R-peak position in original/filtered signal
  // Compensates for delay introduced by differentiation, squaring, and integration
  function findActualRPeak(
    originalData: Float32Array,
    filteredData: Float32Array,
    detectionIdx: number,
    totalDelay: number,
    sampleRate: number
  ): number {
    // The detection point in integrated signal corresponds to a point in the past in the original signal
    // We need to search BACKWARDS from the detection point, compensating for all delays
    
    // Compensate for total processing delay
    let estimatedRPeakIdx = detectionIdx - totalDelay;
    
    // Clamp to valid range
    estimatedRPeakIdx = Math.max(0, Math.min(filteredData.length - 1, estimatedRPeakIdx));
    
    // Define search window around estimated position
    // R-peak detection should be accurate within ±50ms typically
    const searchWindowMs = 80; // 80ms search window (±40ms)
    const searchWindowSamples = Math.floor(sampleRate * searchWindowMs / 1000);
    const halfWindow = Math.floor(searchWindowSamples / 2);
    
    const searchStart = Math.max(0, estimatedRPeakIdx - halfWindow);
    const searchEnd = Math.min(filteredData.length - 1, estimatedRPeakIdx + halfWindow);
    
    if (searchStart >= searchEnd) {
      console.warn(`[ECG] Invalid search range at detection idx ${detectionIdx}, estimated ${estimatedRPeakIdx}`);
      return estimatedRPeakIdx;
    }
    
    // Find the maximum absolute amplitude in the search window
    // R-peak should be the tallest peak in ECG
    let maxAmplitude = 0;
    let maxIdx = estimatedRPeakIdx;
    
    for (let i = searchStart; i <= searchEnd; i++) {
      const amplitude = Math.abs(filteredData[i]);
      if (amplitude > maxAmplitude) {
        maxAmplitude = amplitude;
        maxIdx = i;
      }
    }
    
    // Refine: find the exact peak around maxIdx (within ±5 samples)
    const refineWindow = Math.min(5, Math.floor(sampleRate * 0.005)); // 5ms refinement
    let peakIdx = maxIdx;
    let peakValue = Math.abs(filteredData[maxIdx]);
    
    for (let i = Math.max(0, maxIdx - refineWindow); i <= Math.min(filteredData.length - 1, maxIdx + refineWindow); i++) {
      const amplitude = Math.abs(filteredData[i]);
      if (amplitude > peakValue) {
        peakValue = amplitude;
        peakIdx = i;
      }
    }
    
    // Debug logging for first few peaks to verify correction
    if (detectionIdx < 5 * sampleRate) { // First 5 seconds
      const offsetMs = (detectionIdx - peakIdx) / sampleRate * 1000;
      console.log(`[ECG] R-peak refinement: detection@${(detectionIdx/sampleRate).toFixed(3)}s -> actual@${(peakIdx/sampleRate).toFixed(3)}s (offset: ${offsetMs.toFixed(1)}ms, delay compensation: ${(totalDelay/sampleRate*1000).toFixed(1)}ms)`);
    }
    
    return peakIdx;
  }
  
  // Helper: Simple bandpass filter using cascade of high-pass and low-pass
  function bandpassFilter(data: Float32Array, sampleRate: number, lowFreq: number, highFreq: number): Float32Array {
    const filtered = new Float32Array(data.length);
    
    // High-pass filter (remove DC and low-freq noise)
    const alphaHP = 1 / (1 + sampleRate / (2 * Math.PI * lowFreq));
    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alphaHP * (filtered[i - 1] + data[i] - data[i - 1]);
    }
    
    // Low-pass filter (remove high-freq noise)
    const alphaLP = (2 * Math.PI * highFreq) / (sampleRate + 2 * Math.PI * highFreq);
    const result = new Float32Array(data.length);
    result[0] = filtered[0];
    for (let i = 1; i < filtered.length; i++) {
      result[i] = alphaLP * filtered[i] + (1 - alphaLP) * result[i - 1];
    }
    
    return result;
  }
  
  // Helper: Moving window integration
  function movingWindowIntegration(data: Float32Array, windowSize: number): Float32Array {
    const result = new Float32Array(data.length);
    let sum = 0;
    
    // Initialize window
    for (let i = 0; i < Math.min(windowSize, data.length); i++) {
      sum += data[i];
      result[i] = sum / (i + 1);
    }
    
    // Sliding window
    for (let i = windowSize; i < data.length; i++) {
      sum = sum + data[i] - data[i - windowSize];
      result[i] = sum / windowSize;
    }
    
    return result;
  }
  
  // Helper: Find local peaks
  function findLocalPeaks(data: Float32Array, windowSize: number, minDistance: number): number[] {
    const peaks: number[] = [];
    let lastPeak = -minDistance;
    
    for (let i = windowSize; i < data.length - windowSize; i++) {
      if (i - lastPeak < minDistance) continue;
      
      let isLocalMax = true;
      const value = data[i];
      
      for (let j = -windowSize; j <= windowSize; j++) {
        if (j === 0) continue;
        if (data[i + j] > value) {
          isLocalMax = false;
          break;
        }
      }
      
      if (isLocalMax) {
        peaks.push(i);
        lastPeak = i;
      }
    }
    
    return peaks;
  }
  
  // Helper: Find missed peak in search-back window
  function findMissedPeak(data: Float32Array, start: number, end: number, threshold: number): number {
    let maxValue = threshold;
    let maxIndex = -1;
    
    for (let i = start; i < end; i++) {
      if (data[i] > maxValue) {
        maxValue = data[i];
        maxIndex = i;
      }
    }
    
    return maxIndex;
  }
  
  // Helper: Remove outlier beats based on RR interval statistics
  function removeOutlierBeats(beats: number[], sampleRate: number): number[] {
    const rrIntervals: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      rrIntervals.push((beats[i] - beats[i - 1]) * sampleRate);
    }
    
    if (rrIntervals.length < 3) return beats;
    
    // Calculate median and MAD (Median Absolute Deviation)
    const sortedRR = [...rrIntervals].sort((a, b) => a - b);
    const median = sortedRR[Math.floor(sortedRR.length / 2)];
    const deviations = rrIntervals.map(rr => Math.abs(rr - median));
    const mad = deviations.sort((a, b) => a - b)[Math.floor(deviations.length / 2)];
    
    // Remove beats with RR intervals > 3 MAD from median
    const threshold = 3.5 * mad;
    const cleanedBeats: number[] = [beats[0]];
    
    for (let i = 1; i < beats.length; i++) {
      const rr = (beats[i] - beats[i - 1]) * sampleRate;
      if (Math.abs(rr - median) <= threshold) {
        cleanedBeats.push(beats[i]);
      }
    }
    
    return cleanedBeats;
  }
  
  // Correct heart sound beats using ECG reference
  async function correctBeatsWithECG() {
    if (!hasECG.value || ecgBeats.value.length === 0 || beats.value.length === 0) {
      console.log('Cannot correct: missing ECG or heart sound beats');
      return;
    }
    
    const heartSoundBeats = [...beats.value];
    const ecgRPeaks = [...ecgBeats.value];
    
    console.log(`Correcting ${heartSoundBeats.length} heart sound beats with ${ecgRPeaks.length} ECG R-peaks`);
    
    // Match and correct beats
    const correctedBeats: number[] = [];
    const matchWindow = 0.15; // 150ms matching window
    
    for (const hsBeat of heartSoundBeats) {
      // Find closest ECG R-peak within matching window
      let closestECG: number | null = null;
      let minDistance = matchWindow;
      
      for (const ecgBeat of ecgRPeaks) {
        const distance = Math.abs(ecgBeat - hsBeat);
        if (distance < minDistance) {
          minDistance = distance;
          closestECG = ecgBeat;
        }
      }
      
      if (closestECG !== null) {
        // Correct to ECG timing (weighted average: 70% ECG, 30% heart sound)
        const correctedTime = closestECG * 0.7 + hsBeat * 0.3;
        correctedBeats.push(correctedTime);
      } else {
        // No matching ECG peak - keep original
        correctedBeats.push(hsBeat);
      }
    }
    
    // Add missing ECG peaks that have no heart sound match
    for (const ecgBeat of ecgRPeaks) {
      const hasMatch = correctedBeats.some(b => Math.abs(b - ecgBeat) < matchWindow);
      if (!hasMatch) {
        correctedBeats.push(ecgBeat);
      }
    }
    
    correctedBeats.sort((a, b) => a - b);
    
    console.log(`Correction result: ${correctedBeats.length} beats (${correctedBeats.length - heartSoundBeats.length} added from ECG)`);
    
    // Update beats
    beats.value = correctedBeats;
    await workspaceStore.updateBeats(beats.value, 'ECG 矫正');
    
    // Recalculate BPM
    recalculateBPMFromBeats();
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
    ecgFile,
    ecgBuffer,
    ecgBeats,
    ecgDataList,
    hasECG,
    isProcessingECG,
    ecgProcessingProgress,
    ecgProcessingStage,
    bpmInfo,
    isDetectingBPM,
    detectionProgress,
    detectionStage,
    showBeats,
    detectionStrategy,
    heartSoundOptions,
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
    setECGFile,
    clearECG,
    loadECGReferences,
    recalibrateECG,
    recalibrateAllECG,
    correctBeatsWithECG,
    detectBPMFromBuffer,
    redetectBPM,
    toggleShowBeats,
    setDetectionStrategy,
    updateHeartSoundOptions,
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
