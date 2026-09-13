/**
 * Suno RSC (React Server Components) flight 数据解析器
 * 移植自 usesuno.com/tools/shared/suno-parser.js
 *
 * 原理：suno.com 是 Next.js App Router 站点，页面 HTML 里嵌入了
 * self.__next_f.push([1,"..."]) 的 flight 序列化数据，其中包含
 * 完整的歌曲对象（标题/封面/音频/视频/标签/歌词等）。
 */
import type { ClipInfo, FetchPage, PlaylistInfo } from './types';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SHORT_RE = /suno\.com\/s\/([A-Za-z0-9_-]+)/i;
const HOOK_RE = /suno\.com\/hook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const HOOK_API = 'https://studio-api-prod.suno.com/api/video/hooks/';
export const DEFAULT_PROXY = 'https://sunoapi.aibiei.com/proxy?url=';

/** 从用户粘贴的内容中提取 ID：h:<uuid> / <uuid> / s:<短码> */
export function extractId(raw: string): string {
  const str = String(raw || '').trim();
  const h = str.match(HOOK_RE);
  if (h) return 'h:' + h[1].toLowerCase();
  const m = str.match(UUID_RE);
  if (m) return m[0].toLowerCase();
  const s = str.match(SHORT_RE);
  if (s) return 's:' + s[1];
  return '';
}

/** 按出现顺序拼接所有 self.__next_f.push([1,"..."]) 字符串字面量 */
function collectPayload(html: string): string {
  const re = /self\.__next_f\.push\(\[\s*1\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\)/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse('"' + m[1] + '"');
    } catch {
      out += m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return out;
}

/** 从字符下标 start 起读取 byteLen 个 UTF-8 字节 */
function readNBytes(s: string, start: number, byteLen: number): { text: string; nextCharIdx: number } {
  let got = 0;
  let i = start;
  while (i < s.length && got < byteLen) {
    const code = s.charCodeAt(i);
    let step = 1;
    let bytes: number;
    if (code < 0x80) bytes = 1;
    else if (code < 0x800) bytes = 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes = 4;
      step = 2;
    } else bytes = 3;
    got += bytes;
    i += step;
  }
  return { text: s.substring(start, i), nextCharIdx: i };
}

/** 从 start 起读取一个 JSON 值（对象/数组/字符串/标量），返回原始文本 */
function readJsonValue(s: string, start: number): { raw: string; end: number } | null {
  let i = start;
  while (i < s.length && /\s/.test(s.charAt(i))) i++;
  if (i >= s.length) return null;
  const c = s.charAt(i);

  if (c === '"') {
    let j = i + 1;
    while (j < s.length) {
      const ch = s.charAt(j);
      if (ch === '\\') { j += 2; continue; }
      if (ch === '"') { j++; break; }
      j++;
    }
    return { raw: s.substring(i, j), end: j };
  }

  if (c === '{' || c === '[') {
    const stack = [c];
    let k = i + 1;
    while (k < s.length && stack.length) {
      const cc = s.charAt(k);
      if (cc === '"') {
        while (k < s.length) {
          if (s.charAt(k) === '\\') { k += 2; continue; }
          if (s.charAt(k) === '"') { k++; break; }
          k++;
        }
        continue;
      }
      if (cc === '{' || cc === '[') stack.push(cc);
      else if (cc === '}' || cc === ']') stack.pop();
      k++;
    }
    return { raw: s.substring(i, k), end: k };
  }

  const scalar = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.substring(i));
  if (scalar) return { raw: scalar[0], end: i + scalar[0].length };
  return null;
}
interface FlightEntry { type?: string; value: unknown }

