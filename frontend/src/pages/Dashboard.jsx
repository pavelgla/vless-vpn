import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { devicesApi, statsApi } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import DeviceList from '../components/DeviceList';
import TrafficChart from '../components/TrafficChart';

const POLL_INTERVAL = 30_000;

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function expiryStatus(expiresAt) {
  if (!expiresAt) return null;
  const msLeft   = new Date(expiresAt).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (daysLeft <= 0) return { type: 'error', text: 'Срок действия истёк' };
  if (daysLeft <= 7) return { type: 'warn',  text: `Истекает через ${daysLeft} д.` };
  return { type: 'ok', text: `Действует до: ${new Date(expiresAt).toLocaleDateString('ru-RU')}` };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [devices, setDevices] = useState([]);
  const [stats,   setStats]   = useState(null);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    try {
      const [devRes, statRes] = await Promise.allSettled([
        devicesApi.list(),
        statsApi.me(),
      ]);
      if (devRes.status  === 'fulfilled') setDevices(devRes.value.data);
      if (statRes.status === 'fulfilled') setStats(statRes.value.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка загрузки');
    }
  }, []);

  usePolling(load, POLL_INTERVAL);

  const expiry   = expiryStatus(user?.expires_at);
  const onlineCount = stats?.devices?.filter(d => d.online).length ?? 0;

  const totalUp   = stats?.total?.bytes_up   ?? 0;
  const totalDown = stats?.total?.bytes_down ?? 0;
  const todayUp   = stats?.total?.today_up   ?? 0;
  const todayDown = stats?.total?.today_down ?? 0;

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
            {expiry.type === 'warn' && '⚠'} {expiry.text}
          </div>
        )}
        {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
      </div>

      {/* Traffic summary cards */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Статистика</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Сегодня скачано',  value: fmtBytes(todayDown) },
            { label: 'Сегодня загружено', value: fmtBytes(todayUp)   },
            { label: 'Всего скачано',     value: fmtBytes(totalDown) },
            { label: 'Онлайн устройств',  value: onlineCount         },
          ].map(({ label, value }) => (
            <div key={label} className="card text-center">
              <p className="text-xs text-gray-500 mb-0.5">{label}</p>
              <p className="text-xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Summary chart */}
        <div className="card">
          <p className="text-sm font-medium text-gray-400 mb-3">Трафик по дням (все устройства)</p>
          <TrafficChart dailyData={stats?.daily} />
        </div>
      </section>

      {/* Devices */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Мои устройства
            <span className="ml-2 text-gray-500 text-base font-normal">{devices.length}/5</span>
            {onlineCount > 0 && (
              <span className="ml-2 text-xs text-emerald-400 font-normal">
                {onlineCount} онлайн
              </span>
            )}
          </h2>
        </div>
        {/* Merge per-device traffic from stats into device list */}
        <DeviceList
          devices={devices.map(d => {
            const s = stats?.devices?.find(x => x.uuid === d.uuid);
            return s ? { ...d, ...s } : d;
          })}
          onRefresh={load}
        />
      </section>
    </div>
  );
}
