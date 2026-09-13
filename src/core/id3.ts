/**
 * MP3 ID3 标签写入（browser-id3-writer，纯 JS）
 * 移植自 usesuno.com/tools/downloader/suno-audio-info.js
 */
export interface TagInfo {
  title: string;
  artist: string;
  album?: string;
  tags?: string;
  lyrics?: string;
  cover?: string;
}

function cleanLyrics(value: string): string {
  const lyrics = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (/^\[\s*instrumental\s*\]$/i.test(lyrics)) return '';
  return lyrics;
}

export async function attachMp3Tags(mp3Blob: Blob, info: TagInfo, signal?: AbortSignal): Promise<Blob> {
  const mod: any = await import('browser-id3-writer');
  const Writer: any = mod?.default?.ID3Writer || mod?.ID3Writer || mod?.default;
  if (typeof Writer !== 'function') throw new Error('ID3 写入器加载失败');

  const writer = new Writer(await mp3Blob.arrayBuffer());
  const title = String(info.title || '').trim();
  const artist = String(info.artist || '').trim();
  const album = String(info.album || title || 'Suno AI').trim();
  const tags = String(info.tags || '').trim();
  const lyrics = cleanLyrics(info.lyrics ?? '');
  const coverUrl = String(info.cover || '').trim();

  if (title) writer.setFrame('TIT2', title);
  if (artist) {
    writer.setFrame('TPE1', [artist]);
    writer.setFrame('TPE2', [artist]);
    writer.setFrame('TCOM', [artist]);
    writer.setFrame('TEXT', [artist]);
  }
  writer.setFrame('TALB', album || 'Suno AI');
  if (tags) writer.setFrame('TCON', [tags]);
  if (lyrics) {
    writer.setFrame('USLT', { language: 'eng', description: '', lyrics });
  }

  if (coverUrl) {
    try {
      // 5 秒超时保护，防止封面图片 CDN 波动卡死整个 MP3 生成流程
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      const coverResponse = await fetch(coverUrl, {
        mode: 'cors',
        credentials: 'omit',
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (coverResponse.ok) {
        writer.setFrame('APIC', {
          type: 3,
          data: new Uint8Array(await coverResponse.arrayBuffer()),
          description: '',
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError' && signal?.aborted) throw e;
      // 封面是可选的，网络超时或跨域错误不影响文本标签写入
    }
  }

  writer.addTag();
  const output = writer.getBlob();
  return output && typeof output.arrayBuffer === 'function'
    ? output
    : new Blob([output], { type: 'audio/mpeg' });
}
