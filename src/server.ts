/**
 * AI Daily Bot - Express 静态文件服务器
 * 托管生成的 HTML 日报，供 Playwright 截图
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DailyServer {
  private app: express.Application;
  private server: ReturnType<express.Application['listen']> | null = null;

  constructor(private publicDir: string, private port: number) {
    this.app = express();

    // 静态文件托管
    this.app.use(express.static(this.publicDir));

    // CORS 允许本地访问
    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      next();
    });

    // 健康检查
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  /** 启动服务器 */
  start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        const url = `http://localhost:${this.port}`;
        console.log(`[server] 服务器已启动: ${url}`);
        resolve(url);
      });
      this.server.on('error', reject);
    });
  }

  /** 停止服务器 */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else {
          console.log('[server] 服务器已关闭');
          resolve();
        }
      });
      this.server = null;
    });
  }

  /** 获取 HTML 文件的完整 URL */
  getUrl(filename: string): string {
    return `http://localhost:${this.port}/${filename}`;
  }
}
