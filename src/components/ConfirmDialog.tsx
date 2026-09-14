import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-mask" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <section
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={'modal-icon' + (danger ? ' danger' : '')}>
          <AlertTriangle size={20} strokeWidth={2} />
        </div>
        <div className="confirm-copy">
          <div id="confirm-dialog-title" className="modal-title">{title}</div>
          <p id="confirm-dialog-message" className="modal-message">{message}</p>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy} type="button">
            <X size={14} strokeWidth={2} />
            {cancelLabel}
          </button>
          <button
            className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')}
            onClick={() => void onConfirm()}
            disabled={busy}
            type="button"
          >
            {busy && <span className="spinner" />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
