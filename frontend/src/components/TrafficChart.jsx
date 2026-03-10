import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { statsApi } from '../api/client';

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Fill missing dates in a range with zeros
function fillDates(rows, days) {
  const map = {};
  for (const r of rows) map[r.date] = r;

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    result.push({
      date:  label,
      down: Number(map[key]?.bytes_down || 0),
      up:   Number(map[key]?.bytes_up   || 0),
    });
  }
  return result;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {fmtBytes(p.value)}
        </p>
      ))}
    </div>
  );
};

const PERIODS = [
  { label: '7д',  days: 7  },
  { label: '30д', days: 30 },
  { label: '90д', days: 90 },
];

export default function TrafficChart({ deviceId, dailyData }) {
  const [days, setDays]     = useState(30);
  const [rows, setRows]     = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If dailyData is passed directly (from /stats/me), use it only for 30d
    if (dailyData && days === 30) {
      setRows(fillDates(dailyData, 30));
      return;
    }
    if (!deviceId) return;

    setLoading(true);
    statsApi.deviceDaily(deviceId, days)
      .then(r => setRows(fillDates(r.data, days)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [deviceId, dailyData, days]);

  const data = rows || [];
  const hasData = data.some(r => r.up > 0 || r.down > 0);

  return (
    <div>
      {/* Period selector */}
      <div className="flex gap-1 mb-3">
        {PERIODS.map(p => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              days === p.days
                ? 'bg-brand-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-500 text-sm py-6 text-center">Загрузка...</p>}

      {!loading && !hasData && (
        <p className="text-gray-600 text-sm py-6 text-center">Нет данных за период</p>
      )}

      {!loading && hasData && (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              interval={Math.floor(data.length / 6)}
            />
            <YAxis
              tickFormatter={fmtBytes}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend
              formatter={(v) => v === 'down' ? 'Скачано' : 'Загружено'}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="down" name="down" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="up"   name="up"   fill="#3b82f6" stackId="a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
