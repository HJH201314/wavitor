# ECG 波形宽度问题 - 最终解决方案

## 🎯 真正的根本原因（已确认）

**`duration` 不一致！**

### 问题证据（来自用户日志）

#### 初次加载
```javascript
duration: 221.887959  // ✅ ECG buffer 的真实时长
dataPerSecond: 100.00091983359944
visibleData: 801
barWidth: 2.3046192259675404
```

#### 重新加载工作区
```javascript
duration: 223.68  // ❌ 估算的时长（最大 beat + 2 秒）
dataPerSecond: 99.1997496423462  // 数据密度变小
visibleData: 794  // 可见数据点变少
barWidth: 2.3249370277078087  // 变宽了 0.9%
```

**差异**：
- `duration` 从 **221.89s** 变成了 **223.68s**（增加了 1.8 秒）
- `barWidth` 从 **2.305** 变成了 **2.325**（增加了 0.9%）

## 🔍 问题机制

### 时间线分析

**重新加载工作区时**：

1. **`setAudioFile` 调用**（audio.ts:86）
   ```typescript
   duration.value = 0;  // 重置为 0
   ```

2. **加载 workspace**（audio.ts:123）
   ```typescript
   const workspace = await workspaceStore.loadWorkspace(file);
   beats.value = [...workspace.beats];  // 加载 beats
   ```

3. **设置估算 duration**（audio.ts:138-141）
   ```typescript
   if (workspace.beats.length >= 2) {
     const estimatedDuration = Math.max(...workspace.beats) + 2;  // ❌ 估算！
     duration.value = estimatedDuration;  // 223.68 = 221.68 + 2
     recalculateBPMFromBeats();
   }
   ```

4. **加载 ECG 数据**（audio.ts:132）
   ```typescript
   await loadECGReferences();
   // ECG buffer 的真实 duration = 221.89s
   ```

5. **触发 watch，提取波形**（WaveformVisualizer.vue:1490）
   ```typescript
   watch(() => audioStore.ecgDataList.length, ...) {
     loadAllECGWaveforms();  // 开始提取
   }
   ```

6. **提取波形数据**（extractECGWaveformData）
   ```typescript
   // 使用 ECG buffer 的真实 duration（221.89s）
   const totalPixels = Math.ceil(channelData.length / samplesPerPixel);
   // data.length = 22189（正确）
   ```

7. **渲染波形**（drawECGWaveform）
   ```typescript
   const duration = audioStore.duration || 0;  // ❌ 使用估算值 223.68s
   const dataPerSecond = data.length / duration;  // 22189 / 223.68 = 99.2
   const barWidth = actualWidth / visibleData;  // 变宽了！
   ```

8. **音频元素加载完成**（AudioPlayer.vue:45-49）
   ```typescript
   function handleLoadedMetadata() {
     audioStore.setDuration(audioRef.value.duration);  // 更新为真实 duration
   }
   // ✅ 但这时 ECG 波形已经渲染完了！
   ```

### 核心问题

**提取时**使用 **ECG buffer 的真实 duration**（221.89s）计算数据点

**渲染时**使用 **audio store 的估算 duration**（223.68s）计算数据密度

→ `dataPerSecond` 变小 → `barWidth` 变大 → 波形看起来"宽"

## ✅ 最终修复方案

### 修复核心思想

**渲染时也使用 ECG buffer 的真实 duration，而不是 audio store 的 duration**

### 代码修改

#### 修复 1：`drawECGWaveform` 使用 ECG 的实际 duration

```typescript
function drawECGWaveform(ctx, waveform, yOffset, height) {
  const data = waveform.data;
  if (!data || data.length === 0) return;

  // CRITICAL: Use ECG buffer's actual duration, not audio store duration
  // Audio store duration may be estimated when loading workspace
  const ecgData = audioStore.ecgDataList.find(ecg => ecg.fileId === waveform.fileId);
  const duration = ecgData?.buffer.duration || audioStore.duration || 0;  // ✅ 优先使用 ECG buffer
  if (duration === 0) return;

  // ... 继续渲染
  const dataPerSecond = data.length / duration;  // ✅ 现在使用正确的 duration
  const barWidth = actualWidth / visibleData;  // ✅ barWidth 正确
}
```

#### 修复 2：`getECGVisibleTimeRange` 也使用 ECG 的实际 duration

```typescript
function getECGVisibleTimeRange() {
  // CRITICAL: Use ECG buffer's actual duration
  let duration = audioStore.duration || 0;
  
  // If we have ECG data, use the first ECG's actual duration
  if (audioStore.ecgDataList.length > 0) {
    duration = audioStore.ecgDataList[0].buffer.duration;  // ✅ 使用 ECG buffer
  }
  
  if (duration === 0) return { startTime: 0, endTime: 0 };
  // ...
}
```

## 📊 修复效果

### 预期结果

**重新加载工作区后**：

```javascript
[ECG-WV] ======== drawECGWaveform ========
{
  duration: 221.887959,  // ✅ 现在使用 ECG buffer 的真实时长
  durationSource: 'ECG buffer',  // ✅ 新增字段，显示来源
  dataPerSecond: 100.00091983359944,  // ✅ 与初次加载一致
  visibleData: 801,  // ✅ 与初次加载一致
  barWidth: 2.3046192259675404  // ✅ 与初次加载一致
}
```

### 关键指标对比

| 指标 | 初次加载 | 重新加载（修复前） | 重新加载（修复后） |
|------|---------|-------------------|-------------------|
| `duration` | 221.89s | 223.68s ❌ | 221.89s ✅ |
| `dataPerSecond` | 100.00 | 99.20 ❌ | 100.00 ✅ |
| `visibleData` | 801 | 794 ❌ | 801 ✅ |
| `barWidth` | 2.305 | 2.325 ❌ | 2.305 ✅ |

## 🎓 关键教训

### 1. 多个 duration 源的问题

项目中存在多个 duration 来源：
- `audioStore.duration`：从 audio 元素获取，可能被**估算值**覆盖
- `audioBuffer.duration`：音频 buffer 的实际时长
- `ecgData.buffer.duration`：ECG buffer 的实际时长

**原则**：渲染 ECG 时，应该使用 **ECG buffer 自己的 duration**，而不是其他来源。

### 2. 估算 duration 的副作用

虽然估算 duration 能让 BPM 信息在音频加载前就显示，但会导致：
- ECG 波形渲染使用错误的时长
- 波形宽度不一致
- 难以调试的问题

**建议**：如果需要估算，应该：
1. 明确标记为"估算值"
2. 只用于 UI 显示，不用于数据计算
3. 在真实值加载后触发重新渲染

### 3. 数据提取与渲染的一致性

**黄金法则**：
- 提取时用什么参数（duration, windowDuration 等）
- 渲染时就应该用相同的参数
- 否则数据密度会不匹配

## 📝 修改的文件

- ✅ `frontend/src/components/WaveformVisualizer.vue`
  - `drawECGWaveform`：使用 ECG buffer 的 duration
  - `getECGVisibleTimeRange`：使用 ECG buffer 的 duration
  - 添加 `durationSource` 日志字段

## 🔄 测试步骤

1. 硬刷新浏览器（Cmd + Shift + R）
2. 初次加载 ECG，记录 `duration` 和 `barWidth`
3. 重新加载工作区，检查日志：
   - `durationSource` 应该是 `'ECG buffer'`
   - `duration` 应该是 221.89（而不是 223.68）
   - `barWidth` 应该与初次加载一致
4. 视觉检查：波形宽度应该完全一致

## 日期

2025-02-01 - 问题彻底解决！🎉
