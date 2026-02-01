# UI 优化：工作区内隐藏上传模块

## 更新内容

优化了用户界面布局，当用户在工作区内（已加载音频文件）时，隐藏音频上传模块，提供更简洁的操作界面。

## 改动说明

### 1. HomeView.vue - 条件显示上传模块

**改动前**：
- 上传模块 `AudioUploader` 始终显示
- 音频内容和上传模块同时存在

**改动后**：
```vue
<!-- 有音频文件时，只显示音频内容 -->
<div v-if="audioStore.audioUrl" class="flex flex-col gap-6">
  <AudioPlayer />
  <WaveformVisualizer />
  <BPMCurveChart />
  <FrequencyVisualizer />
</div>

<!-- 无音频文件时，显示上传模块和空状态 -->
<div v-else class="flex-1 flex flex-col gap-6">
  <AudioUploader />
  <div class="flex-1 flex items-center justify-center">
    <!-- 空状态提示 -->
  </div>
</div>
```

**优点**：
- ✅ 工作区内界面更简洁，无干扰
- ✅ 更多空间用于显示音频内容
- ✅ 清晰的状态区分

### 2. WorkspaceList.vue - 添加"新建"按钮

**改动**：
1. **添加隐藏的文件输入**
```vue
<input
  ref="fileInput"
  type="file"
  :accept="acceptedFormats"
  class="hidden"
  @change="handleFileSelect"
/>
```

2. **在标题栏添加"新建"按钮**
```vue
<button
  class="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-lg"
  @click="triggerFileInput"
>
  <svg><!-- 加号图标 --></svg>
  新建
</button>
```

3. **添加文件处理逻辑**
```typescript
function triggerFileInput() {
  fileInput.value?.click()
}

async function handleFile(file: File) {
  // 验证文件类型
  // 调用 audioStore.setAudioFile(file)
  // 更新存储信息
}
```

4. **优化底部布局**
- 将"清空"按钮移到存储信息区域
- 改名为"清空全部"，更明确
- 与"存储空间"标签并列显示

**优点**：
- ✅ 工作区列表成为统一的管理入口
- ✅ "新建"按钮位置显眼，易于发现
- ✅ 保持一致的交互模式（点击文件输入）
- ✅ 上传成功后自动更新存储信息

## 用户体验提升

### 使用流程对比

**改动前**：
1. 进入应用 → 看到上传模块
2. 上传文件 → 上传模块仍然显示
3. 想上传新文件 → 在主区域上传
4. 切换工作区 → 在左侧列表点击

**改动后**：
1. 进入应用 → 看到上传模块和空状态
2. 上传文件 → 上传模块自动隐藏，显示音频内容
3. 想上传新文件 → 点击左侧"新建"按钮
4. 切换工作区 → 在左侧列表点击
5. 所有工作区操作在左侧统一完成

### 界面对比

**无音频状态**：
```
┌─────────────────┬───────────────────────────┐
│ 工作区列表      │ 上传模块                   │
│ [新建]         │ [拖拽或点击上传]            │
│                │                           │
│ 暂无工作区      │ 空状态提示                 │
│                │ "从工作区选择或上传新文件"   │
└─────────────────┴───────────────────────────┘
```

**有音频状态**：
```
┌─────────────────┬───────────────────────────┐
│ 工作区列表      │ 音频播放器                 │
│ [新建]         │                           │
│                │ 波形图                     │
│ ✓ file1.mp3   │                           │
│   file2.mp3   │ BPM 曲线图                 │
│   file3.mp3   │                           │
│                │ 频谱图                     │
│ 存储空间        │                           │
│ [清空全部]     │                           │
└─────────────────┴───────────────────────────┘
```

## 交互改进

### 1. 统一的操作入口
- 所有工作区相关操作（新建、切换、删除、清空）都在左侧列表
- 用户无需在界面不同位置寻找上传按钮

### 2. 更大的内容展示空间
- 隐藏上传模块后，音频内容可以使用全部空间
- 波形图、BPM 曲线等可视化内容更清晰

### 3. 清晰的状态指示
- 无音频：显示上传区域，引导用户操作
- 有音频：隐藏上传区域，专注内容展示

### 4. 一致的设计语言
- "新建"按钮采用蓝色主色调
- 图标 + 文字的组合，清晰易懂
- 与其他按钮保持一致的圆角和阴影

## 技术实现

### 关键代码

**条件渲染**：
```vue
<div v-if="audioStore.audioUrl">
  <!-- 音频内容 -->
</div>
<div v-else>
  <!-- 上传模块 -->
</div>
```

**文件输入触发**：
```typescript
const fileInput = ref<HTMLInputElement | null>(null)

function triggerFileInput() {
  fileInput.value?.click()
}
```

**文件处理**：
```typescript
async function handleFile(file: File) {
  const validTypes = [...]
  if (validTypes.includes(file.type)) {
    await audioStore.setAudioFile(file)
    updateStorageInfo()
  }
}
```

## 兼容性

- ✅ 不影响现有功能
- ✅ 所有文件类型验证保持一致
- ✅ 拖拽上传功能在无音频状态下仍然可用
- ✅ 快捷键等其他交互不受影响

## 测试场景

1. **首次访问**
   - ✅ 显示上传模块
   - ✅ 显示空状态提示
   - ✅ 点击或拖拽可以上传

2. **上传文件后**
   - ✅ 上传模块自动隐藏
   - ✅ 音频内容正常显示
   - ✅ 左侧出现"新建"按钮

3. **点击"新建"按钮**
   - ✅ 打开文件选择对话框
   - ✅ 选择文件后正常上传
   - ✅ 切换到新工作区

4. **删除当前工作区**
   - ✅ 音频内容消失
   - ✅ 上传模块重新显示
   - ✅ 可以继续上传

5. **切换工作区**
   - ✅ 音频内容更新
   - ✅ 上传模块保持隐藏
   - ✅ 状态正确同步

## 总结

通过这次优化：
- 🎯 提供了更专注的工作区体验
- 🎯 统一了工作区管理的交互模式
- 🎯 提升了界面的简洁性和专业感
- 🎯 改善了整体用户体验
