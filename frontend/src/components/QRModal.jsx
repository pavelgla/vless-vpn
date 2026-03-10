import { useState, useEffect } from 'react';
import Modal from './Modal';
import { devicesApi } from '../api/client';

export default function QRModal({ device, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    devicesApi.qr(device.id)
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.message || 'Ошибка загрузки QR'))
      .finally(() => setLoading(false));
  }, [device.id]);

  const copyLink = async () => {
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = data.link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Modal title={`QR-код — ${device.name}`} onClose={onClose} size="sm">
      {loading && (
        <div className="flex justify-center py-10">
          <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && <p className="text-red-400 text-center py-4">{error}</p>}
      {data && (
        <div className="flex flex-col items-center gap-4">
          <img
            src={data.qr}
            alt="VLESS QR"
            className="w-64 h-64 rounded-xl bg-white p-2"
          />
          <p className="text-xs text-gray-500 break-all text-center px-2">{data.link}</p>
          <button className="btn-primary w-full justify-center" onClick={copyLink}>
            {copied ? '✓ Скопировано!' : 'Копировать ссылку'}
          </button>
        </div>
      )}
    </Modal>
  );
}
