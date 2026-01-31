# 心音检测中途停止问题修复

## 问题描述

**现象**：心音模式检测的拍点比较精准，但几乎都会出现检测到一半拍点就没有的情况

**对比**：
- 标准和高级模式检测心音：略有偏移和少量漏检，但能检测到全程
- 心音模式：精准但检测到一半就停止

## 问题原因分析

经过代码审查，发现了三个主要问题：

### 1. 连续拒绝阈值过低

**位置**：`selectAdaptive` 函数

```typescript
// 问题代码
const MAX_CONSECUTIVE_REJECTS = 12;  // 太小！
```

**问题**：
- 当心音间隔不规则或出现节律变化时，12 次连续拒绝很快就会达到
- 一旦达到阈值后，如果下一个 onset 仍不满足条件，检测就会持续中断
- 心音特点是可能存在不规则间隔，这个值太严格

**影响**：
- 导致在音频中途遇到不规则节律时检测中断
- 无法恢复继续检测后续的拍点

### 2. 自适应间隔范围过于严格

**位置**：`selectAdaptive` 函数

```typescript
// 问题代码
let adaptiveMin = minInterval * 0.75;  // 太严格
let adaptiveMax = maxInterval * 1.25;  // 太严格

if (recentIntervals.length >= 3) {
  const avgRecent = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
  adaptiveMin = Math.max(minInterval * 0.7, avgRecent * 0.65);   // 太严格
  adaptiveMax = Math.min(maxInterval * 1.3, avgRecent * 1.5);    // 太严格
}
```

**问题**：
- 心音间隔可能存在较大变化（心率变化、呼吸影响等）
- 过于严格的间隔范围导致正常的心音拍点被拒绝
- 一旦连续拒绝，就会形成恶性循环

### 3. 验证阶段过滤过于严格

**位置**：`validateAndRefineBeats` 函数

```typescript
// 问题代码
const inAbsoluteRange = interval >= minInterval * 0.75 && interval <= maxInterval * 1.25;
const reasonableDeviation = deviation < 0.7;  // 70% 偏差限制太严格

const tooClose = interval < minInterval * 0.5;  // 50% 太严格
```

**问题**：
- 即使 selection 阶段通过，validation 阶段仍会过滤掉很多拍点
- 70% 的偏差限制对于心音过于严格
- 导致后半段拍点被大量过滤掉

### 4. 缺少详细日志

**问题**：
- 没有足够的日志来诊断为什么检测停止
- 难以追踪哪些拍点被拒绝以及原因

## 解决方案

### 1. 提高连续拒绝阈值

```typescript
// 修复后
const MAX_CONSECUTIVE_REJECTS = 25;  // 从 12 提高到 25
```

**改进**：
- 允许更多的连续拒绝，给算法更多机会恢复
- 适应心音间隔不规则的特点

### 2. 放宽自适应间隔范围

```typescript
// 修复后
let adaptiveMin = minInterval * 0.6;  // 从 0.75 放宽到 0.6
let adaptiveMax = maxInterval * 1.5;  // 从 1.25 放宽到 1.5

if (recentIntervals.length >= 3) {
  const avgRecent = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
  adaptiveMin = Math.max(minInterval * 0.5, avgRecent * 0.5);   // 更宽松
  adaptiveMax = Math.min(maxInterval * 1.5, avgRecent * 2.0);   // 更宽松
}
```

**改进**：
- 基础间隔范围从 75%-125% 放宽到 60%-150%
- 自适应范围从 65%-150% 放宽到 50%-200%
- 更好地适应心率变化

### 3. 放宽缺口恢复条件

```typescript
// 修复后
const forceAccept = consecutiveRejects >= MAX_CONSECUTIVE_REJECTS &&
                   interval >= minInterval * 0.4 &&  // 从 0.5 放宽到 0.4
                   interval <= maxInterval * 2.5;    // 从 2.0 放宽到 2.5
```

**改进**：
- 降低强制接受的最小间隔要求
- 提高强制接受的最大间隔限制
- 更容易从检测中断中恢复

### 4. 放宽验证阶段条件

```typescript
// 修复后
const inAbsoluteRange = interval >= minInterval * 0.5 && interval <= maxInterval * 1.5;
const reasonableDeviation = deviation < 1.0;  // 从 0.7 放宽到 1.0

const tooClose = interval < minInterval * 0.4;  // 从 0.5 放宽到 0.4
```

**改进**：
- 绝对范围从 75%-125% 放宽到 50%-150%
- 偏差限制从 70% 放宽到 100%
- "太近"判断从 50% 放宽到 40%
- 减少验证阶段的拍点丢失

### 5. 增强大间隔处理

```typescript
// 修复后
} else if (interval > maxInterval * 1.5 && interval <= maxInterval * 4.0) {
  // Large gap detected - might be missing beats
  const expectedBeats = Math.round(interval / adaptiveMedian);
  
  if (expectedBeats >= 2 && expectedBeats <= 5) {
    // 从最多插值 4 个提升到 5 个
    console.log(`[HeartSound] Interpolating ${expectedBeats - 1} missing beats`);
    // ... 插值逻辑
  } else if (expectedBeats === 1 && deviation < 1.5) {
    // 从 deviation < 1.0 放宽到 < 1.5
    validBeats.push(beats[i]);
    // ...
  } else {
    // 新增：非常大的间隔也接受（但不超过 4 倍最大间隔）
    if (interval <= maxInterval * 4.0) {
      console.log(`[HeartSound] Accepting large gap: ${(interval * 1000).toFixed(0)}ms`);
      validBeats.push(beats[i]);
      recentIntervals.length = 0; // Reset tracking on large gap
    } else {
      removedTooFar++;
    }
  }
}
```

