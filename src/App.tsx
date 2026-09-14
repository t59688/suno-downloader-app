/**
 * 应用主框架：底部 Tab 布局（播放器 / 解析 / 历史）
 * 播放器引擎由 PlayerProvider 持有，切 Tab 不中断播放。
 * 遵循 Apple HIG & 独立工作室黑曜石声学设计规范，全面集成 Lucide 图标体系
 */
import { useState } from 'react';
import { Disc3, ArrowDownToLine, Clock, Sparkles } from 'lucide-react';
import { PlayerProvider, usePlayer } from './components/PlayerContext';
import PlayerTab from './components/PlayerTab';
import ParseTab from './components/ParseTab';
import HistoryTab from './components/HistoryTab';
import type { ClipInfo } from './core/types';

type TabKey = 'player' | 'parse' | 'history';

const TABS: { key: TabKey; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  {
    key: 'player',
    label: '播放器',
    icon: (active) => <Disc3 size={20} strokeWidth={active ? 2.2 : 1.8} />,
  },
  {
    key: 'parse',
    label: '解析',
    icon: (active) => <ArrowDownToLine size={20} strokeWidth={active ? 2.2 : 1.8} />,
  },
  {
    key: 'history',
    label: '历史',
    icon: (active) => <Clock size={20} strokeWidth={active ? 2.2 : 1.8} />,
  },
];

function Shell() {
  const [tab, setTab] = useState<TabKey>('parse');
  const player = usePlayer();
  const [pendingRedownload, setPendingRedownload] = useState<ClipInfo | null>(null);

  /** 历史页点"下载"：切到解析页并自动解析该歌曲 */
  function handleRedownload(clip: ClipInfo) {
    setPendingRedownload(clip);
    setTab('parse');
  }

  return (
    <div className="app">
      <div className="glow" aria-hidden="true" />

      {tab !== 'player' && (
        <header className="brand">
          <div className="brand-mark">
            <img src="/logo.svg" alt="Suno" width={26} height={26} style={{ borderRadius: 6, display: 'block' }} />
          </div>
          <div>
            <div className="brand-name">Suno Downloader</div>
            <div className="brand-sub">音频 · 视频 · 封面 · 歌词，一次拿全</div>
          </div>
        </header>
      )}

      <main className={'main' + (tab === 'player' ? ' main-player' : '')}>
        {/* 播放器常驻挂载：切 Tab 不中断播放 */}
        <div className={'tab-pane' + (tab === 'player' ? '' : ' hidden-pane')}>
          <PlayerTab />
        </div>
        <div className={'tab-pane' + (tab === 'parse' ? '' : ' hidden-pane')}>
          <ParseTab onConsumedRedownload={() => setPendingRedownload(null)} pendingRedownload={pendingRedownload} />
        </div>
        <div className={'tab-pane' + (tab === 'history' ? '' : ' hidden-pane')}>
          <HistoryTab onRedownload={handleRedownload} />
        </div>

        <footer className="foot">公开资源免登录 · 精准 LRC 首次使用自动打开 Suno 登录</footer>
      </main>

      <nav className="tabbar">
        {TABS.map((t) => {
          const badge = t.key === 'player' ? player.tracks.length : 0;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              className={'tabbar-item' + (isActive ? ' active' : '')}
              onClick={() => setTab(t.key)}
            >
              <span className="tabbar-ico">
                {t.icon(isActive)}
                {badge > 0 && <span className="tabbar-badge">{badge > 99 ? '99+' : badge}</span>}
              </span>
              <span className="tabbar-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <Shell />
    </PlayerProvider>
  );
}
