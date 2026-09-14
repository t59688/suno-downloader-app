export interface LrcMetadata {
  title?: string;
  artist?: string;
}

interface NormalizedLine {
  start: number;
  text: string;
  order: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeTagValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/\]/g, '）').trim();
}

function cleanLyricText(value: string): string {
  // LRC is line based: collapse any embedded Suno line breaks first.
  const singleLine = value.replace(/[\r\n]+/g, ' ').trim();
  // Suno sometimes keeps arrangement markers in the text. Strip only known
  // section markers so literal bracketed lyrics such as "[Hey]" are preserved.
  const section = '(?:verse|chorus|pre[- ]?chorus|bridge|intro|outro|hook|refrain|interlude|break|instrumental|solo|主歌|副歌|预副歌|前副歌|桥段|前奏|尾奏)';
  const marker = new RegExp(
    '^\\s*(?:\\[(?:' + section + ')[^\\]\\r\\n]*\\]|【(?:' + section + ')[^】\\r\\n]*】)\\s*',
    'i',
  );
  return singleLine.replace(marker, '').trim();
}

export function formatLrcTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const totalCentiseconds = Math.round(safe * 100);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const secondPart = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `[${String(minutes).padStart(2, '0')}:${String(secondPart).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

export function extractAlignedLyricLines(payload: unknown): Array<{ start: number; text: string }> {
  const root = asRecord(payload);
  const rawLines = root?.aligned_lyrics;
  if (!Array.isArray(rawLines)) return [];

  const normalized: NormalizedLine[] = [];
  rawLines.forEach((item, order) => {
    const row = asRecord(item);
    if (!row) return;
    const start = Number(row.start_s);
    const text = cleanLyricText(typeof row.text === 'string' ? row.text : '');
    if (!Number.isFinite(start) || start < 0 || !text) return;
    normalized.push({ start, text, order });
  });

  normalized.sort((a, b) => a.start - b.start || a.order - b.order);
  return normalized.map(({ start, text }) => ({ start, text }));
}

/** Build standard line-timed LRC from Suno aligned_lyrics/v2 data. */
export function buildStandardLrc(payload: unknown, metadata: LrcMetadata = {}): string {
  const lines = extractAlignedLyricLines(payload);
  if (!lines.length) throw new Error('Suno 未返回可用的逐行同步歌词');

  const out: string[] = [];
  const title = sanitizeTagValue(metadata.title || '');
  const artist = sanitizeTagValue(metadata.artist || '');
  if (title) out.push(`[ti:${title}]`);
  if (artist) out.push(`[ar:${artist}]`);
  out.push('[by:Suno Downloader]');
  out.push('[re:Suno aligned_lyrics/v2]');
  out.push('');

  for (const line of lines) {
    out.push(formatLrcTime(line.start) + line.text);
  }
  return out.join('\n') + '\n';
}
