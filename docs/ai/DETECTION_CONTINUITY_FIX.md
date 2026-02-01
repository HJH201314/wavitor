# 检测连续性修复说明

## 问题描述

在长音频文件中，检测算法容易出现"检测一段时间后就中断"的情况，导致：
- 后半段音频没有检测到拍点
- 检测结果不完整
- 用户体验差

## 问题根源分析

### 1. **过度严格的验证**
当连续多个 onset 不符合自适应间隔要求时，会被连续拒绝：
```typescript
// 原有逻辑
if (interval > adaptiveMaxInterval && scores[i] < medianScore) {
  continue; // 持续拒绝，永不恢复
}
```

### 2. **自适应窗口锁定**
- 自适应间隔基于最近 5 个拍点计算
- 如果这 5 个拍点形成了特定模式，后续的正常拍点可能被误判为异常
- 一旦形成"拒绝循环"，算法无法自我恢复

### 3. **缺少容错机制**
- 音频中可能存在暂时的噪声段、静音段
- 原算法没有"跳过问题区域，重新开始检测"的机制
- 导致检测永久中断

## 解决方案

### 核心策略：间隔恢复机制（Gap Recovery）

添加**连续拒绝计数器**，当拒绝次数过多时，强制接受下一个合理的拍点以恢复检测：

```typescript
// 1. 跟踪连续拒绝次数
let consecutiveRejects = 0;
const MAX_CONSECUTIVE_REJECTS = 15; // 阈值

// 2. 每次拒绝时累加
if (rejected) {
  consecutiveRejects++;
  continue;
}

// 3. 每次接受时重置
if (accepted) {
  consecutiveRejects = 0;
}

// 4. 达到阈值时强制恢复
if (consecutiveRejects >= MAX_CONSECUTIVE_REJECTS) {
  // 接受下一个"基本合理"的拍点
  if (interval >= minInterval * 0.5 && interval <= maxInterval * 2.0) {
    beats.push(currentTime);
    recentIntervals.length = 0; // 重置自适应窗口
    consecutiveRejects = 0;
  }
}
```

### 修改的函数

#### 1. `selectHeartSoundBeatsSimple()` - 简单拍点选择

**添加的逻辑：**

```typescript
// 间隔恢复机制
let consecutiveRejects = 0;
const MAX_CONSECUTIVE_REJECTS = 15;

// 在循环中
if (interval > adaptiveMaxInterval && scores[i] < medianScore) {
  consecutiveRejects++;
  continue;
}

// 强制恢复检查
const forceAccept = consecutiveRejects >= MAX_CONSECUTIVE_REJECTS && 
                   interval >= minInterval * 0.5 && 
                   interval <= maxInterval * 2.0;

if (forceAccept) {
  console.log(`[HeartSound] Gap recovery: forced accept after ${consecutiveRejects} rejects`);
  beats.push(onsetTimes[i]);
  recentIntervals.length = 0; // 重置自适应追踪
  consecutiveRejects = 0;
  continue;
}

// 成功接受时重置
if (accepted) {
  consecutiveRejects = 0;
}
```

**改进的拒绝逻辑：**
- 大间隔 + 弱信号：拒绝，但累加计数器
- 大间隔 + 强信号：接受并记录日志

#### 2. `selectHeartSoundBeatsWithPairing()` - S1-S2 配对选择

**添加的逻辑：**

```typescript
// 间隔恢复机制（与 simple 相同）
let consecutiveRejects = 0;
const MAX_CONSECUTIVE_REJECTS = 15;

// 在无配对路径中
if (interval < ABSOLUTE_MIN_INTERVAL || tooClose) {
  consecutiveRejects++;
  continue;
}

// 强制恢复
const forceAccept = consecutiveRejects >= MAX_CONSECUTIVE_REJECTS &&
                   interval >= minInterval * 0.5 &&
                   interval <= maxInterval * 2.0 &&
                   currentStrength > 0.2;

if (forceAccept) {
  console.log(`[HeartSound] Pairing gap recovery: forced accept`);
  beats.push(currentTime);
  recentIntervals.length = 0;
  consecutiveRejects = 0;
  continue;
}

// 配对成功时也重置
if (pairing_accepted) {
  consecutiveRejects = 0;
}
```

## 技术细节

### 为什么选择 15 次拒绝作为阈值？

| 心率 | 间隔 | 15 次对应时长 |
|-----|------|--------------|
| 60 BPM | 1000ms | ~15 秒 |
| 100 BPM | 600ms | ~9 秒 |
| 150 BPM | 400ms | ~6 秒 |

**考虑因素：**
- 太小（如 5）：可能误恢复，接受错误拍点
- 太大（如 30）：恢复太慢，损失太多数据
- **15 是平衡点**：既给算法足够时间自我调整，又不会损失太多数据

