import { Capacitor } from '@capacitor/core';
import packageJson from '../../package.json';
import { SunoUpdateNative } from '../../plugins/suno-update-native/src/plugin';

export const APP_VERSION = packageJson.version;

const DEFAULT_UPDATE_API = 'https://api.github.com/repos/t59688/suno-downloader-app/releases/latest';
const UPDATE_API = (import.meta.env.VITE_UPDATE_API_URL as string | undefined)?.trim() || DEFAULT_UPDATE_API;

interface ReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  content_type?: unknown;
}

interface ReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
  draft?: unknown;
}

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  tagName: string;
  title: string;
  notes: string;
  publishedAt: string;
  releaseUrl: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
  isNewer: boolean;
}

type ParsedVersion = { numbers: [number, number, number]; prerelease: string[] };

function parseVersion(raw: string): ParsedVersion | null {
  const value = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] == null) return -1;
    if (b[i] == null) return 1;
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    if (aNum && bNum) {
      const diff = Number(a[i]) - Number(b[i]);
      if (diff) return diff > 0 ? 1 : -1;
      continue;
    }
    if (aNum !== bNum) return aNum ? -1 : 1;
    const diff = a[i].localeCompare(b[i]);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error('版本号格式无效');
  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function checkLatestUpdate(signal?: AbortSignal): Promise<UpdateInfo> {
  const response = await fetch(UPDATE_API, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('暂时无法访问更新源');
    throw new Error(`检查更新失败 (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as ReleasePayload;
  if (payload.draft === true) throw new Error('更新源返回了草稿版本');
  const tagName = stringValue(payload.tag_name).trim();
  const version = tagName.replace(/^v/i, '');
  if (!parseVersion(version)) throw new Error('更新源版本号格式无效');

  const assets = Array.isArray(payload.assets) ? (payload.assets as ReleaseAsset[]) : [];
  const apk = assets
    .filter((asset) => stringValue(asset.name).toLowerCase().endsWith('.apk'))
    .sort((a, b) => {
      const aName = stringValue(a.name).toLowerCase();
      const bName = stringValue(b.name).toLowerCase();
      const aScore = aName.includes(version.toLowerCase()) ? 1 : 0;
      const bScore = bName.includes(version.toLowerCase()) ? 1 : 0;
      return bScore - aScore;
    })[0];

  return {
    currentVersion: APP_VERSION,
    version,
    tagName,
    title: stringValue(payload.name) || tagName,
    notes: stringValue(payload.body).trim(),
    publishedAt: stringValue(payload.published_at),
    releaseUrl: stringValue(payload.html_url),
    apkUrl: stringValue(apk?.browser_download_url),
    apkName: stringValue(apk?.name) || `suno-downloader-${tagName}.apk`,
    apkSize: numberValue(apk?.size),
    isNewer: compareVersions(version, APP_VERSION) > 0,
  };
}

export async function downloadUpdate(info: UpdateInfo): Promise<void> {
  if (!info.apkUrl) throw new Error('新版本安装包仍在生成，请稍后再试');
  if (Capacitor.isNativePlatform()) {
    await SunoUpdateNative.downloadUpdate({ url: info.apkUrl, fileName: info.apkName });
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = info.apkUrl;
  anchor.download = info.apkName;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
