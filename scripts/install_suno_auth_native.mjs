import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const androidMain = path.join(root, 'android', 'app', 'src', 'main');
const androidRes = path.join(androidMain, 'res');
const packageDir = path.join(androidMain, 'java', 'com', 'sunoapp', 'downloader');
const mainActivityPath = path.join(packageDir, 'MainActivity.java');
const manifestPath = path.join(androidMain, 'AndroidManifest.xml');
const stylesPath = path.join(androidRes, 'values', 'styles.xml');
const shellSource = path.join(root, 'native', 'android-shell', 'SunoSystemUi.java');
const shellTarget = path.join(packageDir, 'shell', 'SunoSystemUi.java');
const shellRes = path.join(root, 'native', 'android-shell', 'res');

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
  {
    label: 'Suno 更新下载原生桥',
    source: path.join(root, 'native', 'suno-update', 'SunoUpdateNativePlugin.java'),
    target: path.join(packageDir, 'update', 'SunoUpdateNativePlugin.java'),
    importLine: 'import com.sunoapp.downloader.update.SunoUpdateNativePlugin;',
    registerLine: 'registerPlugin(SunoUpdateNativePlugin.class);',
  },
];

function fail(message) {
  throw new Error('[suno-native] ' + message);
}

function copyTree(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) fail(`Android shell 资源目录缺失: ${sourceDir}`);
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) copyFileSync(source, target);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addImport(text, importLine) {
  if (text.includes(importLine)) return text;
  const packageMatch = text.match(/package\s+com\.sunoapp\.downloader\s*;/);
  if (!packageMatch || packageMatch.index == null) fail('无法定位 MainActivity package 声明');
  const at = packageMatch.index + packageMatch[0].length;
  return text.slice(0, at) + '\n' + importLine + text.slice(at);
}

function ensureApplicationAttribute(text, name, value) {
  const application = /<application\b[^>]*>/s;
  const match = text.match(application);
  if (!match) fail('无法定位 AndroidManifest.xml 的 <application>');
  const tag = match[0];
  const attr = new RegExp(`\\s+${escapeRegExp(name)}="[^"]*"`);
  const next = attr.test(tag)
    ? tag.replace(attr, `\n        ${name}="${value}"`)
    : tag.replace('<application', `<application\n        ${name}="${value}"`);
  return text.replace(application, next);
}

function ensureStyleItem(text, styleName, itemName, value) {
  const style = new RegExp(`(<style\\s+name="${escapeRegExp(styleName)}"[^>]*>)([\\s\\S]*?)(</style>)`);
  const match = text.match(style);
  if (!match) fail(`无法定位 Android 样式 ${styleName}`);
  const existing = new RegExp(`<item\\s+name="${escapeRegExp(itemName)}"[^>]*>[\\s\\S]*?</item>`);
  const item = `<item name="${itemName}">${value}</item>`;
  let body = match[2];
  if (existing.test(body)) {
    body = body.replace(existing, item);
  } else {
    body = body.replace(/\s*$/, '') + `\n        ${item}\n    `;
  }
  return text.replace(style, `${match[1]}${body}${match[3]}`);
}

if (!existsSync(mainActivityPath)) {
  fail('未找到 Android MainActivity。请先运行 npx cap add android / npx cap sync android');
}
if (!existsSync(manifestPath)) fail('未找到 AndroidManifest.xml');
if (!existsSync(stylesPath)) fail('未找到 Android styles.xml');
if (!existsSync(shellSource)) fail(`Android shell 源码缺失: ${shellSource}`);

for (const plugin of plugins) {
  if (!existsSync(plugin.source)) fail(`${plugin.label}源码缺失: ${plugin.source}`);
  mkdirSync(path.dirname(plugin.target), { recursive: true });
  copyFileSync(plugin.source, plugin.target);
}
mkdirSync(path.dirname(shellTarget), { recursive: true });
copyFileSync(shellSource, shellTarget);
copyTree(shellRes, androidRes);

let source = readFileSync(mainActivityPath, 'utf8').replace(/\r\n?/g, '\n');
if (!/package\s+com\.sunoapp\.downloader\s*;/.test(source)) {
  fail('MainActivity package 与 com.sunoapp.downloader 不匹配，拒绝自动改写');
}

source = addImport(source, 'import android.os.Bundle;');
source = addImport(source, 'import com.sunoapp.downloader.shell.SunoSystemUi;');
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
      `$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        ${registrationBlock}\n        super.onCreate(savedInstanceState);\n    }\n`,
    );
  }
}

if (!source.includes('SunoSystemUi.apply(this);')) {
  const superCall = /super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;/;
  if (!superCall.test(source)) fail('无法定位 MainActivity super.onCreate，拒绝注入系统栏配置');
  source = source.replace(superCall, (match) => match + '\n        SunoSystemUi.apply(this);');
}
writeFileSync(mainActivityPath, source.endsWith('\n') ? source : source + '\n', 'utf8');

let manifest = readFileSync(manifestPath, 'utf8').replace(/\r\n?/g, '\n');
manifest = ensureApplicationAttribute(manifest, 'android:icon', '@mipmap/suno_launcher');
manifest = ensureApplicationAttribute(manifest, 'android:roundIcon', '@mipmap/suno_launcher_round');
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

let styles = readFileSync(stylesPath, 'utf8').replace(/\r\n?/g, '\n');
for (const styleName of ['AppTheme.NoActionBar', 'AppTheme.NoActionBarLaunch']) {
  styles = ensureStyleItem(styles, styleName, 'android:windowDrawsSystemBarBackgrounds', 'true');
  styles = ensureStyleItem(styles, styleName, 'android:statusBarColor', '@android:color/transparent');
  styles = ensureStyleItem(styles, styleName, 'android:navigationBarColor', '@android:color/transparent');
  styles = ensureStyleItem(styles, styleName, 'android:windowLightStatusBar', 'false');
  styles = ensureStyleItem(styles, styleName, 'android:windowLightNavigationBar', 'false');
}
writeFileSync(stylesPath, styles.endsWith('\n') ? styles : styles + '\n', 'utf8');

console.log('✅ Suno Android 原生桥、沉浸式系统栏与品牌图标已安装');
for (const plugin of plugins) console.log('   ' + path.relative(root, plugin.target));
console.log('   ' + path.relative(root, shellTarget));
console.log('   launcher: @mipmap/suno_launcher');
