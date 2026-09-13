/**
 * 下载流水线：解析 → 密钥 → 解密 → (转码 → 打标签) → 文件
 */
import { fetchRights } from './http';
import { decryptAudio } from './decrypt';
import { blobToAudioBuffer, audioBufferToMp3, audioBufferToWav } from './transcode';
import { attachMp3Tags, type TagInfo } from './id3';
import { zipSync } from 'fflate';
import type { ClipInfo } from './types';

export type DownloadFormat = 'mp3' | 'wav' | 'original' | 'mp4' | 'cover' | 'lyrics';

export interface DownloadOptions {
  onStage?: (stage: string) => void;
  onProgress?: (percent: number | null) => void;
  signal?: AbortSignal;
  kbps?: number;
}

export interface DownloadResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function safeName(s: string): string {
  const n = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80).trim();
  return n || 'suno';
}

/** 流式 fetch 并汇报进度 */
async function fetchBlobWithProgress(url: string, opts: DownloadOptions, mimeType: string): Promise<Blob> {
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error('下载失败 (HTTP ' + res.status + ')');
  if (!res.body) {
    opts.onProgress?.(null);
    return res.blob();
  }
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      got += value.length;
    }
    opts.onProgress?.(total ? Math.min(100, (got / total) * 100) : null);
  }
  return new Blob(chunks as unknown as BlobPart[], { type: mimeType });
}

/** 获取原始（解密后）音频 */
export async function getOriginalAudio(
  clip: ClipInfo,
  opts: DownloadOptions
): Promise<{ blob: Blob; extension: string; mimeType: string }> {
  opts.onStage?.('正在申请解密密钥…');
  const rights = await fetchRights(clip.id, opts.signal);
  opts.onStage?.('正在下载并解密音频…');
  const decoded = await decryptAudio({
    contentId: clip.id,
    rights,
    signal: opts.signal,
    onProgress: (p) => opts.onProgress?.(p.percent),
  });
  return { blob: decoded.blob, extension: decoded.extension, mimeType: decoded.mimeType };
}

export async function downloadTrack(
  clip: ClipInfo,
  format: DownloadFormat,
  opts: DownloadOptions = {}
): Promise<DownloadResult> {
  const name = safeName(clip.title || clip.id);

  switch (format) {
    case 'cover': {
      const url = clip.image_url;
      if (!url) throw new Error('没有封面图地址');
      opts.onStage?.('正在下载封面…');
      const blob = await fetchBlobWithProgress(url, opts, 'image/jpeg');
      return { blob, fileName: name + '_cover.jpg', mimeType: blob.type || 'image/jpeg' };
    }

    case 'mp4': {
      const url = clip.video_url;
      if (!url) throw new Error('这首歌没有视频');
      opts.onStage?.('正在下载视频…');
      const blob = await fetchBlobWithProgress(url, opts, 'video/mp4');
      return { blob, fileName: name + '.mp4', mimeType: 'video/mp4' };
    }

    case 'original': {
      const o = await getOriginalAudio(clip, opts);
      return { blob: o.blob, fileName: name + '.' + o.extension, mimeType: o.mimeType };
    }

    case 'lyrics': {
      const meta = clip.metadata || {};
      const raw = String(meta.prompt ?? meta.lyrics ?? '').replace(/\r\n?/g, '\n').trim();
      if (/^\[\s*instrumental\s*\]$/i.test(raw)) throw new Error('该歌曲为纯音乐，没有歌词');
      if (!raw) throw new Error('没有歌词内容');
      opts.onStage?.('生成歌词文件…');
      const blob = new Blob([raw], { type: 'text/plain;charset=utf-8' });
      opts.onProgress?.(100);
      return { blob, fileName: name + '_lyrics.txt', mimeType: 'text/plain' };
    }

    case 'wav': {
      const o = await getOriginalAudio(clip, opts);
      opts.onStage?.('正在转换为 WAV…');
      opts.onProgress?.(null);
      const ab = await blobToAudioBuffer(o.blob);
      await tick();
      const blob = audioBufferToWav(ab);
      return { blob, fileName: name + '.wav', mimeType: 'audio/wav' };
    }

    case 'mp3': {
      const o = await getOriginalAudio(clip, opts);
      let mp3 = o.blob;
      if (o.extension !== 'mp3') {
        opts.onStage?.('正在转换为 MP3（可能需要一点时间）…');
        opts.onProgress?.(0);
        const ab = await blobToAudioBuffer(o.blob);
        mp3 = await audioBufferToMp3(ab, {
          kbps: opts.kbps,
          onProgress: (p) => opts.onProgress?.(p),
        });
      }
      opts.onStage?.('正在写入 MP3 元数据…');
      const meta = clip.metadata || {};
      const tags: TagInfo = {
        title: clip.title,
        artist: clip.display_name || clip.handle || 'Suno AI',
        album: clip.title,
        tags: meta.tags ? String(meta.tags) : '',
        // 参考站点同款：Suno 公开页不暴露独立歌词字段，
        // 歌词取自 metadata.prompt（[Instrumental] 会被 cleanLyrics 过滤）
        lyrics: String(meta.prompt ?? meta.lyrics ?? ''),
        cover: clip.image_url || '',
      };
      const tagged = await attachMp3Tags(mp3, tags, opts.signal);
      return { blob: tagged, fileName: name + '.mp3', mimeType: 'audio/mpeg' };
    }
  }
}

/**
 * 打包全部可用文件为 ZIP（与参考站点一致）：
 * MP3 + WAV + 原始音频 + 封面 + 歌词.txt + MP4 视频（如有）
 */
export async function downloadAll(clip: ClipInfo, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const name = safeName(clip.title || clip.id);
  const files: Record<string, Uint8Array> = {};

  const collect = async (format: DownloadFormat, stage: string) => {
    try {
      opts.onStage?.(stage);
      const r = await downloadTrack(clip, format, {
        signal: opts.signal,
        onStage: (s) => opts.onStage?.(stage + ' ' + s),
      });
      files[r.fileName] = new Uint8Array(await r.blob.arrayBuffer());
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      // 单项失败（如没有视频）不影响整体打包
    }
    await tick();
  };

  await collect('mp3', '[1/5] 生成 MP3…');
  await collect('wav', '[2/5] 生成 WAV…');
  await collect('original', '[3/5] 解密原始音频…');
  await collect('cover', '[4/5] 下载封面…');
  await collect('lyrics', '[5/5] 生成歌词…');
  if (clip.video_url) {
    opts.onStage?.('下载 MP4 视频…');
    try {
      const r = await downloadTrack(clip, 'mp4', { signal: opts.signal });
      files[r.fileName] = new Uint8Array(await r.blob.arrayBuffer());
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
    }
  }

  opts.onStage?.('打包 ZIP…');
  opts.onProgress?.(100);
  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer], {
    type: 'application/zip',
  });
  return { blob, fileName: name + '_all.zip', mimeType: 'application/zip' };
}
