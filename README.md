# Suno 下载器（Capacitor + React + 原生插件）

粘贴 Suno 歌曲 / Hook / 歌单链接，可下载 **MP3、WAV、原始音频、MP4、封面图、TXT 歌词和标准 LRC**。Android 端负责系统媒体库写入、下载通知、Suno 会话及应用更新下载。

当前应用版本以根目录 `package.json` 的 `version` 为唯一来源。

## 使用流程

```text
粘贴 Suno 链接
  ↓
解析歌曲
  ↓
选择格式
  ↓
下载并保存到设备
```

标准 LRC 使用 Suno Web 当前的 aligned lyrics 数据生成逐行时间轴：

```text
GET /api/gen/<song-id>/aligned_lyrics/v2/
```

应用只使用 `aligned_lyrics[].start_s` 与 `text` 生成标准 `[mm:ss.xx]` LRC，不按歌曲总时长伪造均分时间轴。

当同步 LRC 需要 Suno 会话时，Android 会打开应用内登录页面；登录完成后继续原请求。会话由 Android WebView Cookie 容器保存，React/JavaScript 不读取或持久化认证凭据。

## 关于页与应用更新

「关于」页包含：

- 当前版本显示；
- 简明使用说明；
- 手动检查最新版本；
- 新版本说明；
- Android APK 下载入口。

应用启动后会静默检查更新。发现比当前版本更高、且 Release 已经包含 APK 时，会显示应用主题内的更新卡片；用户可选择稍后处理或下载更新。

默认更新元数据地址：

```text
https://api.github.com/repos/t59688/suno-downloader-app/releases/latest
```

也可以在构建时通过：

```text
VITE_UPDATE_API_URL
```

覆盖更新元数据地址。自定义接口应返回与 GitHub `releases/latest` 兼容的 JSON 字段，至少包含 `tag_name` 与 `assets`。

### 私有仓库注意事项

当前仓库如果保持为 GitHub Private，普通已安装 App 无法匿名读取 Private Release，也无法匿名下载 Private Release APK。应用中不会嵌入 GitHub PAT、GitHub Token 或其他仓库凭据。

因此，要让终端用户真正使用自动更新，需要满足其一：

1. Release/API 与 APK 对终端用户公开可访问；或
2. 提供公开的更新元数据与 APK 分发地址，并相应配置更新源/原生下载允许域名。

这属于分发基础设施约束，不应通过把长期 GitHub 凭据写入 APK 来绕过。

## Release 版本规则

`package.json` 是唯一版本源。例如：

```json
{
  "version": "0.0.2"
}
```

则 GitHub Release tag 必须严格为：

```text
v0.0.2
```

`.github/workflows/android-release.yml` 在安装 JDK、Android SDK 和开始打包前先校验：

```text
release tag == "v" + package.json.version
```

不一致会立即失败，不会继续构建或签名。生成 Android 工程后，`versionName` 也从同一个 `package.json.version` 写入。

## 安全边界

同步 LRC 的会话凭据只存在于 Android 原生层：

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

更新下载同样有原生边界：`SunoUpdateNativePlugin` 只接受 HTTPS 且位于本仓库 GitHub Release 下载路径下的 APK URL，不提供任意 URL 原生下载能力。

## 工作原理

```text
粘贴链接
  │  extractId: 歌曲 UUID / s:短码 / hook UUID / 歌单
  ▼
抓 suno.com 页面
  │  GET https://sunoapi.aibiei.com/proxy?url=...
  │  解析 Next.js RSC flight 数据 → 标题/封面/标签/TXT 歌词
  ▼
申请解密密钥
  │  POST https://yellow-salad.aibiei.com/rights
  │  → { key, iv, glt }
  ▼
下载加密音频
  ▼
App 内解密（@noble/ciphers）
  ▼
转码 / 打标签
     MP3: AudioContext → lamejs 320kbps → browser-id3-writer
     WAV: PCM16
     原始: 按魔数识别 webm/m4a/mp3
```

标准 LRC 是独立链路：

```text
Android App 内 Suno 会话
  ↓
aligned_lyrics/v2
  ↓
aligned_lyrics[].start_s + text
  ↓
标准 [mm:ss.xx] LRC
```

## 原生桥接入

根目录 `android/` 是 Capacitor 生成工程并被 `.gitignore` 排除。可复现的 Android 原生源码保存在：

```text
native/suno-core/SunoNativePlugin.java
native/suno-auth/SunoAuthNativePlugin.java
native/suno-update/SunoUpdateNativePlugin.java
```

每次执行：

```bash
npm run cap:sync
```

都会先执行 `cap sync android`，再由：

```text
scripts/install_suno_auth_native.mjs
```

把三个原生桥复制到生成的 Android app module，并在 `MainActivity` 注册。安装脚本是幂等的，重复执行不会重复插入 import、`registerPlugin(...)` 或权限声明。

## 目录结构

```text
suno-downloader-app/
├─ src/
│  ├─ core/
│  │  ├─ sunoParser.ts
│  │  ├─ decrypt.ts
│  │  ├─ http.ts
│  │  ├─ lrc.ts
│  │  ├─ update.ts        # package.json 版本 + Release 更新检查
│  │  └─ download.ts
│  ├─ components/
│  │  ├─ ParseTab.tsx
│  │  ├─ PlayerTab.tsx
│  │  ├─ HistoryTab.tsx
│  │  ├─ AboutTab.tsx
│  │  ├─ UpdateProvider.tsx
│  │  └─ ConfirmDialog.tsx
│  ├─ App.tsx
│  └─ main.tsx
├─ plugins/
│  ├─ suno-native/
│  ├─ suno-auth-native/
│  └─ suno-update-native/
├─ native/
│  ├─ suno-core/
│  ├─ suno-auth/
│  └─ suno-update/
├─ scripts/
└─ android/               # Capacitor 生成工程，不入 Git
```

## 编译与运行

| 使用场景 | 命令 | 说明 |
|---|---|---|
| 一键编译并安装运行 | `npm run android` | Web 构建 → Capacitor 同步 → 原生桥安装 → Gradle → adb 安装启动 |
| 只构建 APK | `npm run build:apk` | 构建 Android APK，不执行 adb 安装 |
| 同步 Android | `npm run cap:sync` | `cap sync android` 后安装/注册全部原生桥 |
| LRC 逻辑测试 | `npm run test:lrc` | 时间戳、排序、标签清理、异常输入 |
| 端到端音频测试 | `npm test` | 页面解析 → rights → 解密 → MP3/WAV 校验 |
| 桌面浏览器调试 | `npm run dev` | 调试 Web UI 与非原生功能 |

## 注意事项

1. `aligned_lyrics/v2` 是 Suno Web 内部接口，未来可能变化。
2. 某些第三方身份提供商可能限制嵌入式 WebView 登录，实际支持情况取决于 Suno 当时的登录策略。
3. 音频下载仍依赖 aibiei 的 proxy / rights 服务；同步 LRC 不经过这两个服务。
4. 仅下载你有权访问和保存的内容。
