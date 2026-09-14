import { registerPlugin } from '@capacitor/core';

export interface SunoUpdateNativePlugin {
  downloadUpdate(options: { url: string; fileName: string }): Promise<{ downloadId: number }>;
}

export const SunoUpdateNative = registerPlugin<SunoUpdateNativePlugin>('SunoUpdateNative');
