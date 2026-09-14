import { execSync } from 'node:child_process';

function run(command, cwd) {
  execSync(command, { cwd, stdio: 'inherit' });
}

console.log('🚀 [1/3] 编译前端...');
run('npm run build');

console.log('🔧 [2/3] 同步 Capacitor 并安装 Suno 一键登录原生桥...');
run('npm run cap:sync');

console.log('📦 [3/3] Gradle 编译 Debug APK...');
const isWin = process.platform === 'win32';
const gradlew = isWin ? '.\\gradlew assembleDebug' : './gradlew assembleDebug';
run(gradlew, 'android');

const apkPath = isWin
  ? 'android\\app\\build\\outputs\\apk\\debug\\app-debug.apk'
  : 'android/app/build/outputs/apk/debug/app-debug.apk';
console.log('✅ APK 已生成:', apkPath);
