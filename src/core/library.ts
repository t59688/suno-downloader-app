/**
 * 本地歌曲库：只收录"本应用自己解析/下载"的音频。
 * 不扫描任何其他目录的音乐——列表完全来自本应用写入 IndexedDB 的记录。
 */
import { idbAll, idbPut, idbDel } from './storage';

const STORE_NAME = 'tracks';

export interface TrackMeta {
  id: string; // 唯一 id（clipId + 格式 + 时间戳后缀）
  clipId: string;
  title: string;
  artist: string;
  cover?: string;
  fileName: string;
  mimeType: string;
  size: number;
  addedAt: number;
}

export type TrackStore = TrackMeta & { blob: Blob };

/** 生成歌曲唯一 id（同一首歌不同格式视为不同条目） */
export function makeTrackId(clipId: string, format: string): string {
  return (clipId + '_' + format + '_' + Date.now()).slice(0, 120);
}

/* ---------- 列表 ---------- */

export async function listTracks(): Promise<TrackMeta[]> {
  const all = await idbAll<TrackStore>(STORE_NAME);
  return all
    .map(({ blob, ...meta }) => meta)
    .sort((a, b) => b.addedAt - a.addedAt);
}

/* ---------- 增 ---------- */

export async function addTrack(params: {
  clipId: string;
  title: string;
  artist: string;
  cover?: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  format: string;
}): Promise<TrackMeta> {
  const meta: TrackMeta = {
    id: makeTrackId(params.clipId, params.format),
    clipId: params.clipId,
    title: params.title,
    artist: params.artist,
    cover: params.cover,
    fileName: params.fileName,
    mimeType: params.mimeType,
    size: params.blob.size,
    addedAt: Date.now(),
  };
  await idbPut(STORE_NAME, { ...meta, blob: params.blob } satisfies TrackStore);
  return meta;
}

/* ---------- 读取 blob（播放用） ---------- */

export async function getTrackBlob(id: string): Promise<Blob | null> {
  const all = await idbAll<TrackStore>(STORE_NAME);
  return all.find((x) => x.id === id)?.blob ?? null;
}

/* ---------- 删 ---------- */

export async function removeTrack(id: string): Promise<TrackMeta[]> {
  await idbDel(STORE_NAME, id);
  return listTracks();
}