/** 解析 flight payload 为 id → entry 的映射 */
function parseFlight(payload: string): Map<string, FlightEntry> {
  const map = new Map<string, FlightEntry>();
  let i = 0;
  const n = payload.length;
  while (i < n) {
    let j = i;
    while (j < n && /[0-9a-f]/i.test(payload.charAt(j))) j++;
    if (j === i || payload.charAt(j) !== ':') { i = j + 1; continue; }
    const id = payload.substring(i, j).toLowerCase();
    const k = j + 1;
    const typeCh = payload.charAt(k);

    if (typeCh === 'T') {
      const hexStart = k + 1;
      let m = hexStart;
      while (m < n && /[0-9a-f]/i.test(payload.charAt(m))) m++;
      if (payload.charAt(m) !== ',') { i = m + 1; continue; }
      const byteLen = parseInt(payload.substring(hexStart, m), 16);
      const got = readNBytes(payload, m + 1, byteLen);
      map.set(id, { type: 'T', value: got.text });
      i = got.nextCharIdx;
      if (payload.charAt(i) === '\n') i++;
      continue;
    }

    if (typeCh === 'I' || typeCh === 'H' || typeCh === 'M' || typeCh === 'J' || typeCh === 'L') {
      const v = readJsonValue(payload, k + 1);
      if (v) {
        let parsed: unknown;
        try { parsed = JSON.parse(v.raw); } catch { parsed = v.raw; }
        map.set(id, { type: typeCh, value: parsed });
        i = v.end;
        if (payload.charAt(i) === '\n') i++;
        continue;
      }
      i = k + 2;
      continue;
    }

    const v2 = readJsonValue(payload, k);
    if (v2) {
      let parsed2: unknown;
      try { parsed2 = JSON.parse(v2.raw); } catch { parsed2 = v2.raw; }
      map.set(id, { value: parsed2 });
      i = v2.end;
      if (payload.charAt(i) === '\n') i++;
      continue;
    }
    i = k + 1;
  }
  return map;
}

/** 解析 $L<id> / $S<id> / $H<id> 引用，递归展开 */
function deref(node: unknown, map: Map<string, FlightEntry>, seen: Set<string>, depth: number): unknown {
  if (depth > 40) return node;
  if (node == null) return node;
  if (typeof node === 'string') {
    const m = /^\$[LSH]?([0-9a-f]+)$/i.exec(node);
    if (!m) return node;
    const key = m[1].toLowerCase();
    if (seen.has(key)) return node;
    const entry = map.get(key);
    if (!entry) return node;
    seen.add(key);
    const out = deref(entry.value, map, seen, depth + 1);
    seen.delete(key);
    return out;
  }
  if (Array.isArray(node)) {
    return node.map((x) => deref(x, map, seen, depth + 1));
  }
  if (typeof node === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(node)) {
      o[k] = deref((node as Record<string, unknown>)[k], map, seen, depth + 1);
    }
    return o;
  }
  return node;
}

function findClip(val: unknown, targetId?: string): ClipInfo | null {
  if (!val || typeof val !== 'object') return null;
  if (Array.isArray(val)) {
    for (const x of val) {
      const r = findClip(x, targetId);
      if (r) return r;
    }
    return null;
  }
  const v = val as Record<string, unknown>;
  if (v.clip && typeof v.clip === 'object' && (v.clip as Record<string, unknown>).id) {
    const c = v.clip as ClipInfo;
    if (!targetId || String(c.id).toLowerCase() === targetId.toLowerCase()) {
      return c;
    }
  }
  for (const k of Object.keys(v)) {
    const r = findClip(v[k], targetId);
    if (r) return r;
  }
  return null;
}

function fallbackFromHtml(html: string, id: string): ClipInfo {
  let title = '';
  let handle = '';
  const mt = html.match(/<title>([^<]*)<\/title>/i);
  if (mt) {
    const t = mt[1];
    const h = t.match(/^(.*) by @([^\s|]+)\s*\|\s*Suno$/);
    if (h) {
      title = h[1].trim();
      handle = h[2].trim();
    } else {
      title = t.replace(/\|\s*Suno\s*$/, '').trim();
    }
  }
  return {
    id,
    title: title || id,
    handle,
    display_name: handle,
    image_url: 'https://cdn2.suno.ai/image_' + id + '.jpeg',
    audio_url: 'https://cdn1.suno.ai/' + id + '.mp3',
    video_url: '',
    metadata: { tags: '', prompt: '', duration: null },
    _fallback: true,
  };
}

