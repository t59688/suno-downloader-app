/**
 * 解析记录：只记录"本应用自己解析过"的歌曲（localStorage 持久化）
 * 提供 CRUD：新增/更新（按 clip id 去重）、查询、编辑、删除
 */
import type { ClipInfo } from './types';

const KEY = 'suno.parse.records.v1';

export interface ParseRecord {
  id: string; // clip id
  title: string;
  artist: string;
  cover?: string;
  duration?: string; // 秒数（字符串化）
  tags?: string;
  clip: ClipInfo; // 原始解析数据，供再次下载
  createdAt: number;
  updatedAt: number;
}

export function loadRecords(): ParseRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ParseRecord[]) : [];
  } catch {
    return [];
  }
}

function save(records: ParseRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(records));
}

/** 解析成功后写入：同 id 更新，否则置顶插入 */
export function upsertRecord(clip: ClipInfo): ParseRecord[] {
  const records = loadRecords();
  const now = Date.now();
  const rec: ParseRecord = {
    id: clip.id,
    title: clip.title || clip.id,
    artist: clip.display_name || clip.handle || 'Suno',
    cover: clip.image_url,
    duration: clip.metadata?.duration != null ? String(clip.metadata.duration) : undefined,
    tags: clip.metadata?.tags ? String(clip.metadata.tags) : undefined,
    clip,
    createdAt: now,
    updatedAt: now,
  };
  const i = records.findIndex((r) => r.id === clip.id);
  if (i >= 0) {
    rec.createdAt = records[i].createdAt;
    records[i] = rec;
  } else {
    records.unshift(rec);
  }
  save(records);
  return records;
}

/** 编辑（标题/艺术家/备注） */
export function updateRecord(id: string, patch: Partial<Pick<ParseRecord, 'title' | 'artist' | 'tags'>>): ParseRecord[] {
  const records = loadRecords();
  const i = records.findIndex((r) => r.id === id);
  if (i < 0) return records;
  records[i] = { ...records[i], ...patch, updatedAt: Date.now() };
  save(records);
  return records;
}

export function deleteRecord(id: string): ParseRecord[] {
  const records = loadRecords().filter((r) => r.id !== id);
  save(records);
  return records;
}

export function clearRecords(): ParseRecord[] {
  save([]);
  return [];
}
