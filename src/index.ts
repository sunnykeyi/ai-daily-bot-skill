/**
 * AI Daily Bot - 主编排器
 * 串联：采集 → 生成HTML → 托管服务 → 截图 → 企业微信推送
 *
 * 用法：
 *   npx tsx src/index.ts              # 使用 .env 配置运行
 *   WECHAT_WEBHOOK_URL=... npx tsx src/index.ts  # 指定 webhook
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

import { fetchAllData } from './fetch.js';
import { generateDailyHTML } from './generator.js';
import { DailyServer } from './server.js';
import { captureFullPage } from './screenshot.js';
import { sendImageMessage, sendTextMessage } from './wechat-bot.js';
import type { DailyConfig, StageResult, PipelineStage } from './types.js';

// 加载 .env
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');

/**
 * 从环境变量读取配置
 */
function loadConfig(): DailyConfig {
  const wechatWebhookUrl = process.env.WECHAT_WEBHOOK_URL || '';
  const port = parseInt(process.env.PORT || '3456', 10);
  const outputDir = path.resolve(
    PROJECT_DIR,
    process.env.OUTPUT_DIR || './output'
  );
  const publicDir = path.resolve(
    PROJECT_DIR,
    process.env.PUBLIC_DIR || './public'
  );
  const aiDailyDir = path.resolve(
    PROJECT_DIR,
    process.env.AI_DAILY_DIR || './ai-daily'
  );
  const style =
    (process.env.DAILY_STYLE as 'rationalist' | 'modernism') || 'rationalist';

  return {
    wechatWebhookUrl,
    port,
    outputDir,
    publicDir,
    aiDailyDir,
    style,
  };
}

/**
 * 记录流水线阶段结果
 */
function logStage(
  stage: PipelineStage,
  result: StageResult,
  results: StageResult[]
): void {
  const icon = result.success ? '✓' : '✗';
  const duration = (result.duration / 1000).toFixed(1);
  console.log(
    `  [${results.length}] ${icon} ${stage} (${duration}s)` +
      (result.error ? ` — ${result.error}` : '') +
      (result.data ? ` — ${result.data}` : '')
  );
}

/**
 * 主编排函数
 */
