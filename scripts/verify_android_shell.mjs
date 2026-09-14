import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const androidMain = path.join(root, 'android', 'app', 'src', 'main');

function fail(message) {
  throw new Error('[android-shell] ' + message);
}

function read(relativePath) {
  const file = path.join(androidMain, relativePath);
  if (!existsSync(file)) fail(`缺少生成文件: ${relativePath}`);
  return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) fail(`${label} 缺少: ${needle}`);
}

const manifest = read('AndroidManifest.xml');
requireText(manifest, 'android:icon="@mipmap/suno_launcher"', 'AndroidManifest');
requireText(manifest, 'android:roundIcon="@mipmap/suno_launcher_round"', 'AndroidManifest');

const mainActivity = read('java/com/sunoapp/downloader/MainActivity.java');
requireText(mainActivity, 'SunoSystemUi.apply(this);', 'MainActivity');

const styles = read('res/values/styles.xml');
for (const required of [
  '<item name="android:windowDrawsSystemBarBackgrounds">true</item>',
  '<item name="android:statusBarColor">@android:color/transparent</item>',
  '<item name="android:navigationBarColor">@android:color/transparent</item>',
  '<item name="android:windowLightStatusBar">false</item>',
  '<item name="android:windowLightNavigationBar">false</item>',
]) {
  requireText(styles, required, 'styles.xml');
}

for (const relativePath of [
  'java/com/sunoapp/downloader/shell/SunoSystemUi.java',
  'res/values/ic_launcher_background.xml',
  'res/drawable/suno_launcher_foreground.xml',
  'res/mipmap-anydpi/suno_launcher.xml',
  'res/mipmap-anydpi/suno_launcher_round.xml',
  'res/mipmap-anydpi-v26/suno_launcher.xml',
  'res/mipmap-anydpi-v26/suno_launcher_round.xml',
]) {
  if (!existsSync(path.join(androidMain, relativePath))) fail(`缺少品牌资源: ${relativePath}`);
}

console.log('✅ Android shell regression gate passed: immersive system bars + branded launcher icon');
