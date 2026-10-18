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
    // US units for people: miles, feet under a tenth of a mile, mph. The database keeps metres and km/h.
    const M_PER_MI = 1609.34;
    const dist = (m) => m == null ? '-' : m < M_PER_MI / 10 ? `${Math.round(m * 3.28084 / 10) * 10} ft`
      : `${(m / M_PER_MI).toFixed(m < 10 * M_PER_MI ? 2 : 1)} mi`;
    const mph = (kmh) => `${Math.round(kmh * 0.621371)} mph`;
    const time = (t) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    // The date, with the time of day in a span that phones hide where a table is tight.
    const dayTime = (t) => t ? `${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })}<span class="hm">, ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : '-';
    const label = { searching: 'searching', accepted: 'accepted', queued: 'in line', code_sent: 'code sent',
      retry_needed: 'retry needed', success: 'success', failed: 'failed', no_donor: 'no donor', cancelled: 'cancelled',
      pending: 'pending', approved: 'approved', rejected: 'rejected' };
    const pill = (s) => `<span class="pill ${esc(s)}" title="${esc(label[s] ?? s)}">${esc(label[s] ?? s)}</span>`;
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
      // database was reset): ask the server, and start over with sign-in if it says so. Only then: a
      // network hiccup (the Mac just woke up) is no reason to sign out, and signing out here only ever
      // ends this browser's session (the same account stays signed in in the app).
      const { error: userErr } = await sb.auth.getUser();
      if (seq !== routeSeq) return;
      if (userErr && [401, 403].includes(userErr.status)) { await sb.auth.signOut({ scope: 'local' }); return; }
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
    // This browser only: the same account stays signed in in the app on the phone.
    $('signOut').addEventListener('click', () => sb.auth.signOut({ scope: 'local' }));
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
      if (tab === 'stops') { setTimeout(() => map?.invalidateSize(), 50); loadAddChains(); }
    }
    window.addEventListener('hashchange', () => { $('drawerHost').innerHTML = ''; if (!$('dash').hidden) showTab(); });

    // ---- dashboard ----------------------------------------------------------
    async function loadDashboard() { await Promise.all([loadOverview(), loadLive(), loadServer()]); }

    // Server load: the worker measures once a minute (see migration 76). Level and numbers now, then the last
    // 24 hours in 5-minute steps, one small chart per measure, a dashed line where "busy" starts.
    async function loadServer() {
      const { data: s, error } = await sb.rpc('admin_server_load');
      if (error) return;
      const box = $('server'), nw = s.now;
      if (!nw) { box.innerHTML = '<div class="serverHead"><h2>Server</h2></div><p class="note">No measurements yet. The first one comes a minute after the worker update.</p>'; return; }
      const stale = Date.now() - new Date(nw.at).getTime() > 5 * 60 * 1000;
      const [label, cls] = stale ? ['No fresh measurement', 'stale']
        : { ok: ['Running fine', 'ok'], busy: ['Busy', 'busy'], critical: ['Overloaded', 'crit'] }[nw.level];
      const tile = (v, unit, name, hot) => `<div class="${hot ? 'hot' : ''}"><b>${v == null ? '-' : `${Math.round(v)}<small>${unit}</small>`}</b><span>${name}</span></div>`;
      const pts = s.points.map((p) => ({ ...p, t: new Date(p.at).getTime() }));
      box.innerHTML = `<div class="serverHead"><h2>Server</h2><span class="lvl ${cls}"><i></i>${label}</span><span class="when">measured ${ago(nw.at)}</span></div>
        <div class="tiles">
          ${tile(nw.pulse_ms, 'ms', 'Response', nw.pulse_ms >= 1000)}
          ${tile(nw.cpu_pct, '%', 'CPU', nw.cpu_pct >= 85)}
          ${tile(nw.mem_pct, '%', 'Memory', nw.mem_pct >= 90)}
          <div class="${nw.connections >= 0.8 * nw.max_connections ? 'hot' : ''}"><b>${nw.connections}<small>of ${nw.max_connections}</small></b><span>Connections</span></div>
          ${tile(nw.disk_pct, '%', 'Disk used', nw.disk_pct >= 80)}
          ${tile(nw.db_mb, 'MB', 'Database', false)}
        </div>
        <div class="sparks">
          ${spark('pulse', 'Response time, ms', pts, 1000)}
          ${spark('cpu', 'CPU, %', pts, 85, 100)}
          ${spark('mem', 'Memory, %', pts, 90, 100)}
        </div>
        ${nw.metrics_note ? `<p class="note">CPU, memory and disk aren't available: ${esc(nw.metrics_note)}</p>` : ''}`;
      for (const el of box.querySelectorAll('.spark')) hoverSpark(el, pts);
    }
    // One measure over 24 h. Gaps over 10 minutes (worker down, no samples) break the line instead of bridging it.
    function spark(key, title, pts, busy, fixedMax) {
      const end = Date.now(), start = end - 24 * 3600 * 1000;
      const vals = pts.filter((p) => p[key] != null);
      const max = fixedMax ?? Math.max(busy * 1.2, ...vals.map((p) => p[key]));
      const x = (t) => ((t - start) / (end - start)) * 1000, y = (v) => 100 - (Math.min(v, max) / max) * 100;
      let line = '', area = '', prev = null, runStart = null;
      for (const p of vals) {
        const gap = !prev || p.t - prev.t > 10 * 60 * 1000;
        if (gap && prev) area += `L${x(prev.t)},100L${x(runStart)},100Z`;
        if (gap) runStart = p.t;
        line += `${gap ? 'M' : 'L'}${x(p.t)},${y(p[key])}`;
        area += `${gap ? `M${x(p.t)},100L` : 'L'}${x(p.t)},${y(p[key])}`;
        prev = p;
      }
      if (prev) area += `L${x(prev.t)},100L${x(runStart)},100Z`;
      const limit = busy <= max ? `<line class="limit" x1="0" x2="1000" y1="${y(busy)}" y2="${y(busy)}"></line>` : '';
      return `<div class="spark" data-key="${key}" data-max="${max}"><h3>${title}</h3>
        <div class="plot"><span class="top">${Math.round(max)}</span>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${limit}<path class="area" d="${area}"></path><path class="line" d="${line}"></path></svg>
        </div><div class="ax"><span>24 h ago</span><span>12 h</span><span>now</span></div></div>`;
    }
    function hoverSpark(el, pts) {
      const key = el.dataset.key, unit = key === 'pulse' ? ' ms' : '%', plot = el.querySelector('.plot');
      const vals = pts.filter((p) => p[key] != null);
      plot.addEventListener('mousemove', (e) => {
        const r = plot.getBoundingClientRect(), end = Date.now(), start = end - 24 * 3600 * 1000;
        const t = start + ((e.clientX - r.left) / r.width) * (end - start);
        let best = null;
        for (const p of vals) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
        plot.querySelector('.cursor')?.remove(); plot.querySelector('.tip')?.remove();
        if (!best || Math.abs(best.t - t) > 15 * 60 * 1000) return;
        const left = ((best.t - start) / (end - start)) * 100;
        const when = new Date(best.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        plot.insertAdjacentHTML('beforeend', `<div class="cursor" style="left:${left}%"></div><div class="tip" style="left:${Math.min(88, Math.max(12, left))}%">${when}: <b>${best[key]}${unit}</b></div>`);
      });
      plot.addEventListener('mouseleave', () => { plot.querySelector('.cursor')?.remove(); plot.querySelector('.tip')?.remove(); });
    }

    async function loadOverview() {
      const { data: o, error } = await sb.rpc('admin_overview');
      if (error) return;
      const today = o.exchanges_today || {}, week = o.exchanges_week || {};
      const n = (v) => Number(v) || 0;
      const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;

      // Right now: a cell lights up only while something is happening.
      const cell = (k, one, many) => `<div class="nowCell${n(k) ? ' lit' : ''}"><i></i><b>${n(k)}</b><span>${n(k) === 1 ? one : many}</span></div>`;
      $('nowBoard').innerHTML = cell(o.open_exchanges, 'open exchange', 'open exchanges')
        + cell(o.donors_on_shift, 'donor on shift', 'donors on shift');

      // Needs you: what waits for a decision, each with the tab where it's decided.
      const need = (k, label, href) => `<a class="${n(k) ? 'due' : ''}" href="${href}"><b>${n(k)}</b><span>${label}</span></a>`;
      const waiting = n(o.reports_open) + n(o.stops_pending) + n(o.issues_pending);
      $('needs').innerHTML = `<h2>Needs you</h2>
        ${need(o.reports_open, 'open reports', '#reports')}
        ${need(o.stops_pending, 'new stops to check', '#stops')}
        ${need(o.issues_pending, 'problems with stops', '#stops')}
        ${waiting ? '' : '<p>Nothing waiting.</p>'}`;

      // Showers, last 14 days: one stacked bar a day (success at the base), a tooltip per day.
      const days = o.days || [];
      const total = (d) => n(d.success) + n(d.failed) + n(d.no_donor);
      const max = Math.max(1, ...days.map(total));
      const sum = (k) => days.reduce((t, d) => t + n(d[k]), 0);
      const fmt = (iso, opts) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts);
      const seg = (cls, v) => v ? `<div class="seg ${cls}" style="height:${(v / max) * 100}%"></div>` : '';
      const bars = days.map((d) => {
        const tip = `<b>${fmt(d.day, { weekday: 'short', month: 'short', day: 'numeric' })}</b><br>${plural(n(d.success), 'shower', 'showers')}`
          + `${n(d.failed) ? `, ${n(d.failed)} failed` : ''}${n(d.no_donor) ? `, ${n(d.no_donor)} no donor` : ''}`
          + `${n(d.cancelled) ? `<br>${n(d.cancelled)} cancelled by the receiver` : ''}`;
        const label = tip.replace(/<br>/g, '. ').replace(/<[^>]+>/g, '');
        return `<div class="day" tabindex="0" aria-label="${esc(label)}">${seg('ok', n(d.success))}${seg('bad', n(d.failed))}${seg('none', n(d.no_donor))}<div class="tip">${tip}</div></div>`;
      }).join('');
      const labels = days.map((d, i) => i === days.length - 1 ? '<span class="today">today</span>'
        : `<span>${i === 0 || d.day.endsWith('-01') ? fmt(d.day, { month: 'short', day: 'numeric' }) : Number(d.day.slice(8))}</span>`).join('');
      $('chartBox').innerHTML = `<h2>Showers, last 14 days</h2>
        <div class="legend">
          <span><i style="background:var(--ok)"></i>Got a shower <b>${sum('success')}</b></span>
          <span><i style="background:var(--bad)"></i>Code failed <b>${sum('failed')}</b></span>
          <span><i style="background:var(--none)"></i>No donor came <b>${sum('no_donor')}</b></span>
        </div>
        <div class="bars"><div class="top"><em>${max}</em></div>${bars}</div>
        <div class="days">${labels}</div>`;

      // The rest, quiet.
      const methods = Object.entries(o.users_by_method || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${v} ${k === 'email' ? 'email' : k[0].toUpperCase() + k.slice(1)}`).join(', ');
      $('facts').innerHTML = `<h2>This week</h2><dl>
        <dt>Today</dt><dd>${plural(n(today.success), 'shower', 'showers')}${n(today.failed) ? `, <small>${n(today.failed)} failed</small>` : ''}${n(today.no_donor) ? `, <small>${n(today.no_donor)} no donor</small>` : ''}</dd>
        <dt>7 days</dt><dd>${plural(n(week.success), 'shower', 'showers')}${n(week.failed) ? `, <small>${n(week.failed)} failed</small>` : ''}${n(week.no_donor) ? `, <small>${n(week.no_donor)} no donor</small>` : ''}</dd>
        <dt>Drivers</dt><dd>${n(o.users_total)} <small>+${n(o.users_today)} today, +${n(o.users_week)} this week</small></dd>
        <dt>Sign-in</dt><dd><small>${esc(methods || '-')}</small></dd>
        <dt>On hold</dt><dd>${n(o.in_cooldown) || n(o.flagged) ? `${n(o.in_cooldown)} in cooldown, ${n(o.flagged)} flagged` : '<small>nobody</small>'}</dd>
      </dl>`;
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
        u.rows.map((x) => `<tr><td>${avatarImg(x)}</td><td>${userLink(x.id, x.nickname)}${x.name ? `<div class="dim small">${esc(x.name)}</div>` : ''}</td><td class="dim">${device(x)}</td><td class="dim">${esc(x.method)}</td><td class="dim">${esc(x.email ?? '')}</td><td>${esc(x.chains ?? '')}</td><td>${x.given}</td><td>${x.received}</td><td class="dim">${time(x.created_at)}</td><td class="dim">${ago(x.last_seen_at ?? x.last_sign_in_at)}</td><td class="flag">${x.dev_mode ? '<span class="dev" title="Developer mode on">dev</span> ' : ''}${[x.is_blocked && 'blocked', x.in_cooldown && 'cooldown', x.flagged && 'flagged', !x.has_push && 'no push'].filter(Boolean).join(' · ')}</td></tr>`));
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
          <div>Joined</div><div>${time(u.created_at)} · last seen ${ago(u.last_seen_at ?? u.last_sign_in_at)}${u.platform ? ` · ${u.platform === 'ios' ? 'iPhone' : u.platform === 'android' ? 'Android' : 'Web'}${u.app_build ? ' ' + u.app_build : ''}` : ''}</div>
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
        ${u.dev_mode ? `<h3>Truck stop passes <span class="dim">(developer mode)</span></h3>
          <p class="dim small">Tap a pass to see it on the map: <b style="color:#4fbf6a">●</b> the truck stop, <b style="color:#3d8bfd">●</b> where the phone was at its closest. The circle is the 1,000 ft zone.</p>
          <div id="passMap" class="passMap"></div><div id="passList"><p class="dim">Loading…</p></div>` : ''}
      </div>`;
      if (u.dev_mode) loadPasses(u.id);
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
        r.rows.map((x) => `<tr><td class="dim">${time(x.created_at)}</td><td class="wrap">${x.stop_status || x.issue_status ? `${pill(x.stop_status || x.issue_status)} <a href="#stops">Stops</a> · ` : ''}${esc(x.reason).replace(/(https:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noopener">map</a>')}</td><td>${userLink(x.reporter_id, x.reporter)}</td><td>${esc(x.stop ?? '')}</td><td>${x.exchange_status ? pill(x.exchange_status) : '-'}</td><td>${x.photo_path ? `<img class="thumb" data-photo="${esc(x.photo_path)}" alt="code photo">` : '-'}</td><td class="dim">${x.notified_at ? time(x.notified_at) : 'not yet'}</td>
          <td>${repAction(x)} <button class="small danger" data-delete="${x.id}">Delete</button></td></tr>`));
      pager('repPager', r.total, offset, loadReports);
      fillSigned($('reportList'), 'code-photos', 'photo');
    }
    // A stop problem is closed by deciding it (Approve / Reject here, the same as in Stops); a new stop from a
    // driver is decided in Stops, where its pin can be moved first; a chain the app doesn't have is just "Seen".
    function repAction(x) {
      if (x.issue_status === 'pending') return `<button class="small" data-issue="${x.stop_issue_id}" data-approve="1">✅ Approve</button> <button class="small danger" data-issue="${x.stop_issue_id}" data-approve="0">❌ Reject</button>`;
      if (x.stop_status === 'pending') return '<a href="#stops">Decide in Stops</a>';
      if (x.stop_issue_id || x.stop_report_id) return '';   // closed by the decision
      return `<button class="small" data-resolve="${x.id}" data-to="${x.resolved ? 'false' : 'true'}">${x.resolved ? 'Reopen' : x.other_chain ? 'Seen' : 'Resolve'}</button>`;
    }
    $('repFilter').addEventListener('change', () => loadReports(0));
    $('reportList').addEventListener('click', async (e) => {
      const res = e.target.closest('[data-resolve]'), del = e.target.closest('[data-delete]'), dec = e.target.closest('[data-issue]');
      $('repMsg').textContent = '';
      if (dec) {
        const approve = dec.dataset.approve === '1';
        if (approve && !confirm('Apply what the driver reported? (A new chain, the stop off the map, or marked as having no showers.)')) return;
        const { data, error } = await sb.rpc('admin_stop_issue_decide', { p_id: Number(dec.dataset.issue), p_approve: approve });
        $('repMsg').textContent = error ? error.message : data === 'approved' ? 'Done: the stop is fixed.' : data === 'rejected' ? 'Rejected: the stop stays as it was.' : `Result: ${data}`;
        loadReports(); loadOverview(); loadIssues();
      }
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
        data.map((s) => `<tr data-stop="${s.id}" class="${current?.id === s.id ? 'selected' : ''}"><td>${pill(s.status)}</td><td>${esc(s.chain)} <span class="dim">#${s.id}</span></td><td>${userLink(s.reporter_id, s.reporter)}</td><td class="dim">${dayTime(s.created_at)}</td><td class="dim">${s.decided_at ? time(s.decided_at) : ''}</td></tr>`));
      if (!map) {
        // No wheel zoom: scrolling the page over the map must not zoom it (pinch and +/- still do).
        map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([39.5, -98.35], 4);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      }
      if (current) selectStop(current.id); else if (data.length) selectStop(data[0].id);
      loadIssues();
    }

    // ---- problems with existing stops ("something wrong with this truck stop?") ----
    async function loadIssues() {
      const { data, error } = await sb.rpc('admin_stop_issues');
      if (error) return $('issueMsg').textContent = error.message;
      const what = (x) => x.kind === 'not_here' ? 'No truck stop here' : x.kind === 'no_showers' ? 'No showers here'
        : `Really ${x.new_chain ? esc(x.new_chain) : x.other_chain ? `${esc(x.other_chain)} (not in the app)` : 'a chain not in the app'}`;
      const where = (x) => [x.interstate && `${esc(x.interstate)}${x.exit ? ' exit ' + esc(x.exit) : ''}`, [x.city, x.state].filter(Boolean).map(esc).join(', ')].filter(Boolean).join(', ');
      $('issueList').innerHTML = data.length ? table(['', 'Stop', 'Problem', 'From', 'When', ''],
        data.map((x) => `<tr><td>${pill(x.status)}</td>
          <td>${esc(x.chain)}${x.number ? ' #' + esc(x.number) : ''} <span class="dim">#${x.stop_id}</span><div class="dim small">${where(x)}${x.stop_active ? '' : ' · off the map'}</div>
            <a href="https://www.google.com/maps?q=${x.lat},${x.lng}&t=k" target="_blank" rel="noopener">satellite</a></td>
          <td>${what(x)}${x.same > 1 ? ` <span class="dim">(${x.same} drivers)</span>` : ''}</td>
          <td>${userLink(x.reporter_id, x.reporter)}</td><td class="dim">${time(x.created_at)}</td>
          <td>${x.status === 'pending' ? `<button class="small" data-issue="${x.id}" data-approve="1">✅ Approve</button> <button class="small danger" data-issue="${x.id}" data-approve="0">❌ Reject</button>` : `<span class="dim">${x.decided_at ? time(x.decided_at) : ''}</span>`}</td></tr>`))
        : '<p class="dim">Nothing reported yet.</p>';
      loadOtherChains();
    }
    // ---- a developer-mode driver's journal of passes, in the user card ----
    async function loadPasses(userId) {
      const { data, error } = await sb.rpc('admin_stop_passes', { p_user: userId });
      if (!$('passList')) return;   // the card was closed meanwhile
      if (error) return $('passList').innerHTML = `<p class="msg">${esc(error.message)}</p>`;
      const dur = (sec) => sec < 90 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`;
      const verdict = (p) => (p.zone_seconds ?? 0) >= 180 ? ['pulled in', `${dur(p.zone_seconds)} in the zone`, 'var(--accent)']
        : p.min_distance_m != null && p.min_distance_m <= 300 ? ['drove through', p.zone_seconds ? `${dur(p.zone_seconds)} in the zone` : '', '#e8b04a']
        : ['near', 'outside the zone', 'var(--dim)'];
      const where = (p) => [p.interstate && `${esc(p.interstate)}${p.exit ? ' exit ' + esc(p.exit) : ''}`, [p.city, p.state].filter(Boolean).map(esc).join(', ')].filter(Boolean).join(', ');
      // A list, not a table: it has to fit a phone screen.
      $('passList').innerHTML = data.length ? `<div class="found">${data.map((p, i) => { const [v, sub, color] = verdict(p); return `<div class="foundRow clickable" data-pass="${i}">
          <div class="foundInfo"><div class="dim small">${time(p.entered_at)}</div>
            <b>${esc(p.chain)}${p.number ? ' #' + esc(p.number) : ''}</b> <span class="dim small">${where(p) || ''}${p.has_showers ? '' : ' · no showers'}</span>
            <div><b style="color:${color}">${v}</b> <span class="dim small">${[sub, p.between_points && 'between fixes'].filter(Boolean).join(' · ')}</span></div>
            <div class="dim small">closest ${dist(p.min_distance_m)}${p.speed_kmh != null ? ` · ${mph(p.speed_kmh)}` : ''}</div></div>
        </div>`; }).join('')}</div>`
        : '<p class="dim">No passes yet.</p>';
      if (!data.length) return show('passMap', false);
      const map = L.map('passMap', { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      const showPass = (i) => {
        const p = data[i];
        layer.clearLayers();
        const stop = [p.stop_lat, p.stop_lng];
        L.circle(stop, { radius: 300, color: '#4fbf6a', weight: 1, fillOpacity: 0.08 }).addTo(layer);
        L.circleMarker(stop, { radius: 7, color: '#4fbf6a', fillColor: '#4fbf6a', fillOpacity: 1 }).addTo(layer).bindTooltip(p.chain);
        if (p.closest_lat != null) {
          const me = [p.closest_lat, p.closest_lng];
          L.polyline([stop, me], { color: '#3d8bfd', weight: 2, dashArray: '4 4' }).addTo(layer);
          L.circleMarker(me, { radius: 7, color: '#3d8bfd', fillColor: '#3d8bfd', fillOpacity: 1 }).addTo(layer).bindTooltip(dist(p.min_distance_m));
          map.fitBounds(L.latLngBounds([stop, me]).pad(0.6), { maxZoom: 17 });
        } else map.setView(stop, 16);
        for (const row of $('passList').querySelectorAll('[data-pass]')) row.classList.toggle('picked', Number(row.dataset.pass) === i);
      };
      $('passList').addEventListener('click', (e) => { const row = e.target.closest('[data-pass]'); if (row) showPass(Number(row.dataset.pass)); });
      setTimeout(() => { map.invalidateSize(); showPass(0); }, 50);
    }

    // ---- add a truck stop by hand: chain + coordinates (pasted from Google Maps, or a Maps link) ----
    let chainsLoaded = false;
    async function loadAddChains() {
      if (chainsLoaded) return;
      const { data } = await sb.from('chains').select('id,name').order('name');
      if (!data) return;
      $('addChain').innerHTML = '<option value="">Chain…</option>' + data.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      $('stopChain').innerHTML = '<option value="">All chains</option>' + data.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      chainsLoaded = true;
      loadStopStates();
    }
    // "36.69653, -97.34925", "36.69653,-97.34925" or a link with "@36.69653,-97.34925,17z" / "?q=36.69,-97.34".
    const parseCoords = (t) => {
      const m = String(t).match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
      if (!m) return null;
      const lat = Number(m[1]), lng = Number(m[2]);
      return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    };
    $('addStop').onsubmit = async (e) => {
      e.preventDefault();
      const c = parseCoords($('addCoords').value);
      if (!c) return $('addStopMsg').textContent = 'Coordinates look wrong. Paste them like 36.69653, -97.34925.';
      if (!$('addChain').value) return $('addStopMsg').textContent = 'Pick the chain.';
      const { data, error } = await sb.rpc('admin_add_stop', {
        p_chain_id: Number($('addChain').value), p_lat: c.lat, p_lng: c.lng,
        p_number: $('addNumber').value, p_city: $('addCity').value, p_state: $('addState').value,
        p_interstate: $('addInterstate').value, p_exit: $('addExit').value, p_has_showers: $('addShowers').checked,
      });
      if (error) {
        const dup = error.message.match(/^stop_exists:(\d+)/);
        $('addStopMsg').textContent = dup ? `This chain already has a stop within 0.3 mi (#${dup[1]}). Search for ${dup[1]} below to check it.`
          : error.message === 'bad_stop' ? 'Check the chain and the coordinates.' : error.message;
        return;
      }
      $('addStopMsg').innerHTML = `Added: ${esc(data.chain)} <span class="dim">#${data.id}</span> · <a href="https://www.google.com/maps?q=${c.lat},${c.lng}&t=k" target="_blank" rel="noopener">check on the satellite</a>. Drivers there see it now.`;
      for (const id of ['addCoords', 'addNumber', 'addCity', 'addState', 'addInterstate', 'addExit']) $(id).value = '';
      $('addShowers').checked = true;
    };

    // ---- any stop: search, and the "Has showers" switch ----
    let stopQuery = '';
    // An address (or a place name) -> coordinates, from OpenStreetMap's geocoder.
    async function geocode(q) {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`);
        const [hit] = await res.json();
        return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
      } catch { return null; }
    }
    const NEAR_MI = 30;   // about 48 km, under the server's 50 km limit; the closest 30 come back, nearest first
    // Text first (ID, town, state, interstate, exit, chain); coordinates, a Maps link or an address
    // (when the text finds nothing) list the stops within NEAR_MI of that point, closest first. Stops sit on the
    // interstate, often well outside the town they're named after (Harrisonburg's Pilot is 3.5 mi out).
    // The state picker: full names, with how many stops each has.
    const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
    const stateName = (st) => STATE_NAMES[st] ?? st;
    async function loadStopStates() {
      const { data } = await sb.rpc('admin_stop_states');
      if (!data) return;
      const keep = $('stopState').value;
      $('stopState').innerHTML = '<option value="">All states</option>' + data.slice().sort((a, b) => stateName(a.state).localeCompare(stateName(b.state)))
        .map((x) => `<option value="${esc(x.state)}">${esc(stateName(x.state))} (${x.n})</option>`).join('');
      $('stopState').value = keep;
    }
    async function searchStops() {
      const st = $('stopState').value, ch = $('stopChain').value;
      // A state or a chain picked: all their stops, in road order, narrowed by the text.
      if (st || ch) {
        $('stopFound').innerHTML = '<p class="dim">Loading…</p>';
        const { data, error } = await sb.rpc('admin_stop_list', { p_state: st || null, p_chain_id: ch ? Number(ch) : null, p_q: stopQuery || null });
        if (error) return $('stopFoundMsg').textContent = error.message;
        const what = [st ? stateName(st) : 'All states', ch ? $('stopChain').selectedOptions[0].textContent : '', stopQuery ? `"${stopQuery}"` : ''].filter(Boolean).join(', ');
        return showStops(data, `<p class="dim small">${esc(what)}: ${data.length} truck stop${data.length === 1 ? '' : 's'}${data.length >= 1000 ? ' (the first 1000)' : ''}</p>`, 'Nothing here. Try another state, chain or text.');
      }
      if (!stopQuery) return $('stopFound').innerHTML = '';
      $('stopFound').innerHTML = '<p class="dim">Searching…</p>';
      let data = null, around = null, label = '';
      const c = parseCoords(stopQuery);
      if (c) around = c;
      else {
        const { data: found, error } = await sb.rpc('admin_stop_search', { p_q: stopQuery });
        if (error) return $('stopFoundMsg').textContent = error.message;
        data = found;
        if (!data.length) {
          const g = await geocode(stopQuery);
          if (g) { around = g; label = g.label; }
        }
      }
      if (around) {
        const { data: near, error } = await sb.rpc('admin_stops_near', { p_lat: around.lat, p_lng: around.lng, p_km: NEAR_MI * M_PER_MI / 1000 });
        if (error) return $('stopFoundMsg').textContent = error.message;
        data = near;
      }
      const head = around ? `<p class="dim small">Within ${NEAR_MI} mi of ${label ? esc(label) : `${around.lat.toFixed(5)}, ${around.lng.toFixed(5)}`}:</p>` : '';
      showStops(data, head, around ? `No truck stops within ${NEAR_MI} mi.` : 'Nothing found. Try a town, an exit, coordinates or an address.');
    }
    function showStops(data, head, empty) {
      const where = (x) => [x.interstate && `${esc(x.interstate)}${x.exit ? ' exit ' + esc(x.exit) : ''}`, [x.city, x.state].filter(Boolean).map(esc).join(', ')].filter(Boolean).join(', ');
      // A list, not a table: on a phone the switches must stay on screen next to the name.
      $('stopFound').innerHTML = head + (data.length ? `<div class="found">${data.map((x) => `<div class="foundRow${x.is_active ? '' : ' offMap'}">
          <div class="foundInfo"><b>${esc(x.chain)}</b> <span class="dim">#${x.id}</span>${x.is_active ? '' : ' <span class="dim">· off the map</span>'}
            <div class="dim small">${where(x) || '-'}${x.distance_m != null ? ` · ${dist(x.distance_m)} away` : ''} · <a href="https://www.google.com/maps?q=${x.lat},${x.lng}&t=k" target="_blank" rel="noopener">satellite</a></div></div>
          <div class="foundActions">
            <label class="showersBox"><input type="checkbox" data-showers="${x.id}" ${x.has_showers ? 'checked' : ''}> ${x.has_showers ? 'Has showers' : '<b>No showers</b>'}</label>
            <button class="small" data-zone="${x.id}">Pin &amp; zone</button>
            ${x.is_active ? `<button class="small danger" data-active="${x.id}" data-to="0">Remove from map</button>` : `<button class="small" data-active="${x.id}" data-to="1">Put back</button>`}
          </div>
        </div>`).join('')}</div>`
        : `<p class="dim">${esc(empty)}</p>`);
    }
    $('stopSearch').onsubmit = (e) => { e.preventDefault(); stopQuery = $('stopQ').value.trim(); $('stopFoundMsg').textContent = ''; searchStops(); };
    for (const id of ['stopState', 'stopChain']) $(id).onchange = () => { stopQuery = $('stopQ').value.trim(); $('stopFoundMsg').textContent = ''; searchStops(); };
    $('stopFound').addEventListener('click', async (e) => {
      const z = e.target.closest('[data-zone]');
      if (z) return openZone(Number(z.dataset.zone));
      const b = e.target.closest('[data-active]');
      if (!b) return;
      const on = b.dataset.to === '1';
      if (!on && !confirm('Take this truck stop off the map? Drivers stop seeing it and any shifts there end. You can put it back later.')) return;
      const { error } = await sb.rpc('admin_stop_set_active', { p_id: Number(b.dataset.active), p_active: on });
      $('stopFoundMsg').textContent = error ? error.message : on ? 'Back on the map.' : 'Taken off the map.';
      searchStops();
    });
    $('stopFound').addEventListener('change', async (e) => {
      const box = e.target.closest('[data-showers]');
      if (!box) return;
      const has = box.checked;
      if (!has && !confirm('Mark this stop as having no showers? Drivers there are signed off sharing, and requests are refused.')) { box.checked = true; return; }
      const { error } = await sb.rpc('admin_stop_set_showers', { p_id: Number(box.dataset.showers), p_has: has });
      $('stopFoundMsg').textContent = error ? error.message : has ? 'Showers on: the stop works as usual.' : 'Marked: no showers at this stop.';
      searchStops();
    });

    // Pin & zone: where the stop is and how far around it the app counts a driver as there (300 m unless set;
    // long, narrow truck lots may need more, up to 800 m - more would swallow the next stop at the exit).
    const ZONES = [[null, '1,000 ft (300 m, default)'], [400, '1,300 ft (400 m)'], [500, '1,650 ft (500 m)'], [600, '2,000 ft (600 m)'], [800, '2,600 ft (800 m)']];
    async function openZone(id) {
      const { data: z, error } = await sb.rpc('admin_stop_zone', { p_id: id });
      if (error) return $('stopFoundMsg').textContent = error.message;
      const where = [z.interstate && `${z.interstate}${z.exit ? ' exit ' + z.exit : ''}`, [z.city, z.state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
      const opts = ZONES.some(([m]) => m === z.radius_m) ? ZONES : [...ZONES, [z.radius_m, `${Math.round(z.radius_m * 3.28084 / 50) * 50} ft (${z.radius_m} m)`]];
      $('drawerHost').innerHTML = `<div class="drawerBack" id="drawerBack"></div><div class="drawer" id="drawer">
        <button class="close small" id="drawerClose">Close</button>
        <h2>${esc(z.chain)}${z.number ? ' #' + esc(z.number) : ''} <span class="dim small">stop ${z.id}</span></h2>
        <p class="dim">${esc(where || '-')}${z.is_active ? '' : ' · off the map'} · <a href="https://www.google.com/maps?q=${z.lat},${z.lng}&t=k" target="_blank" rel="noopener" id="zoneSat">satellite</a></p>
        <div id="zoneMap" class="passMap" style="height:380px"></div>
        <p class="dim small">Drag the pin onto the building with the showers. The circle is where the app counts a driver as being at this stop: make it cover the truck lot, but not the next stop.</p>
        <div class="zoneRow">
          <label>Zone <select id="zoneR">${opts.map(([m, t]) => `<option value="${m ?? ''}" ${m === z.radius_m ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button class="primary" id="zoneSave">Save</button>
        </div>
        <p class="msg" id="zoneMsg"></p>
      </div>`;
      const close = () => { $('drawerHost').innerHTML = ''; };
      $('drawerBack').onclick = close; $('drawerClose').onclick = close;
      const zm = L.map('zoneMap', { scrollWheelZoom: false }).setView([z.lat, z.lng], 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(zm);
      const radius = () => Number($('zoneR').value) || z.default_m;
      const pin = L.marker([z.lat, z.lng], { draggable: true }).addTo(zm);
      const ring = L.circle([z.lat, z.lng], { radius: radius(), color: '#4fbf6a', weight: 1, fillOpacity: 0.1 }).addTo(zm);
      const fit = () => zm.fitBounds(ring.getBounds(), { padding: [20, 20] });
      setTimeout(() => { zm.invalidateSize(); fit(); }, 50);
      pin.on('drag', () => ring.setLatLng(pin.getLatLng()));
      $('zoneR').onchange = () => { ring.setRadius(radius()); fit(); };
      $('zoneSave').onclick = async () => {
        const { lat, lng } = pin.getLatLng(), r = $('zoneR').value ? Number($('zoneR').value) : null;
        const { error } = await sb.rpc('admin_stop_set_zone', { p_id: z.id, p_lat: lat, p_lng: lng, p_radius_m: r });
        $('zoneMsg').textContent = error ? error.message : `Saved: ${lat.toFixed(5)}, ${lng.toFixed(5)}, zone ${r ? r + ' m' : 'default (300 m)'}.`;
        if (!error) $('zoneSat').href = `https://www.google.com/maps?q=${lat},${lng}&t=k`;
      };
    }

    async function loadOtherChains() {
      const { data, error } = await sb.rpc('admin_other_chains');
      if (error) return;
      $('otherChains').innerHTML = data.length ? table(['Chain', 'Reports', 'Drivers', 'Last', 'Where'],
        data.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.reports}</td><td>${x.drivers}</td><td class="dim">${time(x.last_at)}</td>
          <td>${x.places.slice(0, 5).map((p, i) => `<a href="https://www.google.com/maps?q=${p.lat},${p.lng}&t=k" target="_blank" rel="noopener">${i + 1}</a>`).join(' ')}${x.places.length > 5 ? ' …' : ''}</td></tr>`))
        : '<p class="dim">None yet.</p>';
    }
    $('issueList').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-issue]');
      if (!b) return;
      const approve = b.dataset.approve === '1';
      if (approve && !confirm('Apply what the driver reported? (A new chain, the stop off the map, or marked as having no showers.)')) return;
      const { data, error } = await sb.rpc('admin_stop_issue_decide', { p_id: Number(b.dataset.issue), p_approve: approve });
      await loadIssues();
      $('issueMsg').textContent = error ? error.message : data === 'approved' ? 'Done: the stop is fixed.' : data === 'rejected' ? 'Rejected: the stop stays as it was.' : `Result: ${data}`;
    });
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
      loadReportShowers();
    }
    // "Has showers" for the stop this report made (looked up by its stop ID).
    async function loadReportShowers() {
      show('reportShowersBox', false);
      if (!current?.stop_id) return;
      const { data } = await sb.rpc('admin_stop_search', { p_q: String(current.stop_id) });
      const stop = (data ?? []).find((x) => x.id === current.stop_id);
      if (!stop) return;
      $('reportShowers').checked = stop.has_showers;
      $('reportShowersText').innerHTML = stop.has_showers ? 'Has showers' : '<b>No showers</b>';
      show('reportShowersBox', true);
    }
    $('reportShowers').onchange = async () => {
      const has = $('reportShowers').checked;
      if (!has && !confirm('Mark this stop as having no showers? Drivers there are signed off sharing, and requests are refused.')) { $('reportShowers').checked = true; return; }
      const { error } = await sb.rpc('admin_stop_set_showers', { p_id: current.stop_id, p_has: has });
      $('stopMsg').textContent = error ? error.message : has ? 'Showers on: the stop works as usual.' : 'Marked: no showers at this stop.';
      loadReportShowers();
    };
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
      owner_admin: "This is the owner's email; it can't be removed.",
      last_admin: "You can't remove the last admin.",
      not_in_list: 'This email is not in the list anymore.',
    };
    const adminErr = (e) => adminErrors[e.message] ?? e.message;
    function renderAdmins(a) {
      $('adminList').innerHTML = table(['Email', 'Account', 'Last sign-in', ''],
        a.admins.map((x) => `<tr><td>${esc(x.email)}${x.email === a.me ? '<span class="you">you</span>' : ''}</td>
          <td class="dim">${x.has_account ? 'yes' : 'not yet'}</td>
          <td class="dim">${x.last_sign_in_at ? ago(x.last_sign_in_at) : '-'}</td>
          <td>${x.email === a.me || x.email === a.owner ? '' : `<button class="small" data-remove="${esc(x.email)}">Remove</button>`}</td></tr>`));
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
