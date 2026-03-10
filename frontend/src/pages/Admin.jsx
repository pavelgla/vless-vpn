import { useState, useCallback } from 'react';
import { usersApi, statsApi } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import DeviceList from '../components/DeviceList';

const POLL_INTERVAL = 30_000;

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU');
}

function userStatus(u) {
  if (!u.expires_at) return { label: 'Активен', cls: 'bg-emerald-900/40 text-emerald-400' };
  const expires = new Date(u.expires_at);
  if (expires.getTime() <= Date.now()) return { label: 'Заблокирован', cls: 'bg-red-900/40 text-red-400' };
  const daysLeft = Math.ceil((expires - Date.now()) / 86400000);
  if (daysLeft <= 7) return { label: `${daysLeft}д`, cls: 'bg-yellow-900/40 text-yellow-400' };
  return { label: 'Активен', cls: 'bg-emerald-900/40 text-emerald-400' };
}

// Server stats mini-widget
function ServerStats({ stats }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
      {[
        { label: 'Пользователей', value: stats.users },
        { label: 'Устройств',    value: stats.devices },
        { label: 'CPU',          value: `${stats.cpu?.usage_pct ?? '—'}%` },
        { label: 'RAM',          value: `${stats.memory?.usage_pct ?? '—'}%` },
      ].map(({ label, value }) => (
        <div key={label} className="card text-center">
          <p className="text-xs text-gray-500 mb-0.5">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function Admin() {
  const [users, setUsers]         = useState([]);
  const [serverStats, setServer]  = useState(null);
  const [error, setError]         = useState('');

  // Modal state
  const [addOpen, setAddOpen]           = useState(false);
  const [devicesModal, setDevicesModal] = useState(null); // { user, devices }
  const [confirmDelete, setConfirmDelete] = useState(null); // user to delete
  const [deleting, setDeleting]         = useState(false);

  // Add user form
  const [form, setForm] = useState({ login: '', password: '', expires_at: '' });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError]     = useState('');

  const load = useCallback(async () => {
    try {
      const [uRes, sRes] = await Promise.allSettled([
        usersApi.list(),
        statsApi.server(),
      ]);
      if (uRes.status === 'fulfilled') setUsers(uRes.value.data);
      if (sRes.status === 'fulfilled') setServer(sRes.value.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    }
  }, []);

  usePolling(load, POLL_INTERVAL);

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

      {/* Users table */}
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="table-auto w-full">
          <thead>
            <tr>
              <th>Логин</th>
              <th>Устройства</th>
              <th>Трафик (всего)</th>
              <th>Срок действия</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const st = userStatus(u);
              const isBlocked = u.expires_at && new Date(u.expires_at) <= new Date();
              return (
                <tr key={u.id} className="hover:bg-gray-900/40">
                  <td className="font-medium">
                    {u.login}
                    {u.role === 'superadmin' && (
                      <span className="ml-2 badge bg-brand-900/50 text-brand-400">admin</span>
                    )}
                  </td>
                  <td className="tabular-nums">{u.device_count}/5</td>
                  <td className="text-gray-400 tabular-nums">—</td>
                  <td className="text-gray-400 text-sm">{fmtDate(u.expires_at)}</td>
                  <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                  <td>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        className="btn-ghost btn-sm text-xs"
                        onClick={() => openDevices(u)}
                      >
                        Устройства
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
              <input
                autoFocus
                value={form.login}
                onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                placeholder="username"
                required
                maxLength={64}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Пароль</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Минимум 8 символов"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">
                Срок действия <span className="text-gray-600">(необязательно)</span>
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
              />
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
        <Modal
          title={`Устройства — ${devicesModal.user.login}`}
          onClose={() => setDevicesModal(null)}
          size="lg"
        >
          <DeviceList
            devices={devicesModal.devices}
            onRefresh={refreshDevicesModal}
            adminUserId={devicesModal.user.id}
          />
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
