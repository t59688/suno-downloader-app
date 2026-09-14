import { registerPlugin } from '@capacitor/core';

export interface NativeHttpResponse {
  status: number;
  body: string;
}

export interface SunoAuthNativePlugin {
  /**
   * 获取同步歌词。Android 端会自动复用 App 内 Suno 会话；若未登录或会话失效，
   * 会打开内置 Suno 登录页，登录成功后自动关闭并继续原请求。
   * 会话凭据始终停留在 Android WebView/Cookie 容器，不返回给 JavaScript。
   */
  alignedLyrics(options: { contentId: string }): Promise<NativeHttpResponse>;
  /** 取消正在进行的登录/同步歌词请求。 */
  cancelAuth(): Promise<void>;
}

export const SunoAuthNative = registerPlugin<SunoAuthNativePlugin>('SunoAuthNative');
