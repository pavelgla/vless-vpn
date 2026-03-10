import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { devicesApi, statsApi } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import DeviceList from '../components/DeviceList';
import TrafficTable from '../components/TrafficTable';

const POLL_INTERVAL = 30_000;

function expiryStatus(expiresAt) {
  if (!expiresAt) return null;
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (daysLeft <= 0) return { type: 'error', text: 'Срок действия истёк' };
  if (daysLeft <= 7) return { type: 'warn', text: `Срок действия заканчивается через ${daysLeft} д.` };
  return { type: 'ok', text: `Действует до: ${new Date(expiresAt).toLocaleDateString('ru-RU')}` };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [devRes, statRes] = await Promise.allSettled([
        devicesApi.list(),
        statsApi.me(),
      ]);
      if (devRes.status === 'fulfilled')  setDevices(devRes.value.data);
      if (statRes.status === 'fulfilled') setStats(statRes.value.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    }
  }, []);

  usePolling(load, POLL_INTERVAL);

  const expiry = expiryStatus(user?.expires_at);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Добро пожаловать, {user?.login}</h1>
        {expiry && (
          <div className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
            expiry.type === 'error' ? 'bg-red-900/30 text-red-400 border border-red-800' :
            expiry.type === 'warn'  ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-800' :
                                     'text-gray-500'
          }`}>
            {expiry.type === 'warn' && '⚠️'} {expiry.text}
          </div>
        )}
        {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
      </div>

      {/* Devices */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Мои устройства
            <span className="ml-2 text-gray-500 text-base font-normal">{devices.length}/5</span>
          </h2>
        </div>
        <DeviceList devices={devices} onRefresh={load} />
      </section>

      {/* Traffic */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Трафик</h2>
        <TrafficTable stats={stats} devices={devices} />
      </section>
    </div>
  );
}
