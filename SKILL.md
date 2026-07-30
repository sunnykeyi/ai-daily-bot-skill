---
name: ai-daily-bot
description: |
  AI Daily 自动化日报工作流。从多个 AI 新闻源采集当天内容，生成杂志风格双语 HTML 日报，
  自动截图并通过企业微信机器人推送给用户。

  当用户提到以下内容时必须使用此 skill：
  - "AI日报"、"每日简报"、"daily brief"、"AI news"、"today's AI news"
  - "生成日报"、"推送日报"、"发送日报"、"automated daily report"
  - "帮我看看今天的 AI 新闻"、"fetch my daily brief"
  - 任何涉及自动采集新闻 + 截图 + 企业微信推送的工作流需求

  此 skill 自动串联四个阶段：信息采集 → HTML 生成 → 网页截图 → 企业微信推送，
  无需用户手动操作任何中间步骤。
---

# AI Daily Bot

自动化日报工作流，基于 AI-Daily 信息采集能力，补齐后端托管、网页截图、企业微信推送能力。

## 前置条件

首次使用前需要初始化环境：

```bash
cd ai-daily-bot && bash scripts/setup.sh
```

该脚本会安装 Python 依赖（twscrape）、Node.js 依赖、Playwright 浏览器，并创建 `.env` 配置文件。

## 配置

编辑 `.env` 文件，填入必要配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `WECHAT_WEBHOOK_URL` | 是 | 企业微信机器人 Webhook URL |
| `PORT` | 否 | 本地 HTTP 服务端口（默认 3456） |
| `DAILY_STYLE` | 否 | 日报风格：`rationalist`（学术风）或 `modernism`（极简风），默认 rationalist |

如需抓取 X.com 内容，还需要配置 X.com 凭证文件 `~/.claude/private/x-creds.json`：
```json
{ "auth_token": "你的auth_token", "ct0": "你的ct0" }
```

## 使用方法

### 一键运行

```bash
cd ai-daily-bot && npm run daily
```

或使用 Shell 脚本：

```bash
bash ai-daily-bot/scripts/run-daily.sh
```

### 工作流步骤

运行后自动执行以下四个阶段：

1. **信息采集（fetch）** — 并行运行 AI-Daily 的 Python 抓取脚本：
   - `fetch_news.py`：抓取 Anthropic、OpenAI、Claude Blog、The AI Valley、smol.ai、Every.to 等新闻
   - `fetch_youtube.py`：抓取 10 个 AI 相关 YouTube 频道的最新视频
   - `fetch_x.py`：抓取 18 个 X.com AI 账号的热门帖子

2. **HTML 生成（serve）** — 将抓取数据填入 Rationalist/Modernism 杂志风格模板，生成双语 HTML 日报，保存到 `public/` 目录

3. **网页截图（screenshot）** — 启动本地 Express 服务器托管 HTML，使用 Playwright 无头浏览器进行 2x 高清全页截图，保存到 `output/` 目录

4. **企业微信推送（send）** — 通过 Webhook 将截图以图片消息发送到企业微信群聊。如果图片发送失败，自动回退为文本通知

### 单独运行某个阶段

```bash
# 仅截取指定 URL 的页面
npm run screenshot -- <url> [output.png]

# 仅启动静态文件服务器
npm run serve

# 仅发送图片到企业微信
WECHAT_WEBHOOK_URL=... npx tsx src/wechat-bot.ts <image_path>
```

## 输出文件

| 文件 | 路径 |
|------|------|
| HTML 日报 | `public/daily-brief-YYYY-MM-DD.html` |
| 截图 | `output/daily-screenshot-YYYY-MM-DD.png` |
| 执行日志 | `output/pipeline-log.json` |

## 定时自动化

可通过 cron 或 Claude Code automation 设置每日定时运行：

```bash
# cron 示例：每天早上 9 点运行
0 9 * * * cd /path/to/ai-daily-bot && bash scripts/run-daily.sh >> output/cron.log 2>&1
```

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| 新闻抓取返回空 | 周末 AI 新闻源更新较少属正常现象 |
| X.com 抓取失败 | 检查 `x-creds.json` 或环境变量中的凭证是否有效 |
| Playwright 截图失败 | 运行 `npx playwright install chromium` 重装浏览器 |
| 企业微信发送失败 | 检查 Webhook URL 是否正确，图片是否超过 20MB |
| Python 脚本找不到 | 确认 `ai-daily/` 目录存在且 `npm run setup` 已执行 |
