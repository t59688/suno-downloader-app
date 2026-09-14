/**
 * 标准 LRC 生成器的纯逻辑测试。
 * 运行: npm run test:lrc
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'suno-lrc-test-'));
const localTsc = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const tsc = existsSync(localTsc) ? localTsc : 'tsc';

try {
  execFileSync(
    tsc,
    [
      path.join(root, 'src/core/lrc.ts'),
      '--target', 'ES2020',
      '--module', 'ES2020',
      '--moduleResolution', 'node',
      '--strict',
      '--skipLibCheck',
      '--outDir', tempDir,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');

  const { buildStandardLrc, extractAlignedLyricLines, formatLrcTime } = await import(
    pathToFileURL(path.join(tempDir, 'lrc.js')).href
  );

  assert.equal(formatLrcTime(0), '[00:00.00]');
  assert.equal(formatLrcTime(61.239), '[01:01.24]');
  assert.equal(formatLrcTime(-3), '[00:00.00]');

  const payload = {
    aligned_lyrics: [
      { text: '[Chorus] 第二句', start_s: 12.345, end_s: 14 },
      { text: '[Verse] 第一\n句', start_s: 1.2, end_s: 4 },
      { text: '[Hey] 保留字面括号', start_s: 20 },
      { text: '', start_s: 8 },
      { text: '坏数据', start_s: -1 },
      null,
    ],
  };

  assert.deepEqual(extractAlignedLyricLines(payload), [
    { start: 1.2, text: '第一 句' },
    { start: 12.345, text: '第二句' },
    { start: 20, text: '[Hey] 保留字面括号' },
  ]);

  const lrc = buildStandardLrc(payload, { title: '测试]歌\n名', artist: '歌手' });
  assert.match(lrc, /^\[ti:测试）歌 名\]\n\[ar:歌手\]\n/m);
  assert.match(lrc, /\[00:01\.20\]第一 句/);
  assert.match(lrc, /\[00:12\.35\]第二句/);
  assert.match(lrc, /\[00:20\.00\]\[Hey\] 保留字面括号/);
  assert.ok(lrc.endsWith('\n'));

  assert.throws(() => buildStandardLrc({ aligned_lyrics: [] }), /逐行同步歌词/);
  console.log('✅ LRC formatter tests passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
