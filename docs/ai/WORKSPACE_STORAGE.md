# 工作区存储功能增强

## 功能概述

本次更新为 Wavitor 添加了完整的浏览器存储功能，实现了音频文件和节拍数据的持久化存储。

## 实现的功能

### 1. 音频文件存储
- ✅ 使用 IndexedDB 存储完整的音频文件
- ✅ 支持大文件存储（几十 MB 到几百 MB）
- ✅ 自动保存上传的音频文件
- ✅ 切换工作区时自动加载对应的音频文件

### 2. 节拍数据存储
- ✅ 存储手动添加的节拍点（`manualBeats`）
- ✅ 存储删除的检测节拍（`deletedDetectedBeats`）
- ✅ 存储完整的操作历史记录（`history`）
- ✅ 支持撤销/重做功能的持久化

### 3. 工作区管理
- ✅ 工作区列表显示
- ✅ 点击工作区自动切换并加载音频
- ✅ 显示工作区的节拍数和修改时间
- ✅ 删除单个工作区
- ✅ 清空所有工作区
- ✅ 存储空间使用情况显示

## 技术实现

### 存储方案选择
采用 **IndexedDB** 作为存储方案，原因：
- 支持存储大文件（Blob 对象）
- 容量远大于 localStorage（通常 ≥ 50MB，甚至几百 MB）
- 异步 API，不会阻塞主线程
- 原生浏览器支持，无需额外依赖

### 核心文件

#### 1. `/frontend/src/utils/storage.ts`
存储管理器，提供以下功能：
- 初始化 IndexedDB
- 保存/加载音频文件（Blob 格式）
- 保存/加载工作区数据（JSON 格式）
- 获取存储空间使用情况
- 清空所有数据

#### 2. `/frontend/src/stores/workspace.ts`（更新）
工作区状态管理，集成存储功能：
- `initStorage()` - 初始化存储并加载所有工作区
- `loadWorkspace()` - 从存储加载工作区或创建新工作区
- `updateBeats()` - 更新节拍并自动保存
- `deleteWorkspace()` - 删除工作区及其音频文件
- `undo()/redo()` - 撤销/重做并保存状态

#### 3. `/frontend/src/stores/audio.ts`（更新）
音频状态管理，支持文件存储：
- `setAudioFile()` - 设置音频文件并自动保存到存储
- `loadWorkspaceById()` - 通过 ID 加载工作区和音频文件

#### 4. `/frontend/src/components/WorkspaceList.vue`（更新）
工作区列表组件：
- 显示所有工作区
- 点击切换工作区
- 显示存储空间使用情况
- 删除工作区功能

## 使用流程

### 1. 上传音频文件
```
用户上传文件 → 创建工作区 → 保存音频文件到 IndexedDB → 保存工作区数据
```

### 2. 编辑节拍
```
添加/删除节拍 → 更新工作区数据 → 自动保存到 IndexedDB
```

### 3. 切换工作区
```
点击工作区 → 从 IndexedDB 加载音频文件 → 加载工作区数据 → 恢复编辑状态
```

### 4. 撤销/重做
```
执行撤销/重做 → 更新当前状态 → 自动保存到 IndexedDB
```

## 数据结构

### WorkspaceData
```typescript
interface WorkspaceData {
  fileId: string                      // 文件唯一标识
  fileName: string                    // 文件名
  manualBeats: number[]               // 手动添加的节拍（秒）
  deletedDetectedBeats: number[]      // 删除的检测节拍（秒）
  history: HistoryEntry[]             // 操作历史
  historyIndex: number                // 当前历史索引
  createdAt: number                   // 创建时间戳
  lastModified: number                // 最后修改时间戳
}
```

### AudioFileData
```typescript
interface AudioFileData {
  fileId: string          // 文件 ID
  fileName: string        // 文件名
  fileType: string        // MIME 类型
  fileSize: number        // 文件大小（字节）
  lastModified: number    // 最后修改时间
  audioBlob: Blob         // 音频二进制数据
  createdAt: number       // 创建时间戳
}
```

## 存储容量

- **IndexedDB 容量**: 通常 ≥ 50MB，部分浏览器可达几百 MB 甚至更多
- **自动管理**: 显示存储使用情况，提醒用户清理
- **配额请求**: 浏览器会在需要时自动请求更多空间

## 兼容性

- ✅ Chrome/Edge 24+
- ✅ Firefox 16+
- ✅ Safari 10+
- ✅ Opera 15+
- ⚠️ IE 11（基本支持但可能有限制）

## 注意事项

1. **隐私模式**: 在浏览器隐私/无痕模式下，数据可能在会话结束后被清除
2. **存储限制**: 不同浏览器有不同的存储配额限制
3. **数据持久性**: 用户可以在浏览器设置中清除站点数据
4. **跨域限制**: 数据只能在同一域名下访问

## 未来优化建议

1. 添加数据导出/导入功能（JSON 格式）
2. 实现云端同步功能
3. 添加数据压缩以节省存储空间
4. 实现增量备份机制
5. 添加存储空间不足时的自动清理策略
