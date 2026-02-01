# BPM 检测算法优化

## 更新日期
- 初始优化: 2026-02-01
- 策略隔离更新: 2026-02-01

## 优化目标
优化音频拍点检测算法，特别是在检测到 BPM 突变时，能够重新确认拍点之间是否有遗漏。同时提供两种检测策略供用户选择。

## 检测策略

### 🎯 标准检测（Standard）
**特点**: 快速、简单、高效
**适用场景**: 节奏稳定的音乐（流行、电子、摇滚等）
**算法特点**:
- 基于 onset 强度和相邻一致性评分
- 固定阈值筛选（threshold = 0.3）
- 不进行二次填充，速度更快
- 适合 BPM 变化不大的音乐

**优势**:
- ✅ 检测速度快
- ✅ 计算开销小
- ✅ 对稳定节奏识别准确

**劣势**:
- ❌ 对变速音乐可能遗漏拍点
- ❌ BPM 突变处理能力弱

### 🚀 高级检测（Advanced）
**特点**: 智能、准确、自适应
**适用场景**: 节奏变化的音乐（古典、爵士、实验音乐、现场录音等）
**算法特点**:
- 自适应阈值（基于分数分布中位数）
- BPM 突变检测（30% 变化阈值）
- 智能填充遗漏的拍点
- 更大的邻居评估窗口（3 个邻居）

**优势**:
- ✅ 准确处理 BPM 变化
- ✅ 自动填充遗漏拍点
- ✅ 对复杂节奏适应性强
- ✅ 提高整体检测完整性

**劣势**:
- ❌ 计算时间稍长
- ❌ 可能在某些情况下产生误报

## 用户界面

### BPM 设置面板
新增了 `BPMSettings.vue` 组件，提供：

1. **策略选择**
   - 标准检测 / 高级检测 单选按钮
   - 实时显示当前选择的策略
   - 每个策略都有说明文字

2. **重新检测按钮**
   - 应用新策略后重新检测
   - 显示检测进度状态

3. **检测结果展示**
   - 平均 BPM
   - 节拍数量
   - 置信度百分比

4. **状态反馈**
   - 检测中的动画效果
   - 当前使用的算法提示

## 主要改进

## 技术实现

### 1. 类型定义
```typescript
export type BPMDetectionStrategy = 'standard' | 'advanced';

export interface BPMDetectorOptions {
  minBPM?: number
  maxBPM?: number
  strategy?: BPMDetectionStrategy
}
```

### 2. 主检测函数
```typescript
export function detectBPM(
  audioBuffer: AudioBuffer,
  options: BPMDetectorOptions = {}
): BeatInfo {
  const { strategy = 'advanced' } = options;
  
  if (strategy === 'standard') {
    return detectBPMStandard(audioBuffer, minBPM, maxBPM);
  } else {
    return detectBPMAdvanced(audioBuffer, minBPM, maxBPM);
  }
}
```

### 3. 策略实现

#### 标准检测流程
1. Onset 检测（能量变化）
2. 简单拍点选择（`selectBeatsSimple`）
3. 计算局部 BPM
4. 计算平均 BPM 和置信度

#### 高级检测流程
1. Onset 检测（能量变化）
2. 高级拍点选择（`selectBeatsAdvanced`）
3. **BPM 突变检测与填充**（`detectAndFillMissingBeats`）
4. 计算局部 BPM
5. 计算平均 BPM 和置信度

### 4. Store 集成
```typescript
// audio store 新增
const detectionStrategy = ref<BPMDetectionStrategy>('advanced');

function setDetectionStrategy(strategy: BPMDetectionStrategy) {
  detectionStrategy.value = strategy;
}

// 检测时使用策略
const result = detectBPM(buffer, { 
  minBPM: 60, 
  maxBPM: 200,
  strategy: detectionStrategy.value 
});
```

## 算法细节
**位置**: `frontend/src/utils/bpmDetector.ts`

### 2. 高级拍点选择（`selectBeatsAdvanced`）
**位置**: `frontend/src/utils/bpmDetector.ts`

**改进点**:
- 使用更大的邻居窗口（3个邻居）来评估局部一致性
- 引入自适应阈值，基于分数分布的中位数动态调整
- 改进一致性评分机制，更准确地识别真实节拍

```typescript
// 旧方法：只看前后邻居，固定阈值 0.3
// 新方法：查看周围3个邻居的窗口，使用自适应阈值
const scoreThreshold = Math.max(0.3, medianScore * 0.6);
```

### 3. BPM 突变检测（`detectAndFillMissingBeats`）
**核心功能**: 检测 BPM 突变并填充遗漏的拍点

**检测机制**:
- **BPM 变化检测**: 当相邻拍点的间隔比预期间隔变化超过 30% 时，判定为 BPM 突变
- **间隔过大检测**: 当拍点间隔超过最大允许间隔的 1.5 倍时，认为可能存在遗漏

