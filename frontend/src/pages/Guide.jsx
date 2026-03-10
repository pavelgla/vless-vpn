export default function Guide() {
  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Инструкция по подключению</h1>
        <p className="text-gray-400 text-sm">
          Пошаговое руководство по установке и настройке приложения HAPP
        </p>
      </div>

      {/* Step 1 — Download */}
      <section className="space-y-4">
        <StepHeader n={1} title="Скачайте приложение HAPP" />
        <p className="text-gray-400 text-sm">
          HAPP — клиент для подключения к VPN через протокол VLESS+Reality.
          Доступен для iOS и Android бесплатно.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <StoreButton
            icon={<AppleIcon />}
            label="App Store"
            sublabel="iPhone / iPad"
            href="https://apps.apple.com/app/happ-proxy-utility/id6504287215"
          />
          <StoreButton
            icon={<AndroidIcon />}
            label="Google Play"
            sublabel="Android"
            href="https://play.google.com/store/apps/details?id=com.boos.happ"
          />
        </div>
        <p className="text-xs text-gray-600">
          Если Google Play недоступен — скачайте APK с{' '}
          <a href="https://github.com/happproxy/happ/releases" target="_blank" rel="noreferrer"
            className="text-brand-400 hover:underline">
            GitHub Releases
          </a>
        </p>

        <div className="border-t border-gray-800 pt-4 space-y-3">
          <p className="text-sm font-medium text-gray-300">Для компьютера</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StoreButton
              icon={<WindowsIcon />}
              label="Hiddify"
              sublabel="Windows — рекомендуется"
              href="https://github.com/hiddify/hiddify-app/releases/latest"
            />
            <StoreButton
              icon={<WindowsIcon />}
              label="v2rayN"
              sublabel="Windows — классический"
              href="https://github.com/2dust/v2rayN/releases/latest"
            />
            <StoreButton
              icon={<LinuxIcon />}
              label="Hiddify"
              sublabel="Linux (AppImage / deb)"
              href="https://github.com/hiddify/hiddify-app/releases/latest"
            />
            <StoreButton
              icon={<LinuxIcon />}
              label="v2rayA"
              sublabel="Linux — веб-интерфейс"
              href="https://github.com/v2rayA/v2rayA/releases/latest"
            />
          </div>
          <p className="text-xs text-gray-600">
            Все приложения бесплатны и с открытым исходным кодом. Поддерживают импорт VLESS-ссылок через буфер обмена.
          </p>
        </div>
      </section>

      {/* Step 2 — Add device */}
      <section className="space-y-4">
        <StepHeader n={2} title="Добавьте устройство в личном кабинете" />
        <div className="space-y-3">
          <Step
            icon="1"
            text='Откройте раздел "Кабинет" в этой панели'
          />
          <Step
            icon="2"
            text='Нажмите "+ Добавить устройство" и введите название (например: "iPhone Макс")'
          />
          <Step
            icon="3"
            text="На созданном устройстве нажмите «QR-код» — откроется окно с QR и ссылкой"
          />
        </div>
        <div className="card bg-gray-900 border border-gray-700 text-sm text-gray-400 flex gap-3 items-start">
          <span className="text-2xl mt-0.5">💡</span>
          <span>
            Каждое устройство — отдельный UUID. Не используйте один QR-код на нескольких
            устройствах одновременно: это может приводить к конфликтам соединений.
          </span>
        </div>
      </section>

      {/* Step 3 — Configure HAPP via QR */}
      <section className="space-y-4">
        <StepHeader n={3} title="Настройте HAPP через QR-код" />
        <p className="text-gray-400 text-sm">Самый быстрый способ — сканировать QR прямо с экрана.</p>
        <div className="space-y-3">
          <Step icon="1" text="Откройте HAPP на телефоне" />
          <Step icon="2" text='Нажмите "+" (добавить сервер) → "Сканировать QR-код"' />
          <Step
            icon="3"
            text="Наведите камеру на QR-код в окне «QR-код» в личном кабинете"
          />
          <Step icon="4" text='Сервер появится в списке. Нажмите на него → "Подключить"' />
        </div>

        <div className="rounded-xl overflow-hidden border border-gray-800">
          <div className="bg-gray-900 px-4 py-2 text-xs text-gray-500 font-medium border-b border-gray-800">
            Окно QR-кода в личном кабинете
          </div>
          <div className="bg-gray-950 p-6 flex flex-col items-center gap-3">
            <div className="w-40 h-40 bg-white rounded-xl flex items-center justify-center">
              <QRPlaceholder />
            </div>
            <div className="text-xs text-gray-600 font-mono text-center max-w-xs break-all">
              vless://xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx@vless.console10.ru:443?...
            </div>
            <div className="flex gap-2 w-full max-w-xs">
              <div className="flex-1 bg-brand-600/30 border border-brand-600/50 rounded-lg px-3 py-2 text-center text-xs text-brand-400 font-medium">
                Копировать ссылку
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Step 3b — Configure manually */}
      <section className="space-y-4">
        <StepHeader n={4} title="Или добавьте вручную по ссылке" />
        <p className="text-gray-400 text-sm">
          Если QR не удаётся отсканировать — скопируйте ссылку и вставьте вручную.
        </p>
        <div className="space-y-3">
          <Step
            icon="1"
            text='В окне QR-кода нажмите "Копировать ссылку" — ссылка скопируется в буфер обмена'
          />
          <Step icon="2" text='В HAPP: "+" → "Добавить из буфера обмена" или "Ввести вручную"' />
          <Step icon="3" text='Вставьте скопированную ссылку и нажмите "Сохранить"' />
        </div>
      </section>

      {/* Step 5 — Connect */}
      <section className="space-y-4">
        <StepHeader n={5} title="Подключитесь" />
        <div className="space-y-3">
          <Step icon="1" text="Выберите добавленный сервер в списке HAPP" />
          <Step
            icon="2"
            text='Нажмите большую кнопку подключения (или переключатель). При первом запуске iOS/Android попросят разрешение на создание VPN — разрешите'
          />
          <Step
            icon="3"
            text='Когда статус изменится на "Подключено" — VPN активен. Все сайты и приложения будут работать через сервер'
          />
        </div>
        <div className="card bg-gray-900 border border-gray-700 text-sm text-gray-400 flex gap-3 items-start">
          <span className="text-2xl mt-0.5">✅</span>
          <span>
            После подключения проверьте свой IP через{' '}
            <span className="font-mono text-gray-300">2ip.ru</span> или{' '}
            <span className="font-mono text-gray-300">whoer.net</span> — должен
            отображаться IP нашего сервера.
          </span>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Частые вопросы</h2>
        <div className="space-y-3">
          <FAQ
            q="Не подключается — что делать?"
            a="Проверьте срок действия аккаунта в разделе «Настройки». Убедитесь, что устройство добавлено в кабинете и его UUID совпадает с тем, что в QR-коде."
          />
          <FAQ
            q="Подключился, но сайты не открываются"
            a="Попробуйте переключить режим работы HAPP: Normal → Full (туннелировать весь трафик). Проверьте в кабинете — статус устройства должен быть «онлайн»."
          />
          <FAQ
            q="Можно ли использовать один QR на двух устройствах?"
            a="Нет. Добавьте отдельное устройство для каждого гаджета — у вас есть лимит 5 устройств."
          />
          <FAQ
            q="Как отключить VPN?"
            a="Нажмите кнопку подключения в HAPP повторно, или отключите VPN в системных настройках телефона."
          />
          <FAQ
            q="Как добавить сервер на Windows / Linux?"
            a="Скачайте Hiddify или v2rayN (Windows) / v2rayA (Linux). Скопируйте VLESS-ссылку в кабинете, в приложении выберите «Добавить из буфера обмена» или «Import from clipboard»."
          />
        </div>
      </section>
    </div>
  );
}

