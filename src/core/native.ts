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

/** Blob → base64（分块，避免大文件栈溢出） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 保存文件到系统媒体库（文件管理器可见）：
 * 音频→Music、图片→Pictures、视频→Movies、其他→Documents
 */
export async function nativeSave(
  blob: Blob,
  fileName: string,
  mime: string,
): Promise<{ uri: string; path: string }> {
  const data = await blobToBase64(blob);
  return SunoNative.saveFile({ fileName, data, mime });
}