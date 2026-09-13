import { execSync } from 'child_process';

console.log('🚀 [1/3] 编译前端并同步至安卓工程...');
execSync('npm run build', { stdio: 'inherit' });
execSync('npx cap sync android', { stdio: 'inherit' });

console.log('📦 [2/3] Gradle 编译 Debug APK...');
const isWin = process.platform === 'win32';
const gradlewCmd = isWin ? '.\\gradlew assembleDebug' : './gradlew assembleDebug';
execSync(gradlewCmd, { cwd: 'android', stdio: 'inherit' });

console.log('📱 [3/3] 自动安装并启动应用...');
const apkPath = isWin
  ? 'android\\app\\build\\outputs\\apk\\debug\\app-debug.apk'
  : 'android/app/build/outputs/apk/debug/app-debug.apk';

try {
  execSync(`adb install -r ${apkPath}`, { stdio: 'inherit' });
  execSync('adb shell am start -n com.sunoapp.downloader/.MainActivity', { stdio: 'inherit' });
  console.log('✨ 启动成功！');
} catch (e) {
  console.log('⚠️ 未检测到运行中的设备。APK 已生成在:', apkPath);
}
