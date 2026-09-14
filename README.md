# Suno 下载器（Capacitor + React + 原生插件）

粘贴 Suno 歌曲 / Hook / 歌单链接 → 下载 **MP3 (320k, 含 ID3 标签) / WAV / 原始音频 / MP4 视频 / 封面图 / TXT 歌词 / 标准 LRC**。

公开资源仍保持免登录。Android App 的 **精准 LRC** 不要求用户复制 Cookie、Token 或 Bearer：第一次点击 LRC 时，如果 App 内还没有有效 Suno 会话，会自动打开 Suno 登录页；登录成功后自动关闭并继续下载。之后只要会话仍有效，点击 LRC 就直接生成文件。

## 精准 LRC：一键体验

用户侧流程只有：

```text
粘贴 Suno 链接
  ↓
解析歌曲
  ↓
点「LRC」
  ├─ 已有有效 Suno 会话 → 直接下载
  └─ 首次/会话失效 → 自动打开 Suno 登录页
                         ↓
                       正常登录
                         ↓
                     自动关闭登录页
                         ↓
                     自动继续下载 LRC
```

**不需要：**

- 打开开发者工具
- 查 Cookie
- 查 `__session`
- 复制 Bearer Token
- 把凭据粘贴进 App

Android 的应用沙箱不能也不应该偷读 Chrome 的登录 Cookie，因此第一次使用精准 LRC 时，如果 App 自己还没有 Suno 会话，仍需在自动弹出的 Suno 页面完成一次正常登录。这个登录会话由 Android WebView Cookie 容器持有；React/JavaScript 不读取、不展示、不持久化 Token。

标准 LRC 不使用“按时长均分歌词”的伪时间轴，而是读取 Suno Web 当前使用的：

```text
GET /api/gen/<song-id>/aligned_lyrics/v2/
```

使用 `aligned_lyrics[].start_s` 与 `text` 生成标准逐行格式：

```text
[ti:歌曲名]
[ar:作者]
[by:Suno Downloader]

[00:12.35]第一句歌词
[00:16.82]第二句歌词
```

`aligned_lyrics/v2` 属于 Suno Web 内部接口，不是承诺长期稳定的公共 API；若 Suno 调整鉴权或响应结构，需要相应适配。

## 安全边界

精准 LRC 的会话凭据只存在于 Android 原生层：

```text
React / WebView UI
  │  只传 song UUID
  ▼
SunoAuthNativePlugin
  │
  ├─ Android CookieManager 保存 Suno 登录会话
  ├─ 必要时打开 suno.com 登录页
  └─ 原生层直连固定 Suno API 域名
        ↓
https://studio-api.prod.suno.com/api/gen/<uuid>/aligned_lyrics/v2/
        ↓
只把歌词 JSON 返回 React
```

因此：

- Token 不进入 React state
- Token 不进入 `localStorage` / IndexedDB / 下载历史
- Token 不写日志
- Token 不发送给 aibiei
- JavaScript 不获得 Token
- 原生请求目标固定为 Suno API，不提供任意 URL 转发

## 工作原理

```text
粘贴链接
  │  extractId: 歌曲 UUID / s:短码 / hook UUID / 歌单
  ▼
抓 suno.com 页面 ──────────────── 原生插件 OkHttp（不带 Origin）
  │  GET https://sunoapi.aibiei.com/proxy?url=...
  │  解析页面内嵌的 Next.js RSC flight 数据 → 标题/封面/标签/TXT歌词
  ▼
申请解密密钥 ──────────────────── 原生插件 OkHttp（Origin: https://usesuno.com）
  │  POST https://yellow-salad.aibiei.com/rights
  │  → { key, iv, glt }
  ▼
下载加密音频
  ▼
App 内解密（@noble/ciphers）
  │  userKey    = SHA-256(glt)
  │  contentKey = AES-GCM 解包(key), AAD = uuid
  │  contentIv  = AES-GCM 解包(iv),  AAD = uuid
  │  音频       = AES-CTR 流式解密
  ▼
转码 / 打标签
     MP3: AudioContext → lamejs 320kbps → browser-id3-writer
     WAV: PCM16
     原始: 按魔数识别 webm/m4a/mp3
```

