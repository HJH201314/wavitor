# ECG R-peak 校准数据一致性修复 + 异步加载优化

## 问题描述

1. **数据一致性问题**：在切换工作区或刷新页面后，ECG R-peaks 标记的显示位置与初次加载时不一致。
2. **性能问题**：ECG R-peak 检测（Pan-Tompkins 算法）非常耗时，阻塞 UI 线程。

### 根本原因

- **初次上传**：`setECGFile()` → `extractECGBeats()` → **R-peak 时间校准** → 保存
- **重新加载**：`loadECGReferences()` → 直接使用 `ecgRef.beats` → 可能未执行相同的校准逻辑

## 修复方案（方案 A + 异步加载）

1. 确保使用存储的校准后 beats 数据
2. 添加验证日志和重新校准功能
3. **实现异步加载和 Loading 指示器**

### 修改内容

#### 1. `audio.ts` - 添加 ECG 处理状态

**新增状态变量**：
```typescript
const isProcessingECG = ref(false);           // 是否正在处理 ECG
const ecgProcessingProgress = ref(0);         // 处理进度 0-100
const ecgProcessingStage = ref('');           // 当前处理阶段描述
```

#### 2. `audio.ts` - 异步加载和 Loading 优化

**setECGFile()** - 上传时的异步处理：
- 设置 loading 状态：`isProcessingECG = true`
- 分阶段更新进度：
  - 10%: 解码音频文件
  - 30%: 解码完成
  - 40-80%: 检测 R 峰位置（最耗时）
  - 85%: 保存数据
  - 100%: 完成
- 使用 `setTimeout` 包装 `extractECGBeats()` 避免阻塞 UI
- 添加详细的阶段描述：`ecgProcessingStage`

```typescript
// Extract ECG beats - wrap in setTimeout for async
const extractedBeats = await new Promise<number[]>((resolve) => {
  setTimeout(async () => {
    const beats = await extractECGBeats(buffer);
    resolve(beats);
  }, 0);
});
```

**loadECGReferences()** - 加载时的异步处理：
- 显示加载进度：`加载 文件名 (1/总数)`
- 多文件按顺序加载，实时更新进度
- 使用存储的校准后 beats（方案 A）
- 添加日志验证数据一致性

**recalibrateECG()** - 单文件重新校准：
- 显示进度：`重新校准 文件名...`
- 20%: 开始检测
- 80%: 检测完成
- 100%: 保存完成
- 使用 `setTimeout` 异步执行

**recalibrateAllECG()** - 批量重新校准：
- 显示进度：`重新校准 文件名 (1/总数)`
- 每个文件独立进度显示
- 返回成功/失败统计

#### 3. `ECGUploader.vue` - UI 增强

**新增响应式状态**：
```typescript
const isProcessingECG = computed(() => audioStore.isProcessingECG);
const ecgProcessingProgress = computed(() => audioStore.ecgProcessingProgress);
const ecgProcessingStage = computed(() => audioStore.ecgProcessingStage);
```

**Loading 指示器**（蓝色进度条）：
```vue
<div v-if="isProcessingECG" class="p-3 bg-blue-50 rounded-md border border-blue-200">
  <div class="space-y-2">
    <div class="flex items-center justify-between text-xs">
      <span class="text-blue-700 font-medium">{{ ecgProcessingStage }}</span>
      <span class="text-blue-600">{{ ecgProcessingProgress }}%</span>
    </div>
    <div class="w-full bg-blue-200 rounded-full h-1.5 overflow-hidden">
      <div
        class="bg-blue-600 h-full transition-all duration-300"
        :style="{ width: `${ecgProcessingProgress}%` }"
      />
    </div>
  </div>
</div>
```

**按钮禁用**：
- 处理中时禁用所有按钮（添加、重新校准、移除）
- 添加 `disabled:opacity-50` 和 `disabled:cursor-not-allowed` 样式

#### 4. 日志验证机制

**保存时**：
```typescript
console.log(`[ECG-Save] ${file.name}:`, {
  beatsCount: extractedBeats.length,
  firstBeats: extractedBeats.slice(0, 5),
  lastBeats: extractedBeats.slice(-3)
});
```

**加载时**：
```typescript
console.log(`[ECG-Load] ${ecgRef.fileName}:`, {
  beatsCount: beats.length,
  firstBeats: beats.slice(0, 5),
  lastBeats: beats.slice(-3)
});
```

**重新校准时**：
```typescript
console.log(`[ECG-Recalibrate] ${ecgData.fileName}:`, {
  oldBeatsCount: ecgData.beats.length,
  newBeatsCount: newBeats.length,
  oldFirstBeats: ecgData.beats.slice(0, 5),
  newFirstBeats: newBeats.slice(0, 5)
});
```

## 使用方法

