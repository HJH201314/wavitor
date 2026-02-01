# 心音检测算法优化说明

## 优化日期
2026-02-01

## 概述
对 Wavitor 的心音检测算法进行了全面优化，提供了更多可配置选项和更准确的检测结果。

## 主要优化内容

### 1. 多模式检测支持

新增三种心音检测模式，用户可根据音频质量选择：

| 模式 | 特点 | 适用场景 |
|------|------|---------|
| **简单模式 (Simple)** | 快速检测，计算成本低 | 清晰的心音录音，无明显噪声 |
| **标准模式 (Standard)** | 平衡速度与准确度 | 一般质量的心音录音（默认） |
| **精确模式 (Precise)** | 最高精度，最高分辨率 | 复杂心音、心律不齐、带噪声的录音 |

#### 技术参数对比

| 参数 | 简单模式 | 标准模式 | 精确模式 |
|------|---------|---------|---------|
| Hop Size | 10ms | 5ms | 3ms |
| Window Size | 20ms | 10ms | 9ms |
| 峰值检查范围 | ±2 帧 | ±2 帧 | ±3 帧 |
| 最小峰值间隔 | 20ms | 20ms | 15ms |
| 阈值倍数 | 动态调整 | 动态调整 | 动态调整 |

### 2. 高级可配置选项

#### 2.1 灵敏度调节 (Sensitivity)
- **范围**：0.3 - 1.0
- **默认值**：0.6
- **作用**：控制检测阈值
  - 低灵敏度（0.3-0.5）：只检测强烈的心音，减少误报
  - 中灵敏度（0.5-0.7）：平衡检测
  - 高灵敏度（0.7-1.0）：检测微弱心音，可能增加误报

#### 2.2 滤波强度 (Filter Strength)
- **范围**：150 - 250 Hz
- **默认值**：200 Hz
- **作用**：低通滤波器截止频率
  - 150 Hz：保留更多低频成分，适合低频心音
  - 200 Hz：标准心音频率范围
  - 250 Hz：包含更多高频成分，适合高频率心音

#### 2.3 S1-S2 配对识别 (Enable Pairing)
- **默认值**：启用
- **作用**：
  - ✅ **启用**：识别 S1-S2 心音对，以 S1 作为心跳标记，更准确
  - ❌ **禁用**：简单峰值检测，适合不清晰的 S1-S2 模式

**配对识别原理**：
```
心动周期：
S1 (lub) ---[收缩期 < 150ms]--- S2 (dub) ---[舒张期 > 200ms]--- 下一个 S1

识别规则：
- 检测两个相邻峰值间隔 < 150ms → 识别为 S1-S2 对
- 使用 S1 作为心跳标记（更稳定、能量更大）
- 自动跳到下一个心动周期
```

#### 2.4 噪声降低 (Noise Reduction)
- **默认值**：启用
- **作用**：使用中值滤波器减少瞬时噪声
- **实现**：3ms 窗口中值滤波
- **效果**：
  - ✅ 减少环境噪声干扰
  - ✅ 平滑信号波形
  - ⚠️ 略微增加计算开销

### 3. 改进的算法流程

```
原始心音信号
    ↓
[预处理阶段]
├─ 低通滤波 (150-250 Hz 可调)
└─ 噪声降低 (可选的中值滤波)
    ↓
[检测阶段] - 根据模式调整参数
├─ 能量计算 (动态窗口大小)
├─ Onset 强度计算
├─ 自适应阈值
└─ 局部峰值检测 (动态精度)
    ↓
[选择阶段]
├─ 方式 A: S1-S2 配对选择 (如启用配对)
│   ├─ 识别收缩期间隔 (< 150ms)
│   ├─ 识别舒张期间隔 (> 200ms)
│   └─ 提取 S1 作为心跳标记
└─ 方式 B: 简单峰值选择 (如禁用配对)
    ├─ 基于强度评分
    ├─ 局部一致性检查
    └─ 自适应阈值筛选
    ↓
[验证阶段]
├─ 间隔范围验证
├─ 中位数偏差检查 (< 50%)
├─ 异常值过滤
└─ 缺失节拍插值 (间隔 > 2x 中位数)
    ↓
[输出]
├─ 验证后的心跳时间点
├─ 平均心率 (BPM)
├─ 局部心率曲线
└─ 多维度置信度评分
```

### 4. 增强的置信度计算

新的置信度评分系统考虑多个因素：

#### 评分因子

1. **规律性得分 (Regularity Score)**
   - 计算：偏差在容差范围内的节拍比例
   - 容差：根据模式调整
     - 简单模式：35%
     - 标准模式：30%
     - 精确模式：20%

