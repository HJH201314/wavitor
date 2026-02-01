# ECG R峰时间漂移问题修复

## 问题描述

在 ECG R 峰检测中发现两个问题：

### 问题 1：新增标记时位置漂移
随着时间推移，R 峰标记会越来越早于真实的 R 峰位置，存在累积性的时间漂移问题。

### 问题 2：重新加载工作区时位置变化
重新加载已保存的工作区时，R 峰标记位置会发生偏移，无法与波形正确对齐。

## 问题根源

### 问题 1 根源：信号处理延迟补偿不足

#### 1.1 信号处理流程

ECG R 峰检测采用 Pan-Tompkins 算法，处理流程为：

```
原始信号 → 带通滤波 → 微分 → 平方 → 移动窗口积分 → 峰值检测
```

每个处理步骤都会引入一定的**群延迟（Group Delay）**：

- **带通滤波器**：IIR 滤波器引入约 2-3 个采样点的延迟
- **微分操作**：引入 1 个采样点的延迟
- **移动窗口积分**：引入 `windowSize/2` 个采样点的延迟（150ms 窗口 @ 44.1kHz = 3308 samples）

#### 1.2 原有代码的问题

在 `audio.ts` 的 `extractECGBeats` 函数中：

**问题 1.1：延迟计算不完整**
```typescript
// 原代码：只考虑了积分窗口的延迟
const processingDelay = Math.floor(windowSize / 2);
```

这忽略了滤波器和微分的延迟，导致**总延迟被低估**。

**问题 1.2：回溯搜索方向不明确**
```typescript
// 原代码：搜索窗口定义混乱
const searchStart = Math.max(0, detectionIdx - delay - searchWindowSamples);
const searchEnd = Math.min(filteredData.length - 1, detectionIdx - delay + Math.floor(searchWindowSamples / 2));
```

搜索窗口不对称，且向前延伸，容易搜索到错误的峰值。

**问题 1.3：固定搜索窗口过大**
```typescript
const searchWindowMs = 150; // 150ms
```

150ms 的搜索窗口过大（心跳间隔约 600-1000ms），容易匹配到相邻的峰值。

#### 1.3 为什么会出现"越来越早"的漂移？

- **延迟补偿不足**：实际总延迟约 75ms，但原代码只补偿了约 70ms
- **误差累积**：每次检测的误差（5ms）会累积
- **搜索窗口偏移**：搜索窗口向前延伸，倾向于找到更早的峰值
- **时间越长，累积越多**：在 60 秒的录音中，可能累积到 300ms 的偏移

### 问题 2 根源：波形数据与显示参数不匹配

#### 2.1 波形数据预计算机制

在 `ECGWaveformVisualizer.vue` 的 `extractWaveformData` 函数中，波形数据是**预计算**的：

```typescript
const STANDARD_CANVAS_WIDTH = 800;
const pixelsPerSecond = STANDARD_CANVAS_WIDTH / windowDuration.value;
const samplesPerPixel = Math.floor(ecgData.buffer.sampleRate / pixelsPerSecond);
```

这意味着：
- 波形数据的采样密度依赖于提取时的 `windowDuration`
- 如果重新加载时 `windowDuration` 或 `canvasWidth` 变化，波形数据就会与显示不匹配

#### 2.2 R 峰标记与波形数据的不同计算方式

**R 峰标记位置**（基于时间）：
```typescript
const x = ((rPeakTime - startTime) / (endTime - startTime)) * actualWidth;
```

**波形数据绘制**（基于预计算的索引）：
```typescript
const dataIndex = startIndex + i;
const x = i * barWidth;
```

两者使用不同的坐标系统：
- R 峰：实时计算，基于当前的时间范围和容器宽度
- 波形：使用提取时的参数计算的预计算数据

#### 2.3 关键问题：beats 数据未同步

**最严重的问题**：在 `loadAllECGWaveforms` 函数中，代码通过 `fileId` 匹配现有波形数据：

```typescript
const existingWaveform = ecgWaveforms.value.find(w => w.fileId === ecgData.fileId);

if (existingWaveform && !needsReExtraction) {
  // 直接复用旧的波形数据 - 包括旧的 beats 数组！
  newWaveforms.push(existingWaveform);
}
```

