/**
 * 音频转码：AudioBuffer → MP3 (lamejs) / WAV (手写 PCM16)
 */
// 使用社区维护的 ESM 版本，规避原版 lamejs 的 CJS 作用域 bug（MPEGMode is not defined）
import { Mp3Encoder as Mp3EncoderCtor } from '@breezystack/lamejs';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function toInt16(s: number): number {
  const v = Math.max(-1, Math.min(1, s || 0));
  return v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
}

export async function blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const Ctor: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) throw new Error('当前环境不支持 Web Audio 解码');
  const ctx = new Ctor();
  const ab = await blob.arrayBuffer();
  try {
    return await new Promise<AudioBuffer>((resolve, reject) => {
      let settled = false;
      const res = ctx.decodeAudioData(
        ab,
        (decoded) => {
          if (!settled) { settled = true; resolve(decoded); }
        },
        (err) => {
          if (!settled) { settled = true; reject(err || new Error('音频数据解码失败')); }
        }
      );
      if (res && typeof res.then === 'function') {
        res.then((decoded) => {
          if (!settled) { settled = true; resolve(decoded); }
        }).catch((err) => {
          if (!settled) { settled = true; reject(err); }
        });
      }
    });
  } finally {
    try { void ctx.close(); } catch { /* 忽略 */ }
  }
}

/** AudioBuffer → WAV (PCM16) */
export function audioBufferToWav(ab: AudioBuffer): Blob {
  const numCh = Math.min(2, ab.numberOfChannels);
  const sampleRate = ab.sampleRate;
  const dataLen = ab.length * numCh * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(ab.getChannelData(c));
  let off = 44;
  for (let i = 0; i < ab.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = chans[c][i] || 0;
      view.setInt16(off, v < 0 ? (v < -1 ? -32768 : (v * 32768) | 0) : (v > 1 ? 32767 : (v * 32767) | 0), true);
      off += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export interface Mp3Options {
  kbps?: number;
  onProgress?: (percent: number) => void;
}

/** AudioBuffer → MP3 (lamejs, 分块编码 + 让出主线程) */
export async function audioBufferToMp3(ab: AudioBuffer, opts: Mp3Options = {}): Promise<Blob> {
  if (typeof Mp3EncoderCtor !== 'function') {
    throw new Error('lamejs 未正确加载（缺少 Mp3Encoder）');
  }
  const numCh = Math.min(2, ab.numberOfChannels);
  const encoder = new Mp3EncoderCtor(numCh, ab.sampleRate, opts.kbps ?? 320);
  const CHUNK = 256 * 1024;
  const left = ab.getChannelData(0);
  const right = numCh > 1 ? ab.getChannelData(1) : null;
  const parts: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += CHUNK) {
    const len = Math.min(CHUNK, left.length - i);
    const l = new Int16Array(len);
    for (let j = 0; j < len; j++) {
      const v = left[i + j] || 0;
      l[j] = v < 0 ? (v < -1 ? -32768 : (v * 32768) | 0) : (v > 1 ? 32767 : (v * 32767) | 0);
    }
    let out: Uint8Array;
    if (right) {
      const r = new Int16Array(len);
      for (let j = 0; j < len; j++) {
        const v = right[i + j] || 0;
        r[j] = v < 0 ? (v < -1 ? -32768 : (v * 32768) | 0) : (v > 1 ? 32767 : (v * 32767) | 0);
      }
      out = encoder.encodeBuffer(l, r);
    } else {
      out = encoder.encodeBuffer(l);
    }
    if (out && out.length > 0) parts.push(out);
    opts.onProgress?.(Math.min(100, ((i + len) / left.length) * 100));
    await tick();
  }

  const end = encoder.flush();
  if (end && end.length > 0) parts.push(new Uint8Array(end.buffer, end.byteOffset, end.byteLength));
  return new Blob(parts as unknown as BlobPart[], { type: 'audio/mpeg' });
}