2. **偏差得分 (Deviation Score)**
   - 计算：`max(0, 1 - 平均偏差 × 0.5)`
   - 衡量整体与期望值的接近程度

3. **一致性得分 (Consistency Score)**
   - 计算：相邻间隔比率在 0.8-1.25 范围内的比例
   - 衡量节拍间隔的连续性

4. **样本量得分 (Sample Size Score)**
   - 计算：`min(1, 节拍数 / 10)`
   - 更多节拍 = 更可靠的统计

#### 加权组合

| 模式 | 规律性 | 偏差 | 一致性 | 样本量 |
|------|--------|------|--------|--------|
| 简单 | 40% | 40% | 15% | 5% |
| 标准 | 40% | 30% | 25% | 5% |
| 精确 | 45% | 25% | 25% | 5% |

### 5. 智能验证与修复

#### 验证规则
1. 间隔必须在 BPM 范围内
2. 与中位数间隔偏差 < 50%
3. 过滤明显异常值

#### 自动修复
```typescript
// 检测缺失节拍
if (interval > maxInterval × 1.2 && 预期节拍数 === 2) {
  // 在间隙中插值一个节拍
  interpolatedBeat = lastBeat + medianInterval
  插入节拍
}
```

## UI 集成

### BPM 设置面板增强

#### 主界面
- 三个策略按钮：**[标准] [高级] [心音]**
- 实时显示：BPM 值、节拍数、置信度
- 重检按钮：应用新配置重新检测

#### 心音高级选项（可折叠）

当选择"心音"策略时显示"高级"按钮，点击展开：

1. **检测模式选择器**
   - 三个按钮：简单 | 标准 | 精确
   - Tooltip 显示每个模式的说明

2. **灵敏度滑块**
   - 范围：0.3 - 1.0
   - 实时数值显示
   - 标签：低 ↔ 高

3. **滤波频率滑块**
   - 范围：150 - 250 Hz
   - 实时频率显示
   - 标签：150 Hz ↔ 250 Hz

4. **开关选项**
   - ☑ 启用 S1-S2 配对识别
   - ☑ 启用降噪处理

#### 交互流程
```
1. 用户选择"心音"策略
2. 自动展开高级选项
3. 用户调整参数
4. 点击"重检"按钮
5. 应用新参数重新检测
6. 更新可视化和 BPM 信息
```

## 代码变更

### 新增类型定义

```typescript
export type HeartSoundMode = 'simple' | 'standard' | 'precise';

export interface HeartSoundOptions {
  mode?: HeartSoundMode
  sensitivity?: number            // 0.3-1.0
  filterStrength?: number         // 150-250 Hz
  enablePairing?: boolean
  noiseReduction?: boolean
}

export interface BPMDetectorOptions {
  // ...existing options
  heartSoundOptions?: HeartSoundOptions
}
```

### 核心函数

#### `detectBPMHeartSound()`
- 接受 `HeartSoundOptions` 参数
- 根据选项动态调整检测流程

#### `applyNoiseReduction()`
```typescript
// 新增：中值滤波器
function applyNoiseReduction(data: Float32Array, sampleRate: number): Float32Array
```

#### `detectHeartSoundOnsets()`
- 根据模式调整时间分辨率
- 自适应阈值计算
- 灵敏度驱动的峰值检测

#### `selectHeartSoundBeatsSimple()`
```typescript
// 新增：简单选择（不配对）
function selectHeartSoundBeatsSimple(
  onsetTimes, onsetStrengths, minBPM, maxBPM, sensitivity
): number[]
```

#### `selectHeartSoundBeatsWithPairing()`
```typescript
// 新增：配对选择（S1-S2 识别）
function selectHeartSoundBeatsWithPairing(
  onsetTimes, onsetStrengths, minBPM, maxBPM
): number[]
```

#### `validateAndRefineBeats()`
```typescript
// 新增：验证并修复节拍
function validateAndRefineBeats(
  beats, minBPM, maxBPM
): number[]
```

#### `calculateHeartSoundConfidence()`
- 多维度评分
- 模式相关的权重分配
- 详细的调试日志

### Store 集成

#### audio.ts
```typescript
// 新增状态
const heartSoundOptions = ref<HeartSoundOptions>({
  mode: 'standard',
  sensitivity: 0.6,
  filterStrength: 200,
  enablePairing: true,
  noiseReduction: true
})

// 新增方法
function updateHeartSoundOptions(options: Partial<HeartSoundOptions>) {
  heartSoundOptions.value = { ...heartSoundOptions.value, ...options }
}

// 检测时传递选项
const result = detectBPM(buffer, { 
  strategy: detectionStrategy.value,
  heartSoundOptions: detectionStrategy.value === 'heartsound' 
    ? heartSoundOptions.value 
    : undefined
})
```

