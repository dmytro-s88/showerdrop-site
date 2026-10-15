    // Production project; on localhost a git-ignored config.local.json may point at the local Supabase.
    const PROD = {
      url: 'https://oworbuwivpyuseijwtxk.supabase.co',
      key: 'sb_publishable_cfyGMaNPTNVua6cZCHE3CA_mCM0cGHQ',
    };
    const PAGE = 50;
    // Same order as the app's presets (app/src/lib/theme.ts).
    const PRESETS = ['rookie', 'hauler', 'roadie', 'veteran', 'route66', 'patches', 'headset', 'queen', 'rider', 'buddy'];
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '-').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const show = (id, on) => { $(id).hidden = !on; };

    const ago = (t) => {
      if (!t) return '-';
      const m = Math.round((Date.now() - new Date(t)) / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60);
      return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
    };
    const until = (t) => {
      if (!t) return '';
      const m = Math.round((new Date(t) - Date.now()) / 60000);
      return m <= 0 ? 'expiring' : `${m} min left`;
    };
    const time = (t) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const label = { searching: 'searching', accepted: 'accepted', queued: 'in line', code_sent: 'code sent',
      retry_needed: 'retry needed', success: 'success', failed: 'failed', no_donor: 'no donor', cancelled: 'cancelled',
      pending: 'pending', approved: 'approved', rejected: 'rejected' };
    const pill = (s) => `<span class="pill ${esc(s)}">${esc(label[s] ?? s)}</span>`;
    const table = (head, rows) => rows.length
      ? `<div class="table"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : '<div class="empty">Nothing yet.</div>';
    const pager = (id, total, offset, onPage) => {
      const el = $(id);
      if (total <= PAGE) { el.innerHTML = total ? `${total} total` : ''; return; }
      el.innerHTML = `<button class="small" id="${id}Prev" ${offset === 0 ? 'disabled' : ''}>‹ Prev</button>
        <span>${offset + 1}-${Math.min(offset + PAGE, total)} of ${total}</span>
        <button class="small" id="${id}Next" ${offset + PAGE >= total ? 'disabled' : ''}>Next ›</button>`;
      $(`${id}Prev`).onclick = () => onPage(Math.max(0, offset - PAGE));
      $(`${id}Next`).onclick = () => onPage(offset + PAGE);
    };
    // A user's name, clickable: opens the detail drawer. Mini avatar in front when we know it.
    const userLink = (id, name) => id ? `<a class="user" data-user="${esc(id)}">${esc(name)}</a>` : esc(name);
    // Private buckets: photos load through signed URLs (an hour), cached so a re-render shows the same
    // picture at once instead of a blank that reloads.
    const signedCache = new Map();
    const cachedUrl = (path) => { const c = signedCache.get(path); return c && c.until > Date.now() ? c.url : null; };
    async function signedUrl(bucket, path) {
      const hit = cachedUrl(path);
      if (hit) return hit;
      const { data } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
      if (data?.signedUrl) signedCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
      return data?.signedUrl ?? null;
    }
    const avatarImg = (u, cls = 'ava') => u.avatar_path
      ? `<img class="${cls}" src="${esc(cachedUrl(u.avatar_path) ?? '')}" data-avatar="${esc(u.avatar_path)}" alt="">`
      : `<img class="${cls}" src="avatars/${PRESETS[((u.avatar_id ?? 0) % PRESETS.length + PRESETS.length) % PRESETS.length]}.jpg" alt="">`;
    async function fillSigned(root, bucket, attr) {
      await Promise.all([...root.querySelectorAll(`img[data-${attr}]`)].map(async (img) => {
        const url = await signedUrl(bucket, img.dataset[attr]);
        if (!url) return;
        if (img.getAttribute('src') !== url) img.src = url;
        if (attr === 'photo') img.dataset.full = url;
      }));
    }

    let sb, channel, reloadTimer, slowTimer;

    async function start() {
      let cfg = PROD;
      if (location.hostname === 'localhost') {
        try { cfg = await (await fetch('config.local.json')).json(); } catch { /* use production */ }
      }
      sb = supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true } });
      // Fires once with the stored session (INITIAL_SESSION) and on every sign-in/out. Supabase calls
      // made inside this callback deadlock on the auth lock, so routing runs on the next tick.
      sb.auth.onAuthStateChange((_e, session) => setTimeout(() => route(session), 0));
    }

    let routeSeq = 0, routedUid = null;
    async function route(session) {
      // The same signed-in user again (token refresh, tab focus): nothing to redo.
      if (session && session.user.id === routedUid && !askPassword && !$('dash').hidden) return;
      routedUid = null;
      const seq = ++routeSeq;  // a newer auth event wins over one still loading
      stopLive();
      ['login', 'notAdmin', 'setPw', 'dash'].forEach((id) => show(id, false));
      show('who', !!session);
      if (!session) return show('login', true);
      $('whoEmail').textContent = session.user.email ?? '';
      // A session kept in this browser may belong to an account that no longer exists (deleted, or the
      // database was reset): ask the server, and start over with sign-in if it's gone.
      const { error: userErr } = await sb.auth.getUser();
      if (seq !== routeSeq) return;
      if (userErr) { await sb.auth.signOut(); return; }
      const { data: admin } = await sb.rpc('is_admin');
      if (seq !== routeSeq) return;
      if (!admin) return show('notAdmin', true);
      if (askPassword) return show('setPw', true);
      show('dash', true);
      routedUid = session.user.id;
      showTab();
      startLive();
    }

    // ---- sign in ------------------------------------------------------------
    let askPassword = false;
    const email = () => $('email').value.trim();
    const say = (m) => { $('loginMsg').textContent = m; };

    $('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('pwBtn').disabled = true; say('');
      const { error } = await sb.auth.signInWithPassword({ email: email(), password: $('password').value });
      $('pwBtn').disabled = false;
      if (error) say(/invalid login|credentials/i.test(error.message)
        ? 'Wrong email or password. No password yet? Get a code by email below.' : error.message);
    });
    $('codeLink').addEventListener('click', () => { show('codeFlow', true); show('codeLink', false); });
    $('emailForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!$('email').reportValidity()) return;
      $('sendBtn').disabled = true; say('');
      const { error } = await sb.auth.signInWithOtp({ email: email(), options: { shouldCreateUser: true } });
      $('sendBtn').disabled = false;
      if (error) return say(/rate limit|security purposes/i.test(error.message)
        ? 'Too many codes requested. Wait a minute and try again.' : error.message);
      show('codeForm', true); $('code').focus();
      say('Code sent. Check your inbox.');
    });
    $('codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('verifyBtn').disabled = true;
      askPassword = true;
      const { error } = await sb.auth.verifyOtp({ email: email(), token: $('code').value.trim(), type: 'email' });
      $('verifyBtn').disabled = false;
      if (error) { askPassword = false; say('Wrong or expired code.'); }
    });
    $('setPwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('newPw').value;
      if (pw.length < 8) return $('setPwMsg').textContent = 'Use at least 8 characters.';
      if (pw !== $('newPw2').value) return $('setPwMsg').textContent = "The passwords don't match.";
      $('setPwBtn').disabled = true;
      const { error } = await sb.auth.updateUser({ password: pw });
      $('setPwBtn').disabled = false;
      if (error) return $('setPwMsg').textContent = error.message;
      $('setPwForm').reset(); $('setPwMsg').textContent = '';
      askPassword = false;
      route((await sb.auth.getSession()).data.session);
    });
    $('skipPw').addEventListener('click', async () => { askPassword = false; route((await sb.auth.getSession()).data.session); });
    $('changePw').addEventListener('click', async () => { askPassword = true; route((await sb.auth.getSession()).data.session); });
    $('signOut').addEventListener('click', () => sb.auth.signOut());
    $('refresh').addEventListener('click', () => loadDashboard());

    // ---- tabs ---------------------------------------------------------------
    const TABS = ['dashboard', 'users', 'exchanges', 'reports', 'stops', 'settings'];
    const loaders = { dashboard: loadDashboard, users: () => loadUsers(0), exchanges: () => loadExchanges(0),
      reports: () => loadReports(0), stops: loadStops, settings: loadSettings };
    function showTab() {
      const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
      for (const t of TABS) show(`view-${t}`, t === tab);
      for (const a of $('tabs').querySelectorAll('a')) a.toggleAttribute('aria-current', a.getAttribute('href') === `#${tab}`) ;
      for (const a of $('tabs').querySelectorAll('a')) if (a.getAttribute('href') === `#${tab}`) a.setAttribute('aria-current', 'page');
      loaders[tab]();
      if (tab === 'stops') setTimeout(() => map?.invalidateSize(), 50);
    }
    window.addEventListener('hashchange', () => { $('drawerHost').innerHTML = ''; if (!$('dash').hidden) showTab(); });

    // ---- dashboard ----------------------------------------------------------
    async function loadDashboard() { await Promise.all([loadOverview(), loadLive()]); }

    async function loadOverview() {
      const { data: o, error } = await sb.rpc('admin_overview');
      if (error) return;
      const today = o.exchanges_today || {}, week = o.exchanges_week || {};
      const methods = Object.entries(o.users_by_method || {}).map(([k, v]) => `${v} ${k}`).join(' · ');
      const tile = (n, label, small, cls = '') => `<div class="tile ${cls}"><b>${esc(n)}</b><span>${label}</span>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
      $('tiles').innerHTML = [
        tile(o.open_exchanges, 'open exchanges', '', 'now'),
        tile(o.donors_on_shift, 'donors on shift', '', 'now'),
        tile(o.users_total, 'users', `+${o.users_today} today · +${o.users_week} this week`),
        tile(methods || '-', 'sign-in methods', '', 'text'),
        tile(today.success ?? 0, 'showers today', `${today.failed ?? 0} failed · ${today.no_donor ?? 0} no donor · ${today.cancelled ?? 0} cancelled`),
        tile(week.success ?? 0, 'showers this week', `${week.failed ?? 0} failed · ${week.no_donor ?? 0} no donor`),
        tile(o.reports_open, 'open reports'),
        tile(o.in_cooldown, 'in cooldown', `${o.flagged} flagged`),
      ].join('');
    }

    async function loadLive() {
      const { data: l, error } = await sb.rpc('admin_live');
      if (error) return;
      $('openCount').textContent = l.exchanges.length || '';
      $('openList').innerHTML = l.exchanges.length ? `<div class="cards">${l.exchanges.map((x) => `
        <div class="card">
          <div class="top"><span class="stop">${esc(x.stop)}</span>${pill(x.status)}</div>
          <div class="who">${esc(x.receiver)} → ${x.donor ? esc(x.donor) : `<span class="flag">${x.donors_pending ? `${x.donors_pending} donor(s) notified` : 'no donor at the stop'}</span>`}</div>
          <div class="meta">started ${ago(x.created_at)} · ${until(x.expires_at)}${x.queue_number ? ` · #${x.queue_number} in line` : ''}${x.retry_used ? ' · retry used' : ''}${x.has_photo ? ' · photo' : ''}</div>
        </div>`).join('')}</div>` : '<div class="empty">No open exchanges right now.</div>';
      $('shiftCount').textContent = l.shifts.length || '';
      $('shiftList').innerHTML = table(['Donor', 'Stop', 'Chain', 'Since', 'Until'],
        l.shifts.map((s) => `<tr><td>${esc(s.nickname)}</td><td>${esc(s.stop)}</td><td>${esc(s.chain)}</td><td class="dim">${ago(s.checked_in_at)}</td><td class="dim">${until(s.expires_at)}</td></tr>`));
      $('closedList').innerHTML = table(['Status', 'Stop', 'Receiver', 'Donor', 'Closed', 'Reason'],
        l.recent_exchanges.map((x) => `<tr><td>${pill(x.status)}</td><td>${esc(x.stop)}</td><td>${esc(x.receiver)}</td><td>${esc(x.donor)}</td><td class="dim">${ago(x.updated_at)}</td><td class="dim">${esc(x.decline_reason ?? '')}</td></tr>`));
    }

    // ---- users --------------------------------------------------------------
    let userOffset = 0, userSeq = 0;
    async function loadUsers(offset = userOffset) {
      userOffset = offset;
      const seq = ++userSeq;
      const { data: u, error } = await sb.rpc('admin_users', { p_limit: PAGE, p_offset: offset, p_q: $('userQ').value.trim() || null });
      if (error || seq !== userSeq) return;
      const device = (x) => x.platform ? `${x.platform === 'ios' ? 'iPhone' : x.platform === 'android' ? 'Android' : 'Web'}${x.app_build ? ` · ${x.app_build}` : ''}` : '-';
      $('userList').innerHTML = table(['', 'Nickname', 'Device', 'Sign-in', 'Email', 'Chains', 'Gave', 'Got', 'Joined', 'Last seen', ''],
        u.rows.map((x) => `<tr><td>${avatarImg(x)}</td><td>${userLink(x.id, x.nickname)}${x.name ? `<div class="dim small">${esc(x.name)}</div>` : ''}</td><td class="dim">${device(x)}</td><td class="dim">${esc(x.method)}</td><td class="dim">${esc(x.email ?? '')}</td><td>${esc(x.chains ?? '')}</td><td>${x.given}</td><td>${x.received}</td><td class="dim">${time(x.created_at)}</td><td class="dim">${ago(x.last_seen_at ?? x.last_sign_in_at)}</td><td class="flag">${[x.is_blocked && 'blocked', x.in_cooldown && 'cooldown', x.flagged && 'flagged', !x.has_push && 'no push'].filter(Boolean).join(' · ')}</td></tr>`));
      pager('userPager', u.total, offset, loadUsers);
      fillSigned($('userList'), 'avatars', 'avatar');
    }
    let qTimer;
    $('userQ').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => loadUsers(0), 300); });

    // ---- user drawer --------------------------------------------------------
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-user]');
      if (a) { e.preventDefault(); openUser(a.dataset.user); }
      const t = e.target.closest('img[data-full]');
      if (t) lightbox(t.dataset.full);
    });
    function lightbox(src) {
      const box = document.createElement('div');
      box.className = 'lightbox'; box.innerHTML = `<img src="${esc(src)}" alt="">`;
      box.onclick = () => box.remove();
      document.body.appendChild(box);
    }
    const modErrors = { demo_account: "The App Review demo account can't be blocked or flagged.", adjustment_too_big: 'Keep adjustments within ±100.',
      nothing_to_adjust: 'Enter a number for given or received.' };
    const errText = (e) => modErrors[e.message] ?? e.message;

    async function openUser(id) {
      const { data: u, error } = await sb.rpc('admin_user', { p_id: id });
      if (error || !u) return;
      renderUser(u);
    }
    function renderUser(u) {
      $('drawerHost').innerHTML = `<div class="drawerBack" id="drawerBack"></div><div class="drawer" id="drawer">
        <button class="close small" id="drawerClose">Close</button>
        <h2>${avatarImg(u, 'ava big')}${esc(u.nickname)}</h2>
        <div class="kv">
          <div>Email</div><div>${esc(u.email)}</div>
          <div>Name</div><div>${u.name ? `${esc(u.name)} <span class="dim">(from Google)</span>` : '<span class="dim">- (signed in by email code)</span>'}</div>
          <div>Joined</div><div>${time(u.created_at)} · last seen ${ago(u.last_sign_in_at)}</div>
          <div>Chains</div><div>${esc(u.chains || '-')}</div>
          <div>Language</div><div>${esc(u.language)}${u.has_push ? '' : ' · no push token'}</div>
          <div>Given</div><div><b>${u.given_real + u.given_adj}</b> = ${u.given_real} real ${u.given_adj >= 0 ? '+' : '−'} ${Math.abs(u.given_adj)} adjusted</div>
          <div>Received</div><div><b>${u.received_real + u.received_adj}</b> = ${u.received_real} real ${u.received_adj >= 0 ? '+' : '−'} ${Math.abs(u.received_adj)} adjusted</div>
          <div>Fair use</div><div>received − given = <b>${u.balance}</b> (warn at 3, blocked at 5)</div>
          <div>Strikes (30 d)</div><div>${u.strikes_30d}</div>
          <div>State</div><div class="flag">${[u.is_blocked && 'blocked', u.cooldown_until && new Date(u.cooldown_until) > Date.now() && `cooldown until ${time(u.cooldown_until)}`, u.flagged && 'flagged', u.dev_mode && 'developer mode'].filter(Boolean).join(' · ') || '<span style="color:var(--accent)">ok</span>'}</div>
        </div>
        <div class="actions">
          <button class="small ${u.is_blocked ? '' : 'danger'}" data-mod="${u.is_blocked ? 'unblock' : 'block'}">${u.is_blocked ? 'Unblock' : 'Block'}</button>
          <button class="small" data-mod="clear_cooldown" ${u.cooldown_until && new Date(u.cooldown_until) > Date.now() ? '' : 'disabled'}>Clear cooldown</button>
          <button class="small" data-mod="${u.flagged ? 'unflag' : 'flag'}">${u.flagged ? 'Unflag' : 'Flag'}</button>
          <button class="small" data-mod="${u.dev_mode ? 'dev_off' : 'dev_on'}" title="Developer mode: 5 taps on the version line in the app open a screen that logs every truck stop passed (background location)">Developer mode: ${u.dev_mode ? 'on' : 'off'}</button>
        </div>
        <h3>Adjust counters</h3>
        <form class="adjust" id="adjustForm">
          <input id="adjGiven" type="number" min="-100" max="100" placeholder="given ±, e.g. 1">
          <input id="adjReceived" type="number" min="-100" max="100" placeholder="received ±, e.g. -2">
          <input id="adjNote" class="full" maxlength="200" placeholder="Why (optional)">
          <button class="primary full">Apply</button>
        </form>
        <p class="msg" id="userMsg"></p>
        ${u.adjustments.length ? `<div class="log">${u.adjustments.map((a) => `<p>${time(a.created_at)} · ${esc(a.actor)}: given ${a.given >= 0 ? '+' : ''}${a.given}, received ${a.received >= 0 ? '+' : ''}${a.received}${a.note ? ` - ${esc(a.note)}` : ''}</p>`).join('')}</div>` : ''}
        <h3>Recent exchanges</h3>
        ${table(['Status', 'Role', 'Stop', 'Other driver', 'When'], u.exchanges.map((x) => `<tr><td>${pill(x.status)}</td><td class="dim">${esc(x.role)}</td><td>${esc(x.stop)}</td><td>${userLink(x.other_id, x.other)}</td><td class="dim">${time(x.created_at)}</td></tr>`))}
        <h3>Reports they made</h3>
        ${table(['When', 'Reason', 'Resolved'], u.reports.map((r) => `<tr><td class="dim">${time(r.created_at)}</td><td class="wrap">${esc(r.reason)}</td><td class="dim">${r.resolved ? 'yes' : 'no'}</td></tr>`))}
      </div>`;
      fillSigned($('drawer'), 'avatars', 'avatar');
      const close = () => { $('drawerHost').innerHTML = ''; };
      $('drawerBack').onclick = close; $('drawerClose').onclick = close;
      for (const b of $('drawer').querySelectorAll('[data-mod]')) b.onclick = async () => {
        let reason = null;
        if (b.dataset.mod === 'block') {
          reason = prompt(`Block ${u.nickname}? They see "account blocked" and can't request or share until unblocked.\n\nReason (for your own log, optional):`, '');
          if (reason === null) return;
        }
        const { data, error } = await sb.rpc('admin_moderate', { p_id: u.id, p_action: b.dataset.mod, p_reason: reason });
        if (error) return $('userMsg').textContent = errText(error);
        renderUser(data); loadUsers();
      };
      $('adjustForm').onsubmit = async (e) => {
        e.preventDefault();
        const { data, error } = await sb.rpc('admin_adjust', { p_id: u.id, p_given: Number($('adjGiven').value) || 0,
          p_received: Number($('adjReceived').value) || 0, p_note: $('adjNote').value });
        if (error) return $('userMsg').textContent = errText(error);
        renderUser(data); loadUsers();
      };
    }

    // ---- exchanges ----------------------------------------------------------
    let exOffset = 0;
    async function loadExchanges(offset = exOffset) {
      exOffset = offset;
      const { data: x, error } = await sb.rpc('admin_exchanges', { p_status: $('exStatus').value || null, p_limit: PAGE, p_offset: offset, p_hide_demo: $('exHideDemo').checked });
      if (error) return;
      $('exList').innerHTML = table(['Status', 'Stop', 'Chain', 'Receiver', 'Donor', 'Started', 'Updated', 'Notes'],
        x.rows.map((e) => `<tr><td>${pill(e.status)}</td><td>${esc(e.stop)}${e.is_demo ? ' <span class="dim">(demo)</span>' : ''}</td><td class="dim">${esc(e.chain)}</td><td>${userLink(e.receiver_id, e.receiver)}</td><td>${e.donor_id ? userLink(e.donor_id, e.donor) : '-'}</td><td class="dim">${time(e.created_at)}</td><td class="dim">${ago(e.updated_at)}</td><td class="dim">${[e.decline_reason, e.queue_number ? `#${e.queue_number} in line` : '', e.retry_used ? 'retry' : '', e.has_photo ? 'photo' : ''].filter(Boolean).join(' · ')}</td></tr>`));
      pager('exPager', x.total, offset, loadExchanges);
    }
    $('exStatus').addEventListener('change', () => loadExchanges(0));
    try { $('exHideDemo').checked = localStorage.getItem('exHideDemo') !== '0'; } catch { /* default: hide */ }
    $('exHideDemo').addEventListener('change', () => { try { localStorage.setItem('exHideDemo', $('exHideDemo').checked ? '1' : '0'); } catch { /* ignore */ } loadExchanges(0); });

    // ---- reports ------------------------------------------------------------
    let repOffset = 0;
    async function loadReports(offset = repOffset) {
      repOffset = offset;
      const f = $('repFilter').value;
      const { data: r, error } = await sb.rpc('admin_reports', { p_limit: PAGE, p_offset: offset, p_open: f === '' ? null : f === 'open' });
      if (error) return;
      $('reportList').innerHTML = table(['When', 'Reason', 'From', 'Stop', 'Exchange', 'Photo', 'Emailed', ''],
        r.rows.map((x) => `<tr><td class="dim">${time(x.created_at)}</td><td class="wrap">${x.stop_status ? `${pill(x.stop_status)} <a href="#stops">Stops</a> · ` : ''}${esc(x.reason).replace(/(https:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noopener">map</a>')}</td><td>${userLink(x.reporter_id, x.reporter)}</td><td>${esc(x.stop ?? '')}</td><td>${x.exchange_status ? pill(x.exchange_status) : '-'}</td><td>${x.photo_path ? `<img class="thumb" data-photo="${esc(x.photo_path)}" alt="code photo">` : '-'}</td><td class="dim">${x.notified_at ? time(x.notified_at) : 'not yet'}</td>
          <td><button class="small" data-resolve="${x.id}" data-to="${x.resolved ? 'false' : 'true'}">${x.resolved ? 'Reopen' : 'Resolve'}</button> <button class="small danger" data-delete="${x.id}">Delete</button></td></tr>`));
      pager('repPager', r.total, offset, loadReports);
      fillSigned($('reportList'), 'code-photos', 'photo');
    }
    $('repFilter').addEventListener('change', () => loadReports(0));
    $('reportList').addEventListener('click', async (e) => {
      const res = e.target.closest('[data-resolve]'), del = e.target.closest('[data-delete]');
      $('repMsg').textContent = '';
      if (res) {
        const { error } = await sb.rpc('admin_report_resolve', { p_id: Number(res.dataset.resolve), p_resolved: res.dataset.to === 'true' });
        if (error) return $('repMsg').textContent = error.message;
        loadReports(); loadOverview();
      }
      if (del && confirm('Delete this report? This cannot be undone.')) {
        const { error } = await sb.rpc('admin_report_delete', { p_id: Number(del.dataset.delete) });
        if (error) return $('repMsg').textContent = error.message;
        loadReports(); loadOverview();
      }
    });

    // ---- driver-added stops: list + draggable pin ---------------------------
    let map, marker, stopRows = [], current = null;
    async function loadStops() {
      const { data, error } = await sb.rpc('admin_stop_reports');
      if (error) return;
      stopRows = data;
      $('stopList').innerHTML = table(['', 'Chain', 'From', 'When', 'Decided'],
        data.map((s) => `<tr data-stop="${s.id}" class="${current?.id === s.id ? 'selected' : ''}"><td>${pill(s.status)}</td><td>${esc(s.chain)} <span class="dim">#${s.id}</span></td><td>${userLink(s.reporter_id, s.reporter)}</td><td class="dim">${time(s.created_at)}</td><td class="dim">${s.decided_at ? time(s.decided_at) : ''}</td></tr>`));
      if (!map) {
        // No wheel zoom: scrolling the page over the map must not zoom it (pinch and +/- still do).
        map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([39.5, -98.35], 4);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      }
      if (current) selectStop(current.id); else if (data.length) selectStop(data[0].id);
    }
    function selectStop(id) {
      current = stopRows.find((s) => s.id === id);
      if (!current) return;
      for (const tr of $('stopList').querySelectorAll('tr[data-stop]')) tr.classList.toggle('selected', Number(tr.dataset.stop) === id);
      const at = [current.lat, current.lng];
      if (marker) marker.setLatLng(at); else marker = L.marker(at, { draggable: true }).addTo(map);
      map.setView(at, 17);
      show('mapTools', true);
      if (window.innerWidth <= 760) $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
      // A decision can be changed later (approved by mistake → Reject takes it off the map).
      $('approveStop').disabled = current.status === 'approved';
      $('rejectStop').disabled = current.status === 'rejected';
      $('gmaps').href = `https://www.google.com/maps?q=${current.lat},${current.lng}&t=k`;
      $('mapHint').textContent = `${current.chain} #${current.id} · ${current.status}. Drag the pin onto the building with the showers, then save.`;
      $('stopMsg').textContent = '';
    }
    $('stopList').addEventListener('click', (e) => {
      if (e.target.closest('[data-user]')) return;
      const tr = e.target.closest('tr[data-stop]');
      if (tr) selectStop(Number(tr.dataset.stop));
    });
    $('savePoint').onclick = async () => {
      const { lat, lng } = marker.getLatLng();
      const { error } = await sb.rpc('admin_stop_move', { p_id: current.id, p_lat: lat, p_lng: lng });
      $('stopMsg').textContent = error ? error.message : `Point saved: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (!error) { current.lat = lat; current.lng = lng; $('gmaps').href = `https://www.google.com/maps?q=${lat},${lng}&t=k`; }
    };
    const decide = async (approve) => {
      const wasApproved = current.status === 'approved';
      if (!approve && !confirm(wasApproved
        ? 'Take this stop off the map? Drivers sharing there are signed off.'
        : 'Reject this stop? It will not appear on the map.')) return;
      const { data, error } = await sb.rpc('admin_stop_decide', { p_id: current.id, p_approve: approve });
      const wasPending = current.status === 'pending';
      await loadStops();  // reselects the row (which clears the message), so the message goes after it
      $('stopMsg').textContent = error ? error.message
        : data === 'approved' ? (wasPending ? 'Approved: the stop is live, the driver was told.' : 'Back on the map.')
        : data === 'rejected' ? (wasApproved ? 'Removed: the stop is off the map.' : 'Rejected: it will not appear on the map.')
        : `Result: ${data}`;
    };
    $('approveStop').onclick = () => decide(true);
    $('rejectStop').onclick = () => decide(false);

    // ---- settings: admins, password, log ------------------------------------
    const adminErrors = {
      bad_email: "That doesn't look like an email address.",
      already_admin: 'This email is already an admin.',
      cannot_remove_self: "You can't remove yourself. Ask another admin.",
      last_admin: "You can't remove the last admin.",
      not_in_list: 'This email is not in the list anymore.',
    };
    const adminErr = (e) => adminErrors[e.message] ?? e.message;
    function renderAdmins(a) {
      $('adminList').innerHTML = table(['Email', 'Account', 'Last sign-in', ''],
        a.admins.map((x) => `<tr><td>${esc(x.email)}${x.email === a.me ? '<span class="you">you</span>' : ''}</td>
          <td class="dim">${x.has_account ? 'yes' : 'not yet'}</td>
          <td class="dim">${x.last_sign_in_at ? ago(x.last_sign_in_at) : '-'}</td>
          <td>${x.email === a.me ? '' : `<button class="small" data-remove="${esc(x.email)}">Remove</button>`}</td></tr>`));
    }
    function renderDomains(d) {
      $('domainCount').textContent = `${d.total} in the list`;
      $('domainList').innerHTML = d.manual.length
        ? table(['Domain', 'Added', ''], d.manual.map((x) => `<tr><td>${esc(x.domain)}</td><td class="dim">${time(x.created_at)}</td><td><button class="small" data-unblock="${esc(x.domain)}">Unblock</button></td></tr>`))
        : '';
    }
    async function loadSettings() {
      const [{ data: a }, { data: log }, { data: d }, { data: ref }, { data: donate }] = await Promise.all([
        sb.rpc('admin_admins'), sb.rpc('admin_log_recent', { p_limit: 50 }), sb.rpc('admin_blocked_domains'),
        sb.rpc('admin_email_refusals', { p_limit: 50 }), sb.rpc('donate_url')]);
      const { data: upd } = await sb.rpc('app_update_info');
      if (upd) { $('updVersion').value = upd.latest_version ?? ''; $('updBuild').value = upd.latest_build ?? ''; $('updMin').value = upd.min_build ?? 0; }
      $('donateUrl').value = donate ?? '';
      $('donateMsg').textContent = donate ? 'On: the button is live in the app.' : 'Off: no button in the app.';
      if (a) renderAdmins(a);
      if (d) renderDomains(d);
      if (ref) {
        $('refusalCount').textContent = `${ref.total_30d} in 30 days`;
        $('refusalTop').innerHTML = ref.top_domains.length
          ? `<p>Most tried: ${ref.top_domains.map((x) => `${esc(x.domain)} (${x.n})`).join(' · ')}</p>` : '';
        $('refusalList').innerHTML = ref.recent.length
          ? table(['When', 'Email', 'Domain'], ref.recent.map((x) => `<tr><td class="dim">${time(x.created_at)}</td><td>${esc(x.email)}</td><td class="dim">${esc(x.domain)}</td></tr>`))
          : '<div class="empty">No refused sign-ins yet.</div>';
      }
      $('adminLog').innerHTML = (log ?? []).length
        ? log.map((l) => `<p>${time(l.created_at)} · ${esc(l.actor)} · ${esc(l.action.replaceAll('_', ' '))} ${esc(l.target)}${l.details ? ` - ${esc(l.details)}` : ''}</p>`).join('')
        : '<p>Nothing yet.</p>';
    }
    $('addAdminForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('addAdminBtn').disabled = true; $('adminMsg').textContent = '';
      const { data, error } = await sb.rpc('admin_add', { p_email: $('newAdmin').value });
      $('addAdminBtn').disabled = false;
      if (error) return $('adminMsg').textContent = adminErr(error);
      $('newAdmin').value = '';
      renderAdmins(data); loadSettings();
    });
    $('adminList').addEventListener('click', async (e) => {
      const email = e.target.closest('[data-remove]')?.dataset.remove;
      if (!email || !confirm(`Remove ${email} from admins? They lose access to this dashboard.`)) return;
      $('adminMsg').textContent = '';
      const { data, error } = await sb.rpc('admin_remove', { p_email: email });
      if (error) return $('adminMsg').textContent = adminErr(error);
      renderAdmins(data); loadSettings();
    });

    $('addDomainForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('domainMsg').textContent = '';
      const { data, error } = await sb.rpc('admin_block_domain', { p_domain: $('newDomain').value, p_block: true });
      if (error) return $('domainMsg').textContent = error.message === 'bad_domain' ? "That doesn't look like a domain." : error.message;
      $('newDomain').value = '';
      renderDomains(data);
    });
    $('domainList').addEventListener('click', async (e) => {
      const d = e.target.closest('[data-unblock]')?.dataset.unblock;
      if (!d) return;
      const { data, error } = await sb.rpc('admin_block_domain', { p_domain: d, p_block: false });
      if (error) return $('domainMsg').textContent = error.message;
      renderDomains(data);
    });

    $('updateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { data, error } = await sb.rpc('admin_set_update', { p_latest_version: $('updVersion').value.trim(),
        p_latest_build: Number($('updBuild').value), p_min_build: Number($('updMin').value) });
      $('updMsg').textContent = error ? ({ bad_version: 'Version like 0.5.5.', bad_build: 'Min build must be 0…latest.' })[error.message] ?? error.message
        : `Saved: latest ${data.latest_version} (${data.latest_build}), minimum ${data.min_build}.`;
    });
    $('donateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { data, error } = await sb.rpc('admin_set_donate_url', { p_url: $('donateUrl').value });
      if (error) return $('donateMsg').textContent = error.message === 'bad_url' ? 'Use a full https:// address.' : error.message;
      $('donateMsg').textContent = data ? 'Saved. The button is live in the app.' : 'Saved: donations are off.';
    });

    // ---- live ---------------------------------------------------------------
    function startLive() {
      const nudge = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { if (!$('view-dashboard').hidden) loadDashboard(); }, 800); };
      channel = sb.channel('admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'exchanges' }, nudge)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, nudge)
        .subscribe((status) => {
          $('live').classList.toggle('on', status === 'SUBSCRIBED');
          $('liveText').textContent = status === 'SUBSCRIBED' ? 'live' : 'reconnecting…';
        });
      slowTimer = setInterval(() => { if (!$('view-dashboard').hidden) loadDashboard(); }, 30000);
    }
    function stopLive() {
      clearInterval(slowTimer);
      if (channel) { sb.removeChannel(channel); channel = null; }
    }

    start();
