# ECG 波形图宽度问题调试指南

## 问题描述

重新加载工作区后，ECG 波形图比初次加载时显得"略宽"，视觉上不一致。

## 已尝试的修复

1. ✅ 将 `canvasWidth` 初始化从 800 改为 0
2. ✅ 切换工作区时清空 `ecgWaveforms` 缓存
3. ✅ 改进缓存验证逻辑
4. ✅ 在绘制前同步 canvas 物理尺寸与 CSS 尺寸
5. ❌ **问题仍然存在**

## 数据流分析

### 1. ECG 数据加载流程

```typescript
setAudioFile(file)
  ↓
loadWorkspace(file)  // 从 IndexedDB 加载 workspace 元数据
  ↓
loadECGReferences()  // 加载 ECG 文件和 beats
  ↓
audioStore.ecgDataList.push({
  fileId, fileName, buffer, beats  // ❌ 不包含波形数据！
})
  ↓
watch(ecgDataList.length) 触发
  ↓
ecgWaveforms.value = []  // 清空缓存
  ↓
updateCanvasSize()
  ↓
loadAllECGWaveforms()
  ↓
extractWaveformData()  // 根据当前 canvasWidth 提取波形
  ↓
drawAllWaveforms()  // 绘制
```

### 2. 波形数据提取逻辑

```typescript
// extractWaveformData() - Line 49-108
const FIXED_PIXELS_PER_SECOND = 30;
const totalPixels = Math.ceil(ecgData.buffer.duration * FIXED_PIXELS_PER_SECOND);

// 返回数据：
{
  data: Float32Array(totalPixels),  // 固定密度
  extractedCanvasWidth: totalPixels,  // 记录提取时的总像素数
  ecgDuration: ecgData.buffer.duration
}
```

### 3. 波形渲染逻辑

```typescript
// drawWaveform() - Line 317-449
const ecgDataPerSecond = data.length / waveform.ecgDuration;
// ecgDataPerSecond = 30 (固定值，与 canvasWidth 无关)

// 计算 canvas 位置
const canvasEcgWidth = ((visibleEcgEnd - visibleEcgStart) / (endTime - startTime)) * actualWidth;
const barWidth = canvasEcgWidth / visibleData;
```

### 4. Canvas 尺寸设置

```typescript
// drawAllWaveforms() - Line 565-595
const dpr = window.devicePixelRatio || 1;
canvas.width = canvasWidth.value * dpr;  // 物理像素
canvas.height = canvasHeightPerECG * dpr;
ctx.scale(dpr, dpr);

// CSS 宽度
canvas.className = 'w-full';  // width: 100% (从容器继承)
```

## 可能的根本原因

### 假设 1：容器宽度在重新加载时未稳定

**时间线**：
```
t0: watch(ecgDataList.length) 触发
t1: ecgWaveforms.value = []
t2: requestAnimationFrame() → setTimeout(100ms)
t3: updateCanvasSize()
t4: loadAllECGWaveforms()
```

**问题**：在 t3 时，容器可能还在布局中，`containerRef.value.clientWidth` 可能返回：
- 0（容器未渲染）
- 旧的宽度（容器还未更新）
- 不稳定的中间值

### 假设 2：Canvas CSS 宽度缓存

**问题**：Canvas 元素的 CSS 宽度 `w-full` 可能从浏览器缓存中获取旧值。

**验证**：检查 `canvas.clientWidth` vs `containerRef.value.clientWidth`

### 假设 3：数据密度计算错误

**理论上**：
- `FIXED_PIXELS_PER_SECOND = 30`
- `totalPixels = duration * 30`
- `ecgDataPerSecond = totalPixels / duration = 30`（固定值）

**但实际**：如果 `extractedCanvasWidth` 被错误记录或重用，可能导致密度不匹配。

### 假设 4：缓存重用逻辑有 Bug

即使我们清空了 `ecgWaveforms.value = []`，组件内部可能还有其他缓存：
- `canvasElements` Map
- Canvas DOM 元素本身的属性
- 浏览器的渲染缓存

## 调试步骤

### 第 1 步：添加详细日志（已完成）

在以下位置添加了 `console.log`：
1. `loadAllECGWaveforms()` 开始
   - 记录 `canvasWidth` 前后值
   - 记录容器宽度
2. `All waveforms processed`
   - 记录每个波形的 `extractedCanvasWidth`
   - 记录 `data.length`