### 组件更新

#### BPMSettings.vue
- 新增模式选择器
- 新增灵敏度滑块
- 新增滤波强度滑块
- 新增配对和降噪开关
- 折叠/展开动画
- 响应式绑定到 store

## 使用建议

### 按音频类型选择配置

#### 清晰的专业心音录音
```
模式: 简单
灵敏度: 0.5-0.6
滤波: 200 Hz
配对: 启用
降噪: 禁用
```

#### 一般质量的心音录音
```
模式: 标准
灵敏度: 0.6
滤波: 200 Hz
配对: 启用
降噪: 启用
```

#### 复杂/噪声心音
```
模式: 精确
灵敏度: 0.7-0.8
滤波: 180-200 Hz
配对: 启用
降噪: 启用
```

#### 不规则心律
```
模式: 标准或精确
灵敏度: 0.6-0.7
滤波: 200 Hz
配对: 禁用 (因为 S1-S2 模式不规律)
降噪: 启用
```

#### 胎心音
```
模式: 精确
灵敏度: 0.7
滤波: 220-250 Hz (胎心频率较高)
配对: 禁用
降噪: 启用
```

### 调试与优化

#### 控制台日志
算法会输出详细的调试信息：

```javascript
[HeartSound] Starting detection (40-300 BPM) {
  mode: 'standard',
  sensitivity: 0.6,
  filterStrength: 200,
  enablePairing: true,
  noiseReduction: true
}

[HeartSound] Onset detection params: hopSize=220, windowSize=440, threshold=0.40
[HeartSound] Detected 45 onset candidates
[HeartSound] Selected 18 heart beats (with S1-S2 pairing)
[HeartSound] Final validated beats: 16
[HeartSound] Confidence breakdown: regularity=0.88, deviation=0.92, consistency=0.94, sample=1.00 -> 0.90
```

#### 迭代优化流程
1. 上传心音文件
2. 选择"心音"策略，使用默认配置检测
3. 查看结果和置信度
4. 如果置信度低或检测不准确：
   - 检查控制台日志
   - 调整参数（灵敏度、模式等）
   - 点击"重检"
5. 对比波形图与实际心音
6. 保存最优配置

## 性能特点

### 计算复杂度

| 模式 | 时间复杂度 | 相对速度 |
|------|-----------|---------|
| 简单 | O(n) | 最快 (1x) |
| 标准 | O(n) | 中等 (1.5x) |
| 精确 | O(n) | 较慢 (2.5x) |

### 内存占用
- 简单模式：约为音频长度的 2x
- 标准模式：约为音频长度的 3x
- 精确模式：约为音频长度的 5x

### 适用场景性能建议
- **实时处理**：使用简单模式
- **批量分析**：使用标准模式
- **研究/诊断**：使用精确模式

## 已知限制

1. **配对识别局限**
   - 假设 S1-S2 间隔 < 150ms
   - 某些异常心音可能不适用

2. **噪声敏感性**
   - 强背景噪声仍可能影响检测
   - 建议使用高质量录音

3. **计算开销**
   - 精确模式在长音频上可能较慢
   - 建议录音长度 < 2 分钟

4. **不适用场景**
   - 严重不规则心律（如房颤）
   - 多重杂音干扰
   - 极低信噪比录音

## 未来改进方向

1. **自动参数推荐**
   - 分析音频特征
   - 自动推荐最佳配置

2. **频谱分析**
   - FFT 频域检测
   - 多频带分析

3. **机器学习增强**
   - 训练心音分类模型
   - 自动识别 S1/S2/杂音

4. **心律失常检测**
   - 早搏识别
   - 心律不齐分类
   - 异常模式报警

5. **批量分析工具**
   - 多文件处理
   - 统计分析报告
   - 导出详细数据

## 参考文献

### 心音信号处理
- 数字信号处理中的 Onset 检测
- 自适应阈值算法
- 中值滤波与噪声抑制

### 心音生理学
- S1 和 S2 心音的时序关系
- 心动周期的收缩期和舒张期
- 正常与异常心音模式

## 总结

本次优化大幅提升了心音检测的：
- ✅ **灵活性**：3 种模式 + 5 个可调参数
- ✅ **准确性**：多维度置信度 + 智能验证
- ✅ **鲁棒性**：噪声处理 + 异常值过滤
- ✅ **易用性**：直观 UI + 实时反馈

用户现在可以根据具体需求精细调整检测参数，获得更准确的心率分析结果。