精准 LRC 是独立链路，不经过 aibiei：

```text
Android App 内 Suno 会话
  ↓
aligned_lyrics/v2
  ↓
aligned_lyrics[].start_s + text
  ↓
标准 [mm:ss.xx] LRC
```

## 原生登录桥如何接入

仓库的根 `android/` 是 Capacitor 生成工程并被 `.gitignore` 排除。因此精准 LRC 的 Android 原生源码保存在：

```text
native/suno-auth/SunoAuthNativePlugin.java
```

每次：

```bash
npm run cap:sync
```

都会先执行正常 `cap sync android`，再由：

```text
scripts/install_suno_auth_native.mjs
```

把原生桥复制到生成的 Android app module，并以 Capacitor 官方自定义插件方式在 `MainActivity` 中注册。安装脚本是幂等的：重复执行不会重复插入 import 或 `registerPlugin(...)`。

这样不需要新增 npm 原生依赖，也不会产生无关 lockfile 变更。

## 目录结构

```text
suno-downloader-app/
├─ src/
│  ├─ core/
│  │  ├─ sunoParser.ts
│  │  ├─ decrypt.ts
│  │  ├─ http.ts          # 页面/rights + 一键 LRC 原生桥调用
│  │  ├─ lrc.ts           # aligned_lyrics → 标准逐行 LRC
│  │  ├─ transcode.ts
│  │  ├─ id3.ts
│  │  ├─ download.ts
│  │  └─ types.ts
│  ├─ components/
│  │  └─ ParseTab.tsx
│  ├─ App.tsx
│  └─ main.tsx
├─ plugins/
│  ├─ suno-native/        # 既有 Capacitor JS 桥定义
│  └─ suno-auth-native/
│     └─ src/             # 一键 Suno 登录 JS 桥定义
├─ native/
│  └─ suno-auth/
│     └─ SunoAuthNativePlugin.java
├─ scripts/
│  ├─ install_suno_auth_native.mjs
│  ├─ build_apk.mjs
│  ├─ run_app.mjs
│  ├─ test_lrc.mjs
│  └─ validate.mjs
└─ android/               # Capacitor 生成工程，不入 Git
```

## 编译与运行

| 使用场景 | 命令 | 说明 |
|---|---|---|
| 一键编译并安装运行 | `npm run android` | Web 构建 → Capacitor 同步 → 安装原生登录桥 → Gradle → adb 安装启动 |
| 只构建 APK | `npm run build:apk` | 同上，但不执行 adb 安装 |
| 同步 Android | `npm run cap:sync` | `cap sync android` 后自动安装/注册原生登录桥 |
| LRC 纯逻辑测试 | `npm run test:lrc` | 时间戳、排序、标签清理、异常输入 |
| 原有端到端音频测试 | `npm test` | 页面解析 → rights → 解密 → MP3/WAV 校验 |
| 桌面浏览器调试 | `npm run dev` | 公开资源可调试；精准 LRC 一键登录只在 Android App 开启 |

## 精准 LRC 行为约束

- LRC 按钮在 Android App 中始终可点击，不出现 Token 输入框。
- 首次使用或会话过期时自动弹登录。
- 登录成功后自动继续原来的 LRC 请求，无需再点第二次。
- 取消登录会取消当前 LRC 请求。
- 同一时刻只允许一个登录/LRC 原生请求，避免重复弹窗和竞态。
- 登录页面最长等待 3 分钟，超时明确失败。
- ZIP 在 Android 中也会包含 LRC，并把 LRC 放在前面处理，以便首次登录立即发生，而不是等 MP3/WAV 转码结束后才弹登录。
- 若 Suno 尚未生成同步歌词，会有限次数重试，不会伪造时间轴。

## 风险与注意

1. `aligned_lyrics/v2` 是 Suno Web 内部接口，未来可能变化。
2. 某些第三方身份提供商可能限制嵌入式 WebView 登录；普通 Suno 登录页面仍会完整呈现，实际支持情况取决于 Suno 当时的登录策略。
3. 原有音频下载仍依赖 aibiei 的 proxy / rights 服务；精准 LRC 不依赖这两个服务。
4. 仅下载你有权访问和保存的内容。
