/**
 * 全局播放器上下文：
 *  - 单一 <audio> 引擎，切 tab 不中断播放
 *  - 只播放本应用解析/下载入库的歌曲（TrackMeta 来自 core/library）
 *  - 播放 / 暂停 / 进度 / 倍速(0.5x–3x) / 上一首 / 下一首 / 随机 / 循环(关闭·单曲·列表)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addTrack as libAddTrack,
  getTrackBlob,
  listTracks,
  removeTrack as libRemoveTrack,
  type TrackMeta,
} from '../core/library';
import {
  addMediaControlListener,
  clearMediaSession,
  syncMediaSession,
} from '../core/native';

export type LoopMode = 'off' | 'one' | 'all';

export interface PlayerContextValue {
  tracks: TrackMeta[];
  currentId: string | null;
  current: TrackMeta | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  speed: number;
  loop: LoopMode;
  shuffle: boolean;
  refreshTracks: () => Promise<void>;
  addTrack: (p: {
    clipId: string;
    title: string;
    artist: string;
    cover?: string;
    blob: Blob;
    fileName: string;
    mimeType: string;
    format: string;
  }) => Promise<TrackMeta>;
  play: (id: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  setLoop: (m: LoopMode) => void;
  toggleShuffle: () => void;
  removeTrack: (id: string) => Promise<void>;
  playAll: () => void;
  clearAll: () => Promise<void>;
}

const Ctx = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlayer 必须在 PlayerProvider 内使用');
  return v;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef('');

  const [tracks, setTracks] = useState<TrackMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [loop, setLoop] = useState<LoopMode>('all');
  const [shuffle, setShuffle] = useState(false);

  /* 最新状态引用，供事件回调读取（避免闭包过期） */
  const stateRef = useRef({ tracks, currentId, loop, shuffle });
  stateRef.current = { tracks, currentId, loop, shuffle };

  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const indexOf = useCallback((id: string) => {
    const { tracks } = stateRef.current;
    return tracks.findIndex((t) => t.id === id);
  }, []);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
    }
  }, []);

  const play = useCallback(
    async (id: string) => {
      const a = getAudio();
      const blob = await getTrackBlob(id);
      if (!blob) return;
      a.pause();
      revoke();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setCurrentId(id);
      setLoading(true);
      setTime(0);
      setDuration(0);
      a.src = url;
      a.playbackRate = speed;
      a.play()
        .then(() => setLoading(false))
        .catch(() => setLoading(false));
    },
    [getAudio, revoke, speed],
  );
  const playRef = useRef(play);
  playRef.current = play;

  const next = useCallback(
    (auto = false) => {
      const { tracks, currentId, shuffle, loop } = stateRef.current;
      if (!tracks.length) return;
      if (auto && loop === 'one' && currentId) {
        const a = getAudio();
        a.currentTime = 0;
        void a.play().catch(() => undefined);
        return;
      }
      let idx: number;
      if (shuffle && tracks.length > 1) {
        const cur = currentId ? indexOf(currentId) : -1;
        do {
          idx = Math.floor(Math.random() * tracks.length);
        } while (idx === cur);
      } else if (currentId) {
        const cur = indexOf(currentId);
        const n = cur + 1;
        if (n >= tracks.length) {
          if (loop === 'all') idx = 0;
          else {
            const a = getAudio();
            a.pause();
            a.currentTime = 0;
            return;
          }
        } else idx = n;
      } else {
        idx = 0;
      }
      void playRef.current(tracks[idx].id);
    },
    [getAudio, indexOf],
  );
  const nextRef = useRef(next);
  nextRef.current = next;

  const prev = useCallback(() => {
    const a = getAudio();
    if (a.currentTime > 3) {
      a.currentTime = 0;
      setTime(0);
      return;
    }
    const { tracks, currentId } = stateRef.current;
    if (!tracks.length) return;
    const cur = currentId ? indexOf(currentId) : -1;
    const p = cur <= 0 ? tracks.length - 1 : cur - 1;
    void playRef.current(tracks[p].id);
  }, [getAudio, indexOf]);
  const prevRef = useRef(prev);
  prevRef.current = prev;

  /* 初始化 audio 事件 */
  useEffect(() => {
    const a = getAudio();
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDuration(isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => nextRef.current(true);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
      a.pause();
      revoke();
    };
  }, [getAudio, revoke]);

  /* 倍速 */
  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    const a = audioRef.current;
    if (a) a.playbackRate = s;
  }, []);

  const seek = useCallback(
    (t: number) => {
      const a = getAudio();
      if (a && isFinite(a.duration)) {
        a.currentTime = Math.min(Math.max(0, t), a.duration);
        setTime(a.currentTime);
      }
    },
    [getAudio],
  );
  const seekRef = useRef(seek);
  seekRef.current = seek;

  const toggle = useCallback(() => {
    const a = getAudio();
    if (!currentId) {
      const { tracks } = stateRef.current;
      if (tracks.length) void playRef.current(tracks[0].id);
      return;
    }
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  }, [getAudio, currentId]);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  /* Android 锁屏 / 系统媒体面板 / 蓝牙耳机命令统一回到同一个 HTMLAudioElement。 */
  useEffect(() => {
    let disposed = false;
    let removeListener: (() => Promise<void>) | null = null;

    void addMediaControlListener((event) => {
      const a = getAudio();
      switch (event.action) {
        case 'play': {
          const { currentId: activeId, tracks: currentTracks } = stateRef.current;
          if (activeId) void a.play().catch(() => undefined);
          else if (currentTracks.length) void playRef.current(currentTracks[0].id);
          break;
        }
        case 'pause':
          a.pause();
          break;
        case 'toggle':
          toggleRef.current();
          break;
        case 'stop':
          a.pause();
          seekRef.current(0);
          break;
        case 'next':
          nextRef.current(false);
          break;
        case 'previous':
          prevRef.current();
          break;
        case 'seekTo':
          if (typeof event.position === 'number' && Number.isFinite(event.position)) {
            seekRef.current(event.position);
          }
          break;
        case 'seekForward':
          seekRef.current(a.currentTime + 10);
          break;
        case 'seekBackward':
          seekRef.current(a.currentTime - 10);
          break;
      }
    }).then((handle) => {
      if (!handle) return;
      if (disposed) void handle.remove();
      else removeListener = () => handle.remove();
    });

    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, [getAudio]);

  const playAll = useCallback(() => {
    const { tracks } = stateRef.current;
    if (tracks.length) void playRef.current(tracks[0].id);
  }, []);

  const refreshTracks = useCallback(async () => {
    try {
      setTracks(await listTracks());
    } catch {
      /* IndexedDB 不可用时保持空列表 */
    }
  }, []);

  useEffect(() => {
    void refreshTracks();
  }, [refreshTracks]);

  const addTrack = useCallback(
    async (p: {
      clipId: string;
      title: string;
      artist: string;
      cover?: string;
      blob: Blob;
      fileName: string;
      mimeType: string;
      format: string;
    }) => {
      const meta = await libAddTrack(p);
      setTracks((t) => [meta, ...t]);
      return meta;
    },
    [],
  );

  const removeTrack = useCallback(
    async (id: string) => {
      const rest = await libRemoveTrack(id);
      setTracks(rest);
      if (id === stateRef.current.currentId) {
        const a = getAudio();
        a.pause();
        a.removeAttribute('src');
        revoke();
        setCurrentId(null);
        setTime(0);
        setDuration(0);
        if (rest.length) void playRef.current(rest[0].id);
      }
    },
    [getAudio, revoke],
  );

  const clearAll = useCallback(async () => {
    const a = getAudio();
    a.pause();
    a.removeAttribute('src');
    revoke();
    for (const t of stateRef.current.tracks) await libRemoveTrack(t.id);
    setTracks([]);
    setCurrentId(null);
    setTime(0);
    setDuration(0);
  }, [getAudio, revoke]);

  const current = useMemo(
    () => tracks.find((t) => t.id === currentId) || null,
    [tracks, currentId],
  );

  /* PlaybackState 会按速度自行推进位置；每秒校准一次，避免高频桥调用。 */
  const mediaPosition = Math.max(0, Math.floor(time));
  useEffect(() => {
    if (!current) {
      void clearMediaSession();
      return;
    }
    void syncMediaSession({
      title: current.title || '未知歌曲',
      artist: current.artist || 'Suno AI',
      artworkUrl: current.cover,
      duration,
      position: mediaPosition,
      playing,
      playbackRate: speed,
    });
  }, [current, duration, mediaPosition, playing, speed]);

  useEffect(
    () => () => {
      void clearMediaSession();
    },
    [],
  );

  const value: PlayerContextValue = {
    tracks,
    currentId,
    current,
    playing,
    loading,
    time,
    duration,
    speed,
    loop,
    shuffle,
    refreshTracks,
    addTrack,
    play: (id) => void play(id),
    toggle,
    next: () => next(false),
    prev,
    seek,
    setSpeed,
    setLoop,
    toggleShuffle: () => setShuffle((s) => !s),
    removeTrack,
    playAll,
    clearAll,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

