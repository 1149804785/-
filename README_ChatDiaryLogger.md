# ChatDiaryLogger — Operit 每日AI日记插件

> 每日 23:00 自动回顾指定对话，由 DeepSeek 以 AI 视角生成自然日记，存入 Obsidian 仓库。

## ✨ 功能

- 🔍 **直读数据库**：绕过 Operit API，通过 Java SQLite 直读 `messages` 表
- 🤖 **AI 视角日记**：DeepSeek 以 AI 自己的口吻回顾当日对话，写感悟、心情、反思
- 📝 **主题化文件名**：`2026-04-30_午后闲谈.md` 而非 `2026-04-30_<uuid>.md`
- ⏰ **23:00 自动触发**：配合工作流实现无人值守
- 💾 **Obsidian 兼容**：Markdown 格式，直接存入你的 Vault

## 📦 文件说明

| 文件 | 用途 |
|------|------|
| `ChatDiaryLogger.js` | 沙盒包脚本，导入 Operit |
| `ChatDiaryLogger_workflow_template.json` | 工作流模板，脱敏版 |
| `README.md` | 本文件 |

## 🛠 前置准备

1. **DeepSeek API Key**：[platform.deepseek.com](https://platform.deepseek.com) → API Keys
2. **Operit App**：需启用 `super_admin` 和 `ChatDiaryLogger` 两个沙盒包
3. **Obsidian Vault 路径**：如 `/storage/emulated/0/obsidian/D`

## 🚀 安装步骤

### 1. 导入沙盒包

将 `ChatDiaryLogger.js` 放入 Operit 沙盒包目录：

```
/sdcard/Android/data/com.ai.assistance.operit/files/packages/ChatDiaryLogger.js
```

在 Operit 工具箱中启用 `对话日记助手`。

### 2. 配置环境变量

在 Operit「环境配置」中设置：

| 变量名 | 值 |
|--------|-----|
| `DIARY_AI_API_KEY` | `sk-xxxx` |
| `DIARY_AI_BASE_URL` | `https://api.deepseek.com/v1` |
| `DIARY_AI_MODEL` | `deepseek-v4-pro` |

### 3. 验证数据库连通

让 AI 执行：

```
ChatDiaryLogger:discover_db
```

确认返回 `messages` 表。

### 4. 手动测试

```
ChatDiaryLogger:run_now(chat_id="你的chat_id", output_folder="你的Obsidian路径")
```

AI 会通过终端 curl 调用 DeepSeek 并保存。检查 Obsidian 确认文件生成。

### 5. 设定时工作流

打开 `ChatDiaryLogger_workflow_template.json`，替换所有 `<...>` 占位符：

- `<你的chat_id>`：要回顾的对话 ID
- `<你的Obsidian路径>`：日记保存目录
- `<你的对话窗口chat_id>`：工作流唤醒消息发往的对话

在 Operit 中创建新工作流，粘贴 nodes 和 connections。

首次运行后，AI 会自动为次日创建新的定时任务，形成**自循环**。

## 🔄 工作流架构

```
23:00 Schedule Trigger
       │
       ▼
  start_chat_service (BALL模式)
       │
       ▼
  send_message_to_ai (隐藏消息唤醒AI)
       │
       ▼
  AI 执行：
  ┌─────────────────────────────┐
  │ ① ChatDiaryLogger 拉取消息  │
  │ ② curl → DeepSeek API      │
  │ ③ 保存 Markdown 到 Obsidian │
  │ ④ schedule_one_time_task    │
  └─────────────────────────────┘
       │
       ▼
  delete_workflow (自删)
```

## ⚠️ 已知限制

- **沙盒无网络**：ChatDiaryLogger 脚本本身无法直接调 HTTP API，需通过工作流 AI 代理 + 终端 curl 完成
- **模型名小写**：DeepSeek API 要求 `deepseek-v4-pro`（全小写）
- **数据库列名**：Operit 实际列名为 `chatId` / `sender` / `content` / `timestamp`，脚本已适配

## 📄 许可

MIT — 自由使用、修改、分享。