**改进**：
- 提高大间隔的容忍度（从 3 倍到 4 倍最大间隔）
- 增加更多插值的可能（最多 5 个）
- 对于无法插值的大间隔，也尝试接受

### 6. 早期阶段更宽容

```typescript
// 修复后
} else if (interval >= minInterval * 0.4 && interval < minInterval * 0.5) {
  // Slightly short interval
  if (recentIntervals.length >= 2) {  // 从 3 降低到 2
    const recentAvg = recentIntervals.reduce((sum, val) => sum + val, 0) / recentIntervals.length;
    if (Math.abs(interval - recentAvg) / recentAvg < 0.6) {  // 从 0.5 放宽到 0.6
      validBeats.push(beats[i]);
      // ...
    }
  } else {
    // 新增：不够历史记录时也接受，避免早期截断
    validBeats.push(beats[i]);
    recentIntervals.push(interval);
  }
}
```

**改进**：
- 降低需要的历史记录数量（从 3 降到 2）
- 早期阶段没有足够历史记录时，默认接受而不是拒绝
- 防止检测刚开始就因为规则过严而中断

### 7. 增加详细日志

```typescript
// 新增日志
console.log(`[HeartSound] Auto gap recovery at ${onsetInfo[i].time.toFixed(2)}s after ${consecutiveRejects} rejects`);
console.log(`[HeartSound] Accepting large gap (${(interval * 1000).toFixed(0)}ms) with strong signal at ${onsetInfo[i].time.toFixed(2)}s`);
console.log(`[HeartSound] Auto mode: ${onsetInfo.length} onsets -> ${beats.length} beats (${(beats.length / onsetInfo.length * 100).toFixed(1)}%)`);
console.log(`[HeartSound] Interpolating ${expectedBeats - 1} missing beats`);
console.log(`[HeartSound] Accepting large gap: ${(interval * 1000).toFixed(0)}ms`);
```

**改进**：
- 更容易诊断问题
- 追踪算法的决策过程
- 了解哪些情况触发了特殊处理

### 8. 同步优化三种模式

**S1-Only 模式**：
```typescript
const threshold = Math.max(0.15, medianScore * (0.4 - (sensitivity - 0.6) * 0.3)); // 从 0.2/0.5 降低
const MAX_REJECTS = 25;  // 新增缺口恢复
// 间隔范围从 0.7-1.3 放宽到 0.5-1.5
```

**S1-S2-Pair 模式**：
```typescript
const MAX_REJECTS = 25;  // 新增缺口恢复
// 间隔范围从 0.7-1.3 放宽到 0.5-1.5
```

## 修复效果预期

### 修复前
- ❌ 检测到音频 30%-50% 处突然停止
- ❌ 遇到心率变化时无法继续
- ❌ 大量有效拍点被过滤掉
- ❌ 难以诊断为什么停止

### 修复后
- ✅ 能够检测到音频全程
- ✅ 适应心率变化和不规则间隔
- ✅ 保持拍点精准度的同时提高召回率
- ✅ 通过日志清晰了解算法行为

## 权衡说明

### 可能的副作用
1. **假阳性略微增加**：由于放宽了限制，可能会接受一些不太准确的拍点
2. **对噪声敏感性提高**：在噪声较大的音频中可能检测到噪声峰值

### 缓解措施
1. **保留绝对最小间隔**：100ms 的硬限制防止重复检测
2. **S2 过滤仍然有效**：S1/S2 识别机制仍然工作
3. **用户可调节**：通过灵敏度、模式、S1/S2 模式等参数调节
4. **降噪选项**：用户可以启用降噪来减少噪声影响

## 测试建议

### 测试用例

1. **正常心音（全程）**
   - 测试：10 秒以上的清晰心音
   - 预期：从头到尾都能检测到拍点

2. **心率变化**
   - 测试：从静息到运动状态的心音
   - 预期：适应心率变化，持续检测

3. **不规则节律**
   - 测试：心律不齐的心音
   - 预期：检测到大部分拍点，不会中途停止

4. **长时间录音**
   - 测试：1 分钟以上的心音
   - 预期：全程检测，不会在中途停止

5. **S2 缺失**
   - 测试：部分拍点没有 S2 的心音
   - 预期：正确识别 S1，不受 S2 缺失影响

### 验证方法

1. **检查控制台日志**
   ```
   [HeartSound] Auto mode: 500 onsets -> 120 beats (24.0%)
   [HeartSound] Validation: 120 -> 115 beats (kept 95.8%)
   [HeartSound] Final beat range: 0.50s - 29.85s
   ```
   - 确认拍点覆盖全程（从 0.5s 到接近音频结束）
   - 验证保留率合理（80%-95%）

2. **可视化检查**
   - 查看 BPM 曲线是否覆盖全程
   - 检查拍点标记是否均匀分布

3. **对比模式**
   - 标准模式：参考基准
   - 高级模式：参考基准
   - 心音模式：应该与基准在时间范围上一致

## 相关文件

- `frontend/src/utils/bpmDetector.ts` - 核心修复
  - `selectAdaptive()` - 自动模式
  - `selectS1Only()` - S1 模式  
  - `selectS1S2Pairs()` - 配对模式
  - `validateAndRefineBeats()` - 验证函数

## 版本信息

- **日期**：2026-02-01
- **问题**：心音检测中途停止
- **状态**：已修复
- **影响范围**：所有心音检测模式（auto/s1-only/pair）
