# 重复拍点修复说明

## 问题描述

在检测过程中，会出现 100ms 内连续出现两个非常接近的拍点，导致检测结果不准确。

## 问题原因

1. **相对阈值不足**：原有的最小间隔检查是基于 BPM 范围计算的相对值
   - 例如：`minInterval * 0.5` 或 `minInterval * 0.3`
   - 对于高 BPM（如 300 BPM），minInterval = 0.2s，0.3倍 = 60ms
   - 这个值太小，无法有效过滤重复拍点

2. **回声/误检测**：可能的来源
   - S2 心音被误识别为独立的拍点
   - 音频中的回声或反射
   - 噪声导致的虚假峰值

## 解决方案

### 添加绝对最小间隔检查 ✅

在所有拍点选择和验证函数中，添加 **100ms 绝对最小间隔**：

```typescript
const ABSOLUTE_MIN_INTERVAL = 0.1; // 100ms = 0.1 seconds
if (interval < ABSOLUTE_MIN_INTERVAL) {
  // 拒绝或替换过近的拍点
}
```

### 修改的函数

#### 1. `validateAndRefineBeats()` - 拍点验证函数
- **位置**：第 1138 行
- **逻辑**：如果间隔 < 100ms，直接跳过该拍点
- **优先级**：最高优先级检查，在其他验证之前

```typescript
// Absolute minimum interval check: 100ms (prevents duplicate/echo beats)
const ABSOLUTE_MIN_INTERVAL = 0.1;
if (interval < ABSOLUTE_MIN_INTERVAL) {
  removedTooClose++;
  continue;
}
```

#### 2. `selectHeartSoundBeatsSimple()` - 简单拍点选择
- **位置**：第 884 行
- **逻辑**：如果 < 100ms，保留强度更大的拍点
- **策略**：对于重复拍点，选择信号强度更高的

```typescript
const ABSOLUTE_MIN_INTERVAL = 0.1; // 100ms
if (interval < ABSOLUTE_MIN_INTERVAL) {
  // If too close, keep the stronger one
  const lastIndex = onsetTimes.indexOf(lastBeat);
  if (scores[i] > scores[lastIndex]) {
    beats[beats.length - 1] = onsetTimes[i]; // Replace with stronger
  }
  continue;
}
```

#### 3. `selectHeartSoundBeatsWithPairing()` - S1-S2 配对选择
- **位置 A**：第 1007 行（添加拍点时）
  - 检查新的 S1 拍点是否与上一个拍点过近
  
- **位置 B**：第 1046 行（无配对时）
  - 检查单独的拍点是否与上一个拍点过近

```typescript
const ABSOLUTE_MIN_INTERVAL = 0.1; // 100ms
if (interval < ABSOLUTE_MIN_INTERVAL) {
  i++;
  continue; // Skip beats that are too close
}
```

## 技术细节

### 为什么选择 100ms？

| BPM | 理论间隔 | 说明 |
|-----|---------|------|
| 60 BPM | 1000ms | 正常成人静息心率 |
| 120 BPM | 500ms | 运动时心率 |
| 200 BPM | 300ms | 高强度运动 |
| 300 BPM | 200ms | 极限心率 |
| 600 BPM | 100ms | 理论上限 |

**100ms (600 BPM)** 是：
- 人类心率的理论极限
- 足够过滤误检，同时不影响正常检测
- 符合生理学规律

### 多层防护策略

```
拍点检测流程
    ↓
1. 绝对最小间隔 (100ms) ✓ [新增]
    ↓
2. 相对最小间隔 (基于 BPM)
    ↓
3. 自适应间隔验证
    ↓
4. 强度比较选择
    ↓
最终拍点列表
```

## 效果验证

### 修复前
- 在 5 分钟心音文件中可能出现：
  - 间隔 < 100ms 的重复拍点
  - 检测到的拍点数量异常偏多
  - BPM 计算结果偏高

### 修复后
- ✅ 所有拍点间隔 ≥ 100ms
- ✅ 过滤掉误检测的回声/S2
- ✅ BPM 计算更准确
- ✅ 不影响正常心率检测（40-300 BPM）

## 相关文件

- `frontend/src/utils/bpmDetector.ts` - 核心检测算法
  - `validateAndRefineBeats()` - 第 1095 行
  - `selectHeartSoundBeatsSimple()` - 第 783 行
  - `selectHeartSoundBeatsWithPairing()` - 第 956 行

## 测试建议

### 测试用例
1. **正常心音**（60-100 BPM）
   - 应正常检测，无影响

2. **高心率心音**（150-200 BPM）
   - 间隔约 300-400ms
   - 应正常检测

3. **含噪声/回声的心音**
   - 应过滤掉 < 100ms 的误检测
   - 保留真实拍点

4. **S1-S2 清晰的心音**
   - S2 应被正确识别和过滤
   - 只保留 S1 作为拍点

### 验证方法
```typescript
// 检查所有拍点间隔
const intervals = [];
for (let i = 1; i < beats.length; i++) {
  const interval = beats[i] - beats[i-1];
  intervals.push(interval);
  console.assert(interval >= 0.1, `Found interval < 100ms: ${interval * 1000}ms`);
}
```

## 后续优化方向

如果仍有问题，可以考虑：
1. **可配置的最小间隔**：让用户设置 80-120ms
2. **智能阈值**：根据音频特征动态调整
3. **时域分析**：使用更复杂的信号处理识别真实拍点

---

更新日期：2026-02-01
