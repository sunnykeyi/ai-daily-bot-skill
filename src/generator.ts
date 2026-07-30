/**
 * AI Daily Bot - HTML 日报生成器
 * 读取 Rationalist 模板，填充抓取数据，生成最终 HTML
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import type { FetchedData, NewsArticle, YouTubeVideo, XPost } from './fetch.js';

/**
 * 简单的模板引擎：替换 {{PLACEHOLDER}} 并展开 REPEAT 块
 */
function renderTemplate(
  template: string,
  data: Record<string, string>
): string {
  let result = template;

  // 1. 处理 REPEAT 块 {{#REPEAT ...}} ... {{/REPEAT}}
  result = result.replace(
    /\{\{#REPEAT\s+(\w+)\}\}([\s\S]*?)\{\{\/REPEAT\}\}/g,
    (_match, key, blockContent) => {
      const items = (data[`_REPEAT_${key}`] || '').split('|||REPEAT_ITEM|||').filter(Boolean);
      return items
        .map((item: string) => {
          let filled = blockContent;
          // 解析 item 中的键值对 (key:value 格式)
          const pairs = item.split('|||KV|||');
          pairs.forEach((pair: string) => {
            const [k, v] = pair.split('|||:|||');
            if (k && v !== undefined) {
              filled = filled.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
            }
          });
          return filled;
        })
        .join('\n');
    }
  );

  // 2. 替换普通占位符
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('_')) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }

  return result;
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 截断文本到指定长度
 */
function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text || '';
  return text.slice(0, maxLen) + '...';
}

/**
 * 格式化 X.com 帖子内容（截断，清理换行）
 */
function formatXContent(content: string): string {
  if (!content) return '';
  return truncate(content.replace(/\n/g, ' '), 200);
}

/**
 * 从 YouTube 标题中提取摘要（简化版）
 */
function youtubeSummary(title: string): string {
  if (!title) return '';
  return title.length > 80 ? title.slice(0, 80) + '...' : title;
}

/**
 * 生成 Rationalist 风格 HTML
 */
function generateRationalistHTML(
  template: string,
  data: FetchedData,
  dateEn: string,
  dateCn: string
): string {
  const templateData: Record<string, string> = {};

  // 日期
  templateData['DATE_EN'] = dateEn;
  templateData['DATE_CN'] = dateCn;

  // 新闻计数
  const officialNews = data.news.filter((a) => a.category === 'Official Update');
  const independentNews = data.news.filter((a) => a.category !== 'Official Update');
  templateData['OFFICIAL_COUNT'] = String(officialNews.length);
  templateData['NEWS_COUNT'] = String(independentNews.length);

  // 确定 hero 文章（第一条 Official 新闻）
  const hero = officialNews[0] || data.news[0];
  if (hero) {
    templateData['SPOTLIGHT_HERO_URL'] = hero.url;
    templateData['SPOTLIGHT_HERO_TITLE_EN'] = escapeHtml(hero.title);
    templateData['SPOTLIGHT_HERO_TITLE_CN'] = escapeHtml(hero.title);
    templateData['SPOTLIGHT_HERO_SUMMARY_EN'] = escapeHtml(hero.summary || '');
    templateData['SPOTLIGHT_HERO_SUMMARY_CN'] = escapeHtml(hero.summary || '');
    templateData['SPOTLIGHT_HERO_SOURCE'] = hero.source;
  }

  // Spotlight 列表（hero + 其余）
  const spotlightItems = data.news.slice(0, 6);
  templateData['_REPEAT_SPOTLIGHT'] = spotlightItems
    .map(
      (a) =>
        `SPOTLIGHT_URL|||:|||${a.url}|||KV||||SPOTLIGHT_TITLE_EN|||:|||${escapeHtml(a.title)}|||KV||||SPOTLIGHT_TITLE_CN|||:|||${escapeHtml(a.title)}|||KV||||SPOTLIGHT_SUMMARY_EN|||:|||${escapeHtml(a.summary || '')}|||KV||||SPOTLIGHT_SUMMARY_CN|||:|||${escapeHtml(a.summary || '')}|||KV||||SPOTLIGHT_SOURCE|||:|||${a.source}`
    )
    .join('|||REPEAT_ITEM|||');

  // YouTube
  const ytVideos = data.youtube.slice(0, 8);
  if (ytVideos.length > 0) {
    const ytHero = ytVideos[0];
    templateData['YT_HERO_URL'] = ytHero.url;
    templateData['YT_HERO_TITLE_EN'] = escapeHtml(ytHero.title);
    templateData['YT_HERO_TITLE_CN'] = escapeHtml(ytHero.title);
    templateData['YT_HERO_CHANNEL'] = ytHero.channel;
  }
  templateData['_REPEAT_YOUTUBE'] = ytVideos
    .map(
      (v) =>
        `YT_URL|||:|||${v.url}|||KV||||YT_TITLE_EN|||:|||${escapeHtml(v.title)}|||KV||||YT_TITLE_CN|||:|||${escapeHtml(v.title)}|||KV||||YT_CHANNEL|||:|||${v.channel}`
    )
    .join('|||REPEAT_ITEM|||');

  // X.com posts
  const xItems = data.xPosts.slice(0, 10);
  templateData['_REPEAT_XPOST'] = xItems
    .map(
      (x) =>
        `X_HANDLE|||:|||@${x.username}|||KV||||X_DISPLAYNAME|||:|||${escapeHtml(x.displayname)}|||KV||||X_LIKES|||:|||${x.likes}|||KV||||X_BODY_EN|||:|||${escapeHtml(formatXContent(x.content))}|||KV||||X_BODY_CN|||:|||${escapeHtml(formatXContent(x.content))}|||KV||||X_URL|||:|||${x.url}`
    )
    .join('|||REPEAT_ITEM|||');

  // 填充空值默认
  const defaults: Record<string, string> = {
    SPOTLIGHT_HERO_URL: '#',
    SPOTLIGHT_HERO_TITLE_EN: 'No articles today',
    SPOTLIGHT_HERO_TITLE_CN: '今日无文章',
    SPOTLIGHT_HERO_SUMMARY_EN: 'Check back later for the latest AI news.',
    SPOTLIGHT_HERO_SUMMARY_CN: '请稍后查看最新 AI 新闻。',
    SPOTLIGHT_HERO_SOURCE: '',
    YT_HERO_URL: '#',
    YT_HERO_TITLE_EN: 'No videos today',
    YT_HERO_TITLE_CN: '今日无视频',
    YT_HERO_CHANNEL: '',
  };

  for (const [k, v] of Object.entries(defaults)) {
    if (!templateData[k]) templateData[k] = v;
  }

  return renderTemplate(template, templateData);
}

