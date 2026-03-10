import { useState } from 'react';
import QRModal from './QRModal';
import ConfirmModal from './ConfirmModal';

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return 'Никогда';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function DeviceCard({ device, onRename, onDelete }) {
  const [showQR, setShowQR] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(device.name);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const online = isOnline(device.last_seen_at);

  const submitRename = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || name === device.name) { setRenaming(false); return; }
    setRenameLoading(true);
    setRenameError('');
    try {
      await onRename(device.id, name);
      setRenaming(false);
    } catch (err) {
      setRenameError(err.response?.data?.message || 'Ошибка');
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await onDelete(device.id);
    } catch {
      setDeleteLoading(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <div className="card flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${online ? 'bg-emerald-500' : 'bg-gray-600'}`} />
            {renaming ? (
              <form onSubmit={submitRename} className="flex gap-2 items-center min-w-0">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  maxLength={32}
                  className="text-sm py-1 px-2"
                />
                <button type="submit" className="btn-primary btn-sm" disabled={renameLoading}>
                  {renameLoading ? '...' : 'OK'}
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setRenaming(false); setNewName(device.name); }}>
                  ✕
                </button>
              </form>
            ) : (
              <span className="font-semibold truncate">{device.name}</span>
            )}
          </div>
          <span className={`badge flex-shrink-0 ${online ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
            {online ? 'онлайн' : 'офлайн'}
          </span>
        </div>

        {renameError && <p className="text-red-400 text-xs">{renameError}</p>}

        <div className="text-xs text-gray-500 space-y-1">
          <div>Последняя активность: <span className="text-gray-400">{fmtDateTime(device.last_seen_at)}</span></div>
          <div>Добавлено: <span className="text-gray-400">{fmtDate(device.created_at)}</span></div>
          {device.owner_login && (
            <div>Владелец: <span className="text-gray-400">{device.owner_login}</span></div>
          )}
        </div>

        <div className="flex gap-2 flex-wrap pt-1">
          <button className="btn-ghost btn-sm text-xs" onClick={() => setShowQR(true)}>
            QR-код
          </button>
          {!renaming && (
            <button className="btn-ghost btn-sm text-xs" onClick={() => { setRenaming(true); setNewName(device.name); }}>
              Переименовать
            </button>
          )}
          <button
            className="btn-sm btn text-xs bg-red-900/30 hover:bg-red-900/60 text-red-400"
            onClick={() => setShowConfirm(true)}
          >
            Удалить
          </button>
        </div>
      </div>

      {showQR && <QRModal device={device} onClose={() => setShowQR(false)} />}
      {showConfirm && (
        <ConfirmModal
          title="Удалить устройство?"
          message={`Устройство «${device.name}» будет удалено и доступ по его UUID отозван. Это действие необратимо.`}
          loading={deleteLoading}
          onConfirm={handleDelete}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
