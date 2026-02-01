# 模态框重构说明

## 改动概览

本次重构实现了以下目标：
1. 创建了通用的模态框组件（Modal.vue）
2. 创建了消息提示组件（MessageBox.vue）和工具函数（message.ts）
3. 将项目中所有 `alert()` 和模态框替换为新的组件
4. 优化了淡入淡出动画效果

## 动画优化（最新）

### 优化内容
1. **分离进入/退出动画**：进入稍慢（250ms），退出稍快（200ms），更符合用户预期
2. **使用 cubic-bezier 缓动函数**：
   - 进入：`cubic-bezier(0.4, 0, 0.2, 1)` - 先慢后快，自然流畅
   - 退出：`cubic-bezier(0.4, 0, 1, 1)` - 快速退出，不拖沓
3. **增强进入效果**：从 `scale(0.9)` + `translateY(-20px)` 开始，更有冲击力
4. **优化退出效果**：到 `scale(0.95)` + `translateY(-10px)`，轻盈退场
5. **背景模糊过渡**：添加了 `backdrop-filter` 的过渡动画
6. **按钮交互优化**：hover 过渡时间缩短到 150ms，反应更灵敏
7. **双 RAF 触发**：使用 `requestAnimationFrame` 确保动画正确触发

### 动画参数对比

| 项目 | 优化前 | 优化后 |
|------|--------|--------|
| 进入时长 | 200ms | 250ms |
| 退出时长 | 200ms | 200ms |
| 缓动函数 | ease | cubic-bezier |
| 进入缩放 | 0.95 | 0.9 |
| 进入位移 | -10px | -20px |
| 背景模糊 | 无过渡 | 250ms 过渡 |
| 按钮 hover | 200ms | 150ms |

### message.ts 优化
- 使用响应式的 `show` ref 控制显示状态
- 双 `requestAnimationFrame` 确保 DOM 准备好后再触发动画
- 点击确认/取消时先设置 `show.value = false` 触发退出动画
- 等待 250ms（与动画时长一致）后再清理 DOM
- 添加 DOM 存在性检查，避免重复清理

## 新增文件

### 1. Modal.vue
通用模态框组件，特性：
- 模糊虚化背景（backdrop-filter: blur）
- 居中显示
- 现代化设计风格
- 支持自定义宽度、标题、按钮文本
- 支持多种确认按钮样式（primary, success, danger, warning）
- 支持 ESC 键关闭
- 平滑动画过渡
- 响应式设计

使用示例：
```vue
<Modal
  :show="showDialog"
  title="标题"
  width="480px"
  confirm-text="确定"
  confirm-variant="success"
  @close="showDialog = false"
  @confirm="handleConfirm"
>
  <div>内容</div>
</Modal>
```

### 2. MessageBox.vue
消息提示框组件，基于 Modal 构建，特性：
- 支持 4 种类型：info, success, warning, error
- 每种类型有对应的图标和颜色
- 自动选择合适的确认按钮样式

### 3. message.ts
消息提示工具函数，提供便捷的 API：
- `alert(message, title?)` - 信息提示
- `confirm(message, title?)` - 确认对话框（返回 Promise<boolean>）
- `success(message, title?)` - 成功提示
- `error(message, title?)` - 错误提示
- `showMessage(options)` - 自定义消息提示

使用示例：
```typescript
import { alert, confirm, success, error } from '../utils/message';

// 信息提示
await alert('操作完成');

// 确认对话框
const confirmed = await confirm('确定要删除吗？');
if (confirmed) {
  // 执行删除
}

// 成功提示
await success('保存成功！');

// 错误提示
await error('操作失败');
```

## 修改的文件

### 1. BPMCurveChart.vue
- 导出对话框从自定义实现改为使用 Modal 组件
- 背景从纯黑改为模糊虚化
- 样式更加现代化

### 2. AudioUploader.vue
- 将 `alert()` 改为 `message.alert()`

### 3. ECGUploader.vue
- 将所有 `alert()` 改为 `message.alert()`
- 将 `confirm()` 改为 `message.confirm()`（异步）
- 将成功提示改为 `message.success()`

### 4. WorkspaceList.vue
- 将所有 `alert()` 改为 `message.alert()`
- 将 `confirm()` 改为 `message.confirm()`（异步）

### 5. WaveformVisualizer.vue
- 将 `alert()` 改为 `message.success()` 或 `message.error()`

## 设计特点

### Modal 组件
- **模糊背景**：使用 `backdrop-filter: blur(4px)` 和半透明黑色实现
- **居中布局**：使用 flexbox 实现完美居中
- **圆角阴影**：16px 圆角 + 多层阴影营造立体感
- **动画过渡**：淡入淡出 + 缩放效果
- **键盘支持**：ESC 键关闭
- **滚动锁定**：打开时禁用 body 滚动

### MessageBox 组件
- **图标系统**：每种类型有独特的图标和颜色
  - info: 蓝色圆形信息图标
  - success: 绿色勾选图标
  - warning: 黄色警告三角
  - error: 红色错误圆圈
- **按钮映射**：自动根据类型选择按钮样式

### message.ts 工具
- **Promise API**：所有函数返回 Promise，方便 async/await
- **自动清理**：对话框关闭后自动清理 DOM
- **延迟卸载**：300ms 延迟确保动画完成

## 优势

1. **统一体验**：所有提示框和对话框风格一致
2. **易于维护**：集中管理，修改一处即可
3. **类型安全**：完整的 TypeScript 类型定义
4. **现代化**：使用现代 CSS 特性（backdrop-filter, 动画等）
5. **可扩展**：易于添加新的消息类型或自定义样式
6. **用户友好**：模糊背景不会完全遮挡内容，视觉更柔和

## 兼容性

- backdrop-filter 需要现代浏览器支持
- 如需兼容旧浏览器，可添加 polyfill 或回退方案
