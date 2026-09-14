import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'sunoapp', 'downloader');
const mainActivityPath = path.join(packageDir, 'MainActivity.java');
const sourcePath = path.join(root, 'native', 'suno-auth', 'SunoAuthNativePlugin.java');
const targetDir = path.join(packageDir, 'auth');
const targetPath = path.join(targetDir, 'SunoAuthNativePlugin.java');

function fail(message) {
  throw new Error('[suno-auth-native] ' + message);
}

if (!existsSync(sourcePath)) fail('原生登录桥源码缺失: ' + sourcePath);
if (!existsSync(mainActivityPath)) {
  fail('未找到 Android MainActivity。请先运行 npx cap add android / npx cap sync android');
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(sourcePath, targetPath);

let source = readFileSync(mainActivityPath, 'utf8').replace(/\r\n?/g, '\n');
if (!/package\s+com\.sunoapp\.downloader\s*;/.test(source)) {
  fail('MainActivity package 与 com.sunoapp.downloader 不匹配，拒绝自动改写');
}

const bundleImport = 'import android.os.Bundle;';
const pluginImport = 'import com.sunoapp.downloader.auth.SunoAuthNativePlugin;';

function addImport(text, importLine) {
  if (text.includes(importLine)) return text;
  const packageMatch = text.match(/package\s+com\.sunoapp\.downloader\s*;\s*/);
  if (!packageMatch || packageMatch.index == null) fail('无法定位 MainActivity package 声明');
  const at = packageMatch.index + packageMatch[0].length;
  return text.slice(0, at) + '\n' + importLine + '\n' + text.slice(at);
}

source = addImport(source, bundleImport);
source = addImport(source, pluginImport);

const registerLine = 'registerPlugin(SunoAuthNativePlugin.class);';
if (!source.includes(registerLine)) {
  const superCall = /super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;/;
  if (superCall.test(source)) {
    source = source.replace(superCall, registerLine + '\n        super.onCreate(savedInstanceState);');
  } else {
    const classOpen = /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/;
    if (!classOpen.test(source)) fail('无法识别 MainActivity 结构，拒绝自动改写');
    source = source.replace(
      classOpen,
      `$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        ${registerLine}\n        super.onCreate(savedInstanceState);\n    }`,
    );
  }
}

writeFileSync(mainActivityPath, source.endsWith('\n') ? source : source + '\n', 'utf8');
console.log('✅ Suno 一键登录原生桥已安装并注册');
console.log('   ' + path.relative(root, targetPath));
