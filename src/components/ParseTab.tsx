/**
 * 解析 Tab：粘贴 Suno 链接 → 解析 → 选择格式下载
 *  - 解析成功后自动写入「历史」记录
 *  - 音频下载完成后自动加入「播放器」曲库
 *  - 支持从「历史」页发起的再下载（pendingRedownload）
 *  - 全面集成 Lucide 规范图标与 Bento 格式网格
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Music,
  AudioWaveform,
  Binary,
  Video,
  Image as ImageIcon,
  FileText,
  Archive,
  Download,
  ClipboardPaste,
  Sparkles,
  Check,
  AlertCircle,
  RotateCcw,
  HardDriveDownload,
  X,
} from 'lucide-react';
import { extractId, fetchAndParse, fetchAndParsePlaylist } from '../core/sunoParser';
import { fetchPage } from '../core/http';
import { downloadTrack, downloadAll, type DownloadFormat, type DownloadResult } from '../core/download';
import { isNative, nativeSave, notifyStart, notifyProgress, notifyComplete, notifyFail, notifyCancel } from '../core/native';
import { upsertRecord } from '../core/records';
import AudioPlayer from './AudioPlayer';
import { usePlayer } from './PlayerContext';
import { RECORDS_CHANGED } from './HistoryTab';
import type { ClipInfo } from '../core/types';

type Phase = 'idle' | 'parsing' | 'ready' | 'downloading' | 'done' | 'error';

interface Props {
  pendingRedownload: ClipInfo | null;
  onConsumedRedownload: () => void;
}

function fmtSize(bytes: number): string {
  if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

const FORMATS: { key: DownloadFormat; label: string; desc: string }[] = [
  { key: 'mp3', label: 'MP3', desc: '320k · 带元标签' },
  { key: 'wav', label: 'WAV', desc: '无损原始采样' },
  { key: 'original', label: '原始音频', desc: '解密原生文件' },
  { key: 'mp4', label: 'MP4', desc: '高画质 MV 视频' },
  { key: 'cover', label: '高清封面', desc: '原图无损尺寸' },
  { key: 'lyrics', label: '歌词', desc: '纯文本 / LRC' },
];

const AUDIO_FORMATS: DownloadFormat[] = ['mp3', 'wav', 'original'];

const FormatIcons: Record<DownloadFormat | 'zip', ReactNode> = {
  mp3: <Music size={17} strokeWidth={1.9} />,
  wav: <AudioWaveform size={17} strokeWidth={1.9} />,
  original: <Binary size={17} strokeWidth={1.9} />,
  mp4: <Video size={17} strokeWidth={1.9} />,
  cover: <ImageIcon size={17} strokeWidth={1.9} />,
  lyrics: <FileText size={17} strokeWidth={1.9} />,
  zip: <Archive size={18} strokeWidth={1.9} />,
};

export default function ParseTab({ pendingRedownload, onConsumedRedownload }: Props) {
  const player = usePlayer();
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [clip, setClip] = useState<ClipInfo | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const lastNotifPct = useRef(-1);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* 历史页发起的再下载：直接复用已解析的数据 */
  useEffect(() => {
    if (!pendingRedownload) return;
    const c = pendingRedownload;
    resetResult();
    setInput('https://suno.com/song/' + c.id);
    setClip(c);
    setPhase('ready');
    setStage('已从历史载入，请选择格式开始下载');
    setError('');
    onConsumedRedownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRedownload]);

  const busy = phase === 'parsing' || phase === 'downloading';

  function resetResult() {
    setResult(null);
    setSavedMsg('');
    setProgress(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl('');
    }
  }

  /** 解析成功 → 写入历史记录 */
  function recordParsed(c: ClipInfo) {
    try {
      upsertRecord(c);
      window.dispatchEvent(new Event(RECORDS_CHANGED));
    } catch {
      /* 记录失败不影响主流程 */
    }
  }

  async function handleParse() {
    const raw = input.trim();
    if (!raw || busy) return;
    resetResult();
    setPhase('parsing');
    setError('');
    setClip(null);
    setStage('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      if (/\/playlist\//i.test(raw)) {
        const id = extractId(raw);
        if (!id) throw new Error('无法识别歌单链接');
        setStage('正在解析歌单…');
        const pl = await fetchAndParsePlaylist(id, fetchPage, ac.signal);
        if (!pl.clips.length) throw new Error('歌单里没有解析到歌曲');
        setStage(`歌单「${pl.name}」共 ${pl.clips.length} 首，展示第 1 首`);
        setClip(pl.clips[0]);
        recordParsed(pl.clips[0]);
      } else {
        const id = extractId(raw);
        if (!id) throw new Error('无法识别链接，请粘贴 Suno 歌曲 / Hook / 歌单链接');
        setStage('正在解析歌曲信息…');
        let c: ClipInfo | null = null;
        try {
          c = await fetchAndParse(id, fetchPage, ac.signal);
        } catch {
          c = null;
        }
        if ((!c || c._fallback) && !id.startsWith('h:')) {
          const bareId = id.replace(/^[sh]:/, '');
          try {
            const pl = await fetchAndParsePlaylist(bareId, fetchPage, ac.signal);
            if (pl.clips.length) {
              setStage(`歌单「${pl.name}」共 ${pl.clips.length} 首，展示第 1 首`);
              c = pl.clips[0];
            }
          } catch {
            /* 忽略 */
          }
        }
        if (!c) throw new Error('未能解析出歌曲信息，请确认链接是否有效公开');
        setClip(c);
        recordParsed(c);
      }
      setPhase('ready');
      if (!stage) setStage('解析完成，请选择所需格式');
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setPhase(clip ? 'ready' : 'idle');
        setStage('已取消');
        return;
      }
      setPhase('error');
      setError(e?.message || String(e));
    }
  }

  function wrapProgress() {
    return (p: number | null) => {
      setProgress(p);
      if (p != null && p >= 0) {
        const pct = Math.min(99, Math.round(p));
        if (pct !== lastNotifPct.current) {
          lastNotifPct.current = pct;
          notifyProgress(pct);
        }
      }
    };
  }

  /** 原生平台：下载完成后自动写入系统媒体库 */
  async function autoSave(r: DownloadResult) {
    if (!isNative) return;
    try {
      const res = await nativeSave(r.blob, r.fileName, r.mimeType);
      setSavedMsg('已保存到 ' + res.path);
      notifyComplete('已保存到 ' + res.path);
    } catch (e: any) {
      setSavedMsg('自动保存失败: ' + (e?.message || String(e)));
      notifyFail('保存失败');
    }
  }

  /** 音频下载完成 → 自动加入播放器曲库 */
  async function addToLibrary(r: DownloadResult, format: DownloadFormat) {
    if (!AUDIO_FORMATS.includes(format) || !clip) return;
    try {
      await player.addTrack({
        clipId: clip.id,
        title: clip.title || clip.id,
        artist: clip.display_name || clip.handle || 'Suno AI',
        cover: clip.image_url,
        blob: r.blob,
        fileName: r.fileName,
        mimeType: r.mimeType,
        format,
      });
      setSavedMsg((m) => (m ? m + ' · ' : '') + '已入库播放器');
    } catch {
      /* 入库失败不阻断 */
    }
  }

  async function handleDownload(format: DownloadFormat) {
    if (!clip || busy) return;
    setPhase('downloading');
    setError('');
    setSavedMsg('');
    setProgress(null);
    lastNotifPct.current = -1;
    notifyStart(
      clip.title || 'Suno 歌曲',
      (FORMATS.find((f) => f.key === format)?.label || format) + ' · 下载中',
    );
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await downloadTrack(clip, format, {
        signal: ac.signal,
        onStage: setStage,
        onProgress: wrapProgress(),
      });
      setResult(r);
      setResultUrl(URL.createObjectURL(r.blob));
      setPhase('done');
      setStage('完成');
      await autoSave(r);
      await addToLibrary(r, format);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setPhase('ready');
        setStage('已取消');
        notifyCancel();
        return;
      }
      setPhase('error');
      setError(e?.message || String(e));
      notifyFail(e?.message || '下载失败');
    }
  }

  async function handleAll() {
    if (!clip || busy) return;
    setPhase('downloading');
    setError('');
    setSavedMsg('');
    setProgress(null);
    lastNotifPct.current = -1;
    notifyStart(clip.title || 'Suno 歌曲', '全部文件（ZIP）· 下载中');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await downloadAll(clip, {
        signal: ac.signal,
        onStage: setStage,
        onProgress: wrapProgress(),
      });
      setResult(r);
      setResultUrl(URL.createObjectURL(r.blob));
      setPhase('done');
      setStage('完成');
      await autoSave(r);
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setPhase('ready');
        setStage('已取消');
        notifyCancel();
        return;
      }
      setPhase('error');
      setError(e?.message || String(e));
      notifyFail(e?.message || '下载失败');
    }
  }

  async function handleSave() {
    if (!result) return;
    try {
      if (isNative) {
        const res = await nativeSave(result.blob, result.fileName, result.mimeType);
        setSavedMsg((m) => (m ? m + ' · ' : '') + '已保存到 ' + res.path);
      } else {
        const a = document.createElement('a');
        a.href = resultUrl;
        a.download = result.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setSavedMsg((m) => (m ? m + ' · ' : '') + '已开始浏览器下载');
      }
    } catch (e: any) {
      setError('保存失败: ' + (e?.message || String(e)));
    }
  }

  const isAudio = result && result.mimeType.startsWith('audio/');
  const isVideo = result && result.mimeType.startsWith('video/');
  const isImage = result && result.mimeType.startsWith('image/');
  const tagList = clip?.metadata?.tags
    ? String(clip.metadata.tags).split(/[,，\s、]+/).filter(Boolean)
    : [];

  async function handlePaste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setInput(t.trim());
    } catch {
      /* 忽略 */
    }
  }

  function reset() {
    if (busy) return;
    abortRef.current?.abort();
    setInput('');
    setClip(null);
    setResult(null);
    setSavedMsg('');
    setStage('');
    setError('');
    setProgress(null);
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
      setResultUrl('');
    }
    setPhase('idle');
  }

  return (
    <div className="parse-tab">
      {/* 链接输入卡片 */}
      <section className="card">
        <textarea
          placeholder="粘贴 Suno 歌曲、Hook 或公开歌单链接…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleParse();
            }
          }}
        />
        <div className="input-actions">
          <button className="btn btn-ghost" onClick={handlePaste} disabled={busy} type="button">
            <ClipboardPaste size={15} strokeWidth={1.8} />
            粘贴
          </button>
          <button
            className="btn btn-primary"
            onClick={handleParse}
            disabled={busy || !input.trim()}
            type="button"
          >
            {busy ? (
              <>
                <span className="spinner" />
                解析中…
              </>
            ) : (
              <>
                <Sparkles size={15} strokeWidth={1.8} />
                解析歌曲
              </>
            )}
          </button>
        </div>
      </section>

      {/* 歌曲信息预览卡片 */}
      {clip && (
        <section className="card track-card">
          <div className="track-cover">
            {clip.image_url ? (
              <img src={clip.image_url} alt="" />
            ) : (
              <Music size={26} strokeWidth={1.8} />
            )}
          </div>
          <div className="track-info">
            <h2 className="track-title">{clip.title || clip.id}</h2>
            <p className="track-artist">
              <span>{clip.display_name || clip.handle || 'Suno'}</span>
              {clip.metadata?.duration ? <span>· {String(clip.metadata.duration)}s</span> : null}
            </p>
            {tagList.length > 0 && (
              <div className="track-tags">
                {tagList.slice(0, 4).map((t) => (
                  <span key={t} className="tag-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 格式下载 Bento Grid */}
      {(phase === 'ready' || phase === 'downloading' || phase === 'done') && clip && (
        <section className="card">
          <div className="formats-grid">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                className="format-btn"
                onClick={() => handleDownload(f.key)}
                disabled={busy || (f.key === 'mp4' && !clip.video_url)}
                type="button"
              >
                <div className="format-header">
                  <div className="format-ico-box">{FormatIcons[f.key]}</div>
                  <span className="format-dl-badge">
                    <Download size={15} strokeWidth={2} />
                  </span>
                </div>
                <div className="format-label">{f.label}</div>
                <div className="format-desc">
                  {f.key === 'mp4' && !clip.video_url ? '无视频源' : f.desc}
                </div>
              </button>
            ))}
          </div>

          <button className="btn all-btn full" onClick={handleAll} disabled={busy} type="button">
            {FormatIcons.zip}
            打包全部文件 · ZIP
          </button>
        </section>
      )}

      {/* 进度提示卡片 */}
      {busy && (
        <section className="card progress-card">
          <div className="progress-top">
            <span className="progress-label">
              <span className="spinner" />
              {stage || '正在处理中…'}
            </span>
            <button className="btn btn-quiet mini" onClick={() => abortRef.current?.abort()} type="button">
              <X size={14} strokeWidth={2} />
              取消
            </button>
          </div>
          <div className="progress-track">
            {progress != null && progress >= 0 ? (
              <div className="progress-fill" style={{ width: Math.max(4, Math.round(progress)) + '%' }} />
            ) : (
              <div className="progress-indet" />
            )}
          </div>
        </section>
      )}

      {/* 错误卡片 */}
      {phase === 'error' && (
        <section className="error-card">
          <div className="error-ico">
            <AlertCircle size={20} strokeWidth={2} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="error-msg">{error}</div>
            <div className="error-actions">
              <button className="btn btn-ghost mini" onClick={reset} type="button">
                <RotateCcw size={13} strokeWidth={2} />
                清空重试
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 完成结果卡片 */}
      {result && phase === 'done' && (
        <section className="card result-card">
          <div className="result-head">
            <div className="result-check">
              <Check size={18} strokeWidth={2.4} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="result-title">下载完成</div>
              <div className="result-file">
                {result.fileName} · {fmtSize(result.blob.size)}
              </div>
            </div>
          </div>

          <div className="result-preview">
            {isAudio && (
              <AudioPlayer
                src={resultUrl}
                title={clip?.title}
                artist={clip?.display_name || clip?.handle}
                cover={clip?.image_url}
              />
            )}
            {isVideo && <video controls src={resultUrl} />}
            {isImage && <img src={resultUrl} alt="" />}
          </div>

          <div className="result-actions">
            {(!isNative || !savedMsg.includes('已保存到')) && (
              <button className="btn btn-primary full" onClick={handleSave} type="button">
                <HardDriveDownload size={16} strokeWidth={2} />
                保存到设备
              </button>
            )}
            {savedMsg && <div className="saved-line">{savedMsg}</div>}
            <button className="btn btn-quiet full" onClick={reset} type="button">
              <RotateCcw size={14} strokeWidth={2} />
              继续解析新歌曲
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
