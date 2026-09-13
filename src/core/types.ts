export interface ClipMetadata {
  tags?: string;
  prompt?: string;
  duration?: number | string | null;
  lyrics?: string;
  [k: string]: unknown;
}

export interface ClipInfo {
  id: string;
  title: string;
  handle?: string;
  display_name?: string;
  image_url?: string;
  audio_url?: string;
  video_url?: string;
  metadata?: ClipMetadata;
  _hook?: boolean;
  _fallback?: boolean;
  hook_id?: string;
  hook_duration?: number | null;
  hook_caption?: string;
  [k: string]: unknown;
}

export interface PlaylistInfo {
  clips: ClipInfo[];
  name: string;
  image: string;
}

/** Suno rights 服务返回的密钥材料（base64url 编码） */
export interface Rights {
  key: string;
  iv: string;
  glt: string;
}

/** 抓取页面 HTML 的抽象（App 内走原生插件，桌面调试走 Vite 代理） */
export type FetchPage = (targetUrl: string, signal?: AbortSignal) => Promise<string>;
