#!/bin/bash
# ============================================
# AI Daily Bot - 一键执行脚本
# 采集新闻 → 生成 HTML → 截图 → 推送
# ============================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "============================================"
echo " AI Daily Bot - 日报生成中..."
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

# 检查 .env
if [ ! -f ".env" ]; then
    echo "❌ 未找到 .env 文件，请先运行 npm run setup"
    exit 1
fi

# 加载环境变量
export $(grep -v '^#' .env | xargs)

# 运行主编排器
npx tsx src/index.ts

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "============================================"
    echo " 日报生成与推送完成！"
    echo "============================================"
else
    echo ""
    echo "============================================"
    echo " 流程异常退出 (code: $EXIT_CODE)"
    echo " 请检查日志排查问题"
    echo "============================================"
    exit $EXIT_CODE
fi