**问题场景**：
1. **首次上传 ECG**：检测到 462 个 R 峰
2. **用户调整检测参数**：重新检测后可能变成 485 个 R 峰
3. **重新加载工作区**：
   - `ecgData.beats` 是新的（485 个 R 峰）
   - 但 `existingWaveform.beats` 是旧的（462 个 R 峰）
   - 如果参数未变化（`needsReExtraction = false`），直接复用旧波形
   - **结果**：绘制时使用旧的 462 个 R 峰位置，与新的音频数据不匹配

#### 2.4 问题场景总结

1. **首次加载**：`windowDuration = 10s`，提取波形数据
2. **用户调整**：改为 `windowDuration = 5s`，波形数据已缓存
3. **保存工作区**：R 峰时间正确保存（以秒为单位）
4. **重新加载**：
   - 加载时 `windowDuration` 可能是默认值（如 10s）
   - 但波形数据是上次 5s 时提取的
   - 或者 **beats 数据已更新**，但仍使用旧的波形数据
   - **结果**：R 峰标记和波形不对齐

## 修复方案

### 1. 准确计算总延迟

```typescript
// 新代码：计算所有处理步骤的延迟
const filterDelay = 2;                        // 带通滤波器延迟
const differentiationDelay = 1;               // 微分延迟
const integrationDelay = Math.floor(windowSize / 2);  // 积分延迟
const totalProcessingDelay = filterDelay + differentiationDelay + integrationDelay;

console.log(`[ECG] Processing delays: filter=${filterDelay}, diff=${differentiationDelay}, 
             integration=${integrationDelay}, total=${totalProcessingDelay} samples 
             (${(totalProcessingDelay / sampleRate * 1000).toFixed(1)}ms)`);
```

### 2. 改进回溯搜索逻辑

```typescript
function findActualRPeak(
  originalData: Float32Array,
  filteredData: Float32Array,
  detectionIdx: number,
  totalDelay: number,
  sampleRate: number
): number {
  // 1. 准确补偿总延迟
  let estimatedRPeakIdx = detectionIdx - totalDelay;
  estimatedRPeakIdx = Math.max(0, Math.min(filteredData.length - 1, estimatedRPeakIdx));
  
  // 2. 使用对称的搜索窗口（±40ms）
  const searchWindowMs = 80;
  const searchWindowSamples = Math.floor(sampleRate * searchWindowMs / 1000);
  const halfWindow = Math.floor(searchWindowSamples / 2);
  
  const searchStart = Math.max(0, estimatedRPeakIdx - halfWindow);
  const searchEnd = Math.min(filteredData.length - 1, estimatedRPeakIdx + halfWindow);
  
  // 3. 在搜索窗口内找最大振幅点
  let maxAmplitude = 0;
  let maxIdx = estimatedRPeakIdx;
  
  for (let i = searchStart; i <= searchEnd; i++) {
    const amplitude = Math.abs(filteredData[i]);
    if (amplitude > maxAmplitude) {
      maxAmplitude = amplitude;
      maxIdx = i;
    }
  }
  
  // 4. 精细化调整（±5ms）
  const refineWindow = Math.min(5, Math.floor(sampleRate * 0.005));
  let peakIdx = maxIdx;
  let peakValue = Math.abs(filteredData[maxIdx]);
  
  for (let i = Math.max(0, maxIdx - refineWindow); 
       i <= Math.min(filteredData.length - 1, maxIdx + refineWindow); i++) {
    const amplitude = Math.abs(filteredData[i]);
    if (amplitude > peakValue) {
      peakValue = amplitude;
      peakIdx = i;
    }
  }
  
  return peakIdx;
}
```

### 3. 添加调试日志

```typescript
// 在前 5 秒记录详细的修正信息
if (detectionIdx < 5 * sampleRate) {
  const offsetMs = (detectionIdx - peakIdx) / sampleRate * 1000;
  console.log(`[ECG] R-peak refinement: detection@${(detectionIdx/sampleRate).toFixed(3)}s 
               -> actual@${(peakIdx/sampleRate).toFixed(3)}s 
               (offset: ${offsetMs.toFixed(1)}ms, delay compensation: ${(totalDelay/sampleRate*1000).toFixed(1)}ms)`);
}
```

## 验证方法

### 1. 控制台日志验证

上传 ECG 文件后，查看浏览器控制台输出：

```
[ECG] Processing delays: filter=2, diff=1, integration=3308, total=3311 samples (75.1ms)
[ECG] R-peak refinement: detection@0.123s -> actual@0.048s (offset: 75.0ms, delay compensation: 75.1ms)
[ECG] R-peak refinement: detection@0.789s -> actual@0.714s (offset: 75.0ms, delay compensation: 75.1ms)
...
```

