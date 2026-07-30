#!/bin/bash
# ============================================
# AI Daily Bot - 环境初始化脚本
# 安装 Python 依赖 + Playwright 浏览器
# ============================================
set -e

echo "============================================"
echo " AI Daily Bot - 环境初始化"
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 1. 安装 Python 依赖
echo ""
echo "[1/4] 安装 Python 依赖..."
pip3 install --upgrade "twscrape @ git+https://github.com/vladkens/twscrape.git" 2>/dev/null || {
    echo "  ⚠ twscrape 安装失败（X.com 抓取将不可用），继续..."
}

# 2. 检查 Python 版本
echo ""
echo "[2/4] 检查 Python 版本..."
python3 --version

# 3. 安装 Node.js 依赖
echo ""
echo "[3/4] 安装 Node.js 依赖..."
cd "$PROJECT_DIR"
npm install

# 4. 安装 Playwright 浏览器
echo ""
echo "[4/4] 安装 Playwright Chromium..."
npx playwright install chromium 2>/dev/null || {
    echo "  ⚠ playwright install 失败，尝试 npx playwright install --with-deps chromium"
    npx playwright install --with-deps chromium
}

# 5. 创建 .env（如果不存在）
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo ""
    echo "创建 .env 配置文件..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "  ⚠ 请编辑 .env 文件，填入企业微信 Webhook URL"
fi

# 6. 复制 seed 图片到 public 目录
SEED_DIR="$PROJECT_DIR/ai-daily/skills/ai-daily/output"
if [ -d "$SEED_DIR" ]; then
    cp "$SEED_DIR"/*.jpg "$PROJECT_DIR/public/" 2>/dev/null || true
    cp "$SEED_DIR"/*.png "$PROJECT_DIR/public/" 2>/dev/null || true
fi

echo ""
echo "============================================"
echo " 初始化完成！"
echo " 下一步：编辑 .env 填入 WECHAT_WEBHOOK_URL"
echo " 然后运行: npm run daily"
echo "============================================"
