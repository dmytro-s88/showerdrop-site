// Site language: English, Spanish, Russian, like the app. A globe menu in the header switches it;
// the choice is remembered, the first visit follows the browser. Elements carry data-i18n="key"
// (text) or data-i18n-html="key" (text with markup). Legal pages stay in English, as in the app.
(function () {
  const LANGS = [['en', 'English'], ['es', 'Español'], ['ru', 'Русский']];
  const T = {
    en: {
      'nav.privacy': 'Privacy',
      'nav.terms': 'Terms',
      'lang.label': 'Language',
      lead: "Drivers with spare shower credits share a code with drivers who don't have them, right at the truck stop.",
      sub: 'Your credits, any truck stop. Free, no money changes hands.',
      download: 'Download for Android',
      'release.default': 'Beta · latest version',
      'release.fmt': 'Version {v} · {mb} MB · {date}',
      'step1.t': 'Pull in and request a shower',
      'step1.d': "The app finds the truck stop you're at and asks drivers there with credits for that chain.",
      'step2.t': 'A donor accepts',
      'step2.d': 'They reserve a shower with their own loyalty account and send you the room and code, or a photo of it.',
      'step3.t': 'Shower, then confirm',
      'step3.d': 'Tell the app the door opened. The donor gets thanks, and next time it might be you who shares.',
      'install.h': 'Installing the beta',
      'install.1': 'Tap <b>Download for Android</b> on your phone and open the file when it finishes.',
      'install.2': 'If Android asks, allow your browser to install apps (once).',
      'install.3': "If Google Play Protect warns that the app is unknown, tap <b>More details → Install anyway</b>. The beta isn't in the Play Store yet.",
      'install.4': 'New versions install over the old one; your account stays.',
      note: 'ShowerDrop is in beta for Android. Questions: <a href="mailto:support@showerdrop.app">support@showerdrop.app</a>',
      'footer.privacy': 'Privacy Policy',
      'footer.terms': 'Terms of Use',
      'footer.disclaimer': 'ShowerDrop is not affiliated with Pilot Flying J, Love\'s, TravelCenters of America or any loyalty program. Truck stop data © OpenStreetMap contributors.',
      'legal.note': '',
    },
    es: {
      'nav.privacy': 'Privacidad',
      'nav.terms': 'Términos',
      'lang.label': 'Idioma',
      lead: 'Los conductores con créditos de ducha de sobra comparten un código con quienes no los tienen, ahí mismo en la parada de camiones.',
      sub: 'Tus créditos, en cualquier parada. Gratis, sin dinero de por medio.',
      download: 'Descargar para Android',
      'release.default': 'Beta · última versión',
      'release.fmt': 'Versión {v} · {mb} MB · {date}',
      'step1.t': 'Llega y pide una ducha',
      'step1.d': 'La app encuentra la parada donde estás y avisa a los conductores de ahí que tienen créditos de esa cadena.',
      'step2.t': 'Un donante acepta',
      'step2.d': 'Reserva una ducha con su propia cuenta de lealtad y te envía el número y el código, o una foto.',
      'step3.t': 'Dúchate y confirma',
      'step3.d': 'Dile a la app que la puerta se abrió. El donante recibe las gracias, y la próxima vez quizá compartas tú.',
      'install.h': 'Cómo instalar la beta',
      'install.1': 'En tu teléfono toca <b>Descargar para Android</b> y abre el archivo cuando termine.',
      'install.2': 'Si Android lo pide, permite que tu navegador instale apps (una sola vez).',
      'install.3': 'Si Google Play Protect avisa que la app es desconocida, toca <b>Más detalles → Instalar de todos modos</b>. La beta aún no está en Play Store.',
      'install.4': 'Las versiones nuevas se instalan encima de la anterior; tu cuenta se mantiene.',
      note: 'ShowerDrop está en beta para Android. Preguntas: <a href="mailto:support@showerdrop.app">support@showerdrop.app</a>',
      'footer.privacy': 'Política de privacidad',
      'footer.terms': 'Términos de uso',
      'footer.disclaimer': 'ShowerDrop no está afiliado a Pilot Flying J, Love\'s, TravelCenters of America ni a ningún programa de lealtad. Datos de paradas © colaboradores de OpenStreetMap.',
      'legal.note': 'Este documento solo está disponible en inglés.',
    },
    ru: {
      'nav.privacy': 'Приватность',
      'nav.terms': 'Условия',
      'lang.label': 'Язык',
      lead: 'Водители с лишними кредитами на душ делятся кодом с теми, у кого их нет, прямо на трак-стопе.',
      sub: 'Твои кредиты — на любом трак-стопе. Бесплатно, без денег.',
      download: 'Скачать для Android',
      'release.default': 'Бета · последняя версия',
      'release.fmt': 'Версия {v} · {mb} МБ · {date}',
      'step1.t': 'Заехал — запросил душ',
      'step1.d': 'Приложение определяет стоянку, на которой ты стоишь, и спрашивает водителей с кредитами этой сети.',
      'step2.t': 'Донор принимает запрос',
      'step2.d': 'Он бронирует душ на свой аккаунт лояльности и присылает номер душа и код или фото.',
      'step3.t': 'Помылся — подтвердил',
      'step3.d': 'Отметь в приложении, что дверь открылась. Донору — спасибо, а в следующий раз поделишься ты.',
      'install.h': 'Как установить бету',
      'install.1': 'Нажми <b>Скачать для Android</b> на телефоне и открой файл после загрузки.',
      'install.2': 'Если Android спросит, разреши браузеру устанавливать приложения (один раз).',
      'install.3': 'Если Google Play Protect предупредит, что приложение неизвестно, нажми <b>Подробнее → Всё равно установить</b>. В Play Store бета пока не опубликована.',
      'install.4': 'Новые версии ставятся поверх старой, аккаунт сохраняется.',
      note: 'ShowerDrop — бета-версия для Android. Вопросы: <a href="mailto:support@showerdrop.app">support@showerdrop.app</a>',
      'footer.privacy': 'Политика конфиденциальности',
      'footer.terms': 'Условия использования',
      'footer.disclaimer': 'ShowerDrop не связан с Pilot Flying J, Love\'s, TravelCenters of America и программами лояльности. Данные о стоянках © участники OpenStreetMap.',
      'legal.note': 'Этот документ доступен только на английском языке.',
    },
  };

  const KEY = 'showerdrop.lang';
  const supported = (l) => (l && T[l] ? l : null);
  const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const browser = () => supported((navigator.language || 'en').slice(0, 2).toLowerCase());
  let lang = supported(stored()) || browser() || 'en';

  const t = (key, vars) => {
    let s = (T[lang] && T[lang][key]) ?? T.en[key] ?? key;
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, v); });
    return s;
  };

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    // Legal pages: a one-line note in languages other than English.
    document.querySelectorAll('[data-legal-note]').forEach((el) => {
      el.textContent = t('legal.note');
      el.hidden = !el.textContent;
    });
    const btn = document.getElementById('langBtn');
    if (btn) btn.querySelector('span').textContent = lang.toUpperCase();
    document.querySelectorAll('#langMenu [data-lang]').forEach((li) => li.setAttribute('aria-selected', String(li.dataset.lang === lang)));
    document.dispatchEvent(new CustomEvent('langchange'));
  }

  function setLang(l) {
    lang = supported(l) || 'en';
    try { localStorage.setItem(KEY, lang); } catch { /* private mode: not remembered */ }
    apply();
  }

  // Globe button + menu, built here so every page gets the same one.
  function mountPicker() {
    const nav = document.querySelector('header nav');
    if (!nav) return;
    const wrap = document.createElement('div');
    wrap.className = 'lang';
    wrap.innerHTML = `
      <button id="langBtn" type="button" aria-haspopup="listbox" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/>
        </svg><span></span>
      </button>
      <ul id="langMenu" role="listbox" hidden>
        ${LANGS.map(([code, name]) => `<li role="option" tabindex="0" data-lang="${code}">${name}</li>`).join('')}
      </ul>`;
    nav.appendChild(wrap);
    const btn = wrap.querySelector('#langBtn');
    const menu = wrap.querySelector('#langMenu');
    btn.setAttribute('aria-label', t('lang.label'));
    const open = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); open(menu.hidden); });
    menu.addEventListener('click', (e) => {
      const li = e.target.closest('[data-lang]');
      if (li) { setLang(li.dataset.lang); open(false); btn.focus(); }
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); }
    });
    document.addEventListener('click', () => open(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  }

  window.siteI18n = { t, get lang() { return lang; } };
  mountPicker();
  apply();
})();
