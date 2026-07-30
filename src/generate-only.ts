/**
 * 仅生成阶段
 * 读取 output/fetched-data.json（已翻译的中文数据），生成 HTML + 截图 + 推送
 *
 * 用法：npm run generate
 *
 * Agent 工作流：
 *   1. npm run fetch          → 采集英文数据到 output/fetched-data.json
 *   2. agent 读取 JSON，翻译为中文，写回 output/fetched-data.json
 *   3. npm run generate       → 读取翻译后的 JSON，生成 HTML + 截图 + 推送
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { generateDailyHTML } from './generator.js';
import { DailyServer } from './server.js';
import { captureFullPage } from './screenshot.js';
import { sendImageMessage, sendTextMessage } from './wechat-bot.js';
import type { DailyConfig } from './types.js';
import type { TranslatedData } from './generator.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');

function loadConfig(): DailyConfig {
  const wechatWebhookUrl = process.env.WECHAT_WEBHOOK_URL || '';
  const port = parseInt(process.env.PORT || '3456', 10);
  const outputDir = path.resolve(PROJECT_DIR, process.env.OUTPUT_DIR || './output');
  const publicDir = path.resolve(PROJECT_DIR, process.env.PUBLIC_DIR || './public');
  const aiDailyDir = path.resolve(PROJECT_DIR, process.env.AI_DAILY_DIR || './ai-daily');
  const style = (process.env.DAILY_STYLE as 'rationalist' | 'modernism') || 'rationalist';
  return { wechatWebhookUrl, port, outputDir, publicDir, aiDailyDir, style };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       AI Daily Bot - 生成阶段              ║');
  console.log('╚════════════════════════════════════════════╝');

  const fullConfig = loadConfig();
  const startTime = Date.now();
  let server: DailyServer | null = null;
  let htmlFilename = '';
  let screenshotPath = '';

  // 读取翻译后的数据
  const dataPath = path.join(fullConfig.outputDir, 'fetched-data.json');
  if (!existsSync(dataPath)) {
    console.error(`✗ 未找到数据文件: ${dataPath}`);
    console.error('  请先运行 npm run fetch 采集数据');
    process.exit(1);
  }

  const translated: TranslatedData = JSON.parse(
    readFileSync(dataPath, 'utf-8')
  );

  const dateStr = new Date()
    .toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
    .replace(/\//g, '-');

  // 确保目录存在
  for (const dir of [fullConfig.outputDir, fullConfig.publicDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // ── 生成 HTML ──
  console.log('── 生成 HTML 日报 ──');
  htmlFilename = generateDailyHTML(
    translated, // EN 字段（原文）
    translated, // CN 字段（已翻译的中文，直接用同一份数据）
    fullConfig.style,
    fullConfig.publicDir,
    fullConfig.aiDailyDir
  );
  console.log(`  ✓ ${htmlFilename}`);

  // ── 截图 ──
  console.log('── 网页截图 ──');
  try {
    server = new DailyServer(fullConfig.publicDir, fullConfig.port);
    const baseUrl = await server.start();
    const url = `${baseUrl}/${htmlFilename}`;
    screenshotPath = path.join(fullConfig.outputDir, `daily-screenshot-${dateStr}.png`);

    await captureFullPage({
      url,
      outputPath: screenshotPath,
      viewportWidth: 1200,
      viewportHeight: 900,
      deviceScaleFactor: 2,
      fullPage: true,
    });
    console.log('  ✓ 截图完成');
  } catch (err: any) {
    console.error(`  ✗ 截图失败: ${err.message}`);
  } finally {
    if (server) await server.stop();
  }

  // ── 推送 ──
  if (fullConfig.wechatWebhookUrl && screenshotPath) {
    console.log('── 企业微信推送 ──');
    try {
      await sendImageMessage(fullConfig.wechatWebhookUrl, screenshotPath);
      console.log('  ✓ 已发送');
    } catch (err: any) {
      console.warn('  图片发送失败，尝试文本通知...');
      try {
        await sendTextMessage(fullConfig.wechatWebhookUrl, `AI Daily 日报已生成\nHTML: ${htmlFilename}\n（图片发送失败: ${err.message}）`);
      } catch {}
    }
  }

  const durationMs = Date.now() - startTime;
  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(` ✓ 完成 | 总耗时 ${(durationMs / 1000).toFixed(1)}s`);
  console.log(` HTML: ${fullConfig.publicDir}/${htmlFilename}`);
  console.log(` 截图: ${screenshotPath}`);
  console.log('════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('生成失败:', err.message);
  process.exit(1);
});
