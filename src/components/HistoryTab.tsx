/**
 * 历史 Tab：本应用解析记录管理（CRUD）
 *  - 只收录通过本软件解析的歌曲
 *  - 编辑（标题/艺术家/风格标签）、删除、清空、再下载
 *  - 全面集成 Lucide 规范图标与 iOS 原生风格交互
 */
import { useEffect, useMemo, useState } from 'react';
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

export const RECORDS_CHANGED = 'suno:records-changed';

interface Props {
  /** 点击"再下载"：切回解析页并自动解析 */
  onRedownload: (clip: ClipInfo) => void;
}

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

  return (
    <div className="history-tab">
      <div className="hist-head">
        <div className="hist-title">
          解析记录 <em>{records.length} 条</em>
        </div>
        {records.length > 0 && (
          <button
            className="btn btn-quiet mini danger"
            onClick={() => {
              if (window.confirm('确定清空全部解析记录？（不影响已保存的文件）')) {
                setRecords(clearRecords());
              }
            }}
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
          <p>暂无解析历史记录</p>
          <span>在「解析」页输入或粘贴链接，解析后的记录会自动汇总在此</span>
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
                  onClick={() => {
                    if (window.confirm(`确认删除「${r.title}」的记录？`)) setRecords(deleteRecord(r.id));
                  }}
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

      {/* 编辑弹窗 */}
      {editing && (
        <div className="modal-mask" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">编辑记录信息</div>
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
          </div>
        </div>
      )}
    </div>
  );
}