/**
 * 生成 Modernism 风格 HTML
 */
function generateModernismHTML(
  template: string,
  data: FetchedData,
  dateEn: string,
  dateCn: string
): string {
  const templateData: Record<string, string> = {};

  templateData['DATE_EN'] = dateEn;
  templateData['DATE_CN'] = dateCn;

  const officialNews = data.news.filter((a) => a.category === 'Official Update');
  const independentNews = data.news.filter((a) => a.category !== 'Official Update');
  templateData['OFFICIAL_COUNT'] = String(officialNews.length);
  templateData['NEWS_COUNT'] = String(independentNews.length);
  templateData['SPOTLIGHT_COUNT'] = String(data.news.length);

  // Hero
  const hero = officialNews[0] || data.news[0];
  if (hero) {
    templateData['SPOTLIGHT_HERO_URL'] = hero.url;
    templateData['SPOTLIGHT_HERO_TITLE_EN'] = escapeHtml(hero.title);
    templateData['SPOTLIGHT_HERO_TITLE_CN'] = escapeHtml(hero.title);
    templateData['SPOTLIGHT_HERO_TAG_EN'] = escapeHtml(hero.category || 'News');
    templateData['SPOTLIGHT_HERO_TAG_CN'] = escapeHtml(hero.category || '新闻');
    templateData['SPOTLIGHT_HERO_DATE_EN'] = hero.date;
    templateData['SPOTLIGHT_HERO_DATE_CN'] = hero.date;
    templateData['SPOTLIGHT_HERO_SUMMARY_EN'] = escapeHtml(hero.summary || '');
    templateData['SPOTLIGHT_HERO_SUMMARY_CN'] = escapeHtml(hero.summary || '');
    templateData['SPOTLIGHT_HERO_SOURCE'] = hero.source;
  }

  // Stack items（Spotlight 其余文章）
  const stackItems = data.news.slice(1, 6);
  templateData['_REPEAT_STACK'] = stackItems
    .map(
      (a) =>
        `STACK_URL|||:|||${a.url}|||KV||||STACK_TITLE_EN|||:|||${escapeHtml(a.title)}|||KV||||STACK_TITLE_CN|||:|||${escapeHtml(a.title)}|||KV||||STACK_TAG_EN|||:|||${escapeHtml(a.category || 'News')}|||KV||||STACK_TAG_CN|||:|||${escapeHtml(a.category || '新闻')}|||KV||||STACK_DATE_EN|||:|||${a.date}|||KV||||STACK_DATE_CN|||:|||${a.date}`
    )
    .join('|||REPEAT_ITEM|||');

  // YouTube (Modernism 用 4 列网格)
  const ytVideos = data.youtube.slice(0, 8);
  templateData['_REPEAT_YOUTUBE'] = ytVideos
    .map(
      (v) =>
        `YT_URL|||:|||${v.url}|||KV||||YT_TITLE_EN|||:|||${escapeHtml(v.title)}|||KV||||YT_TITLE_CN|||:|||${escapeHtml(v.title)}|||KV||||YT_CHANNEL|||:|||${v.channel}`
    )
    .join('|||REPEAT_ITEM|||');

  // X.com posts (Modernism 用 2 列)
  const xItems = data.xPosts.slice(0, 10);
  templateData['_REPEAT_XPOST'] = xItems
    .map(
      (x) =>
        `X_HANDLE|||:|||@${x.username}|||KV||||X_DISPLAYNAME|||:|||${escapeHtml(x.displayname)}|||KV||||X_LIKES|||:|||${x.likes}|||KV||||X_BODY_EN|||:|||${escapeHtml(formatXContent(x.content))}|||KV||||X_BODY_CN|||:|||${escapeHtml(formatXContent(x.content))}|||KV||||X_URL|||:|||${x.url}`
    )
    .join('|||REPEAT_ITEM|||');

  // 默认值
  const defaults: Record<string, string> = {
    SPOTLIGHT_HERO_URL: '#',
    SPOTLIGHT_HERO_TITLE_EN: 'No articles today',
    SPOTLIGHT_HERO_TITLE_CN: '今日无文章',
    SPOTLIGHT_HERO_TAG_EN: 'News',
    SPOTLIGHT_HERO_TAG_CN: '新闻',
    SPOTLIGHT_HERO_DATE_EN: dateEn,
    SPOTLIGHT_HERO_DATE_CN: dateCn,
    SPOTLIGHT_HERO_SUMMARY_EN: 'Check back later for the latest AI news.',
    SPOTLIGHT_HERO_SUMMARY_CN: '请稍后查看最新 AI 新闻。',
    SPOTLIGHT_HERO_SOURCE: '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (!templateData[k]) templateData[k] = v;
  }

  return renderTemplate(template, templateData);
}