async function run(): Promise<void> {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       AI Daily Bot - 日报工作流            ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');

  const fullConfig = loadConfig();
  const results: StageResult[] = [];
  const startTime = Date.now();
  let server: DailyServer | null = null;
  let htmlFilename = '';
  let screenshotPath = '';

  // 验证配置
  if (!fullConfig.wechatWebhookUrl) {
    console.warn('[config] ⚠ 未配置 WECHAT_WEBHOOK_URL，将跳过企业微信推送');
  }

  // 确保目录存在
  for (const dir of [fullConfig.outputDir, fullConfig.publicDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // =========================================================
  // 阶段 1: 信息采集
  // =========================================================
  console.log('── 阶段 1/4: 信息采集 ──');
  const fetchStart = Date.now();

  let fetchedData;
  try {
    const scriptsDir = path.join(
      fullConfig.aiDailyDir,
      'skills/ai-daily/scripts'
    );
    fetchedData = await fetchAllData(scriptsDir);

    const totalItems =
      fetchedData.news.length +
      fetchedData.youtube.length +
      fetchedData.xPosts.length;

    if (totalItems === 0) {
      throw new Error('所有数据源均无返回内容（可能周末无更新）');
    }

    results.push({
      stage: 'fetch',
      success: true,
      data: `新闻 ${fetchedData.news.length} | YouTube ${fetchedData.youtube.length} | X ${fetchedData.xPosts.length}`,
      duration: Date.now() - fetchStart,
    });
  } catch (err: any) {
    results.push({
      stage: 'fetch',
      success: false,
      error: err.message,
      duration: Date.now() - fetchStart,
    });
    logStage('fetch', results[results.length - 1], results);
    console.log('');
    console.log('⚠ 信息采集阶段失败，流程终止。');
    saveResults(results);
    return;
  }

  logStage('fetch', results[results.length - 1], results);

  // =========================================================
  // 阶段 2: 生成 HTML
  // =========================================================
  console.log('');
  console.log('── 阶段 2/4: 生成 HTML 日报 ──');
  const genStart = Date.now();

  try {
    htmlFilename = generateDailyHTML(
      fetchedData,
      fullConfig.style,
      fullConfig.publicDir,
      fullConfig.aiDailyDir
    );
    results.push({
      stage: 'serve',
      success: true,
      data: htmlFilename,
      duration: Date.now() - genStart,
    });
  } catch (err: any) {
    results.push({
      stage: 'serve',
      success: false,
      error: err.message,
      duration: Date.now() - genStart,
    });
    logStage('serve', results[results.length - 1], results);
    saveResults(results);
    return;
  }

  logStage('serve', results[results.length - 1], results);

  // =========================================================
  // 阶段 3: 启动服务器 + 截图
  // =========================================================
  console.log('');
  console.log('── 阶段 3/4: 网页截图 ──');
  const shotStart = Date.now();

  try {
    // 启动 HTTP 服务器
    server = new DailyServer(fullConfig.publicDir, fullConfig.port);
    const baseUrl = await server.start();

    const url = `${baseUrl}/${htmlFilename}`;
    const dateStr = new Date()
      .toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
      .replace(/\//g, '-');
    screenshotPath = path.join(
      fullConfig.outputDir,
      `daily-screenshot-${dateStr}.png`
    );

    await captureFullPage({
      url,
      outputPath: screenshotPath,
      viewportWidth: 1200,
      viewportHeight: 900,
      deviceScaleFactor: 2,
      fullPage: true,
    });

    results.push({
      stage: 'screenshot',
      success: true,
      data: screenshotPath,
      duration: Date.now() - shotStart,
    });
  } catch (err: any) {
    results.push({
      stage: 'screenshot',
      success: false,
      error: err.message,
      duration: Date.now() - shotStart,
    });
  } finally {
    // 截图完成后立即关闭服务器
    if (server) {
      await server.stop();
    }
  }

  logStage('screenshot', results[results.length - 1], results);

  // =========================================================
  // 阶段 4: 企业微信推送
  // =========================================================
  if (fullConfig.wechatWebhookUrl && screenshotPath) {
    console.log('');
    console.log('── 阶段 4/4: 企业微信推送 ──');
    const sendStart = Date.now();

    try {
      await sendImageMessage(fullConfig.wechatWebhookUrl, screenshotPath);

      results.push({
        stage: 'send',
        success: true,
        data: '日报截图已发送',
        duration: Date.now() - sendStart,
      });
    } catch (err: any) {
      // 图片发送失败时，尝试发送文本通知
      console.warn('[send] 图片发送失败，尝试发送文本通知...');
      try {
        await sendTextMessage(
          fullConfig.wechatWebhookUrl,
          `AI Daily 日报已生成\nHTML: ${htmlFilename}\n截图: ${screenshotPath}\n（图片发送失败: ${err.message}）`
        );
      } catch {}

      results.push({
        stage: 'send',
        success: false,
        error: err.message,
        duration: Date.now() - sendStart,
      });
    }

    logStage('send', results[results.length - 1], results);
  } else if (!fullConfig.wechatWebhookUrl) {
    console.log('');
    console.log('── 阶段 4/4: 企业微信推送 ── 已跳过（未配置 Webhook）');
  }

  // =========================================================
  // 完成报告
  // =========================================================
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(
    ` 完成: ${successCount} 成功, ${failCount} 失败 | 总耗时 ${totalDuration}s`
  );
  if (htmlFilename) {
    console.log(` HTML: ${fullConfig.publicDir}/${htmlFilename}`);
  }
  if (screenshotPath) {
    console.log(` 截图: ${screenshotPath}`);
  }
  console.log('════════════════════════════════════════════');

  saveResults(results);
}

/**
 * 保存执行结果到 JSON 日志
 */
function saveResults(results: StageResult[]): void {
  const logPath = path.join(PROJECT_DIR, 'output', 'pipeline-log.json');
  const log = {
    timestamp: new Date().toISOString(),
    results,
  };
  try {
    writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  } catch {}
}

// 运行
run().catch((err) => {
  console.error('');
  console.error('════════════════════════════════════════════');
  console.error(' 流程异常终止:', err.message);
  console.error('════════════════════════════════════════════');
  process.exit(1);
});
