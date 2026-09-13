/**
 * 网络请求路由层：
 *  - App 内（Capacitor 原生平台）→ 走原生插件（OkHttp），
 *    因为 proxy 接口拒绝任意 Origin、rights 接口只认 usesuno.com 的 Origin，
 *    而浏览器/WebView 的 fetch 无法控制 Origin 头。
 *  - 桌面浏览器调试 → 走 vite.config.ts 里的 /dev-proxy 中间件。
 */
import { Capacitor } from '@capacitor/core';
import { SunoNative as SunoNativeInstance } from '../../plugins/suno-native/src/plugin';
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