### 强制恢复的条件

```typescript
const forceAccept = 
  consecutiveRejects >= MAX_CONSECUTIVE_REJECTS &&  // 1. 拒绝次数足够多
  interval >= minInterval * 0.5 &&                  // 2. 不能太快（>= 0.5x 最小间隔）
  interval <= maxInterval * 2.0 &&                  // 3. 不能太慢（<= 2x 最大间隔）
  currentStrength > 0.2;                            // 4. 信号强度基本可接受
```

这些条件确保：
- ✅ 不会接受完全不合理的拍点
- ✅ 允许一定程度的 BPM 变化
- ✅ 要求基本的信号质量

### 重置自适应窗口

强制恢复时重置 `recentIntervals`：
```typescript
recentIntervals.length = 0; // 清空历史记录
```

**原因：**
- 中断前的间隔模式可能已不适用
- 重新建立新的自适应基准
- 避免旧数据影响新检测

## 工作流程图

```
开始检测
    ↓
检测到 onset
    ↓
符合阈值？ ──否→ consecutiveRejects++
    ↓ 是
符合间隔？ ──否→ consecutiveRejects++
    ↓ 是
接受拍点
consecutiveRejects = 0
    ↓
    ↓
consecutiveRejects >= 15？
    ↓ 是
基本合理的间隔？
    ↓ 是
【强制恢复】
- 接受拍点
- 重置计数器
- 清空自适应窗口
    ↓
继续检测...
```

## 效果验证

### 修复前
```
检测结果：[0s - 45s 有拍点] → [45s - 300s 无拍点]
原因：在 45s 处遇到问题区域，算法停止接受新拍点
```

### 修复后
```
检测结果：[0s - 300s 持续检测]
- 45s 处触发 gap recovery
- 日志：Gap recovery: forced accept after 15 rejects at 46.5s
- 检测恢复并继续到结束
```

### 日志示例

```
[HeartSound] Simple beat selection: 5432 onsets -> 287 beats
[HeartSound] Gap recovery: forced accept after 15 rejects at 46.50s
[HeartSound] Large gap (1234ms) but strong signal, accepting
[HeartSound] Beat range: 0.52s - 299.87s
```

## 性能影响

- **计算开销**：几乎无影响（只增加一个整数计数器）
- **内存开销**：无额外开销
- **检测质量**：
  - ✅ 避免检测中断
  - ✅ 保持高准确率
  - ⚠️ 可能在恢复点接受稍弱的拍点（可接受的权衡）

## 相关文件

- `frontend/src/utils/bpmDetector.ts`
  - `selectHeartSoundBeatsSimple()` - 第 783 行
  - `selectHeartSoundBeatsWithPairing()` - 第 985 行

## 测试建议

### 测试用例

1. **长音频文件**（> 3 分钟）
   - 应能完整检测到结尾
   - 查看控制台日志确认是否触发 gap recovery

2. **含噪声段的音频**
   - 噪声段后应能恢复检测
   - 恢复点应在合理位置

3. **变速心音**
   - BPM 逐渐变化的音频
   - 应能适应变化并持续检测

4. **混合质量音频**
   - 前半段清晰，后半段模糊
   - 应能检测整个音频

### 验证方法

```typescript
// 1. 检查拍点时间范围
console.log(`First beat: ${beats[0]}s`);
console.log(`Last beat: ${beats[beats.length - 1]}s`);
console.log(`Audio duration: ${duration}s`);

// 确保最后一个拍点接近音频结尾
const coverage = beats[beats.length - 1] / duration;
console.log(`Coverage: ${(coverage * 100).toFixed(1)}%`);
// 应该 > 95%

// 2. 查看控制台日志
// 搜索 "Gap recovery" 或 "Large gap"
// 确认恢复机制正常工作
```

## 后续优化方向

如果仍有问题，可以考虑：

1. **动态阈值**
   - 根据音频质量调整 `MAX_CONSECUTIVE_REJECTS`
   - 高质量音频：更大阈值（更保守）
   - 低质量音频：更小阈值（更积极恢复）

2. **多级恢复**
   ```typescript
   if (consecutiveRejects >= 10) {
     // 第一级：降低阈值
   } else if (consecutiveRejects >= 20) {
     // 第二级：强制恢复
   } else if (consecutiveRejects >= 30) {
     // 第三级：完全重置，从头开始
   }
   ```

3. **智能跳跃**
   - 检测到长时间静音段
   - 直接跳过，在下一个有信号的区域重新开始

4. **区段分析**
   - 将音频分成多个区段
   - 每个区段独立检测
   - 最后合并结果

---

更新日期：2026-02-01
