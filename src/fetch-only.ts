/**
 * 仅采集数据阶段
 * 抓取新闻/YouTube/X 内容，输出 JSON 到 output/fetched-data.json
 *
 * 用法：npm run fetch
 *
 * Agent 工作流：
 *   1. npm run fetch          → 采集英文数据到 output/fetched-data.json
 *   2. agent 读取 JSON，翻译为中文，写回 output/fetched-data.json（覆盖 CN 字段）
 *   3. npm run generate       → 读取翻译后的 JSON，生成 HTML + 截图 + 推送
 */
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { fetchAllData } from './fetch.js';
import type { FetchedData } from './fetch.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║       AI Daily Bot - 采集阶段              ║');
  console.log('╚════════════════════════════════════════════╝');

  const aiDailyDir = path.resolve(
    PROJECT_DIR,
    process.env.AI_DAILY_DIR || './ai-daily'
  );
  const outputDir = path.resolve(PROJECT_DIR, './output');

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const scriptsDir = path.join(aiDailyDir, 'skills/ai-daily/scripts');
  const data = await fetchAllData(scriptsDir);

  const totalItems =
    data.news.length + data.youtube.length + data.xPosts.length;

  if (totalItems === 0) {
    console.error('⚠ 所有数据源均无返回内容，流程终止');
    process.exit(1);
  }

  // 输出 JSON 到文件（agent 会读取此文件，翻译后写回）
  const outputPath = path.join(outputDir, 'fetched-data.json');
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log(` ✓ 采集完成: 新闻 ${data.news.length} | YouTube ${data.youtube.length} | X ${data.xPosts.length}`);
  console.log(` 📄 数据已保存: ${outputPath}`);
  console.log('');
  console.log(' 下一步：翻译此 JSON 中的 title/summary/content 为中文，');
  console.log('        保持结构不变，覆盖写回同一文件，然后运行 npm run generate');
  console.log('════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('采集失败:', err.message);
  process.exit(1);
});
