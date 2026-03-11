import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/client';

function useCaptcha() {
  const [captcha, setCaptcha] = useState(null);

  const reload = useCallback(async () => {
    setCaptcha(null);
    try {
      const { data } = await authApi.captcha();
      setCaptcha(data);
    } catch {
      setCaptcha({ id: '', question: '? + ?' });
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { captcha, reloadCaptcha: reload };
}

function useCountdown(targetMs) {
  const [secsLeft, setSecsLeft] = useState(0);

  useEffect(() => {
    if (!targetMs) { setSecsLeft(0); return; }
    const tick = () => {
      const s = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setSecsLeft(s);
      if (s <= 0) clearInterval(id);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return secsLeft;
}

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const { captcha, reloadCaptcha } = useCaptcha();

  const [form, setForm]       = useState({ login: '', password: '', captchaAnswer: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(null);

  const secsLeft   = useCountdown(lockedUntil);
  const isLocked   = secsLeft > 0;
  const minsLeft   = Math.floor(secsLeft / 60);
  const remSecs    = secsLeft % 60;
  const lockLabel  = minsLeft > 0
    ? `${minsLeft} мин ${remSecs} сек`
    : `${remSecs} сек`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked || !captcha?.id) return;
    setError('');
    setLoading(true);
    try {
      const data = await login(
        form.login,
        form.password,
        captcha.id,
        parseInt(form.captchaAnswer, 10),
      );
      navigate(data.role === 'superadmin' ? '/admin' : '/dashboard', { replace: true });
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 429 && d?.locked_until) {
        setLockedUntil(d.locked_until);
        setError('');
      } else {
        setError(d?.message || 'Неверный логин или пароль');
      }
      reloadCaptcha();
      setForm(f => ({ ...f, captchaAnswer: '' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold">VPN Panel</h1>
          <p className="text-gray-500 text-sm mt-1">Войдите в личный кабинет</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Логин</label>
            <input
              autoFocus
              autoComplete="username"
              value={form.login}
              onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
              placeholder="admin"
              disabled={isLocked}
              required
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Пароль</label>
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
              disabled={isLocked}
              required
            />
          </div>

          {/* Captcha */}
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Проверка</label>
            <div className="flex gap-3 items-center">
              <div className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-center font-mono text-lg tracking-widest select-none">
                {captcha ? `${captcha.question} =` : '…'}
              </div>
              <input
                type="number"
                className="w-24 text-center"
                value={form.captchaAnswer}
                onChange={e => setForm(f => ({ ...f, captchaAnswer: e.target.value }))}
                placeholder="?"
                disabled={isLocked}
                required
              />
              <button
                type="button"
                className="btn-ghost px-3 py-2.5 text-gray-500 hover:text-gray-300"
                onClick={() => { reloadCaptcha(); setForm(f => ({ ...f, captchaAnswer: '' })); }}
                title="Обновить капчу"
                disabled={isLocked}
              >
                ↺
              </button>
            </div>
          </div>

          {/* Lockout banner */}
          {isLocked && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-3 text-center">
              <p className="font-medium mb-1">Вход заблокирован</p>
              <p className="text-xs text-red-500">после 3 неудачных попыток</p>
              <p className="mt-2 font-mono text-base">{lockLabel}</p>
            </div>
          )}

          {error && !isLocked && (
            <div className="bg-red-900/30 border border-red-800 text-red-400 text-sm rounded-lg px-4 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full justify-center"
            disabled={loading || isLocked || !captcha?.id}
          >
            {loading ? 'Вход...' : isLocked ? `Подождите ${lockLabel}` : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
