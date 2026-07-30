/**
 * AI Daily Bot 核心类型定义
 */

/** 全局配置 */
export interface DailyConfig {
  /** 企业微信 Webhook URL */
  wechatWebhookUrl: string;
  /** 本地服务端口 */
  port: number;
  /** 输出归档目录 */
  outputDir: string;
  /** 公开文件托管目录 */
  publicDir: string;
  /** AI-Daily 脚本目录 */
  aiDailyDir: string;
  /** 日报风格 */
  style: 'rationalist' | 'modernism';
  /** X.com 凭证路径 */
  xCredsPath?: string;
}

/** 流水线阶段标识 */
export type PipelineStage = 'fetch' | 'serve' | 'screenshot' | 'send';

/** 每个阶段的结果 */
export interface StageResult {
  stage: PipelineStage;
  success: boolean;
  /** 附加数据（如文件路径） */
  data?: string;
  /** 错误信息 */
  error?: string;
  /** 耗时（毫秒） */
  duration: number;
}

/** 截图选项 */
export interface ScreenshotOptions {
  /** 页面 URL */
  url: string;
  /** 输出文件路径 */
  outputPath: string;
  /** 视口宽度 */
  viewportWidth?: number;
  /** 视口高度 */
  viewportHeight?: number;
  /** 设备像素比 */
  deviceScaleFactor?: number;
  /** 是否全页截图 */
  fullPage?: boolean;
}

/** 企业微信消息类型 */
export interface WechatImageMessage {
  msgtype: 'image';
  image: {
    /** 图片 base64 编码 */
    base64: string;
    /** 图片 MD5 值 */
    md5: string;
  };
}

/** 企业微信响应 */
export interface WechatResponse {
  errcode: number;
  errmsg: string;
}

/** 每日摘要信息 */
export interface DailySummary {
  date: string;
  htmlPath: string;
  screenshotPath: string;
  sources: number;
}
