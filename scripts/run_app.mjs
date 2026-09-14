import { execSync } from 'child_process';

console.log('🚀 [1/4] 编译 APK（包含一键 Suno 登录原生桥）...');
execSync('node scripts/build_apk.mjs', { stdio: 'inherit' });

console.log('📱 [2/4] 检查连接设备...');
const isWin = process.platform === 'win32';
const apkPath = isWin
  ? 'android\\app\\build\\outputs\\apk\\debug\\app-debug.apk'
  : 'android/app/build/outputs/apk/debug/app-debug.apk';

try {
  console.log('📥 [3/4] 安装 APK...');
  execSync(`adb install -r ${apkPath}`, { stdio: 'inherit' });
  console.log('▶️ [4/4] 启动应用...');
  execSync('adb shell am start -n com.sunoapp.downloader/.MainActivity', { stdio: 'inherit' });
  console.log('✨ 启动成功！');
} catch (e) {
  console.log('⚠️ 未检测到可用设备。APK 已生成在:', apkPath);
}
