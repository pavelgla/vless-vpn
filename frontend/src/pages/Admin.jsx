import { useState, useCallback, useEffect, useRef } from 'react';
import { usersApi, statsApi } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import DeviceList from '../components/DeviceList';
import TrafficChart from '../components/TrafficChart';

const POLL_INTERVAL = 30_000;
const ONLINE_MS     = 3 * 60 * 1000;

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU');
}

function userStatus(u) {
  if (!u.expires_at) return { label: 'Активен', cls: 'bg-emerald-900/40 text-emerald-400' };
  const expires  = new Date(u.expires_at);
  if (expires <= Date.now()) return { label: 'Заблокирован', cls: 'bg-red-900/40 text-red-400' };
  const daysLeft = Math.ceil((expires - Date.now()) / 86400000);
  if (daysLeft <= 7) return { label: `${daysLeft}д`, cls: 'bg-yellow-900/40 text-yellow-400' };
  return { label: 'Активен', cls: 'bg-emerald-900/40 text-emerald-400' };
}

function ServerStats({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Пользователей',   value: stats.users },
    { label: 'Устройств',       value: stats.devices },
    { label: 'Онлайн сейчас',   value: stats.online_devices ?? 0 },
    { label: 'CPU',             value: `${stats.cpu?.usage_pct ?? '—'}%` },
    { label: 'RAM',             value: `${stats.memory?.usage_pct ?? '—'}%` },
    { label: 'Трафик (всего)',  value: fmtBytes(stats.traffic?.total) },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
      {items.map(({ label, value }) => (
        <div key={label} className="card text-center">
          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function Admin() {
  const [users,      setUsers]  = useState([]);
  const [serverStats, setServer] = useState(null);
  const [onlineDevs, setOnline]  = useState([]);
  const [error,      setError]   = useState('');

  const [addOpen,       setAddOpen]       = useState(false);
  const [devicesModal,  setDevicesModal]  = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [statsModal,    setStatsModal]    = useState(null); // { user }

  const [form, setForm]           = useState({ login: '', password: '', expires_at: '' });
  const [formLoading, setFormLoading] = useState(false);
  const [formError,   setFormError]   = useState('');

  const load = useCallback(async () => {
    try {
      const [uRes, sRes, oRes] = await Promise.allSettled([
        usersApi.list(),
        statsApi.server(),
        statsApi.online(),
      ]);
      if (uRes.status === 'fulfilled') setUsers(uRes.value.data);
      if (sRes.status === 'fulfilled') setServer(sRes.value.data);
      if (oRes.status === 'fulfilled') setOnline(oRes.value.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    }
  }, []);

  usePolling(load, POLL_INTERVAL);

  // Build user traffic lookup from server stats
  const trafficByUserId = {};
  for (const t of serverStats?.user_traffic || []) {
    trafficByUserId[t.id] = t;
  }

  const handleBlock = async (user) => {
    const isBlocked = user.expires_at && new Date(user.expires_at) <= new Date();
    try {
      await usersApi.update(user.id, {
        expires_at: isBlocked ? null : new Date(0).toISOString(),
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await usersApi.remove(confirmDelete.id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка удаления');
    } finally {
      setDeleting(false);
    }
  };

  const openDevices = async (user) => {
    try {
      const res = await usersApi.devices(user.id);
      setDevicesModal({ user, devices: res.data });
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка');
    }
  };

  const refreshDevicesModal = async () => {
    if (!devicesModal) return;
    const res = await usersApi.devices(devicesModal.user.id);
    setDevicesModal(m => ({ ...m, devices: res.data }));
    await load();
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      await usersApi.create({
        login:      form.login,
        password:   form.password,
        expires_at: form.expires_at || undefined,
      });
      setForm({ login: '', password: '', expires_at: '' });
      setAddOpen(false);
      await load();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Ошибка');
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Управление пользователями</h1>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>
          + Добавить пользователя
        </button>
      </div>

      {error && <p className="text-red-400 text-sm bg-red-900/20 px-4 py-2 rounded-lg">{error}</p>}

      <ServerStats stats={serverStats} />

      {/* Currently online devices */}
      {onlineDevs.length > 0 && (
        <div className="card">
          <p className="text-sm font-medium text-emerald-400 mb-3">
            Онлайн сейчас — {onlineDevs.length}
          </p>
          <div className="space-y-1">
            {onlineDevs.map(d => (
              <div key={d.id} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="font-medium">{d.name}</span>
                  {d.owner_login && (
                    <span className="text-gray-500 text-xs">({d.owner_login})</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 text-right">
                  {d.last_ip && <span className="font-mono mr-3">{d.last_ip}</span>}
                  <span>{new Date(d.last_seen_at).toLocaleTimeString('ru-RU', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit log */}
      <AuditLog />

      {/* Users table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Логин</th>
              <th>Устройства</th>
              <th>Трафик (30д)</th>
              <th>Срок действия</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const st        = userStatus(u);
              const isBlocked = u.expires_at && new Date(u.expires_at) <= new Date();
              const traffic   = trafficByUserId[u.id];
              const totalBytes = (traffic?.bytes_up || 0) + (traffic?.bytes_down || 0);
              return (
                <tr key={u.id} className="hover:bg-gray-900/40">
                  <td className="font-medium">
                    {u.login}
                    {u.role === 'superadmin' && (
                      <span className="ml-2 badge bg-brand-900/50 text-brand-400">admin</span>
                    )}
                  </td>
                  <td className="tabular-nums">{u.device_count}/5</td>
                  <td className="text-gray-400 tabular-nums text-sm">{fmtBytes(totalBytes)}</td>
                  <td className="text-gray-400 text-sm">{fmtDate(u.expires_at)}</td>
                  <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                  <td>
                    <div className="flex gap-1.5 flex-wrap">
                      <button className="btn-ghost btn-sm text-xs" onClick={() => openDevices(u)}>
                        Устройства
                      </button>
                      <button
                        className="btn-ghost btn-sm text-xs"
                        onClick={() => setStatsModal(u)}
                      >
                        График
                      </button>
                      {u.role !== 'superadmin' && (
                        <>
                          <button
                            className={`btn-sm btn text-xs ${
                              isBlocked
                                ? 'bg-emerald-900/30 hover:bg-emerald-900/60 text-emerald-400'
                                : 'bg-yellow-900/30 hover:bg-yellow-900/60 text-yellow-400'
                            }`}
                            onClick={() => handleBlock(u)}
                          >
                            {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                          </button>
                          <button
                            className="btn-sm btn text-xs bg-red-900/30 hover:bg-red-900/60 text-red-400"
                            onClick={() => setConfirmDelete(u)}
                          >
                            Удалить
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-500 py-8">
                  Пользователей нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add user modal */}
      {addOpen && (
        <Modal title="Добавить пользователя" onClose={() => { setAddOpen(false); setFormError(''); }} size="sm">
          <form onSubmit={handleAddUser} className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Логин</label>
              <input autoFocus value={form.login}
                onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                placeholder="username" required maxLength={64} />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Пароль</label>
              <input type="password" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Минимум 8 символов" required minLength={8} />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">
                Срок действия <span className="text-gray-600">(необязательно)</span>
              </label>
              <input type="date" value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </div>
            {formError && (
              <p className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">{formError}</p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn-primary" disabled={formLoading}>
                {formLoading ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Devices modal */}
      {devicesModal && (
        <Modal title={`Устройства — ${devicesModal.user.login}`}
          onClose={() => setDevicesModal(null)} size="lg">
          <DeviceList devices={devicesModal.devices} onRefresh={refreshDevicesModal}
            adminUserId={devicesModal.user.id} />
        </Modal>
      )}

      {/* User traffic chart modal */}
      {statsModal && (
        <Modal title={`Трафик — ${statsModal.login}`}
          onClose={() => setStatsModal(null)} size="lg">
          <UserTrafficChart userId={statsModal.id} />
        </Modal>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <ConfirmModal
          title="Удалить пользователя?"
          message={`Пользователь «${confirmDelete.login}» и все его устройства будут удалены без возможности восстановления.`}
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  login_ok:       { label: 'Вход',                cls: 'bg-emerald-900/40 text-emerald-400' },
  login_fail:     { label: 'Неудачный вход',      cls: 'bg-red-900/40 text-red-400' },
  logout:         { label: 'Выход',               cls: 'bg-gray-800 text-gray-400' },
  password_change:{ label: 'Смена пароля',        cls: 'bg-blue-900/40 text-blue-400' },
  device_create:  { label: 'Устройство добавлено',cls: 'bg-brand-900/40 text-brand-400' },
  device_delete:  { label: 'Устройство удалено',  cls: 'bg-red-900/40 text-red-400' },
  device_rename:  { label: 'Переименование',      cls: 'bg-yellow-900/40 text-yellow-400' },
  user_create:    { label: 'Пользователь создан', cls: 'bg-brand-900/40 text-brand-400' },
  user_delete:    { label: 'Пользователь удалён', cls: 'bg-red-900/40 text-red-400' },
  user_block:     { label: 'Заблокирован',        cls: 'bg-red-900/40 text-red-400' },
  user_unblock:   { label: 'Разблокирован',       cls: 'bg-emerald-900/40 text-emerald-400' },
};

function auditDetails(action, details) {
  if (!details) return '';
  if (action === 'login_ok' || action === 'login_fail') return details.login || '';
  if (action === 'device_create') return details.device_name || '';
  if (action === 'device_delete') return details.device_name || '';
  if (action === 'device_rename') return `${details.old_name} → ${details.new_name}`;
  if (action === 'user_create' || action === 'user_delete') return details.login || '';
  if (action === 'user_block' || action === 'user_unblock') return details.login || '';
  return '';
}

function AuditLog() {
  const [entries, setEntries]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [open,    setOpen]      = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await statsApi.audit(200);
      setEntries(res.data);
      loaded.current = true;
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    if (!open && !loaded.current) load();
    setOpen(v => !v);
  };

  return (
    <div className="card">
      <button
        className="flex w-full items-center justify-between text-sm font-medium"
        onClick={toggle}
      >
        <span>Журнал действий</span>
        <span className="text-gray-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-4">
          {loading && <p className="text-sm text-gray-500">Загрузка...</p>}
          {entries && entries.length === 0 && (
            <p className="text-sm text-gray-500">Записей нет</p>
          )}
          {entries && entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Время</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Пользователь</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Действие</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">Детали</th>
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => {
                    const meta = ACTION_LABELS[e.action] || { label: e.action, cls: 'bg-gray-800 text-gray-400' };
                    return (
                      <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                        <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString('ru-RU', {
                            day: '2-digit', month: '2-digit', year: '2-digit',
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                        </td>
                        <td className="py-2 px-3 text-xs font-medium">
                          {e.user_login || <span className="text-gray-600">—</span>}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`badge text-xs ${meta.cls}`}>{meta.label}</span>
                        </td>
                        <td className="py-2 px-3 text-xs text-gray-400">
                          {auditDetails(e.action, e.details) || <span className="text-gray-600">—</span>}
                        </td>
                        <td className="py-2 px-3 text-xs font-mono text-gray-500">
                          {e.ip || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Per-user traffic chart: loads all devices then shows combined chart
function UserTrafficChart({ userId }) {
  const [devices, setDevices] = useState(null);

  useEffect(() => {
    usersApi.devices(userId)
      .then(r => setDevices(r.data))
      .catch(() => setDevices([]));
  }, [userId]);

  if (!devices) return <p className="text-gray-500 text-sm">Загрузка...</p>;
  if (devices.length === 0) return <p className="text-gray-500 text-sm">Нет устройств</p>;

  return (
    <div className="space-y-6">
      {devices.map(d => (
        <div key={d.id}>
          <p className="text-sm text-gray-400 mb-2">{d.name}</p>
          <TrafficChart deviceId={d.id} />
        </div>
      ))}
    </div>
  );
}
