# ECG 波形宽度问题 - 根本原因分析

## 🎯 核心问题

**重新加载工作区时，ECG 波形比初次加载时要"宽"（或窄）**

## 🔍 已排除的原因

1. ✅ `canvasWidth` 初始化问题 - 已修复
2. ✅ 波形缓存未清空 - 已修复
3. ✅ Canvas 尺寸不同步 - 已修复
4. ✅ 容器未准备（v-show 死锁）- 已修复

## 🚨 最可能的根本原因

### 嫌疑：数据密度与渲染宽度不匹配

#### 当前实现逻辑

```typescript
// 1. 提取数据时（extractECGWaveformData）
const STANDARD_CANVAS_WIDTH = 800;  // ❌ 硬编码 800px
const pixelsPerSecond = STANDARD_CANVAS_WIDTH / windowDuration.value;
const samplesPerPixel = Math.floor(ecgData.buffer.sampleRate / pixelsPerSecond);
const totalPixels = Math.ceil(channelData.length / samplesPerPixel);
// 结果：data.length = totalPixels（基于 800px 计算）

// 2. 渲染时（drawECGWaveform）
const actualWidth = canvasWidth.value;  // 实际容器宽度（如 1846px）
const dataPerSecond = data.length / duration;  // 使用提取时的数据长度
const barWidth = actualWidth / visibleData;  // ❌ 不匹配！
```

#### 问题分析

**初次加载**：
- 容器宽度 = 1846px
- 提取数据：基于 800px，生成 N 个数据点
- 渲染：1846px / N 个数据点 = 每个点宽 W1

**重新加载**：
- 容器宽度 = 1846px（相同）
- 提取数据：基于 800px，生成 N 个数据点（相同）
- 渲染：1846px / N 个数据点 = 每个点宽 W1（应该相同）

**等等！如果逻辑相同，为什么会不同？**

### 可能的差异点

#### 假设 1：`windowDuration` 不同

如果重新加载时 `windowDuration` 发生了变化：

```typescript
// 初次加载：windowDuration = 8s
const pixelsPerSecond = 800 / 8 = 100 pixels/s
const totalPixels = duration * 100

// 重新加载：windowDuration = 10s（假设）
const pixelsPerSecond = 800 / 10 = 80 pixels/s
const totalPixels = duration * 80  // ❌ 数据点变少了！
```

**结果**：数据点少 → barWidth 变大 → 波形看起来"宽"

#### 假设 2：数据被缓存但 `windowDuration` 改变

```typescript
// 初次加载：windowDuration = 8s，data.length = 22189
// 保存到 ecgWaveforms.value

// 重新加载：windowDuration = 10s
// 但是 data 没有重新提取，还是 22189
// 渲染时：barWidth = 1846 / (22189 * 8/10) ≠ 预期
```

#### 假设 3：固定宽度 800 与实际宽度不匹配

**核心问题**：为什么要用 800px 提取数据，却用 1846px 渲染？

```typescript
// 提取：假设 canvas 是 800px
data.length = ceil(bufferLength / (sampleRate / (800 / windowDuration)))

// 渲染：实际 canvas 是 1846px
barWidth = 1846 / data.length

// 如果初次和重新加载的 canvasWidth 不同：
// 初次：canvasWidth = 1846px
// 重新加载：canvasWidth = 1894px（旧值）
// 虽然数据相同，但渲染宽度不同！
```

## 🎯 调试方案

已添加详细日志来确认：

### 提取时的日志

```typescript
console.log('[ECG-WV] ======== extractECGWaveformData ========', {
  fileName,
  STANDARD_CANVAS_WIDTH,  // 应该是 800
  windowDuration,  // 检查是否变化
  pixelsPerSecond,
  sampleRate,
  samplesPerPixel,
  channelDataLength,
  bufferDuration,
  totalPixels,  // data.length
  currentCanvasWidth  // 当前 canvasWidth.value
});
```

### 渲染时的日志

```typescript
console.log('[ECG-WV] ======== drawECGWaveform ========', {
  fileName,
  canvasWidth,  // 检查是否与提取时不同
  actualWidth,
  dataLength,  // 检查是否与提取时的 totalPixels 一致
  duration,
  dataPerSecond,
  windowDuration,  // 检查是否与提取时不同
  startTime,
  endTime,
  visibleData,
  barWidth,  // 关键！初次 vs 重新加载的差异
  expectedDataLength: Math.ceil(duration * (800 / windowDuration))
});
```

## 📊 预期结果

**如果是 windowDuration 变化**：
- 初次：windowDuration = 8s, totalPixels = X
- 重新加载：windowDuration = 10s, totalPixels = 0.8X
- barWidth 从 W1 变成 1.25W1

**如果是 canvasWidth 不同**：
- 初次：canvasWidth = 1846px, barWidth = 1846 / X
- 重新加载：canvasWidth = 1894px, barWidth = 1894 / X
- barWidth 从 W1 变成 1.026W1

**如果是数据被缓存**：
- 提取时的日志不会出现（因为没有重新提取）
- 渲染使用旧的 data

## 🔧 可能的修复方案

### 方案 1：使用实际 canvasWidth 提取数据

```typescript
async function extractECGWaveformData(ecgData: ...) {
  // 使用实际的 canvas 宽度，而不是固定的 800
  const extractionWidth = canvasWidth.value || 800;
  const pixelsPerSecond = extractionWidth / windowDuration.value;
  // ...
}
```

### 方案 2：保存提取时的宽度，渲染时缩放

```typescript
interface ECGWaveformData {
  // ...
  extractedWidth: number;  // 新增：提取时的宽度
}

// 渲染时
const scale = canvasWidth.value / waveform.extractedWidth;
const barWidth = (waveform.extractedWidth / visibleData) * scale;
```

### 方案 3：确保 windowDuration 在重新加载时不变

```typescript
// 保存到 workspace
workspace.ecgSettings = {
  windowDuration: windowDuration.value
};

// 加载时恢复
windowDuration.value = workspace.ecgSettings?.windowDuration || 8;
```

## 下一步

1. 硬刷新浏览器
2. 初次加载 ECG，记录日志
3. 重新加载工作区，记录日志
4. 对比两次的关键数值：
   - `windowDuration`
   - `totalPixels` / `dataLength`
   - `canvasWidth`
   - `barWidth`

根据日志结果确定真正的原因，然后实施对应的修复方案。