function StepHeader({ n, title }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 h-8 rounded-full bg-brand-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Step({ icon, text }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-6 h-6 rounded-full bg-gray-800 text-gray-400 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </span>
      <p className="text-gray-300 text-sm">{text}</p>
    </div>
  );
}

function FAQ({ q, a }) {
  return (
    <details className="card bg-gray-900 border border-gray-800 group">
      <summary className="cursor-pointer text-sm font-medium text-gray-200 list-none flex justify-between items-center gap-2">
        {q}
        <span className="text-gray-600 group-open:rotate-180 transition-transform flex-shrink-0">▾</span>
      </summary>
      <p className="mt-3 pt-3 border-t border-gray-800 text-sm text-gray-400">{a}</p>
    </details>
  );
}

function StoreButton({ icon, label, sublabel, href }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="card bg-gray-900 border border-gray-700 hover:border-brand-600/50 transition-colors flex items-center gap-3 px-4 py-3 no-underline"
    >
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-gray-500">{sublabel}</p>
      </div>
    </a>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current text-green-400">
      <path d="M17.523 15.341a.477.477 0 1 1 0-.953.477.477 0 0 1 0 .953m-11.046 0a.477.477 0 1 1 0-.953.477.477 0 0 1 0 .953M17.69 9.4l1.124-1.945a.23.23 0 0 0-.084-.315.23.23 0 0 0-.315.084l-1.138 1.97A7.3 7.3 0 0 0 12 8.285a7.3 7.3 0 0 0-5.278 2.909L5.585 7.224a.23.23 0 0 0-.315-.084.23.23 0 0 0-.084.315L6.31 9.4C4.634 10.283 3.5 11.95 3.5 13.87v.63h17v-.63c0-1.92-1.134-3.587-2.81-4.47" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current text-blue-400">
      <path d="M3 12V6.75l6-1.32v6.57H3zm17-9v8.75h-7V4.68L20 3zM3 13h6v6.57l-6-1.32V13zm17 .25V22l-7-1.32V13h7z"/>
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7 fill-current text-yellow-400">
      <path d="M12.504 0c-.155 0-.315.008-.48.021C7.576.336 3.24 3.655 3.24 8.561c0 1.972.518 3.738 1.362 5.209-.273.68-.455 1.398-.455 2.175 0 3.876 3.148 7.02 7.027 7.02 3.877 0 7.024-3.144 7.024-7.02 0-.777-.182-1.495-.455-2.175.844-1.471 1.362-3.237 1.362-5.209C19.105 3.558 15.981.336 12.504 0zm-.023 1.5c.252 0 .503.01.749.028C16.988 1.813 19.5 4.785 19.5 8.562c0 1.666-.457 3.215-1.236 4.51-.366-.555-.784-1.056-1.246-1.49.317-.765.488-1.6.488-2.476 0-3.557-2.867-6.438-6.425-6.438S4.656 5.55 4.656 9.106c0 .876.171 1.711.488 2.476-.462.434-.88.935-1.246 1.49C3.12 11.777 2.663 10.228 2.663 8.562c0-3.777 2.513-6.749 6.27-7.034.249-.018.5-.028.748-.028zM12.48 6c1.938 0 3.52 1.578 3.52 3.52 0 1.943-1.582 3.52-3.52 3.52S8.96 11.463 8.96 9.52C8.96 7.578 10.542 6 12.48 6zm0 1.5c-1.117 0-2.02.901-2.02 2.02 0 1.118.903 2.02 2.02 2.02 1.118 0 2.02-.902 2.02-2.02 0-1.119-.902-2.02-2.02-2.02zm-4.46 8.04c.724 0 1.31.586 1.31 1.31 0 .723-.586 1.31-1.31 1.31-.723 0-1.31-.587-1.31-1.31 0-.724.587-1.31 1.31-1.31zm8.92 0c.723 0 1.31.586 1.31 1.31 0 .723-.587 1.31-1.31 1.31-.724 0-1.31-.587-1.31-1.31 0-.724.586-1.31 1.31-1.31zM12.48 18c1.367 0 2.52.85 3.04 2.07-.94.6-2.05.93-3.04.93-.99 0-2.1-.33-3.04-.93.52-1.22 1.673-2.07 3.04-2.07z"/>
    </svg>
  );
}

