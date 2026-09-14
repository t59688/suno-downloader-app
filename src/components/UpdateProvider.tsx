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
import { Download, Sparkles, X } from 'lucide-react';
import { APP_VERSION, checkLatestUpdate, downloadUpdate, type UpdateInfo } from '../core/update';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'queued'
  | 'error';

interface UpdateContextValue {
  currentVersion: string;
  status: UpdateStatus;
  info: UpdateInfo | null;
  error: string;
  check: () => Promise<void>;
  download: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdate(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error('useUpdate 必须在 UpdateProvider 内使用');
  return value;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async (automatic: boolean) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setStatus('checking');
    setError('');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const result = await checkLatestUpdate(controller.signal);
      setInfo(result);
      if (result.isNewer) {
        setStatus('available');
        if (automatic && result.apkUrl) setPromptOpen(true);
      } else {
        setStatus('current');
      }
    } catch (cause) {
      const message = cause instanceof DOMException && cause.name === 'AbortError'
        ? '检查更新超时，请稍后重试'
        : cause instanceof Error
          ? cause.message
          : '检查更新失败';
      setStatus('error');
      setError(message);
    } finally {
      window.clearTimeout(timer);
      checkingRef.current = false;
    }
  }, []);

  const check = useCallback(() => runCheck(false), [runCheck]);

  const download = useCallback(async () => {
    if (!info) return;
    setStatus('downloading');
    setError('');
    try {
      await downloadUpdate(info);
      setStatus('queued');
      setPromptOpen(false);
    } catch (cause) {
      setStatus('error');
      setError(cause instanceof Error ? cause.message : '更新下载失败');
    }
  }, [info]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runCheck(true), 900);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  useEffect(() => {
    if (!promptOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && status !== 'downloading') setPromptOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [promptOpen, status]);

  const value = useMemo<UpdateContextValue>(
    () => ({ currentVersion: APP_VERSION, status, info, error, check, download }),
    [status, info, error, check, download],
  );

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {promptOpen && info && (
        <div
          className="modal-mask"
          role="presentation"
          onMouseDown={() => status !== 'downloading' && setPromptOpen(false)}
        >
          <section
            className="modal update-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-dialog-title"
            aria-describedby={info.notes ? 'update-dialog-notes' : undefined}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setPromptOpen(false)}
              aria-label="稍后更新"
              disabled={status === 'downloading'}
              type="button"
            >
              <X size={17} strokeWidth={2} />
            </button>
            <div className="update-mark"><Sparkles size={22} strokeWidth={1.9} /></div>
            <div id="update-dialog-title" className="modal-title update-title">发现新版本</div>
            <div className="update-version-row">
              <span>v{APP_VERSION}</span>
              <i>→</i>
              <strong>v{info.version}</strong>
            </div>
            {info.notes && <p id="update-dialog-notes" className="update-notes">{info.notes.slice(0, 900)}</p>}
            <div className="modal-actions update-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setPromptOpen(false)}
                disabled={status === 'downloading'}
                type="button"
              >
                稍后
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void download()}
                disabled={status === 'downloading'}
                type="button"
              >
                {status === 'downloading' ? <span className="spinner" /> : <Download size={15} strokeWidth={2} />}
                {status === 'downloading' ? '正在下载…' : '下载更新'}
              </button>
            </div>
          </section>
        </div>
      )}
    </UpdateContext.Provider>
  );
}
