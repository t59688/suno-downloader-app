import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'node:https';

/**
 * 仅开发环境使用：桌面浏览器调试时的本地代理。
 * 原因：
 *  1) sunoapi.aibiei.com/proxy  不允许携带任意 Origin（浏览器跨域 fetch 必带）
 *  2) yellow-salad.aibiei.com/rights 只允许 Origin: https://usesuno.com，
 *     而浏览器 JS 被禁止设置 Origin 头。
 * 所以在浏览器调试时，由 Vite 中间件在服务端代发请求；
 * 打包进 App 后则走原生插件（OkHttp），完全不需要这个中间件。
 */
function nodeGetOrPost(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('upstream timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function devProxy(): Plugin {
  return {
    name: 'suno-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-proxy', async (req, res, next) => {
        const host = (req.headers.host || '').split(':')[0];
        if (host !== 'localhost' && host !== '127.0.0.1') return next();
        const u = new URL(req.url ?? '', 'http://localhost');
        try {
          if (u.pathname === '/dev-proxy/page') {
            const target = u.searchParams.get('url');
            if (!target) { res.statusCode = 400; res.end('url required'); return; }
            const r = await nodeGetOrPost('GET', 'https://sunoapi.aibiei.com/proxy?url=' + encodeURIComponent(target), { Accept: 'text/html,application/xhtml+xml' });
            res.statusCode = r.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(r.text);
          } else if (u.pathname === '/dev-proxy/rights') {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            const r = await nodeGetOrPost(
              'POST',
              'https://yellow-salad.aibiei.com/rights',
              { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://usesuno.com', Referer: 'https://usesuno.com/' },
              Buffer.concat(chunks).toString('utf8')
            );
            res.statusCode = r.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.end(r.text);
          } else {
            next();
          }
        } catch (e) {
          res.statusCode = 502;
          res.end('dev proxy error: ' + String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxy()],
  // lamejs 是 UMD 包，内部引用了 global
  define: { global: 'globalThis' },
  build: { chunkSizeWarningLimit: 1600 },
});
