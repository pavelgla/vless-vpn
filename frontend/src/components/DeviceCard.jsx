import { useState } from 'react';
import QRModal from './QRModal';
import ConfirmModal from './ConfirmModal';
import TrafficChart from './TrafficChart';
import { statsApi } from '../api/client';

const ONLINE_MS = 3 * 60 * 1000;

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_MS;
}

function fmtDateTime(iso) {
  if (!iso) return 'Никогда';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function DeviceCard({ device, onRename, onDelete }) {
  const [showQR,      setShowQR]      = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showChart,   setShowChart]   = useState(false);
  const [showConns,   setShowConns]   = useState(false);
  const [connections, setConnections] = useState(null);
  const [renaming,    setRenaming]    = useState(false);
  const [newName,     setNewName]     = useState(device.name);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError,   setRenameError]   = useState('');
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

  const loadConnections = async () => {
    if (!showConns) {
      try {
        const res = await statsApi.connections(device.id);
        setConnections(res.data);
      } catch {
        setConnections([]);
      }
    }
    setShowConns(v => !v);
  };

  return (
    <>
      <div className="card flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              online ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-gray-600'
            }`} />
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
                <button type="button" className="btn-ghost btn-sm"
                  onClick={() => { setRenaming(false); setNewName(device.name); }}>
                  ✕
                </button>
              </form>
            ) : (
              <span className="font-semibold truncate">{device.name}</span>
            )}
          </div>
          <span className={`badge flex-shrink-0 ${
            online ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500'
          }`}>
            {online ? 'онлайн' : 'офлайн'}
          </span>
        </div>

        {renameError && <p className="text-red-400 text-xs">{renameError}</p>}

        {/* Info rows */}
        <div className="text-xs text-gray-500 space-y-1">
          <div className="flex justify-between">
            <span>Последняя активность:</span>
            <span className="text-gray-400">{fmtDateTime(device.last_seen_at)}</span>
          </div>
          {device.last_ip && (
            <div className="flex justify-between">
              <span>IP:</span>
              <span className="text-gray-400 font-mono">{device.last_ip}</span>
            </div>
          )}
          {(device.bytes_up > 0 || device.bytes_down > 0) && (
            <div className="flex justify-between">
              <span>Трафик (всего):</span>
              <span className="text-gray-400">
                ↑{fmtBytes(device.bytes_up)} ↓{fmtBytes(device.bytes_down)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Добавлено:</span>
            <span className="text-gray-400">{fmtDate(device.created_at)}</span>
          </div>
          {device.owner_login && (
            <div className="flex justify-between">
              <span>Владелец:</span>
              <span className="text-gray-400">{device.owner_login}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap pt-1">
          <button className="btn-ghost btn-sm text-xs" onClick={() => setShowQR(true)}>
            QR-код
          </button>
          {!renaming && (
            <button className="btn-ghost btn-sm text-xs"
              onClick={() => { setRenaming(true); setNewName(device.name); }}>
              Переименовать
            </button>
          )}
          <button className="btn-ghost btn-sm text-xs"
            onClick={() => setShowChart(v => !v)}>
            {showChart ? 'Скрыть график' : 'График'}
          </button>
          <button className="btn-ghost btn-sm text-xs" onClick={loadConnections}>
            {showConns ? 'Скрыть сессии' : 'Сессии'}
          </button>
          <button
            className="btn-sm btn text-xs bg-red-900/30 hover:bg-red-900/60 text-red-400"
            onClick={() => setShowConfirm(true)}
          >
            Удалить
          </button>
        </div>

        {/* Traffic chart (expandable) */}
        {showChart && (
          <div className="pt-2 border-t border-gray-800">
            <TrafficChart deviceId={device.id} />
          </div>
        )}

        {/* Connection history (expandable) */}
        {showConns && (
          <div className="pt-2 border-t border-gray-800">
            <p className="text-xs text-gray-500 mb-2 font-medium">Последние подключения</p>
            {!connections && <p className="text-xs text-gray-600">Загрузка...</p>}
            {connections && connections.length === 0 && (
              <p className="text-xs text-gray-600">Нет данных</p>
            )}
            {connections && connections.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {connections.map((c, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-500">
                    <span className="font-mono text-gray-400">{c.client_ip || '—'}</span>
                    <span>{new Date(c.connected_at).toLocaleString('ru-RU', {
                      day: '2-digit', month: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showQR && <QRModal device={device} onClose={() => setShowQR(false)} />}
      {showConfirm && (
        <ConfirmModal
          title="Удалить устройство?"
          message={`Устройство «${device.name}» будет удалено и доступ по его UUID отозван.`}
          loading={deleteLoading}
          onConfirm={handleDelete}
          onClose={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