### 1. 上传 ECG 文件

- 拖拽或点击上传 WAV 文件
- 自动显示蓝色进度条
- 实时显示处理阶段：
  - "解码音频文件..."
  - "检测 R 峰位置..."（最耗时）
  - "保存数据..."
  - "完成"

### 2. 加载工作区

- 切换工作区时自动加载 ECG 文件
- 显示进度：`加载 文件名 (1/3)`
- 后台异步加载，不阻塞 UI

### 3. 重新校准

**单文件**：
- 点击文件卡片上的 🔄 图标
- 显示进度：`重新校准 文件名...`
- 完成后显示成功/失败提示

**批量**：
- 点击顶部 "🔄 重新校准" 按钮
- 逐个文件处理，显示进度
- 完成后显示统计：`重新校准完成：2/2 个文件成功`

### 4. 验证数据一致性

打开控制台，对比日志：
- `[ECG-Save]` vs `[ECG-Load]`：firstBeats 应完全一致
- `[ECG-Recalibrate]`：查看 oldBeats vs newBeats 的差异

## 性能优化细节

### 异步执行策略

使用 `setTimeout` 包装计算密集型操作：
```typescript
const extractedBeats = await new Promise<number[]>((resolve) => {
  setTimeout(async () => {
    const beats = await extractECGBeats(buffer);
    resolve(beats);
  }, 0);
});
```

**原理**：
- `setTimeout(..., 0)` 将任务放入宏任务队列
- 浏览器在执行前可以更新 UI（渲染 loading 指示器）
- 避免长时间计算阻塞事件循环

### 进度更新策略

**上传流程**：
- 0% → 10%（开始）
- 10% → 30%（解码完成，快速）
- 30% → 40%（准备检测）
- 40% → 80%（R-peak 检测，耗时最长）
- 80% → 85%（检测完成）
- 85% → 100%（保存数据）

**加载流程**：
- 均匀分配：每个文件占 `100/总文件数` 的进度

**重新校准**：
- 0% → 20%（开始）
- 20% → 80%（检测，耗时最长）
- 80% → 100%（保存）

### Loading 状态重置

所有操作完成后，保持成功状态 500ms：
```typescript
setTimeout(() => {
  isProcessingECG.value = false;
  ecgProcessingProgress.value = 0;
  ecgProcessingStage.value = '';
}, 500);
```

## 技术细节

### 数据流

```
上传 ECG:
File → [10%] 解码 → [40%] 检测 R-peak → [85%] 保存 → [100%] 完成

加载 ECG:
workspace.ecgReferences → [按文件加载] → 解码 + 使用存储beats → [100%] 完成

重新校准:
ecgDataList.buffer → [20%] 重新检测 → [80%] 更新数据 → [100%] 完成
```

### UI 状态管理

```typescript
// Store 状态
isProcessingECG: boolean         // 全局处理状态
ecgProcessingProgress: number    // 0-100
ecgProcessingStage: string       // 阶段描述

// Component 响应式绑定
v-if="isProcessingECG"           // 显示进度条
:disabled="isProcessingECG"      // 禁用按钮
:style="{ width: `${progress}%` }"  // 进度条宽度
```

## 影响范围

### 修改文件
- `frontend/src/stores/audio.ts`（+120 行）
- `frontend/src/components/ECGUploader.vue`（+25 行）

### 新增功能
- ✅ 异步 ECG 处理（不阻塞 UI）
- ✅ 实时进度指示器
- ✅ 阶段描述文字
- ✅ 按钮禁用状态
- ✅ 数据一致性验证日志
- ✅ 手动重新校准功能

### 受益场景
- 上传大型 ECG 文件（~4 分钟音频）
- 切换工作区加载多个 ECG 文件
- 批量重新校准
- 所有 ECG 相关操作的用户体验

## 测试建议

### 1. 性能测试
- 上传大型 ECG 文件（>200MB）
- 观察 UI 是否保持响应
- 验证进度条是否平滑更新

### 2. 功能测试
- 上传 → 切换工作区 → 返回（验证位置一致）
- 上传 → 刷新页面（验证位置一致）
- 重新校准单个/所有文件
- 多个 ECG 文件的批量操作

### 3. 日志验证
- 对比 `[ECG-Save]` 和 `[ECG-Load]` 的 firstBeats
- 检查 `[ECG-Recalibrate]` 的前后差异
- 确认数据一致性

## 后续优化建议

1. **Web Worker**：将 Pan-Tompkins 算法移到 Worker 线程
2. **增量进度**：在 `extractECGBeats()` 内部报告进度
3. **取消操作**：添加取消按钮停止长时间运行的检测
4. **并发处理**：多文件时使用 Promise.all 并行处理
5. **缓存优化**：避免重复解码同一文件