/** 解析单歌曲页面 HTML，返回 clip 对象 */
export function parseHtml(html: string, id: string): ClipInfo {
  if (!html) return fallbackFromHtml('', id);
  const payload = collectPayload(html);
  if (!payload) return fallbackFromHtml(html, id);
  const map = parseFlight(payload);
  const resolved: Record<string, unknown> = {};
  map.forEach((entry, k) => {
    resolved[k] = deref(entry.value, map, new Set(), 0);
  });
  let clip: ClipInfo | null = null;
  // 优先匹配与请求 id 一致的歌曲（避免误解析到推荐列表或页面侧边栏的其它歌曲）
  for (const k of Object.keys(resolved)) {
    clip = findClip(resolved[k], id);
    if (clip) break;
  }
  // 未匹配到时回退到页面中第一个有效歌曲对象
  if (!clip) {
    for (const k of Object.keys(resolved)) {
      clip = findClip(resolved[k]);
      if (clip) break;
    }
  }
  if (!clip) return fallbackFromHtml(html, id);
  clip.id = clip.id || id;
  if (!clip.audio_url) clip.audio_url = 'https://cdn1.suno.ai/' + clip.id + '.mp3';
  if (!clip.image_url) clip.image_url = 'https://cdn2.suno.ai/image_' + clip.id + '.jpeg';
  return clip;
}

function normalizeHook(data: unknown, hookId: string): ClipInfo | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  const clip: Record<string, any> = d.clip && typeof d.clip === 'object' ? d.clip : {};
  const originalId: string = clip.id || d.original_clip_id || '';
  const videoUrl: string = typeof d.rendered_video_url === 'string' ? d.rendered_video_url : '';
  if (!originalId || !videoUrl || !/^https:\/\//i.test(videoUrl)) return null;

  const normalized: Record<string, any> = { ...clip };
  normalized.id = originalId;
  normalized.title = clip.title || d.title || 'Suno hook';
  normalized.audio_url = clip.audio_url || 'https://cdn1.suno.ai/' + originalId + '.mp3';
  normalized.video_url = videoUrl;
  normalized.image_url = d.thumbnail_image_url || clip.image_url || 'https://cdn2.suno.ai/image_' + originalId + '.jpeg';
  normalized.hook_id = d.id || hookId;
  normalized.hook_duration = d.video_duration != null ? Number(d.video_duration) : null;
  normalized.hook_caption = typeof d.caption === 'string' ? d.caption : '';
  normalized._hook = true;
  return normalized as ClipInfo;
}

async function fetchHookById(hookId: string, fetchPage: FetchPage, signal?: AbortSignal): Promise<ClipInfo | null> {
  try {
    const text = await fetchPage(HOOK_API + hookId, signal);
    const data = JSON.parse(text);
    return normalizeHook(data, hookId);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return null;
  }
}

/**
 * 根据 extractId 的结果加载歌曲信息
 * id 形式: h:<uuid> | <uuid> | s:<短码>
 */
export async function fetchAndParse(id: string, fetchPage: FetchPage, signal?: AbortSignal): Promise<ClipInfo> {
  const isHook = id.indexOf('h:') === 0;
  const isShort = id.startsWith('s:');

  if (isHook) {
    const directHook = await fetchHookById(id.slice(2), fetchPage, signal);
    if (!directHook) throw new Error('无法加载公开 Hook 详情');
    return directHook;
  }

  const target = isShort ? 'https://suno.com/s/' + id.slice(2) : 'https://suno.com/song/' + id;
  const html = await fetchPage(target, signal);
  if (!html || html.length < 400) throw new Error('代理返回为空');

  let realId = id;
  if (isShort) {
    const hookMatch = html.match(HOOK_RE);
    realId = (hookMatch ? hookMatch[1] : (html.match(UUID_RE) || [''])[0]).toLowerCase();
    if (!realId) throw new Error('无法将短链接解析为歌曲 ID');
    if (hookMatch) {
      const shortHook = await fetchHookById(realId, fetchPage, signal);
      if (shortHook) return shortHook;
    }
  }
  return parseHtml(html, realId);
}

