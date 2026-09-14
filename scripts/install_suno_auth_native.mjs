import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const androidMain = path.join(root, 'android', 'app', 'src', 'main');
const packageDir = path.join(androidMain, 'java', 'com', 'sunoapp', 'downloader');
const mainActivityPath = path.join(packageDir, 'MainActivity.java');
const manifestPath = path.join(androidMain, 'AndroidManifest.xml');

const plugins = [
  {
    label: 'Suno 核心原生桥',
    source: path.join(root, 'native', 'suno-core', 'SunoNativePlugin.java'),
    target: path.join(packageDir, 'core', 'SunoNativePlugin.java'),
    importLine: 'import com.sunoapp.downloader.core.SunoNativePlugin;',
    registerLine: 'registerPlugin(SunoNativePlugin.class);',
  },
  {
    label: 'Suno 一键登录原生桥',
    source: path.join(root, 'native', 'suno-auth', 'SunoAuthNativePlugin.java'),
    target: path.join(packageDir, 'auth', 'SunoAuthNativePlugin.java'),
    importLine: 'import com.sunoapp.downloader.auth.SunoAuthNativePlugin;',
    registerLine: 'registerPlugin(SunoAuthNativePlugin.class);',
  },
];

function fail(message) {
  throw new Error('[suno-native] ' + message);
}

if (!existsSync(mainActivityPath)) {
  fail('未找到 Android MainActivity。请先运行 npx cap add android / npx cap sync android');
}
if (!existsSync(manifestPath)) fail('未找到 AndroidManifest.xml');
for (const plugin of plugins) {
  if (!existsSync(plugin.source)) fail(`${plugin.label}源码缺失: ${plugin.source}`);
  mkdirSync(path.dirname(plugin.target), { recursive: true });
  copyFileSync(plugin.source, plugin.target);
}

let source = readFileSync(mainActivityPath, 'utf8').replace(/\r\n?/g, '\n');
if (!/package\s+com\.sunoapp\.downloader\s*;/.test(source)) {
  fail('MainActivity package 与 com.sunoapp.downloader 不匹配，拒绝自动改写');
}

function addImport(text, importLine) {
  if (text.includes(importLine)) return text;
  const packageMatch = text.match(/package\s+com\.sunoapp\.downloader\s*;\s*/);
  if (!packageMatch || packageMatch.index == null) fail('无法定位 MainActivity package 声明');
  const at = packageMatch.index + packageMatch[0].length;
  return text.slice(0, at) + '\n' + importLine + '\n' + text.slice(at);
}

source = addImport(source, 'import android.os.Bundle;');
for (const plugin of plugins) source = addImport(source, plugin.importLine);

const missingRegistrations = plugins
  .map((plugin) => plugin.registerLine)
  .filter((line) => !source.includes(line));

if (missingRegistrations.length) {
  const registrationBlock = missingRegistrations.join('\n        ');
  const superCall = /super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;/;
  if (superCall.test(source)) {
    source = source.replace(superCall, (match) => registrationBlock + '\n        ' + match);
  } else {
    const classOpen = /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/;
    if (!classOpen.test(source)) fail('无法识别 MainActivity 结构，拒绝自动改写');
    source = source.replace(
      classOpen,
      `$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        ${registrationBlock}\n        super.onCreate(savedInstanceState);\n    }`,
    );
  }
}

writeFileSync(mainActivityPath, source.endsWith('\n') ? source : source + '\n', 'utf8');

let manifest = readFileSync(manifestPath, 'utf8').replace(/\r\n?/g, '\n');
const permissions = [
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
];
for (const permission of permissions) {
  const name = permission.match(/android:name="([^"]+)"/)?.[1];
  if (!name || manifest.includes(`android:name="${name}"`)) continue;
  const appIndex = manifest.indexOf('<application');
  if (appIndex < 0) fail('无法定位 AndroidManifest.xml 的 <application>');
  manifest = manifest.slice(0, appIndex) + permission + '\n    ' + manifest.slice(appIndex);
}
writeFileSync(manifestPath, manifest.endsWith('\n') ? manifest : manifest + '\n', 'utf8');

console.log('✅ Suno 原生桥已安装并注册');
for (const plugin of plugins) console.log('   ' + path.relative(root, plugin.target));
