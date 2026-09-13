import { registerPlugin } from '@capacitor/core';

export interface NativeHttpResponse {
  status: number;
  body: string;
}

export interface SunoNativePlugin {
  /** GET 任意 URL（用于 aibiei 代理抓 suno.com 页面） */
  pageGet(options: { url: string }): Promise<NativeHttpResponse>;
  /** POST rights 接口（原生自动携带 Origin: https://usesuno.com） */
  rightsPost(options: { body: string }): Promise<NativeHttpResponse>;
  /** 显示下载开始通知（不确定进度） */
  notifyStart(options: { title: string; subtitle?: string }): Promise<void>;
  /** 更新通知进度（0-99） */
  notifyProgress(options: { percent: number }): Promise<void>;
  /** 下载完成通知 */
  notifyComplete(options: { text: string }): Promise<void>;
  /** 下载失败通知 */
  notifyFail(options: { message: string }): Promise<void>;
  /** 取消通知 */
  notifyCancel(): Promise<void>;
  /** 保存 base64 文件到系统媒体库（Music/Pictures/Movies/Documents） */
  saveFile(options: {
    fileName: string;
    data: string;
    mime?: string;
  }): Promise<{ uri: string; path: string }>;
  /** 流式保存开始：创建文件并返回 sessionId */
  saveStreamStart(options: {
    fileName: string;
    mime?: string;
  }): Promise<{ sessionId: string }>;
  /** 流式保存写入分块数据（Base64） */
  saveStreamChunk(options: {
    sessionId: string;
    chunk: string;
  }): Promise<{ success: boolean }>;
  /** 流式保存结束并刷新索引 */
  saveStreamFinish(options: {
    sessionId: string;
  }): Promise<{ uri: string; path: string }>;
  /** 流式保存中断/取消 */
  saveStreamAbort(options: {
    sessionId: string;
  }): Promise<void>;
  /** 读取系统剪贴板文本内容 */
  getClipboard(): Promise<{ text: string }>;
}

/**
 * 原生 HTTP 插件（Android: OkHttp）
 *
 * 为什么需要它：
 *  1) sunoapi.aibiei.com/proxy 检测到非白名单 Origin 会返回 403，
 *     而不带 Origin 头就正常 → 原生请求默认不带 Origin，正合适；
 *  2) yellow-salad.aibiei.com/rights 只允许 Origin: https://usesuno.com，
 *     浏览器规范禁止 JS 设置 Origin 头 → 必须原生代发并伪装该头。
 */
export const SunoNative = registerPlugin<SunoNativePlugin>('SunoNative');

