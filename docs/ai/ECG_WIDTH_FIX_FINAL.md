# ECG 波形宽度最终修复文档

## 🔥 最终根本原因

容器使用了 `v-show` 导致在加载时被隐藏（`display: none`），所以 `clientWidth = 0`！

### 问题分析

```vue
<!-- 原来的代码 -->
<div v-if="audioStore.hasECG" class="...">  <!-- 外层容器，始终可见 -->
  <!-- ... 其他内容 ... -->
  <div
    v-show="!isLoadingECG && ecgWaveforms.length > 0"  <!-- ❌ 隐藏时 width=0 -->
    ref="ecgContainerRef"
    class="space-y-2"
  />
</div>
```

**问题链条**：
1. `isLoadingECG = true` → 容器被 `v-show` 隐藏
2. `ecgContainerRef.value.clientWidth = 0`
3. `loadAllECGWaveforms()` 检测到 width=0，进入重试循环
4. 但容器要等到 `isLoadingECG = false` 才显示
5. 而 `isLoadingECG = false` 要等到 `loadAllECGWaveforms()` 完成
6. **死锁！无限重试！**

### 最终修复方案

将 `ref` 移到外层**始终可见的父容器**：

```vue
<!-- 修复后的代码 -->
<div 
  v-if="audioStore.hasECG" 
  ref="ecgContainerRef"  <!-- ✅ 移到外层，始终可见 -->
  class="..."
>
  <!-- ... 其他内容 ... -->
  <div
    ref="ecgCanvasContainerRef"  <!-- 新增，用于放置 canvas -->
    v-show="!isLoadingECG && ecgWaveforms.length > 0"
    class="space-y-2"
  />
</div>
```

**好处**：
- `ecgContainerRef` 始终可见，`clientWidth` 正常
- `ecgCanvasContainerRef` 用于动态添加 canvas 元素
- 不会进入死锁状态

### 代码修改

#### 1. 添加重试限制（防止死循环）

```typescript
// Track retry count to prevent infinite loops
let loadRetryCount = 0;
const MAX_LOAD_RETRIES = 10;

async function loadAllECGWaveforms() {
  if (ecgContainerRef.value) {
    const containerWidth = ecgContainerRef.value.clientWidth;
    
    if (containerWidth <= 0) {
      if (loadRetryCount >= MAX_LOAD_RETRIES) {
        console.error('[ECG-WV] Container not ready after max retries, giving up');
        loadRetryCount = 0;
        return;
      }
      
      loadRetryCount++;
      setTimeout(() => loadAllECGWaveforms(), 100);
      return;
    }
    
    // Container is ready, reset retry count
    loadRetryCount = 0;
    canvasWidth.value = containerWidth;
    // ... 继续
  }
}
```

#### 2. 移动 ref 到外层容器

```vue
<div 
  v-if="audioStore.hasECG" 
  ref="ecgContainerRef"  <!-- 外层容器，始终可见 -->
  class="mt-6 pt-6 border-t-2 border-purple-100"
>
  <!-- ... -->
  <div
    ref="ecgCanvasContainerRef"  <!-- 新增 ref -->
    v-show="!isLoadingECG && ecgWaveforms.length > 0"
    class="space-y-2"
  />
</div>
```

#### 3. 更新所有引用

```typescript
// 添加新 ref
const ecgContainerRef = ref<HTMLDivElement | null>(null);
const ecgCanvasContainerRef = ref<HTMLDivElement | null>(null);

// 更新 drawAllECGWaveforms
function drawAllECGWaveforms() {
  const container = ecgCanvasContainerRef.value;  // 使用 canvas 容器
  if (!container) return;
  // ...
}

// 更新清空逻辑
if (ecgCanvasContainerRef.value) {
  while (ecgCanvasContainerRef.value.firstChild) {
    ecgCanvasContainerRef.value.removeChild(ecgCanvasContainerRef.value.firstChild);
  }
}
```

## 修复效果

✅ **无死锁**：
- 外层容器始终可见
- `clientWidth` 正常获取
- 重试逻辑正常工作

✅ **防止无限循环**：
- 最多重试 10 次
- 超过限制后放弃并输出错误

✅ **正确的宽度**：
- 容器宽度 = 实际父容器宽度
- canvas 宽度 = 容器宽度
- 无缩放问题

## 测试验证

修复后应该看到：

### 初次加载
```javascript
[ECG] Reset canvasWidth from 800 to 0
[ECG-WV] ============ loadAllECGWaveforms start ============
{
  containerWidth: 1846,
  canvasWidthBefore: 0,
  canvasWidthAfter: 1846  // ✅ 正确
}
```

### 重新加载工作区
```javascript
[ECG] Reset canvasWidth from 1894 to 0  // ✅ 重置旧值
[ECG-WV] ============ loadAllECGWaveforms start ============
{
  containerWidth: 1846,
  canvasWidthBefore: 0,
  canvasWidthAfter: 1846  // ✅ 使用新值
}
```

### 不应该看到
```javascript
[ECG-WV] Container not ready (width=0), retrying...  // ❌ 如果出现说明还有问题
```

## 关键教训

1. **`v-show` 会导致 `clientWidth = 0`**
   - 使用 `display: none` 隐藏元素
   - 需要获取尺寸时，使用外层始终可见的容器

2. **防御性编程**
   - 添加最大重试次数
   - 避免死循环

3. **容器层次设计**
   - 获取尺寸的容器：始终可见
   - 显示内容的容器：可以动态显示/隐藏

## 修复文件

- ✅ `frontend/src/components/WaveformVisualizer.vue`
  - 添加重试限制
  - 移动 `ref` 到外层容器
  - 更新所有容器引用

## 日期

2025-02-01 - 最终修复完成！🎉