function QRPlaceholder() {
  return (
    <svg viewBox="0 0 100 100" className="w-28 h-28">
      <rect x="5" y="5" width="35" height="35" rx="4" fill="none" stroke="#000" strokeWidth="4"/>
      <rect x="14" y="14" width="17" height="17" fill="#000"/>
      <rect x="60" y="5" width="35" height="35" rx="4" fill="none" stroke="#000" strokeWidth="4"/>
      <rect x="69" y="14" width="17" height="17" fill="#000"/>
      <rect x="5" y="60" width="35" height="35" rx="4" fill="none" stroke="#000" strokeWidth="4"/>
      <rect x="14" y="69" width="17" height="17" fill="#000"/>
      <rect x="60" y="60" width="8" height="8" fill="#000"/>
      <rect x="72" y="60" width="8" height="8" fill="#000"/>
      <rect x="84" y="60" width="8" height="8" fill="#000"/>
      <rect x="60" y="72" width="8" height="8" fill="#000"/>
      <rect x="84" y="72" width="8" height="8" fill="#000"/>
      <rect x="60" y="84" width="8" height="8" fill="#000"/>
      <rect x="72" y="84" width="8" height="8" fill="#000"/>
      <rect x="84" y="84" width="8" height="8" fill="#000"/>
      <rect x="47" y="5" width="8" height="8" fill="#000"/>
      <rect x="47" y="18" width="8" height="8" fill="#000"/>
      <rect x="47" y="31" width="8" height="8" fill="#000"/>
      <rect x="5" y="47" width="8" height="8" fill="#000"/>
      <rect x="18" y="47" width="8" height="8" fill="#000"/>
      <rect x="31" y="47" width="8" height="8" fill="#000"/>
      <rect x="47" y="47" width="8" height="8" fill="#000"/>
    </svg>
  );
}
