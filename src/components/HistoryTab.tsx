/**
 * 历史 Tab：本应用解析记录管理（CRUD）
 *  - 只收录通过本软件解析的歌曲
 *  - 编辑（标题/艺术家/风格标签）、删除、清空、再下载
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Download,
  Edit3,
  Trash2,
  Clock,
  Music,
  X,
  Check,
} from 'lucide-react';
import {
  loadRecords,
  updateRecord,
  deleteRecord,
  clearRecords,
  type ParseRecord,
} from '../core/records';
import type { ClipInfo } from '../core/types';
import ConfirmDialog from './ConfirmDialog';

export const RECORDS_CHANGED = 'suno:records-changed';

interface Props {
  onRedownload: (clip: ClipInfo) => void;
}

type ConfirmAction = { kind: 'clear' } | { kind: 'delete'; record: ParseRecord } | null;

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function HistoryTab({ onRedownload }: Props) {
  const [records, setRecords] = useState<ParseRecord[]>(() => loadRecords());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ParseRecord | null>(null);
  const [draft, setDraft] = useState({ title: '', artist: '', tags: '' });
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  useEffect(() => {
    const fn = () => setRecords(loadRecords());
    window.addEventListener(RECORDS_CHANGED, fn);
    return () => window.removeEventListener(RECORDS_CHANGED, fn);
  }, []);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!kw) return list;
    return list.filter(
      (r) =>
        r.title.toLowerCase().includes(kw) ||
        r.artist.toLowerCase().includes(kw) ||
        (r.tags || '').toLowerCase().includes(kw),
    );
  }, [records, q]);

  function openEdit(r: ParseRecord) {
    setEditing(r);
    setDraft({ title: r.title, artist: r.artist, tags: r.tags || '' });
  }

  function saveEdit() {
    if (!editing) return;
    setRecords(
      updateRecord(editing.id, {
        title: draft.title.trim() || editing.title,
        artist: draft.artist.trim(),
        tags: draft.tags.trim(),
      }),
    );
    setEditing(null);
  }

  const closeConfirm = useCallback(() => setConfirmAction(null), []);

  function applyConfirm() {
    if (!confirmAction) return;
    if (confirmAction.kind === 'clear') {
      setRecords(clearRecords());
    } else {
      setRecords(deleteRecord(confirmAction.record.id));
    }
    setConfirmAction(null);
  }

  const confirmTitle = confirmAction?.kind === 'clear' ? '清空解析记录？' : '删除这条记录？';
  const confirmMessage = confirmAction?.kind === 'clear'
    ? '解析历史会被清空，已经保存到设备的文件不会受到影响。'
    : confirmAction?.kind === 'delete'
      ? `「${confirmAction.record.title}」将从解析历史中移除。`
      : '';

  return (
    <div className="history-tab">
      <div className="hist-head">
        <div className="hist-title">
          解析记录 <em>{records.length} 条</em>
        </div>
        {records.length > 0 && (
          <button
            className="btn btn-quiet mini danger"
            onClick={() => setConfirmAction({ kind: 'clear' })}
            type="button"
          >
            <Trash2 size={13} strokeWidth={2} />
            清空
          </button>
        )}
      </div>

      {records.length > 0 && (
        <div className="hist-search-box">
          <Search size={15} strokeWidth={1.8} />
          <input
            className="hist-search"
            placeholder="搜索歌曲标题、艺术家或风格标签…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      )}

      {records.length === 0 ? (
        <div className="hist-empty">
          <Clock size={40} strokeWidth={1.5} />
          <p>暂无解析记录</p>
          <span>解析过的歌曲会自动汇总在这里。</span>
        </div>
      ) : (
        <ul className="hist-list">
          {filtered.map((r) => (
            <li key={r.id} className="hist-item">
              <div className="hist-cover">
                {r.cover ? <img src={r.cover} alt="" /> : <Music size={20} strokeWidth={1.8} />}
              </div>
              <div className="hist-meta">
                <div className="hist-t">{r.title}</div>
                <div className="hist-a">
                  {r.artist}
                  {r.duration ? ` · ${r.duration}s` : ''}
                </div>
                <div className="hist-d">{fmtDate(r.updatedAt)}</div>
              </div>
              <div className="hist-ops">
                <button
                  className="btn btn-quiet mini"
                  onClick={() => onRedownload(r.clip)}
                  title="重新下载"
                  type="button"
                >
                  <Download size={13} strokeWidth={2} />
                  下载
                </button>
                <button
                  className="btn btn-quiet mini"
                  onClick={() => openEdit(r)}
                  title="编辑"
                  type="button"
                >
                  <Edit3 size={13} strokeWidth={2} />
                  编辑
                </button>
                <button
                  className="btn btn-quiet mini danger"
                  title="删除"
                  onClick={() => setConfirmAction({ kind: 'delete', record: r })}
                  type="button"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && <li className="hist-none">未找到与关键词匹配的记录</li>}
        </ul>
      )}

      {editing && (
        <div className="modal-mask" role="presentation" onMouseDown={() => setEditing(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-edit-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div id="history-edit-title" className="modal-title">编辑记录信息</div>
            <label className="field">
              <span>歌曲标题</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="输入标题"
              />
            </label>
            <label className="field">
              <span>艺术家 / 创作者</span>
              <input
                value={draft.artist}
                onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
                placeholder="输入艺术家名称"
              />
            </label>
            <label className="field">
              <span>风格标签</span>
              <input
                value={draft.tags}
                placeholder="例如：Pop, Cinematic, Electronic"
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost mini" onClick={() => setEditing(null)} type="button">
                <X size={14} strokeWidth={2} />
                取消
              </button>
              <button className="btn btn-primary mini" onClick={saveEdit} type="button">
                <Check size={14} strokeWidth={2} />
                保存
              </button>
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction != null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmAction?.kind === 'clear' ? '清空记录' : '删除记录'}
        danger
        onCancel={closeConfirm}
        onConfirm={applyConfirm}
      />
    </div>
  );
}
