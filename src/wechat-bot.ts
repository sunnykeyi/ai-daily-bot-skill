/**
 * AI Daily Bot - 企业微信机器人推送模块
 * 通过 Webhook 发送图片消息
 */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import type { WechatResponse } from './types.js';

/**
 * 计算文件的 base64 和 MD5
 */
function fileToBase64AndMd5(filePath: string): {
  base64: string;
  md5: string;
} {
  const buffer = readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const md5 = createHash('md5').update(buffer).digest('hex');
  return { base64, md5 };
}

/**
 * 发送图片消息到企业微信
 * @param webhookUrl - 企业微信机器人 Webhook URL
 * @param imagePath - 图片文件路径（支持 PNG/JPG）
 * @param retries - 重试次数，默认 2
 * @returns 企业微信 API 响应
 */
export async function sendImageMessage(
  webhookUrl: string,
  imagePath: string,
  retries: number = 2
): Promise<WechatResponse> {
  console.log(`[wechat] 准备发送图片: ${imagePath}`);

  const { base64, md5 } = fileToBase64AndMd5(imagePath);

  // 检查图片大小（企业微信限制 20MB，base64 约 1.33x）
  const sizeMB = (Buffer.byteLength(base64, 'base64') / (1024 * 1024)).toFixed(2);
  console.log(`[wechat] 图片大小: ${sizeMB} MB (base64), MD5: ${md5}`);

  if (parseFloat(sizeMB) > 20) {
    throw new Error(`图片过大 (${sizeMB} MB)，超过企业微信 20MB 限制`);
  }

  const body = JSON.stringify({
    msgtype: 'image',
    image: { base64, md5 },
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = 3000 * attempt;
        console.log(`[wechat] 第 ${attempt} 次重试，等待 ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const result: WechatResponse = await response.json();

      if (result.errcode === 0) {
        console.log('[wechat] 消息发送成功');
        return result;
      }

      throw new Error(
        `企业微信返回错误: errcode=${result.errcode}, errmsg=${result.errmsg}`
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[wechat] 发送失败: ${lastError.message}`);
    }
  }

  throw lastError || new Error('企业微信消息发送失败');
}

/**
 * 发送文本消息到企业微信
 */
export async function sendTextMessage(
  webhookUrl: string,
  content: string
): Promise<WechatResponse> {
  console.log(`[wechat] 发送文本消息: ${content.slice(0, 50)}...`);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'text',
      text: { content },
    }),
  });

  const result: WechatResponse = await response.json();

  if (result.errcode !== 0) {
    throw new Error(
      `企业微信返回错误: errcode=${result.errcode}, errmsg=${result.errmsg}`
    );
  }

  console.log('[wechat] 文本消息发送成功');
  return result;
}

/**
 * 独立测试入口
 * 用法: npx tsx src/wechat-bot.ts <image_path>
 */
async function main() {
  const webhookUrl = process.env.WECHAT_WEBHOOK_URL;
  const imagePath = process.argv[2];

  if (!webhookUrl) {
    console.error('请设置环境变量 WECHAT_WEBHOOK_URL');
    process.exit(1);
  }

  if (!imagePath) {
    console.error('用法: npx tsx src/wechat-bot.ts <image_path>');
    process.exit(1);
  }

  await sendImageMessage(webhookUrl, imagePath);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('wechat-bot.ts') ||
    process.argv[1].endsWith('wechat-bot.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('[wechat] 错误:', err.message);
    process.exit(1);
  });
}
