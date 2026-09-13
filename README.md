# Suno 下载器（Capacitor + React + 原生插件）

粘贴 Suno 歌曲 / Hook / 歌单链接 → 下载 **MP3 (320k, 含 ID3 标签) / WAV / 原始音频 / MP4 视频 / 封面图**。
无需登录 Suno，纯本地解密，App 不经过任何自建服务器。

## 工作原理

```
粘贴链接
  │  extractId: 歌曲UUID / s:短码 / hook UUID / 歌单
  ▼
抓 suno.com 页面 ──────────────── 原生插件 OkHttp（不带 Origin）
  │  GET https://sunoapi.aibiei.com/proxy?url=...
  │  解析页面内嵌的 Next.js RSC flight 数据 → 标题/封面/标签/歌词
  ▼
申请解密密钥 ──────────────────── 原生插件 OkHttp（伪装 Origin: https://usesuno.com）
  │  POST https://yellow-salad.aibiei.com/rights
  │  → { key, iv, glt }
  ▼
下载加密音频（JS 直接 fetch，CloudFront 允许任意跨域）
  │  GET https://d2lwuy8qc234o3.cloudfront.net/1/clip/<uuid>.m4a
  ▼
App 内解密（@noble/ciphers 纯 JS）
  │  userKey    = SHA-256(glt)
  │  contentKey = AES-GCM 解包(key),  AAD = uuid
  │  contentIv  = AES-GCM 解包(iv),   AAD = uuid
  │  音频       = AES-CTR 流式解密（可报进度）
  ▼
转码 / 打标签
     MP3: AudioContext 解码 → lamejs 320kbps → browser-id3-writer 写标签
     WAV: PCM16
     原始: 按魔数识别 webm/m4a/mp3
```

## 为什么需要原生代码（仅 Android 端 ~100 行 Java）

浏览器规范**禁止 JS 设置 `Origin` 请求头**，而：

| 接口 | 行为（已实测） |
|---|---|
| `sunoapi.aibiei.com/proxy` | 带外部 Origin → **403**；不带 Origin → 200 |
| `yellow-salad.aibiei.com/rights` | 只放行 `Origin: https://usesuno.com` |

所以这两个请求由 `plugins/suno-native`（OkHttp）发出：
- `pageGet`：不带 Origin
- `rightsPost`：带 `Origin: https://usesuno.com`

桌面浏览器调试时，`vite.config.ts` 内置 `/dev-proxy` 中间件在服务端代发同样请求，
因此 **`npm run dev` 在 Chrome 里也能完整体验整个流程**。

## 目录结构

```
suno-downloader-app/
├─ src/
│  ├─ core/
│  │  ├─ sunoParser.ts    # 链接提取 + RSC flight 解析（歌曲/歌单/hook）
│  │  ├─ decrypt.ts       # AES-GCM 解包 + AES-CTR 流式解密
│  │  ├─ http.ts          # 路由：原生平台→插件 / 浏览器→dev-proxy
│  │  ├─ transcode.ts     # AudioContext → lamejs MP3 / WAV
│  │  ├─ id3.ts           # ID3 标签（标题/艺术家/歌词/封面）
│  │  ├─ download.ts      # 下载流水线
│  │  └─ types.ts
│  ├─ App.tsx             # 单页 UI
│  └─ main.tsx
├─ plugins/suno-native/   # 本地 Capacitor 插件
│  ├─ src/plugin.ts       # registerPlugin('SunoNative')
│  └─ android/            # OkHttp 实现（SunoNativePlugin.java）
├─ scripts/validate.mjs   # 端到端链路验证（Node 直接跑真实歌曲）
├─ android/               # Capacitor Android 工程（已接入 suno-native）
└─ suno_sample.m4a        # 验证脚本产出的真实解密音频
```

## 开发

```bash
npm install

# 1) 桌面浏览器完整体验（含解密，走 vite dev-proxy）
npm run dev

# 2) 端到端链路验证（真实歌曲：解析→密钥→下载→解密→落盘）
npm run validate

# 3) Web 构建 + 同步到 Android
npm run build
npx cap sync android

# 4) 打包 APK（需要 Android SDK + JDK 17/21）
cd android && gradlew.bat assembleDebug
# 产物: android/app/build/outputs/apk/debug/app-debug.apk

# 5) 用 Android Studio 打开 android/ 可调试/出 release 包
npx cap open android
```

## 已验证（2026-09-13）

- ✅ 短链 `suno.com/s/kuuNnXWLBeiaN1wU` 解析：歌曲《Hello!》(Tony)
- ✅ rights 密钥获取（Origin 伪装）
- ✅ 1.05MB 加密音频 → AES-CTR 解密 → 合法 `ftyp` m4a（suno_sample.m4a）
- ✅ `npm run build`（tsc + vite）
- ✅ `gradlew assembleDebug` → app-debug.apk (4.45MB)

## 风险与注意

1. **第三方依赖**：proxy / rights 都是 aibiei.com 的服务，随时可能加鉴权或收费。
   长期方案是自建后端（抓 Suno 官方 rights 接口），App 端解密逻辑不变。
2. **Suno 可能改加密方案**：解密参数集中在 `decrypt.ts`，改动可控。
3. **上架审核**：App Store 3.1.1 对"下载第三方内容"有要求，需声明仅下载公开/自有内容。
4. MP3 转码在 JS 线程执行，长歌曲会占 CPU 30s~2min（与官网实现相同）。
   后续可换成原生 ffmpeg（mobile-ffmpeg / ffmpeg-kit）提升速度。
5. 歌单目前展示第 1 首，可后续扩展为列表批量下载。
