/**
 * 播放器 Tab：只播放本应用解析/下载入库的歌曲
 * 旋转黑胶唱片 · 声学细滑轨 · 0.5x–3x 倍速 · 随机 · 循环 · 灵动 EQ
 */
import { useCallback, useRef, useState } from 'react';
import {
  Disc3,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Gauge,
  Trash2,
  Music,
} from 'lucide-react';
import { usePlayer } from './PlayerContext';
import ConfirmDialog from './ConfirmDialog';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

type ConfirmAction = { kind: 'clear' } | { kind: 'remove'; id: string; title: string } | null;

function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

export default function PlayerTab() {
  const p = usePlayer();
  const barRef = useRef<HTMLDivElement>(null);
  const [seeking, setSeeking] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const { current, playing, loading, time, duration, speed, loop, shuffle, tracks } = p;

  const posFromEvent = (e: React.PointerEvent): number => {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  function cycleLoop() {
    if (loop === 'off') p.setLoop('all');
    else if (loop === 'all') p.setLoop('one');
    else p.setLoop('off');
  }

  const closeConfirm = useCallback(() => setConfirmAction(null), []);

  async function applyConfirm() {
    if (!confirmAction) return;
    if (confirmAction.kind === 'clear') await p.clearAll();
    else await p.removeTrack(confirmAction.id);
    setConfirmAction(null);
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const confirmTitle = confirmAction?.kind === 'clear' ? '清空本地曲库？' : '移除这首歌曲？';
  const confirmMessage = confirmAction?.kind === 'clear'
    ? '本应用保存的本地曲库记录会被清空，此操作不可恢复。'
    : confirmAction?.kind === 'remove'
      ? `「${confirmAction.title}」将从本地曲库中移除。`
      : '';

  return (
    <div className="player-tab">
      <section className="card now-card">
        {current ? (
          <>
            <div className="now-disc-wrap">
              <div className={'now-disc' + (playing ? ' spinning' : '')}>
                {current.cover ? (
                  <img src={current.cover} alt="" />
                ) : (
                  <Disc3 size={44} strokeWidth={1.5} color="#5e606b" />
                )}
              </div>
              {loading && (
                <div className="now-loading">
                  <span className="spinner" />
                </div>
              )}
            </div>

            <div className="now-info">
              <div className="now-title">{current.title || '未知歌曲'}</div>
              <div className="now-artist">{current.artist || 'Suno AI'}</div>
            </div>

            <div
              className="now-bar"
              ref={barRef}
              onPointerDown={(e) => {
                if (!duration) return;
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                setSeeking(true);
                p.seek(posFromEvent(e) * duration);
              }}
              onPointerMove={(e) => {
                if (!seeking || !duration) return;
                p.seek(posFromEvent(e) * duration);
              }}
              onPointerUp={() => setSeeking(false)}
            >
              <div className="now-fill" style={{ width: pct + '%' }} />
              <div className="now-knob" style={{ left: pct + '%' }} />
            </div>

            <div className="now-times">
              <span>{fmtTime(time)}</span>
              <span>{fmtTime(duration)}</span>
            </div>

            <div className="now-controls">
              <button
                className={'ctl ctl-mini' + (shuffle ? ' active' : '')}
                onClick={p.toggleShuffle}
                aria-label="随机播放"
                title="随机播放"
                type="button"
              >
                <Shuffle size={18} strokeWidth={shuffle ? 2.2 : 1.8} />
              </button>

              <button className="ctl" onClick={p.prev} aria-label="上一首" type="button">
                <SkipBack size={22} strokeWidth={2} fill="currentColor" />
              </button>

              <button
                className="ctl ctl-main"
                onClick={p.toggle}
                aria-label={playing ? '暂停' : '播放'}
                type="button"
              >
                {playing ? (
                  <Pause size={24} strokeWidth={2.4} fill="currentColor" />
                ) : (
                  <Play size={24} strokeWidth={2.4} fill="currentColor" style={{ marginLeft: 2 }} />
                )}
              </button>

              <button className="ctl" onClick={() => p.next()} aria-label="下一首" type="button">
                <SkipForward size={22} strokeWidth={2} fill="currentColor" />
              </button>

              <button
                className={'ctl ctl-mini' + (loop !== 'off' ? ' active' : '')}
                onClick={cycleLoop}
                aria-label="循环模式"
                title={'循环：' + (loop === 'off' ? '关闭' : loop === 'one' ? '单曲' : '列表')}
                type="button"
              >
                {loop === 'one' ? (
                  <Repeat1 size={18} strokeWidth={2.2} />
                ) : (
                  <Repeat size={18} strokeWidth={loop === 'all' ? 2.2 : 1.8} />
                )}
              </button>
            </div>

            <div className="now-extra">
              <div className="speed-wrap">
                <button
                  className={'btn btn-quiet speed-btn' + (speedOpen ? ' open' : '')}
                  onClick={() => setSpeedOpen((o) => !o)}
                  type="button"
                >
                  <Gauge size={13} strokeWidth={2} />
                  {speed}x
                </button>
                {speedOpen && (
                  <div className="speed-menu">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        className={'speed-item' + (s === speed ? ' on' : '')}
                        onClick={() => {
                          p.setSpeed(s);
                          setSpeedOpen(false);
                        }}
                        type="button"
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="now-mode">
                {shuffle ? '随机 · ' : ''}
                {loop === 'off' ? '顺序播放' : loop === 'one' ? '单曲循环' : '列表循环'}
              </span>
            </div>
          </>
        ) : (
          <div className="now-empty">
            <Disc3 size={40} strokeWidth={1.5} />
            <p>{tracks.length ? '点击下方歌曲开始播放' : '暂无本地歌曲'}</p>
          </div>
        )}
      </section>

      {tracks.length > 0 && (
        <section className="card list-card">
          <div className="list-head">
            <span className="list-title">
              我的歌曲 <em>{tracks.length} 首</em>
            </span>
            <div className="list-actions">
              <button className="btn btn-quiet mini" onClick={p.playAll} type="button">
                <Play size={13} strokeWidth={2} fill="currentColor" />
                播放全部
              </button>
              <button
                className="btn btn-quiet mini danger"
                onClick={() => setConfirmAction({ kind: 'clear' })}
                type="button"
              >
                <Trash2 size={13} strokeWidth={2} />
                清空
              </button>
            </div>
          </div>
          <ul className="track-list">
            {tracks.map((t) => {
              const active = t.id === p.currentId;
              return (
                <li key={t.id} className={'track-item' + (active ? ' active' : '')}>
                  <button
                    className="track-item-cover"
                    onClick={() => (active ? p.toggle() : p.play(t.id))}
                    aria-label="播放"
                    type="button"
                  >
                    {t.cover ? (
                      <img src={t.cover} alt="" />
                    ) : (
                      <Music size={18} strokeWidth={1.8} />
                    )}
                    {active && playing && (
                      <span className="eq" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                  </button>
                  <div className="track-meta" onClick={() => (active ? p.toggle() : p.play(t.id))}>
                    <div className="track-t">{t.title}</div>
                    <div className="track-a">
                      {t.artist} · {fmtSize(t.size)}
                    </div>
                  </div>
                  <button
                    className="track-del"
                    aria-label="删除"
                    onClick={() => setConfirmAction({ kind: 'remove', id: t.id, title: t.title })}
                    type="button"
                  >
                    <Trash2 size={15} strokeWidth={1.8} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tracks.length === 0 && <p className="list-hint">下载完成的音频会显示在这里。</p>}

      <ConfirmDialog
        open={confirmAction != null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmAction?.kind === 'clear' ? '清空曲库' : '移除歌曲'}
        danger
        onCancel={closeConfirm}
        onConfirm={applyConfirm}
      />
    </div>
  );
}
