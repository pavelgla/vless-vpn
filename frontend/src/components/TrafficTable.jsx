import { useState } from 'react';

const PERIODS = [
  { key: 'day',   label: 'День' },
  { key: 'week',  label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
];

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export default function TrafficTable({ stats, devices }) {
  const [period, setPeriod] = useState('month');

  if (!stats) {
    return <p className="text-gray-500 text-sm">Загрузка статистики...</p>;
  }

  const perDevice = stats.devices || [];

  // Build a lookup: uuid → stats
  const statsByUuid = {};
  for (const s of perDevice) {
    statsByUuid[s.uuid] = s;
  }

  return (
    <div className="space-y-4">
      {/* Period switcher */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 w-fit">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              period === p.key ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Загружено',  value: fmtBytes(stats.total?.uplink) },
          { label: 'Скачано',    value: fmtBytes(stats.total?.downlink) },
          { label: 'Всего',      value: fmtBytes((stats.total?.uplink || 0) + (stats.total?.downlink || 0)) },
        ].map(({ label, value }) => (
          <div key={label} className="card text-center">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="font-semibold text-lg">{value}</p>
          </div>
        ))}
      </div>

      {/* Per-device table */}
      {devices && devices.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="table-auto w-full">
            <thead>
              <tr>
                <th>Устройство</th>
                <th>Загружено</th>
                <th>Скачано</th>
                <th>Итого</th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => {
                const s = statsByUuid[d.uuid] || {};
                const total = (s.uplink || 0) + (s.downlink || 0);
                return (
                  <tr key={d.id} className="hover:bg-gray-900/50">
                    <td className="font-medium">{d.name}</td>
                    <td className="text-gray-400">{fmtBytes(s.uplink)}</td>
                    <td className="text-gray-400">{fmtBytes(s.downlink)}</td>
                    <td className="text-gray-300">{fmtBytes(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
