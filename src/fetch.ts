/**
 * AI Daily Bot - Python 脚本调用层
 * 封装对 AI-Daily Python 抓取脚本的调用
 */
import { execSync } from 'child_process';
import path from 'path';

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  category: string;
  date: string;
  summary: string;
}

export interface YouTubeVideo {
  channel: string;
  title: string;
  url: string;
  published: string;
}

export interface XPost {
  username: string;
  displayname: string;
  content: string;
  date: string;
  url: string;
  likes: number;
  retweets: number;
}

export interface FetchedData {
  news: NewsArticle[];
  youtube: YouTubeVideo[];
  xPosts: XPost[];
}

/**
 * 运行 Python 脚本并解析 JSON 输出
 */
function runScript(scriptPath: string): any[] {
  try {
    const stdout = execSync(`python3 "${scriptPath}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 120_000, // 2 分钟超时
    });
    return JSON.parse(stdout.trim());
  } catch (err: any) {
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    console.warn(`[fetch] 脚本执行警告 (${path.basename(scriptPath)}):`, stderr.slice(0, 200));
    // 尝试从 stdout 解析（即使有 stderr 错误）
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout.trim());
      } catch {
        // 无法解析，返回空数组
      }
    }
    return [];
  }
}

/**
 * 运行所有抓取脚本，返回合并数据
 */
export async function fetchAllData(
  scriptsDir: string
): Promise<FetchedData> {
  console.log('[fetch] 开始并行抓取数据...');
  const startTime = Date.now();

  // 三个脚本路径
  const fetchNews = path.join(scriptsDir, 'fetch_news.py');
  const fetchYouTube = path.join(scriptsDir, 'fetch_youtube.py');
  const fetchX = path.join(scriptsDir, 'fetch_x.py');

  const results: { news: NewsArticle[]; youtube: YouTubeVideo[]; xPosts: XPost[] } = {
    news: [],
    youtube: [],
    xPosts: [],
  };

  try {
    // 并行执行（Node.js 单线程，但子进程是并行的）
    const [newsResult, youtubeResult, xResult] = await Promise.allSettled([
      (async () => {
        console.log('[fetch] 抓取新闻 (fetch_news.py)...');
        const data = runScript(fetchNews) as NewsArticle[];
        console.log(`[fetch] 新闻: ${data.length} 条`);
        return data;
      })(),
      (async () => {
        console.log('[fetch] 抓取 YouTube (fetch_youtube.py)...');
        const data = runScript(fetchYouTube) as YouTubeVideo[];
        console.log(`[fetch] YouTube: ${data.length} 条`);
        return data;
      })(),
      (async () => {
        console.log('[fetch] 抓取 X.com (fetch_x.py)...');
        const data = runScript(fetchX) as XPost[];
        console.log(`[fetch] X.com: ${data.length} 条`);
        return data;
      })(),
    ]);

    if (newsResult.status === 'fulfilled') results.news = newsResult.value;
    else console.error('[fetch] 新闻抓取失败:', newsResult.reason?.message);

    if (youtubeResult.status === 'fulfilled') results.youtube = youtubeResult.value;
    else console.error('[fetch] YouTube 抓取失败:', youtubeResult.reason?.message);

    if (xResult.status === 'fulfilled') results.xPosts = xResult.value;
    else console.error('[fetch] X.com 抓取失败:', xResult.reason?.message);
  } catch (err) {
    console.error('[fetch] 抓取出错:', err);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[fetch] 抓取完成 (${elapsed}s): 新闻 ${results.news.length}, YouTube ${results.youtube.length}, X ${results.xPosts.length}`
  );

  return results;
}