/**
 * 获取今天的日期字符串
 */
function getDateStrings(): { en: string; cn: string; filename: string } {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  };
  const en = now.toLocaleDateString('en-US', options);
  const cn = now.toLocaleDateString('zh-CN', { ...options, weekday: undefined });
  const filename = now
    .toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-');
  return { en, cn, filename };
}

/**
 * 生成 HTML 日报并保存到 public 目录
 * @returns 生成的 HTML 文件路径
 */
export function generateDailyHTML(
  data: FetchedData,
  style: 'rationalist' | 'modernism',
  publicDir: string,
  aiDailyDir: string
): string {
  console.log(`[html] 生成 ${style} 风格日报...`);

  // 选择模板
  const templateName = style === 'rationalist' ? 'template.html' : 'template.html';
  const templateDir = style === 'rationalist' ? 'rationalist' : 'modernism';
  const templatePath = path.join(
    aiDailyDir,
    'skills/ai-daily/assets',
    templateDir,
    templateName
  );

  let template: string;
  try {
    template = readFileSync(templatePath, 'utf-8');
  } catch {
    // 回退：尝试另一种风格
    const fallbackDir = style === 'rationalist' ? 'modernism' : 'rationalist';
    const fallbackPath = path.join(
      aiDailyDir,
      'skills/ai-daily/assets',
      fallbackDir,
      'template.html'
    );
    console.warn(`[html] 模板 ${templateDir} 不可用，回退到 ${fallbackDir}`);
    template = readFileSync(fallbackPath, 'utf-8');
  }

  const { en, cn, filename } = getDateStrings();

  // 生成 HTML
  const html =
    style === 'rationalist'
      ? generateRationalistHTML(template, data, en, cn)
      : generateModernismHTML(template, data, en, cn);

  // 保存文件
  const outputFilename = `daily-brief-${filename}.html`;
  const outputPath = path.join(publicDir, outputFilename);
  writeFileSync(outputPath, html, 'utf-8');

  // 复制 hero 图片到 public 目录
  const seedDir = path.join(aiDailyDir, 'skills/ai-daily/output');

  // 复制 spotlight 图片
  for (const ext of ['jpg', 'png']) {
    try {
      copyFileSync(
        path.join(seedDir, `spotlight.${ext}`),
        path.join(publicDir, `spotlight.${ext}`)
      );
    } catch {}
  }

  // 复制 youtubepicks 图片
  for (const ext of ['jpg', 'png']) {
    try {
      copyFileSync(
        path.join(seedDir, `youtubepicks.${ext}`),
        path.join(publicDir, `youtubepicks.${ext}`)
      );
    } catch {}
  }

  console.log(`[html] 日报已生成: ${outputPath}`);
  return outputFilename;
}
