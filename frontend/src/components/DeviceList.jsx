import { useState } from 'react';
import DeviceCard from './DeviceCard';
import { devicesApi, usersApi } from '../api/client';

const MAX_DEVICES = 5;

/**
 * Reusable device list with add / rename / delete.
 * When `adminUserId` is set, calls /users/:id/* endpoints (superadmin context).
 */
export default function DeviceList({ devices, onRefresh, adminUserId = null }) {
  const [addName, setAddName] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDevice, setNewDevice] = useState(null); // show QR after creation

  const atLimit = devices.length >= MAX_DEVICES;

  const handleAdd = async (e) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    setAddLoading(true);
    setAddError('');
    try {
      const res = adminUserId
        ? await usersApi.addDevice(adminUserId, { name })
        : await devicesApi.create({ name });
      setNewDevice(res.data);
      setAddName('');
      setShowAddForm(false);
      await onRefresh();
    } catch (err) {
      setAddError(err.response?.data?.message || 'Ошибка при добавлении');
    } finally {
      setAddLoading(false);
    }
  };

  const handleRename = async (id, name) => {
    await devicesApi.rename(id, { name });
    await onRefresh();
  };

  const handleDelete = async (id) => {
    if (adminUserId) {
      await usersApi.removeDevice(adminUserId, id);
    } else {
      await devicesApi.remove(id);
    }
    await onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map(d => (
          <DeviceCard
            key={d.id}
            device={d}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        ))}
        {devices.length === 0 && (
          <p className="text-gray-500 text-sm col-span-full py-4">Устройств пока нет</p>
        )}
      </div>

      {/* New device QR quick-show */}
      {newDevice && (
        <div className="card border-brand-500/50 bg-brand-900/10">
          <p className="text-sm font-medium mb-2 text-brand-400">Устройство создано!</p>
          <p className="text-xs text-gray-500 break-all mb-3">{newDevice.link}</p>
          <img src={newDevice.qr} alt="QR" className="w-48 h-48 rounded-lg bg-white p-1 mb-3" />
          <button className="btn-ghost btn-sm text-xs" onClick={() => setNewDevice(null)}>
            Закрыть
          </button>
        </div>
      )}

      {/* Add device */}
      {atLimit ? (
        <p className="text-sm text-yellow-500/80 bg-yellow-500/10 rounded-lg px-4 py-2.5">
          Достигнут лимит {MAX_DEVICES} устройств. Удалите одно устройство, чтобы добавить новое.
        </p>
      ) : (
        <div>
          {!showAddForm ? (
            <button className="btn-primary" onClick={() => setShowAddForm(true)}>
              + Добавить устройство
            </button>
          ) : (
            <form onSubmit={handleAdd} className="flex gap-2 items-start flex-wrap">
              <div className="flex-1 min-w-48">
                <input
                  autoFocus
                  placeholder="Название устройства"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                  maxLength={32}
                  required
                />
                {addError && <p className="text-red-400 text-xs mt-1">{addError}</p>}
              </div>
              <button type="submit" className="btn-primary" disabled={addLoading}>
                {addLoading ? 'Создание...' : 'Создать'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setShowAddForm(false); setAddError(''); }}>
                Отмена
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
