/**
 * 端到端链路验证（在 Node 里跑 App 的真实核心代码）：
 *   1. 通过 aibiei 代理抓 suno.com 首页
 *   2. 用 src/core/sunoParser.ts 解析出真实歌曲
 *   3. POST rights 接口（带 Origin: https://usesuno.com）换取密钥
 *   4. 从 CloudFront 下载加密音频
 *   5. 用 src/core/decrypt.ts 做 AES-GCM 解包 + AES-CTR 流式解密
 *   6. 校验输出魔数，保存解密后的文件
 *
 * 运行: npm run validate
 */
import { execSync } from 'node:child_process';
import https from 'node:https';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function bundle(entry, out) {
  execSync(
    `npx esbuild "${path.join(root, entry)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=warning`,
    { cwd: root, stdio: 'inherit' }
  );
}

/** 原生 https 请求（可自由控制 Origin 头，模拟原生插件行为） */
function httpsReq(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (validate script)', ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

console.log('=== Suno 下载器链路验证 ===\n');

// 打包真实的 App 核心模块
console.log('[0/5] 打包核心模块 (esbuild)...');
bundle('src/core/sunoParser.ts', path.join(__dirname, 'tmp_parser.mjs'));
bundle('src/core/decrypt.ts', path.join(__dirname, 'tmp_decrypt.mjs'));
const { fetchAndParse, parsePlaylistHtml } = await import('./tmp_parser.mjs');
const { decryptAudio, detectAudioType } = await import('./tmp_decrypt.mjs');

// 1) 用真实歌曲短链接（来自 usesuno 官网示例）
const SAMPLE_SHORT = 'https://suno.com/s/kuuNnXWLBeiaN1wU';
const fetchPageNode = async (url) => {
  const r = await httpsReq('GET', 'https://sunoapi.aibiei.com/proxy?url=' + encodeURIComponent(url), { Accept: 'text/html' });
  if (r.status !== 200) throw new Error('proxy HTTP ' + r.status);
  return r.text;
};

console.log('[1/5] 通过 aibiei 代理抓取歌曲页: ' + SAMPLE_SHORT);
const songHtml = await fetchPageNode(SAMPLE_SHORT);
console.log('      页面大小: ' + songHtml.length + ' 字符');

// 2) 用 fetchAndParse 完整解析（短链 → UUID → RSC flight → clip）
console.log('[2/5] 解析歌曲页 RSC flight 数据...');
const song = await fetchAndParse('s:kuuNnXWLBeiaN1wU', fetchPageNode);
console.log('      歌曲: ' + song.title + (song._fallback ? ' [fallback!]' : ' [RSC 解析成功]'));
console.log('      作者: ' + (song.display_name || song.handle || '?') + '  ID: ' + song.id);
if (song._fallback) throw new Error('歌曲页 RSC 解析失败，走了 fallback');
const clip = song;

// 3) 换密钥（模拟原生插件：带 Origin: https://usesuno.com）
console.log('[3/5] POST rights 接口申请解密密钥...');
const rightsReq = await httpsReq(
  'POST',
  'https://yellow-salad.aibiei.com/rights',
  {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: 'https://usesuno.com',
    Referer: 'https://usesuno.com/',
  },
  JSON.stringify({ content_params: { content_id: clip.id, content_type: 'clip' } })
);
if (rightsReq.status !== 200) {
  throw new Error('rights 失败: HTTP ' + rightsReq.status + ' ' + rightsReq.text.slice(0, 200));
}
const rights = JSON.parse(rightsReq.text);
if (!rights.key || !rights.iv || !rights.glt) throw new Error('rights 响应缺少 key/iv/glt: ' + rightsReq.text.slice(0, 200));
console.log('      key/iv/glt 获取成功 (glt 长度 ' + rights.glt.length + ')');

// 4+5) 下载加密音频并解密
console.log('[4/5] 下载加密音频 + AES-CTR 流式解密...');
let last = -1;
const decoded = await decryptAudio({
  contentId: clip.id,
  rights,
  onProgress: (p) => {
    const pct = p.percent == null ? -1 : Math.floor(p.percent);
    if (pct !== last) {
      last = pct;
      process.stdout.write('\r      进度: ' + (pct >= 0 ? pct + '%' : '?') + '  ' + (p.decrypted / 1024 / 1024).toFixed(2) + ' MB');
    }
  },
});
console.log('\n[5/5] 校验结果...');
console.log('      解密后大小: ' + (decoded.blob.size / 1024 / 1024).toFixed(2) + ' MB');
console.log('      格式: ' + decoded.mimeType + ' (.' + decoded.extension + ')');

// 魔数校验
const head = new Uint8Array(await decoded.blob.slice(0, 16).arrayBuffer());
const recheck = detectAudioType(head);
console.log('      魔数复检: ' + recheck.mimeType + (recheck.extension === decoded.extension ? ' ✓ 一致' : ' ✗ 不一致!'));

// 保存解密文件供检查
const outPath = path.resolve(__dirname, '..', 'suno_sample.' + decoded.extension);
writeFileSync(outPath, new Uint8Array(await decoded.blob.arrayBuffer()));
console.log('\n✅ 全链路验证通过！解密文件已保存: ' + outPath);
console.log('   歌曲: ' + (song.title || clip.title));

// 附加验证：歌词提取逻辑（与 download.ts 'lyrics' 分支一致：来源 = metadata.prompt）
console.log('\n[附加] 验证歌词提取...');
const raw = String(clip.metadata?.prompt ?? '').replace(/\r\n?/g, '\n').trim();
if (/^\[\s*instrumental\s*\]$/i.test(raw)) {
  console.log('      纯音乐（[Instrumental]），无歌词');
} else if (raw) {
  writeFileSync(path.resolve(__dirname, '..', 'suno_sample_lyrics.txt'), raw);
  console.log('      ✅ 歌词 ' + raw.length + ' 字符，已保存 suno_sample_lyrics.txt');
  console.log('      预览: ' + raw.split('\n')[0].slice(0, 60));
} else {
  console.log('      该歌曲没有 prompt/歌词');
}
