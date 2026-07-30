/**
 * AI Daily Bot - Playwright 截图模块
 * 对 HTML 日报进行全页高清截图
 */
import { chromium } from 'playwright';
import type { ScreenshotOptions } from './types.js';

const DEFAULT_OPTIONS: Partial<ScreenshotOptions> = {
  viewportWidth: 1200,
  viewportHeight: 900,
  deviceScaleFactor: 2,
  fullPage: true,
};

/**
 * 对指定 URL 的页面进行全页截图
 * @returns 截图文件的绝对路径
 */
export async function captureFullPage(
  options: ScreenshotOptions
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  console.log(`[screenshot] 启动浏览器，访问: ${opts.url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: opts.viewportWidth!, height: opts.viewportHeight! },
    deviceScaleFactor: opts.deviceScaleFactor,
  });

  const page = await context.newPage();

  try {
    // 访问页面，等待网络空闲
    await page.goto(opts.url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // 等待字体加载完成
    await page.evaluate(() => document.fonts.ready);

    // 稍微等待让 CSS 动画/过渡完成
    await page.waitForTimeout(1000);

    console.log(`[screenshot] 正在截图 → ${opts.outputPath}`);

    // 全页截图
    await page.screenshot({
      path: opts.outputPath,
      fullPage: opts.fullPage,
      type: 'png',
    });

    console.log(`[screenshot] 截图完成: ${opts.outputPath}`);
    return opts.outputPath;
  } finally {
    await browser.close();
    console.log('[screenshot] 浏览器已关闭');
  }
}

/**
 * 独立测试入口：对指定 URL 截图
 * 用法: npx tsx src/screenshot.ts <url> [output.png]
 */
async function main() {
  const url = process.argv[2];
  const output = process.argv[3] || './output/screenshot.png';

  if (!url) {
    console.error('用法: npx tsx src/screenshot.ts <url> [output.png]');
    process.exit(1);
  }

  await captureFullPage({ url, outputPath: output });
}

// 仅在直接运行时执行 main
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('screenshot.ts') ||
    process.argv[1].endsWith('screenshot.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('[screenshot] 错误:', err.message);
    process.exit(1);
  });
}