**工作流程**:
1. 遍历所有已检测的拍点
2. 对于每对相邻拍点：
   - 计算当前间隔和预期间隔
   - 判断是否存在 BPM 突变或间隔异常
3. 如果检测到异常，调用 `findMissingBeatsInGap` 在该区间寻找遗漏的拍点
4. 合并所有拍点并去重

### 4. 间隔填充（`findMissingBeatsInGap`）
**核心功能**: 在两个拍点之间的间隔中寻找遗漏的拍点

**算法步骤**:
1. 根据预期间隔估算间隔内应该有多少个拍点
2. 从原始 onset 候选中筛选出位于该间隔内的候选点
3. 按强度排序候选点
4. 使用网格匹配算法：
   - 计算每个应该存在的拍点的理论位置
   - 在理论位置附近（40% 的间隔范围内）寻找最强的候选点
   - 避免选择距离太近的候选点
5. 返回找到的遗漏拍点列表

**关键参数**:
```typescript
const bpmChangeThreshold = 0.3;  // 30% BPM 变化阈值
const searchWindow = targetInterval * 0.4;  // 搜索窗口为目标间隔的 40%
const tolerance = 0.01;  // 10ms 去重容差
```

## 检测流程更新

### 原流程
1. 计算 onset 检测函数
2. 选择最强的 onset 作为拍点候选
3. 计算局部 BPM
4. 计算平均 BPM
5. 计算置信度

### 新流程
1. 计算 onset 检测函数
2. 选择最强的 onset 作为拍点候选
3. **[新增] 检测 BPM 突变并填充遗漏的拍点**
4. 计算局部 BPM
5. 计算平均 BPM
6. 计算置信度

## 调试日志
添加了控制台日志来跟踪优化效果：
```typescript
console.log(`Initial beat selection: ${beats.length} beats`);
console.log(`Filled ${beats.length - beatsBeforeFill} missing beats (BPM change detection)`);
```

## 预期效果

1. **更准确的 BPM 突变处理**: 当音乐速度突然改变时，能够正确识别并填充之前遗漏的拍点

2. **减少遗漏**: 在拍点检测的初始阶段可能因为过于严格的筛选而遗漏的拍点，现在能够在后处理阶段被找回

3. **更好的局部一致性**: 改进的评分机制能够更好地识别局部一致的节奏模式

4. **自适应性**: 算法能够根据音频的实际特征动态调整检测参数

## 使用指南

### 如何选择检测策略

1. **使用标准检测的场景**:
   - 电子音乐、流行音乐等节奏稳定的曲目
   - 需要快速检测，对准确性要求不高
   - 音频时长较长，希望减少处理时间
   - BPM 基本恒定，无明显变速

2. **使用高级检测的场景**:
   - 古典音乐、爵士乐等节奏变化的曲目
   - 包含渐快（accelerando）或渐慢（ritardando）的音乐
   - 现场录音，节奏可能不稳定
   - 需要最高的检测准确性
   - 音频中有明显的速度变化

### 操作步骤

1. **上传音频文件**
   - 支持 WAV, MP3, OGG, FLAC, AAC 格式

2. **等待自动检测**
   - 默认使用"高级检测"策略
   - 检测完成后会显示节拍标记

3. **切换检测策略（如果需要）**
   - 在 "BPM 检测设置" 面板中选择策略
   - 点击"重新检测"按钮应用新策略

4. **查看检测结果**
   - 平均 BPM 值
   - 检测到的节拍数量
   - 检测置信度

5. **手动调整（可选）**
   - 在波形图上手动添加/删除/移动拍点
   - 支持撤销/重做操作

### 性能对比

| 特性 | 标准检测 | 高级检测 |
|------|---------|---------|
| 检测速度 | ⚡⚡⚡ 快 | ⚡⚡ 中等 |
| BPM 稳定音乐 | ✅ 优秀 | ✅ 优秀 |
| BPM 变化音乐 | ⚠️ 一般 | ✅ 优秀 |
| 遗漏拍点处理 | ❌ 无 | ✅ 自动填充 |
| 计算开销 | 💚 低 | 💛 中等 |
| 推荐场景 | 电子/流行 | 古典/爵士/现场 |

## 测试建议

1. 使用包含速度变化的音乐进行测试（如渐快、渐慢、突然变速）
2. 对比优化前后的拍点检测结果
3. 检查控制台日志，确认是否有拍点被填充
4. 在 BPM 曲线图上观察速度变化点的拍点密度是否更合理

## 技术细节

### 时间复杂度
- `detectAndFillMissingBeats`: O(n * m)，其中 n 是拍点数量，m 是 onset 候选数量
- `findMissingBeatsInGap`: O(k * m)，其中 k 是估算的遗漏拍点数，m 是候选数量

### 空间复杂度
- 主要开销在于存储 onset 候选和中间结果，O(m)

## 后续优化方向

1. 可以考虑使用机器学习方法来优化 BPM 突变检测的阈值
2. 可以添加更复杂的节奏模式识别，如处理复合节拍
3. 可以引入用户反馈机制来持续改进检测准确性
