import { CheckCircle2, Download, Info, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useUpdate } from './UpdateProvider';

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function AboutTab() {
  const update = useUpdate();
  const available = update.info?.isNewer === true;
  const noApk = available && !update.info?.apkUrl;

  return (
    <div className="about-tab">
      <section className="about-hero">
        <div className="about-logo"><Sparkles size={28} strokeWidth={1.7} /></div>
        <div>
          <div className="about-name">Suno 下载器</div>
          <div className="about-version">版本 v{update.currentVersion}</div>
        </div>
      </section>

      <section className="card about-section">
        <div className="about-section-head">
          <Info size={17} strokeWidth={1.9} />
          <div>
            <h2>使用说明</h2>
            <p>从链接到文件，保持流程简单。</p>
          </div>
        </div>
        <ol className="about-steps">
          <li><span>1</span><div><strong>粘贴链接</strong><p>支持 Suno 歌曲、Hook 与歌单链接。</p></div></li>
          <li><span>2</span><div><strong>选择格式</strong><p>按需下载音频、视频、封面、TXT 或同步 LRC。</p></div></li>
          <li><span>3</span><div><strong>保存到设备</strong><p>Android 会将生成文件写入对应的系统媒体目录。</p></div></li>
        </ol>
        <div className="about-note">
          <ShieldCheck size={15} strokeWidth={2} />
          <span>同步 LRC 需要会话时，会在应用内打开 Suno 登录页并在完成后继续。</span>
        </div>
      </section>

      <section className="card about-section">
        <div className="about-section-head version-head">
          <RefreshCw size={17} strokeWidth={1.9} />
          <div>
            <h2>版本更新</h2>
            <p>当前版本与最新 Release 自动比对。</p>
          </div>
        </div>

        <div className="version-panel">
          <div className="version-row">
            <span className="version-label">当前版本</span>
            <strong>v{update.currentVersion}</strong>
          </div>
          {update.info && (
            <div className="version-row">
              <span className="version-label">最新版本</span>
              <strong className={available ? 'accent-text' : ''}>v{update.info.version}</strong>
            </div>
          )}
        </div>

        <div className={'version-status ' + update.status}>
          {update.status === 'idle' && '可随时检查最新版本'}
          {update.status === 'checking' && <><span className="spinner" />正在检查更新…</>}
          {update.status === 'current' && <><CheckCircle2 size={15} />已是最新版本</>}
          {update.status === 'available' && !noApk && `发现新版本 v${update.info?.version}`}
          {update.status === 'available' && noApk && '新版本已发布，安装包正在准备中'}
          {update.status === 'downloading' && <><span className="spinner" />正在提交下载…</>}
          {update.status === 'queued' && <><CheckCircle2 size={15} />已加入系统下载，请查看通知</>}
          {update.status === 'error' && update.error}
        </div>

        {available && update.info?.notes && (
          <p className="about-release-notes">{update.info.notes.slice(0, 700)}</p>
        )}

        <div className="about-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void update.check()}
            disabled={update.status === 'checking' || update.status === 'downloading'}
            type="button"
          >
            <RefreshCw size={15} strokeWidth={2} />
            检查更新
          </button>
          {available && update.info?.apkUrl && (
            <button
              className="btn btn-primary"
              onClick={() => void update.download()}
              disabled={update.status === 'downloading'}
              type="button"
            >
              <Download size={15} strokeWidth={2} />
              下载 v{update.info.version}{update.info.apkSize ? ` · ${fmtSize(update.info.apkSize)}` : ''}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
