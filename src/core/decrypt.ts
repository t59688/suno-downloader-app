/**
 * Suno 加密音频解密器
 * 移植自 usesuno.com/tools/downloader/suno-media-source.js
 *
 * Suno 的音频文件是 AES-CTR 加密后放在公开 CDN 上的：
 *   https://d2lwuy8qc234o3.cloudfront.net/1/clip/<uuid>.m4a
 * 解密密钥通过 rights 服务换取（见 http.ts）：
 *   userKey    = SHA-256(glt)                       → AES-GCM 解包密钥
 *   contentKey = GCM_Decrypt(userKey, key, iv=12B, AAD=uuid) → AES-CTR 密钥(16/24/32字节)
 *   contentIv  = GCM_Decrypt(userKey, iv,  iv=12B, AAD=uuid) → 16 字节 IV
 *   音频       = CTR_Decrypt(contentKey, contentIv) 流式逐块解密
 *
 * 这里用 @noble/ciphers 纯 JS 实现（不依赖 Web Crypto，
 * 任何 WebView / 安全上下文都能跑）。
 */
import { ctr, gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha256';
import type { Rights } from './types';

export const RIGHTS_URL = 'https://yellow-salad.aibiei.com/rights';
export const AUDIO_BASE_URL = 'https://d2lwuy8qc234o3.cloudfront.net/1/clip/';
const CONTENT_TYPE = 'clip';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCK = 16;

export interface DecryptProgress {
  decrypted: number;
  total: number;
  percent: number | null;
}

export interface DecodedAudio {
  blob: Blob;
  mimeType: string;
  extension: string;
}

export function encryptedAudioUrl(contentId: string): string {
  return AUDIO_BASE_URL + encodeURIComponent(contentId) + '.m4a';
}

function base64UrlToBytes(value: string): Uint8Array {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 16 字节 IV + 块偏移（128 位大端加法） */
function addCounter(iv: Uint8Array, blockOffset: number): Uint8Array {
  const counter = new Uint8Array(BLOCK);
  counter.set(iv);
  let value = BigInt(0);
  for (let i = 0; i < counter.length; i++) {
    value = (value << BigInt(8)) | BigInt(counter[i]);
  }
  value += BigInt(blockOffset);
  for (let j = counter.length - 1; j >= 0; j--) {
    counter[j] = Number(value & BigInt(255));
    value >>= BigInt(8);
  }
  return counter;
}

/** 按魔数判断解密后的真实音频格式 */
export function detectAudioType(first: Uint8Array): { mimeType: string; extension: string } {
  const f = first || new Uint8Array(0);
  if (f.length >= 4 && f[0] === 0x1a && f[1] === 0x45 && f[2] === 0xdf && f[3] === 0xa3) {
    return { mimeType: 'audio/webm', extension: 'webm' };
  }
  if (f.length >= 3 && f[0] === 0x49 && f[1] === 0x44 && f[2] === 0x33) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  if (f.length >= 2 && f[0] === 0xff && (f[1] & 0xe0) === 0xe0) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  return { mimeType: 'audio/mp4', extension: 'm4a' };
}

export interface DecryptOptions {
  contentId: string;
  rights: Rights;
  onProgress?: (p: DecryptProgress) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** 流式下载并解密音频，返回 Blob */
export async function decryptAudio(opts: DecryptOptions): Promise<DecodedAudio> {
  const id = String(opts.contentId || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error('无效的 Suno 歌曲 ID（需要 UUID）');
  const { key, iv, glt } = opts.rights;
  if (!key || !iv || !glt) throw new Error('密钥数据不完整 (key/iv/glt)');

  // 1) userKey = SHA-256(glt)
  const userKey = sha256(new TextEncoder().encode(glt));

  // 2) 解包 content key / iv（@noble/ciphers v1.3: nonce/AAD 在构造时传入）
  const unwrap = (b64: string): Uint8Array => {
    const wrapped = base64UrlToBytes(b64);
    if (wrapped.length < 28) throw new Error('密钥数据不完整');
    try {
      return gcm(userKey, wrapped.subarray(0, 12), new TextEncoder().encode(id)).decrypt(
        wrapped.subarray(12)
      );
    } catch {
      throw new Error('密钥解包失败（AES-GCM 校验不通过）');
    }
  };

  const contentKey = unwrap(key);
  const contentIv = unwrap(iv);
  if (contentKey.length !== 16 && contentKey.length !== 24 && contentKey.length !== 32) {
    throw new Error('内容密钥长度异常: ' + contentKey.length);
  }
  if (contentIv.length !== BLOCK) throw new Error('内容 IV 长度异常: ' + contentIv.length);

  // 3) 流式下载加密文件并逐块 AES-CTR 解密
  const doFetch = opts.fetchImpl || fetch;
  const response = await doFetch(encryptedAudioUrl(id), { signal: opts.signal });
  if (!response.ok) throw new Error('下载加密音频失败 (HTTP ' + response.status + ')');
  if (!response.body) throw new Error('当前环境不支持流式读取音频');

  const totalHeader = Number(response.headers.get('content-length')) || 0;
  let total = totalHeader;
  const contentRange = response.headers.get('content-range');
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)$/);
    if (m) total = Number(m[1]);
  }

  const out: Uint8Array[] = [];
  let blockIndex = 0;
  let remainder = new Uint8Array(0);
  let downloadedBytes = 0;
  let reader = (response.body as ReadableStream<Uint8Array>).getReader();

  const url = encryptedAudioUrl(id);
  let retries = 0;
  const MAX_RETRIES = 6;

  for (;;) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        downloadedBytes += value.length;
        opts.onProgress?.({
          decrypted: downloadedBytes,
          total,
          percent: total ? Math.min(100, (downloadedBytes / total) * 100) : null,
        });

        // 拼接前一个网络分块未满 16 字节的余量
        let chunk: Uint8Array;
        if (remainder.length > 0) {
          chunk = new Uint8Array(remainder.length + value.length);
          chunk.set(remainder, 0);
          chunk.set(value, remainder.length);
          remainder = new Uint8Array(0);
        } else {
          chunk = value;
        }

        // 只对完整的 16 字节整数块调用 AES-CTR 解密，严格保证密码流不发生错位
        const fullBlocksLen = Math.floor(chunk.length / BLOCK) * BLOCK;
        if (fullBlocksLen > 0) {
          const fullBlocks = chunk.subarray(0, fullBlocksLen);
          const ctrCipher = ctr(contentKey, addCounter(contentIv, blockIndex));
          out.push(ctrCipher.decrypt(fullBlocks));
          blockIndex += fullBlocksLen / BLOCK;
        }

        // 不足 16 字节的余数暂存至 remainder，待下一分块拼满 16 字节
        if (fullBlocksLen < chunk.length) {
          remainder = chunk.slice(fullBlocksLen);
        }
      }

      // 读取完毕，正常跳出循环
      break;
    } catch (err: any) {
      if (opts.signal?.aborted || err?.name === 'AbortError') throw err;
      retries++;
      if (retries > MAX_RETRIES) throw err;

      // 发生网络闪断/超时时，利用 HTTP Range 从上一个完整解密块无缝续传
      remainder = new Uint8Array(0); // 清空未解密余量
      const resumePos = blockIndex * BLOCK;
      downloadedBytes = resumePos;
      await new Promise((r) => setTimeout(r, 1200));

      const resumeRes = await doFetch(url, {
        signal: opts.signal,
        headers: { Range: `bytes=${resumePos}-` },
      });
      if (!resumeRes.ok && resumeRes.status !== 206) {
        throw new Error('断点续传失败 (HTTP ' + resumeRes.status + ')');
      }
      if (!resumeRes.body) throw new Error('当前环境不支持流式续传');
      reader = (resumeRes.body as ReadableStream<Uint8Array>).getReader();
    }
  }

  // 解密最后剩余的非整块尾部字节
  if (remainder.length > 0) {
    const ctrCipher = ctr(contentKey, addCounter(contentIv, blockIndex));
    out.push(ctrCipher.decrypt(remainder));
  }

  const totalLen = out.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let p = 0;
  for (const c of out) { buf.set(c, p); p += c.length; }
  if (totalLen === 0) throw new Error('解密结果为空');

  const type = detectAudioType(buf.subarray(0, 16));
  const blob = new Blob([buf as unknown as BlobPart], { type: type.mimeType });
  return { blob, mimeType: type.mimeType, extension: type.extension };
}
