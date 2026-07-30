/**
 * AI Daily Bot - HTML 日报生成器
 * 读取 Rationalist 模板，填充抓取数据，生成最终 HTML
 */
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import type { FetchedData, NewsArticle, YouTubeVideo, XPost } from './fetch.js';

/**
 * 翻译后的数据 — 结构和 FetchedData 一致，但 title/summary/content 已是中文。
 * 翻译由 Claude agent 在 skill 执行过程中完成，不在后端做。
 * 未翻译时直接传入原始英文数据即可（CN 字段会回退到原文）。
 */
export type TranslatedData = FetchedData;

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
 * 展开数字索引占位符块
 *
 * 原版 AI-Daily 模板用 {{SPOTLIGHT_1_*}} {{SPOTLIGHT_2_*}} 等单条占位符，
 * 但模板里只写了 _1_ 一份。本函数：把含 _1_ 占位符的 HTML 块复制 N-1 份，
 * 每份把 _1_ 替换为 _N_，从而支持多条目渲染。
 *
 * @param template 模板字符串
 * @param dataListLength 数据条数
 * @param blockRegex 匹配单个 .si 块（包含 <!-- /REPEAT --> 注释）的正则
 * @param fieldPrefix 占位符前缀，如 'SPOTLIGHT'
 */
