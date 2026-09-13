import { useEffect, useRef, useState } from 'react';
import { Disc3, Play, Pause } from 'lucide-react';

interface Props {
  src: string;
  title?: string;
  artist?: string;
  cover?: string;
}

function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * 自定义音频播放器：
 * 旋转唱片封面 + 极简声学细进度条 + 播放/暂停
 */
export default function AudioPlayer({ src, title, artist, cover }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => () => audioRef.current?.pause(), []);

  async function toggle() {
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

  function onPointerDown(e: React.PointerEvent) {
    const a = audioRef.current;
    if (!a || !duration) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setSeeking(true);
    setTime(posFromEvent(e) * duration);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!seeking || !duration) return;
    setTime(posFromEvent(e) * duration);
  }

  function onPointerUp(e: React.PointerEvent) {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = posFromEvent(e) * duration;
    setSeeking(false);
  }

  const pct = duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div className="player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (!seeking) setTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
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