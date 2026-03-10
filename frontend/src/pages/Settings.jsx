import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [form, setForm]     = useState({ old_password: '', new_password: '', confirm: '' });
  const [error, setError]   = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (form.new_password !== form.confirm) {
      setError('Новые пароли не совпадают');
      return;
    }
    if (form.new_password.length < 8) {
      setError('Новый пароль должен содержать минимум 8 символов');
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword({
        old_password: form.old_password,
        new_password: form.new_password,
      });
      setSuccess('Пароль успешно изменён. Выполняется выход...');
      setForm({ old_password: '', new_password: '', confirm: '' });

      // Force re-login after password change
      setTimeout(async () => {
        await logout();
        navigate('/login', { replace: true });
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Ошибка смены пароля');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold mb-8">Настройки</h1>

      {/* Account info */}
      <div className="card mb-6">
        <p className="text-sm text-gray-500 mb-1">Логин</p>
        <p className="font-semibold">{user?.login}</p>
        <p className="text-sm text-gray-500 mt-3 mb-1">Роль</p>
        <p className="font-semibold capitalize">{user?.role === 'superadmin' ? 'Суперадмин' : 'Пользователь'}</p>
      </div>

      {/* Change password */}
      <div className="card">
        <h2 className="font-semibold mb-5">Сменить пароль</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Текущий пароль</label>
            <input
              type="password"
              autoComplete="current-password"
              value={form.old_password}
              onChange={e => setForm(f => ({ ...f, old_password: e.target.value }))}
              placeholder="••••••••"
              required
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Новый пароль</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.new_password}
              onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
              placeholder="Минимум 8 символов"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Подтвердите новый пароль</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-2.5">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-900/30 border border-emerald-800 text-emerald-400 text-sm rounded-lg px-4 py-2.5">
              {success}
            </div>
          )}

          <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
        </form>
      </div>
    </div>
  );
}
