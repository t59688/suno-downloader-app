import { Capacitor } from '@capacitor/core';
import { SunoNative } from '../../plugins/suno-native/src/plugin';

/** 是否原生平台（Android/iOS）——Web 端全部自动降级为 no-op */
export const isNative = Capacitor.isNativePlatform();

function safe(fn: () => Promise<unknown>): Promise<void> {
  if (!isNative) return Promise.resolve();
  return fn().then(() => undefined).catch(() => undefined);
}

/* ---------- 通知栏进度 ---------- */

export const notifyStart = (title: string, subtitle = '') =>
  safe(() => SunoNative.notifyStart({ title, subtitle }));

export const notifyProgress = (percent: number) =>
  safe(() => SunoNative.notifyProgress({ percent }));

export const notifyComplete = (text: string) =>
  safe(() => SunoNative.notifyComplete({ text }));

export const notifyFail = (message: string) => safe(() => SunoNative.notifyFail({ message }));

export const notifyCancel = () => safe(() => SunoNative.notifyCancel());

/* ---------- 保存到本地媒体库 ---------- */

/** Uint8Array → base64（分小块转换避免调用栈溢出） */
export function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Blob → base64 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return uint8ToBase64(new Uint8Array(buf));
}

/**
 * 保存文件到系统媒体库（文件管理器可见）：
 * 音频→Music、图片→Pictures、视频→Movies、其他→Documents
 * 针对大文件采用 512KB 分块流式写入，从根本上杜绝 Android Bridge 单次传递几十兆 Base64 引发的 JVM OutOfMemoryError。
 */
export async function nativeSave(
  blob: Blob,
  fileName: string,
  mime: string,
): Promise<{ uri: string; path: string }> {
  // 小于等于 256KB 的极小文件（如封面图片、歌词文本）直接单次保存
  if (blob.size <= 256 * 1024) {
    const data = await blobToBase64(blob);
    return SunoNative.saveFile({ fileName, data, mime });
  }

  // 大文件采用流式分块写入（每块 512KB）
  const { sessionId } = await SunoNative.saveStreamStart({ fileName, mime });
  try {
    const CHUNK_SIZE = 512 * 1024;
    let offset = 0;
    while (offset < blob.size) {
      const slice = blob.slice(offset, offset + CHUNK_SIZE);
      const buf = await slice.arrayBuffer();
      const chunk = uint8ToBase64(new Uint8Array(buf));
      await SunoNative.saveStreamChunk({ sessionId, chunk });
      offset += CHUNK_SIZE;
    }
    return await SunoNative.saveStreamFinish({ sessionId });
  } catch (err) {
    await SunoNative.saveStreamAbort({ sessionId }).catch(() => {});
    throw err;
  }
}

/* ---------- 原生系统剪贴板读取 ---------- */

/**
 * 获取系统剪贴板内容：
 * 原生平台优先使用 Android 系统底层 ClipboardManager，彻底规避 Android WebView 的权限限制；
 * Web 浏览器降级走 navigator.clipboard。
 */
export async function getClipboardText(): Promise<string> {
  if (isNative) {
    try {
      const res = await SunoNative.getClipboard();
      return (res?.text || '').trim();
    } catch {
      /* 忽略原生异常并降级 */
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return ((await navigator.clipboard.readText()) || '').trim();
    }
  } catch {
    /* 忽略安全沙箱拒绝异常 */
  }
  return '';
}