// ===== 歌单解析 (suno.com/playlist/<uuid>) =====

function findAllClips(val: unknown, collected: ClipInfo[], seen: Set<string>): void {
  if (!val || typeof val !== 'object') return;
  if (Array.isArray(val)) {
    for (const x of val) findAllClips(x, collected, seen);
    return;
  }
  const v = val as Record<string, unknown>;
  if (v.clip && typeof v.clip === 'object' && (v.clip as Record<string, unknown>).id) {
    const c = v.clip as ClipInfo;
    if (!seen.has(c.id)) { seen.add(c.id); collected.push(c); }
  }
  for (const k of Object.keys(v)) findAllClips(v[k], collected, seen);
}

function findPlaylistImage(resolved: Record<string, unknown>): string {
  let best = '';
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const vv = v as Record<string, any>;
    const img: string = vv.image_url || vv.imageUrl || '';
    if (typeof img !== 'string' || !/cdn[12]\.suno\.ai/i.test(img)) continue;
    let count = 0;
    for (const kk of Object.keys(vv)) {
      const c = vv[kk];
      if (c && typeof c === 'object' && c.clip && c.clip.id) count++;
    }
    if (count >= 2 || (Array.isArray(vv.clips) && vv.clips.length >= 2)) { best = img; break; }
  }
  return best;
}

function findPlaylistName(resolved: Record<string, unknown>, html: string): string {
  let name = '';
  const mt = html.match(/<title>([^<]*)<\/title>/i);
  if (mt) name = mt[1].replace(/\s*\|\s*Suno\s*$/i, '').trim();
  if (name) return name;
  for (const k of Object.keys(resolved)) {
    const v = resolved[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const vv = v as Record<string, any>;
    if (typeof vv.name === 'string' && vv.name) {
      let count = 0;
      for (const kk of Object.keys(vv)) {
        const c = vv[kk];
        if (c && typeof c === 'object' && c.clip && c.clip.id) count++;
      }
      if (count >= 2 || Array.isArray(vv.clips)) return vv.name;
    }
    if (typeof vv.title === 'string' && vv.title) {
      let c2 = 0;
      for (const kk of Object.keys(vv)) {
        const c = vv[kk];
        if (c && typeof c === 'object' && c.clip && c.clip.id) c2++;
      }
      if (c2 >= 2 || Array.isArray(vv.clips)) return vv.title;
    }
  }
  return name;
}

export function parsePlaylistHtml(html: string, id: string): PlaylistInfo {
  const payload = collectPayload(html);
  const resolved: Record<string, unknown> = {};
  if (payload) {
    const map = parseFlight(payload);
    map.forEach((entry, k) => {
      resolved[k] = deref(entry.value, map, new Set(), 0);
    });
  }
  const clips: ClipInfo[] = [];
  findAllClips(resolved, clips, new Set());
  clips.forEach((c) => {
    c.id = c.id || '';
    if (!c.audio_url) c.audio_url = 'https://cdn1.suno.ai/' + c.id + '.mp3';
    if (!c.image_url) c.image_url = 'https://cdn2.suno.ai/image_' + c.id + '.jpeg';
  });
  const name = findPlaylistName(resolved, html) || ('Playlist ' + String(id).substring(0, 8));
  const image = findPlaylistImage(resolved);
  return { clips, name, image };
}

export async function fetchAndParsePlaylist(id: string, fetchPage: FetchPage, signal?: AbortSignal): Promise<PlaylistInfo> {
  const target = 'https://suno.com/playlist/' + id;
  const html = await fetchPage(target, signal);
  if (!html || html.length < 400) throw new Error('代理返回为空');
  return parsePlaylistHtml(html, id);
}

