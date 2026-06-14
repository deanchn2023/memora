# Memora macOS Widget

> 桌面小组件 — 今日 Top 3 待办 + 番茄钟状态

## 功能

- **小组件（Small）**：显示番茄钟倒计时 或 Top 1 待办
- **中组件（Medium）**：左侧 Top 3 待办列表 + 右侧番茄钟进度环

## 架构

```
Electron (Memora App)
  └── main.js: syncWidgetData() 每5分钟写入
      ~/Library/Group Containers/group.com.memora.app/widgetData.json
          ↓ WidgetKit 读取
WidgetKit (MemoraWidget)
  └── MemoraWidgetProvider: loadWidgetData() 读取共享文件
```

## 数据格式 (widgetData.json)

```json
{
  "tasks": [
    { "id": "1", "title": "完成项目方案", "priority": "high", "dueDate": "今天", "isCompleted": false },
    { "id": "2", "title": "团队周会", "priority": "medium", "dueDate": "14:00", "isCompleted": false },
    { "id": "3", "title": "整理会议纪要", "priority": "low", "dueDate": "明天", "isCompleted": false }
  ],
  "pomodoro": {
    "isRunning": true,
    "remainingSeconds": 1110,
    "currentTask": "完成项目方案"
  },
  "lastUpdated": "2026-06-14T01:30:00.000Z"
}
```

## 部署步骤

### 前置要求
- Xcode 15+
- macOS 14+ (Sonoma)
- Apple Developer Account

### 1. 创建 Xcode 项目

1. 打开 Xcode → File → New → Project
2. 选择 **Widget Extension**
3. Product Name: `MemoraWidget`
4. Bundle Identifier: `com.memora.app.MemoraWidget`
5. 取消勾选 "Include Live Activity"（暂不需要）

### 2. 配置 App Group

1. 在 Xcode 中选择项目 → Signing & Capabilities
2. 添加 **App Groups** capability
3. 勾选 `group.com.memora.app`（如果没有则创建）

### 3. 替换代码

将 `MemoraWidget.swift` 的内容复制到 Xcode 项目的 Widget Swift 文件中

### 4. 配置 Entitlements

确保 Widget Extension 的 `.entitlements` 文件包含：

```xml
<key>com.apple.security.application-groups</key>
<array>
    <string>group.com.memora.app</string>
</array>
```

### 5. 构建运行

1. 选择 Widget Extension target
2. Build & Run
3. 在桌面上添加 Memora Widget

## 数据同步机制

- **写入**：Electron 主进程 `syncWidgetData()` 每 5 分钟写入
- **读取**：WidgetKit `MemoraWidgetProvider` 读取共享文件
- **刷新**：Widget Timeline 每 15 分钟刷新一次
- **触发**：任务增删改时立即同步（可选增强）

## 增强计划

- [ ] 任务完成时立即刷新 Widget（通过 Darwin Notification）
- [ ] 深色模式适配
- [ ] Lock Screen Widget（iOS 16+ / macOS 锁屏）
- [ ] 交互式 Widget 按钮（标记完成、开始番茄钟）