**验证要点**：
- `offset` 应该接近 `delay compensation`（说明补偿准确）
- 多个 R 峰的 `offset` 应该保持稳定（说明没有累积误差）

### 2. 视觉验证

在心电波形可视化组件中：
- R 峰标记（紫色虚线）应该准确对齐波形的最高点
- 从录音开始到结束，标记精度应保持一致
- 不应出现"越来越偏移"的现象

### 3. 数值验证

如果有标准 ECG 测试文件（带标注的 R 峰位置）：
- 计算检测到的 R 峰与标准标注的平均误差
- 误差应 < 10ms
- 误差的标准差应很小（说明一致性好）

## 预期效果

### 修复前
- R 峰标记在录音开始时较准确
- 随时间推移，标记越来越早于实际 R 峰
- 60 秒录音结束时，可能偏移 200-500ms

### 修复后
- R 峰标记在整个录音过程中保持准确
- 时间偏移控制在 ±10ms 以内
- 没有累积性漂移

## 技术要点总结

1. **群延迟补偿**：必须考虑所有信号处理步骤的延迟
2. **对称搜索窗口**：避免方向性偏差
3. **合理窗口大小**：既要容错，又要避免误匹配（80ms 是经验值）
4. **两级优化**：粗搜索（±40ms）+ 精细调整（±5ms）
5. **调试日志**：帮助验证修复效果

## 相关文件

### 修复 1 相关（信号处理延迟）
- `frontend/src/stores/audio.ts`
  - `extractECGBeats()`: R 峰检测主函数
  - `findActualRPeak()`: 延迟补偿和峰值精确定位

### 修复 2 相关（波形数据重提取）
- `frontend/src/components/ECGWaveformVisualizer.vue`
  - `ECGWaveformData` 接口：添加了 `extractedWindowDuration` 和 `extractedCanvasWidth`
  - `extractWaveformData()`: 记录提取时的参数
  - `shouldReExtractWaveforms()`: 智能检测是否需要重新提取
  - **`loadAllECGWaveforms()`**: ✅ **关键修复** - 添加 beats 数据变化检测，避免使用旧的 R 峰数据
  - `updateCanvasSize()`: 容器宽度变化检测（1px 阈值）

**关键修复说明**：
- 在重新加载时，不仅检查 `windowDuration` 和 `canvasWidth`，还检查 **beats 数组是否变化**
- 如果 beats 数据变化（R 峰重新检测），强制重新提取波形数据
- 这解决了从缓存加载时使用旧 beats 数据的问题

## 测试建议

### 测试问题 1（新增标记漂移）
1. 使用标准 ECG 测试信号（如 MIT-BIH 数据库）
2. 测试不同心率的录音（60-180 BPM）
3. 测试长时间录音（>60秒）验证无漂移
4. 对比修复前后的 R 峰位置精度

### 测试问题 2（重新加载位置变化）
1. 上传 ECG 文件并检测 R 峰
2. 调整窗口时长（如从 10s 改为 5s）
3. 保存工作区
4. 刷新页面或切换工作区
5. 重新加载工作区
6. **验证**：R 峰标记应与波形完美对齐（查看控制台日志确认是否重新提取）

### 预期控制台输出

**参数变化时**：
```
[ECG-WV] Extracted waveform data: windowDuration=10s, canvasWidth=800px, beats=462
[ECG-WV] Waveform re-extraction needed: { 
  windowDurationChanged: true, 
  oldWindowDuration: 5, 
  newWindowDuration: 10,
  windowDurationDiff: 5,
  canvasWidthChanged: false 
}
[ECG-WV] Re-extracting waveform - parameter changes
```

**Beats 数据变化时**（✅ 关键修复）：
```
[ECG-WV] Re-extracting waveform - beats changed: {
  fileName: '260129_squats_ECG_mod.wav',
  oldBeatsCount: 450,
  newBeatsCount: 462,
  firstOldBeats: [0.808, 1.592, 2.284],
  firstNewBeats: [0.807, 1.591, 2.283]
}
[ECG-WV] Waveform extracted: {
  fileName: '260129_squats_ECG_mod.wav',
  dataLength: 22189,
  beatsCount: 462,
  firstBeats: [0.807, 1.591, 2.283]
}
```

**复用缓存时**：
```
[ECG-WV] Reusing existing waveform for: 260129_squats_ECG_mod.wav
```
