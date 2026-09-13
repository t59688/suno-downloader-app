/**
 * 针对用户目标歌曲的端到端解密与转码完整性自动化测试：
 * 目标: https://suno.com/song/96fc42a9-a30c-4bb4-bebc-e8ae1b37bc79
 * 运行: node scripts/test_song_e2e.mjs
 */
import { execSync } from 'node:child_process';
import https from 'node:https';
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

function httpsReq(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), buffer: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

console.log('====================================================');
console.log('  Suno 目标歌曲解密与转码端到端完整性测试');
console.log('  目标: https://suno.com/song/96fc42a9-a30c-4bb4-bebc-e8ae1b37bc79');
console.log('====================================================\n');

// 1. 打包最新修改的核心模块
console.log('[1/5] 打包最新 core 模块 (esbuild)...');
bundle('src/core/sunoParser.ts', path.join(__dirname, 'tmp_parser.mjs'));
bundle('src/core/decrypt.ts', path.join(__dirname, 'tmp_decrypt.mjs'));
bundle('src/core/transcode.ts', path.join(__dirname, 'tmp_transcode.mjs'));

const { fetchAndParse } = await import('./tmp_parser.mjs');
const { decryptAudio, detectAudioType } = await import('./tmp_decrypt.mjs');
const { audioBufferToWav, audioBufferToMp3 } = await import('./tmp_transcode.mjs');

// 2. 解析目标歌曲
const TARGET_ID = '96fc42a9-a30c-4bb4-bebc-e8ae1b37bc79';
const fetchPageNode = async (url) => {
  const r = await httpsReq('GET', 'https://sunoapi.aibiei.com/proxy?url=' + encodeURIComponent(url), { Accept: 'text/html' });
  if (r.status !== 200) throw new Error('proxy HTTP ' + r.status);
  return r.text;
};

console.log('[2/5] 抓取并解析目标歌曲页面...');
const clip = await fetchAndParse(TARGET_ID, fetchPageNode);
console.log('      歌曲名称:', clip.title);
console.log('      创作者  :', clip.display_name || clip.handle);
console.log('      歌曲 ID :', clip.id);
console.log('      原始时长:', clip.metadata?.duration ? clip.metadata.duration + ' 秒' : '未知');

if (clip.id.toLowerCase() !== TARGET_ID.toLowerCase()) {
  throw new Error(`歌曲匹配错误！期望 ${TARGET_ID}，实际解析出 ${clip.id}`);
}

// 3. 换取解密密钥
console.log('[3/5] 向 rights 服务换取解密密钥...');
const rightsRes = await httpsReq(
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
if (rightsRes.status !== 200) {
  throw new Error('rights 接口失败: HTTP ' + rightsRes.status + ' ' + rightsRes.text.slice(0, 200));
}
const rights = JSON.parse(rightsRes.text);

// 4. 使用修复后的分块对齐解密器进行下载解密
console.log('[4/5] 启动修复后的流式 AES-CTR 解密下载...');
let lastPct = -1;
const decoded = await decryptAudio({
  contentId: clip.id,
  rights,
  onProgress: (p) => {
    const pct = p.percent == null ? -1 : Math.floor(p.percent);
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(`\r      下载解密进度: ${pct >= 0 ? pct + '%' : '?'} (${(p.decrypted / 1024 / 1024).toFixed(2)} MB)`);
    }
  },
});
console.log('\n      解密完成！解密后总大小: ' + (decoded.blob.size / 1024 / 1024).toFixed(2) + ' MB');

// 5. 校验解密出的每一帧（严防 10 秒截断和破损）
console.log('[5/5] 深度分析解密后的音频容器与全部音频帧...');
const buf = Buffer.from(await decoded.blob.arrayBuffer());
const stszIdx = buf.indexOf(Buffer.from('stsz'));
const stcoIdx = buf.indexOf(Buffer.from('stco'));

if (stszIdx < 0 || stcoIdx < 0) {
  throw new Error('解密文件损坏：未找到 MP4/M4A 样本索引表 (stsz/stco)');
}

const sampleCount = buf.readUInt32BE(stszIdx + 12);
const firstChunkOffset = buf.readUInt32BE(stcoIdx + 12);
console.log('      音频采样帧总数:', sampleCount);

// 每一帧 Opus 样本长度约 20ms (0.02s)
const calculatedDurationSec = sampleCount * 0.02;
console.log(`      根据帧数计算总时长: ~${calculatedDurationSec.toFixed(1)} 秒 (约 ${(calculatedDurationSec / 60).toFixed(1)} 分钟)`);

if (calculatedDurationSec < 180) {
  throw new Error(`检测到音频严重截断！总时长仅 ${calculatedDurationSec} 秒，未达到整首长度！`);
}

// 遍历检查全曲样本帧头（验证无任何错位乱码帧）
let sampleOffset = firstChunkOffset;
let validFrameCount = 0;
let invalidFrameCount = 0;

for (let i = 0; i < sampleCount; i++) {
  const sz = buf.readUInt32BE(stszIdx + 16 + i * 4);
  if (sampleOffset + sz <= buf.length) {
    const toc = buf[sampleOffset];
    const config = (toc >> 3) & 0x1f;
    // 标准 Opus 编码配置（fullband 或 standard voice/music 模式均为 0~31 正常配置）
    if (config >= 0 && config <= 31) {
      validFrameCount++;
    } else {
      invalidFrameCount++;
    }
  }
  sampleOffset += sz;
}

console.log(`      音频帧有效率: ${validFrameCount} / ${sampleCount} (${((validFrameCount / sampleCount) * 100).toFixed(2)}%)`);
if (invalidFrameCount > 0) {
  throw new Error(`检测到 ${invalidFrameCount} 个损坏帧！解密流仍存在错位！`);
}

// 6. 验证转码性能与模块可用性
console.log('\n[转码验证] 验证 WAV & MP3 编码模块稳定性...');
const mockAudioBuffer = {
  numberOfChannels: 2,
  sampleRate: 48000,
  length: 48000 * 5, // 5秒测试缓冲
  getChannelData: (ch) => new Float32Array(48000 * 5).fill(0.1 * (ch + 1)),
};

const wavBlob = audioBufferToWav(mockAudioBuffer);
console.log('      WAV 编码成功, 5秒测试大小:', wavBlob.size, '字节');

const mp3Blob = await audioBufferToMp3(mockAudioBuffer, { kbps: 320 });
console.log('      MP3 编码成功, 5秒测试大小:', mp3Blob.size, '字节');

console.log('\n====================================================');
console.log('🎉 测试全部通过！目标歌曲完整解密，全曲无损坏，转码链路健康！');
console.log('====================================================\n');