function expandNumberedBlocks(
  template: string,
  dataListLength: number,
  blockRegex: RegExp,
  fieldPrefix: string
): string {
  if (dataListLength <= 1) return template;

  // 找第一个匹配的块（en 或 cn 各有 REPEAT 注释，但 EN 和 CN 都有两份 _1_ 块）
  // 因为 EN 和 CN 区域各有一份 .si 块（SPOTLIGHT_1_*），需要分别处理
  // 这里用 global 模式一次性处理所有匹配
  const matches = [...template.matchAll(blockRegex)];
  if (matches.length === 0) return template;

  let result = template;
  // 从后往前替换，避免位置偏移
  for (let m = matches.length - 1; m >= 0; m--) {
    const match = matches[m];
    const firstBlock = match[0];

    let extraBlocks = '';
    for (let i = 2; i <= dataListLength; i++) {
      extraBlocks += firstBlock.replace(
        new RegExp(`\\{\\{${fieldPrefix}_1_`, 'g'),
        `{{${fieldPrefix}_${i}_`
      );
    }

    result = result.slice(0, match.index!) + firstBlock + extraBlocks + result.slice(match.index! + firstBlock.length);
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
 * 注入中文字体支持
 * 在 Google Fonts 链接中加入 Noto Serif SC / Noto Sans SC，
 * 并在 CSS font-family 变量中添加这些字体作为中文回退。
 * 解决 Linux 服务器上没有 'Songti SC' 等系统字体导致中文乱码的问题。
 */
function injectCjkFonts(html: string): string {
  let result = html;

  // 1. 扩展 Google Fonts 链接，加入 Noto Serif SC 和 Noto Sans SC
  result = result.replace(
    /(href="https:\/\/fonts\.googleapis\.com\/css2\?family=)([^"]*)(")/,
    (match, prefix, fonts, suffix) => {
      // 如果已经包含 Noto 则跳过
      if (fonts.includes('Noto')) return match;
      return `${prefix}${fonts}&family=Noto+Serif+SC:wght@400;600;700&family=Noto+Sans+SC:wght@300;400;500${suffix}`;
    }
  );

  // 2. 替换 serif 字体栈：加入 Noto Serif SC
  result = result.replace(
    /(--serif:\s*['"]?)([^;]+)/g,
    (match, prefix, fonts) => {
      if (fonts.includes('Noto Serif SC')) return match;
      // 在 Spectral 之后、Songti SC 之前插入 Noto Serif SC
      return `${prefix}${fonts.replace("'Songti SC'", "'Noto Serif SC', 'Songti SC'")}`;
    }
  );

  // 3. 替换 mono 字体栈：中文用 Noto Sans SC
  result = result.replace(
    /(--mono:\s*)([^;]+)/g,
    (match, prefix, fonts) => {
      if (fonts.includes('Noto Sans SC')) return match;
      // 在 JetBrains Mono 之后插入 Noto Sans SC
      const fixed = fonts.replace(
        /'JetBrains Mono',/,
        "'JetBrains Mono', 'Noto Sans SC',"
      );
      return `${prefix}${fixed}`;
    }
  );

  // 4. 将 lang 属性改为 zh-CN（内容含中英双语）
  result = result.replace(/<html lang="en">/, '<html lang="zh-CN">');

  return result;
}

/**
 * 格式化 X.com 帖子内容（清理换行，保留较完整内容供模板自适应排版）
 */
function formatXContent(content: string): string {
  if (!content) return '';
  // 清理多余换行，但保留完整内容——模板的 .x-body 支持 line-height 1.58 多行
  return truncate(content.replace(/\n{3,}/g, '\n\n').trim(), 300);
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
 * @param data 原始英文数据（用于 EN 字段）
 * @param translated 翻译后中文数据（用于 CN 字段，未翻译则回退原文）
 */
function generateRationalistHTML(
  template: string,
  data: FetchedData,
  translated: TranslatedData,
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
  const heroT = translated.news[0];
  if (hero) {
    templateData['SPOTLIGHT_HERO_URL'] = hero.url;
    templateData['SPOTLIGHT_HERO_TITLE_EN'] = escapeHtml(hero.title);
    templateData['SPOTLIGHT_HERO_TITLE_CN'] = escapeHtml(heroT?.title || hero.title);
    templateData['SPOTLIGHT_HERO_SUMMARY_EN'] = escapeHtml(hero.summary || '');
    templateData['SPOTLIGHT_HERO_SUMMARY_CN'] = escapeHtml(heroT?.summary || hero.summary || '');
    templateData['SPOTLIGHT_HERO_SOURCE'] = hero.source;
    templateData['SPOTLIGHT_HERO_DATE'] = hero.date || '';
  }

  // Spotlight 列表（第 1 条用 _1_ 占位符，后续 _2_、_3_...）
  // 模板语法：{{SPOTLIGHT_1_URL}} {{SPOTLIGHT_1_TITLE_EN}} 等
  const spotlightItems = data.news.slice(0, 6);
  // 跳过 hero（hero 已经是第一条），所以这里填索引 1, 2, 3... 对应模板的 _1_, _2_, _3_
  for (let i = 0; i < spotlightItems.length; i++) {
    const idx = i + 1; // 模板索引从 1 开始
    const a = spotlightItems[i];
    const t = translated.news[i];
    templateData[`SPOTLIGHT_${idx}_URL`] = a.url;
    templateData[`SPOTLIGHT_${idx}_TITLE_EN`] = escapeHtml(a.title);
    templateData[`SPOTLIGHT_${idx}_TITLE_CN`] = escapeHtml(t?.title || a.title);
    templateData[`SPOTLIGHT_${idx}_SUMMARY_EN`] = escapeHtml(a.summary || '');
    templateData[`SPOTLIGHT_${idx}_SUMMARY_CN`] = escapeHtml(t?.summary || a.summary || '');
    templateData[`SPOTLIGHT_${idx}_SOURCE`] = a.source;
    templateData[`SPOTLIGHT_${idx}_DATE`] = a.date || '';
  }

  // YouTube Hero
  const ytVideos = data.youtube.slice(0, 8);
  if (ytVideos.length > 0) {
    const ytHero = ytVideos[0];
    const ytHeroT = translated.youtube[0];
    templateData['YT_HERO_URL'] = ytHero.url;
    templateData['YT_HERO_TITLE_EN'] = escapeHtml(ytHero.title);
    templateData['YT_HERO_TITLE_CN'] = escapeHtml(ytHeroT?.title || ytHero.title);
    templateData['YT_HERO_SUMMARY_EN'] = escapeHtml('');
    templateData['YT_HERO_SUMMARY_CN'] = escapeHtml('');
    templateData['YT_HERO_SOURCE'] = ytHero.channel;
    templateData['YT_HERO_DATE'] = ytHero.published || '';
    templateData['YT_COUNT'] = String(ytVideos.length);
  }

  // YouTube 列表（_1_、_2_、...）
  for (let i = 0; i < ytVideos.length; i++) {
    const idx = i + 1;
    const v = ytVideos[i];
    const t = translated.youtube[i];
    templateData[`YT_${idx}_URL`] = v.url;
    templateData[`YT_${idx}_TITLE_EN`] = escapeHtml(v.title);
    templateData[`YT_${idx}_TITLE_CN`] = escapeHtml(t?.title || v.title);
    templateData[`YT_${idx}_SUMMARY_EN`] = escapeHtml('');
    templateData[`YT_${idx}_SUMMARY_CN`] = escapeHtml('');
    templateData[`YT_${idx}_SOURCE`] = v.channel;
    templateData[`YT_${idx}_DATE`] = v.published || '';
  }

  // X.com posts
  const xItems = data.xPosts.slice(0, 10);
  templateData['X_COUNT'] = String(xItems.length);
  for (let i = 0; i < xItems.length; i++) {
    const idx = i + 1;
    const x = xItems[i];
    const t = translated.xPosts[i];
    templateData[`X_${idx}_HANDLE`] = `@${x.username}`;
    templateData[`X_${idx}_LIKES`] = String(x.likes);
    templateData[`X_${idx}_DATE`] = x.date || '';
    templateData[`X_${idx}_BODY_EN`] = escapeHtml(formatXContent(x.content));
    templateData[`X_${idx}_BODY_CN`] = escapeHtml(formatXContent(t?.content || x.content));
    templateData[`X_${idx}_URL`] = x.url;
  }

  // 展开数字索引块：把模板中只有 _1_ 占位符的 .si 块复制 N 份
  // 注意：只匹配包含对应前缀占位符的块，避免误匹配已被展开的其他块
  let expandedTemplate = template;
  expandedTemplate = expandNumberedBlocks(
    expandedTemplate,
    spotlightItems.length,
    /<div class="si">(?:(?!<div class="si">)[\s\S])*?\{\{SPOTLIGHT_1_[\s\S]*?<\/div>\s*<!-- \/REPEAT -->/g,
    'SPOTLIGHT'
  );
  expandedTemplate = expandNumberedBlocks(
    expandedTemplate,
    ytVideos.length,
    /<div class="si">(?:(?!<div class="si">)[\s\S])*?\{\{YT_1_[\s\S]*?<\/div>\s*<!-- \/REPEAT -->/g,
    'YT'
  );
  // X 区域：没数据时直接清空整段（EN 和 CN 各一个 section）
  if (xItems.length === 0) {
    expandedTemplate = expandedTemplate.replace(
      /<section class="art-sec sec-x[^"]*"[^>]*>[\s\S]*?<\/section>/g,
      ''
    );
  } else {
    expandedTemplate = expandNumberedBlocks(
      expandedTemplate,
      xItems.length,
      /<div class="x-row">(?:(?!<div class="x-row">)[\s\S])*?\{\{X_1_[\s\S]*?<\/div>\s*<!-- \/REPEAT -->/g,
      'X'
    );
  }

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
    YT_HERO_SUMMARY_EN: 'No videos today',
    YT_HERO_SUMMARY_CN: '今日无视频',
    YT_HERO_SOURCE: '',
  };

  for (const [k, v] of Object.entries(defaults)) {
    if (!templateData[k]) templateData[k] = v;
  }

  return renderTemplate(expandedTemplate, templateData);
}

/**
 * 生成 Modernism 风格 HTML
 * @param data 原始英文数据（用于 EN 字段）
 * @param translated 翻译后中文数据（用于 CN 字段）
 */
function generateModernismHTML(
  template: string,
  data: FetchedData,
  translated: TranslatedData,
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
  const heroT = translated.news[0];
  if (hero) {
    templateData['SPOTLIGHT_HERO_URL'] = hero.url;
    templateData['SPOTLIGHT_HERO_TITLE_EN'] = escapeHtml(hero.title);
    templateData['SPOTLIGHT_HERO_TITLE_CN'] = escapeHtml(heroT?.title || hero.title);
    templateData['SPOTLIGHT_HERO_TAG_EN'] = escapeHtml(hero.category || 'News');
    templateData['SPOTLIGHT_HERO_TAG_CN'] = escapeHtml(hero.category || '新闻');
    templateData['SPOTLIGHT_HERO_DATE_EN'] = hero.date;
    templateData['SPOTLIGHT_HERO_DATE_CN'] = hero.date;
    templateData['SPOTLIGHT_HERO_SUMMARY_EN'] = escapeHtml(hero.summary || '');
    templateData['SPOTLIGHT_HERO_SUMMARY_CN'] = escapeHtml(heroT?.summary || hero.summary || '');
    templateData['SPOTLIGHT_HERO_SOURCE'] = hero.source;
  }

  // Stack items（Spotlight 其余文章）
  const stackItems = data.news.slice(1, 6);
  templateData['_REPEAT_STACK'] = stackItems
    .map(
      (a, i) => {
        const t = translated.news[i + 1];
        return `STACK_URL|||:|||${a.url}|||KV||||STACK_TITLE_EN|||:|||${escapeHtml(a.title)}|||KV||||STACK_TITLE_CN|||:|||${escapeHtml(t?.title || a.title)}|||KV||||STACK_TAG_EN|||:|||${escapeHtml(a.category || 'News')}|||KV||||STACK_TAG_CN|||:|||${escapeHtml(a.category || '新闻')}|||KV||||STACK_DATE_EN|||:|||${a.date}|||KV||||STACK_DATE_CN|||:|||${a.date}`;
      }
    )
    .join('|||REPEAT_ITEM|||');

  // YouTube (Modernism 用 4 列网格)
  const ytVideos = data.youtube.slice(0, 8);
  templateData['_REPEAT_YOUTUBE'] = ytVideos
    .map(
      (v, i) => {
        const t = translated.youtube[i];
        return `YT_URL|||:|||${v.url}|||KV||||YT_TITLE_EN|||:|||${escapeHtml(v.title)}|||KV||||YT_TITLE_CN|||:|||${escapeHtml(t?.title || v.title)}|||KV||||YT_CHANNEL|||:|||${v.channel}`;
      }
    )
    .join('|||REPEAT_ITEM|||');

  // X.com posts (Modernism 用 2 列)
  const xItems = data.xPosts.slice(0, 10);
  templateData['_REPEAT_XPOST'] = xItems
    .map(
      (x, i) => {
        const t = translated.xPosts[i];
        return `X_HANDLE|||:|||@${x.username}|||KV||||X_DISPLAYNAME|||:|||${escapeHtml(x.displayname)}|||KV||||X_LIKES|||:|||${x.likes}|||KV||||X_BODY_EN|||:|||${escapeHtml(formatXContent(x.content))}|||KV||||X_BODY_CN|||:|||${escapeHtml(formatXContent(t?.content || x.content))}|||KV||||X_URL|||:|||${x.url}`;
      }
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
 * @param data 原始英文数据
 * @param translated 翻译后中文数据（EN 字段用原文，CN 字段用翻译）
 * @returns 生成的 HTML 文件路径
 */
export function generateDailyHTML(
  data: FetchedData,
  translated: TranslatedData,
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

  // 生成 HTML（EN 用原文 data，CN 用翻译 translated）
  const html =
    style === 'rationalist'
      ? generateRationalistHTML(template, data, translated, en, cn)
      : generateModernismHTML(template, data, translated, en, cn);

  // 注入中文字体支持（Noto Serif SC / Noto Sans SC）
  const htmlWithCjkFonts = injectCjkFonts(html);

  // 保存文件
  const outputFilename = `daily-brief-${filename}.html`;
  const outputPath = path.join(publicDir, outputFilename);
  writeFileSync(outputPath, htmlWithCjkFonts, 'utf-8');

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
