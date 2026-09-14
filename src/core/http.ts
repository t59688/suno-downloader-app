/**
 * 网络请求路由层：
 *  - App 内（Capacitor 原生平台）→ 页面/rights 走现有原生插件；精准 LRC 走
 *    SunoAuthNative，它会自动复用或刷新 App 内的 Suno 登录会话。
 *  - 桌面浏览器调试 → 页面/rights 走 vite.config.ts 的 /dev-proxy。
 *    精准 LRC 的一键登录仅在 Android App 内提供，避免把会话凭据暴露给网页 JS。
 */
import { Capacitor } from '@capacitor/core';
import { SunoNative as SunoNativeInstance } from '../../plugins/suno-native/src/plugin';
import { SunoAuthNative } from '../../plugins/suno-auth-native/src/plugin';
import { DEFAULT_PROXY } from './sunoParser';
import type { FetchPage, Rights } from './types';

/** 通过 aibiei 代理抓取 suno.com 页面 HTML */
export const fetchPage: FetchPage = async (targetUrl, signal) => {
  if (Capacitor.isNativePlatform()) {
    const res = await SunoNativeInstance.pageGet({ url: DEFAULT_PROXY + encodeURIComponent(targetUrl) });
    if (!res.body || res.body.length < 400) throw new Error('代理返回为空');
    return res.body;
  }
  const r = await fetch('/dev-proxy/page?url=' + encodeURIComponent(targetUrl), { signal });
  if (!r.ok) throw new Error('代理请求失败 (HTTP ' + r.status + ')');
  const text = await r.text();
  if (!text || text.length < 400) throw new Error('代理返回为空');
  return text;
};

/** 向 rights 服务申请音频解密密钥 { key, iv, glt } */
export async function fetchRights(contentId: string, signal?: AbortSignal): Promise<Rights> {
  const body = JSON.stringify({ content_params: { content_id: contentId, content_type: 'clip' } });
  if (Capacitor.isNativePlatform()) {
    const res = await SunoNativeInstance.rightsPost({ body });
    let j: Rights;
    try {
      j = JSON.parse(res.body);
    } catch {
      throw new Error('密钥响应不是合法 JSON');
    }
    if (!j.key || !j.iv || !j.glt) throw new Error('密钥响应缺少 key/iv/glt');
    return j;
  }
  const r = await fetch('/dev-proxy/rights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error('音频鉴权失败 (HTTP ' + r.status + ')' + (text ? ': ' + text.slice(0, 180) : ''));
  }
  let j: Rights;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('密钥响应不是合法 JSON');
  }
  if (!j.key || !j.iv || !j.glt) throw new Error('密钥响应缺少 key/iv/glt');
  return j;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AlignedLyricsOptions {
  signal?: AbortSignal;
  onRetry?: (attempt: number, maxAttempts: number) => void;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasAlignedLyrics(payload: unknown): boolean {
  const root = asRecord(payload);
  return Array.isArray(root?.aligned_lyrics) && root.aligned_lyrics.length > 0;
}

function isProcessing(payload: unknown): boolean {
  const root = asRecord(payload);
  const detail = root?.detail;
  return typeof detail === 'string' && /processing|not ready|pending/i.test(detail);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Android App 是否支持不暴露 Token 的一键精准 LRC。 */
export function supportsOneTapLrc(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * 获取 Suno 原始逐行同步歌词。
 *
 * Android：JS 不接触 Token。原生插件先复用 App 内 Suno 会话；若会话不存在或失效，
 * 自动打开 Suno 登录页，登录成功后自动关闭并继续请求。
 * Web 调试：不提供手工 Token 入口，避免把凭据复制进网页。
 */
export async function fetchAlignedLyrics(
  contentId: string,
  opts: AlignedLyricsOptions = {},
): Promise<unknown> {
  if (!UUID_RE.test(contentId)) throw new Error('歌曲 ID 无效，无法获取同步歌词');
  if (!Capacitor.isNativePlatform()) {
    throw new Error('精准 LRC 的一键登录仅支持 Android App');
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw abortError();

    const onAbort = () => {
      void SunoAuthNative.cancelAuth().catch(() => {});
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    let response: { status: number; body: string };
    try {
      response = await SunoAuthNative.alignedLyrics({ contentId });
    } catch (e) {
      if (opts.signal?.aborted) throw abortError();
      throw e;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }

    if (opts.signal?.aborted) throw abortError();
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = response.body;
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error('Suno 登录状态已失效，请重新登录');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error('同步歌词请求失败 (HTTP ' + response.status + ')');
    }
    if (hasAlignedLyrics(payload)) return payload;
    if (!isProcessing(payload) || attempt === maxAttempts) break;

    opts.onRetry?.(attempt + 1, maxAttempts);
    await wait(1500, opts.signal);
  }

  throw new Error('Suno 暂未返回可用的同步歌词，请稍后重试');
}