3. Canvas 尺寸设置
   - 记录 `canvasWidth.value`
   - 记录 `canvas.clientWidth`
   - 记录 `canvas.width`（物理像素）
   - 记录 `dpr`

### 第 2 步：测试并收集日志

**操作流程**：
1. 初次上传 ECG 文件（记录日志）
2. 切换到其他工作区
3. 切换回原工作区（记录日志）
4. 对比两次日志的差异

**关键数据点**：
- `canvasWidth` 是否相同？
- `containerWidth` 是否相同？
- `canvas.clientWidth` 是否相同？
- `extractedCanvasWidth` 是否相同？
- `data.length` 是否相同？
- Canvas 物理宽度（`canvas.width`）是否相同？
- 缩放比例（`canvas.width / canvas.clientWidth`）是否相同？

### 第 3 步：分析差异

根据日志差异，判断哪个假设正确：

#### 如果 `canvasWidth` 不同
→ **假设 1 正确**：容器宽度未稳定
→ **修复**：增加等待时间或使用 ResizeObserver

#### 如果 `canvas.clientWidth ≠ containerRef.value.clientWidth`
→ **假设 2 正确**：CSS 宽度缓存
→ **修复**：强制重新计算样式或重新创建 canvas

#### 如果 `extractedCanvasWidth` 不同
→ **假设 3 正确**：数据密度不匹配
→ **修复**：检查 `extractWaveformData` 是否使用了错误的参数

#### 如果 `canvas.width / canvas.clientWidth` 比例不同
→ **假设 4 + 缩放问题**：Canvas 物理尺寸与 CSS 尺寸不同步
→ **修复**：在绘制前强制同步

## 待验证的具体数值

请在以下两种情况下收集日志：

### 情况 A：初次加载（正常）

```
[ECG-WV] ============ loadAllECGWaveforms start ============
{
  canvasWidthBefore: ???,
  canvasWidthAfter: ???,
  containerWidth: ???
}

[ECG-WV] ============ All waveforms processed ============
{
  canvasWidth: ???,
  containerWidth: ???,
  waveforms: [{
    extractedCanvasWidth: ???,
    dataLength: ???,
    ecgDuration: ???
  }]
}

[DEBUG-ECGWaveformVis] Canvas setup:
{
  canvasWidth: ???,
  canvasClientWidth: ???,
  canvasPhysicalWidth: ???,
  dpr: ???,
  containerWidth: ???
}
```

### 情况 B：重新加载工作区（略宽）

```
（相同格式，对比数值）
```

## 可能的最终修复方案

### 方案 A：使用 ResizeObserver

```typescript
onMounted(() => {
  if (containerRef.value) {
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (Math.abs(newWidth - canvasWidth.value) > 1) {
          canvasWidth.value = newWidth;
          // 触发重绘
        }
      }
    });
    resizeObserver.observe(containerRef.value);
  }
});
```

### 方案 B：延长等待时间

```typescript
setTimeout(() => {
  updateCanvasSize();
  loadAllECGWaveforms();
}, 300);  // 从 100ms 增加到 300ms
```

### 方案 C：强制重新创建 Canvas

```typescript
watch(() => audioStore.ecgDataList.length, (newLength) => {
  if (newLength > 0) {
    ecgWaveforms.value = [];
    // 清空并重新创建所有 canvas 元素
    canvasElements.value.clear();
    if (containerRef.value) {
      containerRef.value.innerHTML = '';
    }
    // ...
  }
});
```

### 方案 D：完全独立于 canvasWidth 的提取

```typescript
// 不使用 canvasWidth，完全基于 ECG duration
function extractWaveformData(ecgData, ecgStartTime) {
  // 不依赖 canvasWidth.value
  const totalPixels = Math.ceil(ecgData.buffer.duration * FIXED_PIXELS_PER_SECOND);
  // ...
}
```

## 下一步行动

1. ✅ 添加详细日志（已完成）
2. ⏳ 运行测试并收集日志
3. ⏳ 对比分析日志差异
4. ⏳ 根据差异选择对应的修复方案
5. ⏳ 实施修复
6. ⏳ 验证修复效果

## 文件修改

- ✅ `frontend/src/components/ECGWaveformVisualizer.vue` - 添加详细日志
- 📝 `ECG_WIDTH_DEBUG_GUIDE.md` - 本文档

## 日期

2025-02-01（调试指南创建）
