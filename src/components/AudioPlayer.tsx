import { useEffect, useRef, useState } from 'react';
import { Disc3, Play, Pause } from 'lucide-react';
import { usePlayer } from './PlayerContext';

interface Props {
  src: string;
  title?: string;
  artist?: string;
  cover?: string;
  /** 下载完成后已入库的歌曲 ID。存在时直接复用全局播放器，避免双播放器。 */
  trackId?: string;
}

function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * 下载完成页的试听 UI。
 * 音频正常入库后复用 PlayerContext 的单一 audio 引擎，因此 Android MediaSession、
 * 蓝牙/耳机按键与播放器 Tab 始终控制同一份播放状态。
 * IndexedDB 入库失败时才退回当前 result Blob 的本地 <audio> 预览。
 */
export default function AudioPlayer({ src, title, artist, cover, trackId }: Props) {
  const player = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  const globalActive = Boolean(trackId && player.currentId === trackId);
  const playing = trackId ? globalActive && player.playing : localPlaying;
  const time = trackId ? (globalActive ? player.time : 0) : localTime;
  const duration = trackId ? (globalActive ? player.duration : 0) : localDuration;

  useEffect(() => () => audioRef.current?.pause(), []);

  async function toggle() {
    if (trackId) {
      if (globalActive) player.toggle();
      else player.play(trackId);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      await a.play().catch(() => {});
    } else {
      a.pause();
    }
  }

  function posFromEvent(e: React.PointerEvent): number {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  function previewSeek(t: number) {
    if (trackId && globalActive) player.seek(t);
    else setLocalTime(t);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!duration) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSeeking(true);
    previewSeek(posFromEvent(e) * duration);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!seeking || !duration) return;
    previewSeek(posFromEvent(e) * duration);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!duration) return;
    const target = posFromEvent(e) * duration;
    if (trackId && globalActive) {
      player.seek(target);
    } else {
      const a = audioRef.current;
      if (a) a.currentTime = target;
      setLocalTime(target);
    }
    setSeeking(false);
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div className="player">
      {!trackId && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setLocalPlaying(true)}
          onPause={() => setLocalPlaying(false)}
          onEnded={() => setLocalPlaying(false)}
          onTimeUpdate={(e) => {
            if (!seeking) setLocalTime(e.currentTarget.currentTime);
          }}
          onLoadedMetadata={(e) => setLocalDuration(e.currentTarget.duration)}
        />
      )}
      <div className="player-row">
        <div className={'player-disc' + (playing ? ' spinning' : '')}>
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <Disc3 size={18} strokeWidth={1.8} />
          )}
        </div>
        <div className="player-info">
          <div className="player-title">{title || '音频预览'}</div>
          <div className="player-artist">{artist || 'Suno'}</div>
        </div>
        <button className="player-btn" onClick={toggle} aria-label={playing ? '暂停' : '播放'} type="button">
          {playing ? (
            <Pause size={14} strokeWidth={2.4} fill="currentColor" />
          ) : (
            <Play size={14} strokeWidth={2.4} fill="currentColor" style={{ marginLeft: 1 }} />
          )}
        </button>
      </div>
      <div
        className="player-bar"
        ref={barRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="player-fill" style={{ width: pct + '%' }} />
        <div className="player-knob" style={{ left: pct + '%' }} />
      </div>
      <div className="player-times">
        <span>{fmtTime(time)}</span>
        <span>{fmtTime(duration)}</span>
      </div>
    </div>
  );
}
