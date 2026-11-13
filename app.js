// Zinzo admin panel (R24). Plain JS + supabase-js (CDN). Every write is a normal Supabase call checked by RLS policies that
// require public.is_admin(); the panel never holds a service key. Validation uses the app's own code (shared.js), so a
// banner or dApp previewed here is exactly what phones accept.
(function () {
  'use strict';
  const Z = window.ZinzoShared;
  const C = window.ZINZO;
  const sb = window.supabase.createClient(C.url, C.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const ago = (d) => { if (!d) return '—'; const s = (Date.now() - new Date(d)) / 1000; if (s < 90) return 'just now'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 129600) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
  let toastT;
  const toast = (msg, err) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); document.body.appendChild(t); } t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 4200); };
  const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message || String(e), true); } };
  const dlg = $('#dlg');
  const openDlg = (html) => { dlg.innerHTML = html; dlg.showModal(); return dlg; };

  // ---------- auth ----------
  const showLogin = (mode) => {
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    const setPw = mode === 'setpw';
    $('#pwForm').classList.toggle('hidden', setPw); $('#linkBtn').classList.toggle('hidden', setPw); $('#setPwForm').classList.toggle('hidden', !setPw);
    $('#loginTitle').textContent = setPw ? 'Set your password' : 'Sign in';
    $('#loginSub').textContent = setPw ? 'You signed in with an email link. Set a password for next time.' : 'Admins only. Use the email listed as a Zinzo admin.';
  };
  $('#pwForm').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    $('#loginMsg').textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    $('#loginMsg').textContent = error ? (/invalid/i.test(error.message) ? 'Wrong email or password. No password yet? Use the email link below.' : error.message) : '';
    if (!error) boot();
  }));
  $('#linkBtn').addEventListener('click', guard(async () => {
    const email = $('#email').value.trim();
    if (!email) { $('#loginMsg').textContent = 'Type your email above first.'; return; }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + '?setpw=1', shouldCreateUser: true } });
    $('#loginMsg').textContent = error ? error.message : 'Check your email and open the link in this browser. (Supabase\'s free email sender allows about 2 emails per hour.)';
  }));
  $('#setPwForm').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const a = $('#newPw').value, b = $('#newPw2').value;
    if (a.length < 10) return toast('Use at least 10 characters', true);
    if (a !== b) return toast("Passwords don't match", true);
    must(await sb.auth.updateUser({ password: a }));
    toast('Password saved');
    history.replaceState(null, '', location.pathname);
    boot();
  }));
  $('#skipPw').addEventListener('click', () => { history.replaceState(null, '', location.pathname); boot(); });
  $('#logout').addEventListener('click', async () => { await sb.auth.signOut(); showLogin(); });
  $('#chPw').addEventListener('click', () => showLogin('setpw'));

  let me = null;
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    if (new URLSearchParams(location.search).get('setpw') === '1') return showLogin('setpw');
    const { data: isAdmin, error } = await sb.rpc('is_admin');
    if (error || !isAdmin) {
      showLogin(); $('#loginMsg').textContent = `${session.user.email} is not a Zinzo admin.`;
      await sb.auth.signOut(); return;
    }
    me = session.user;
    $('#me').textContent = me.email;
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    go(location.hash.slice(1) || 'waitlist');
  }

  // ---------- router ----------
  const TABS = {};
  function go(tab) {
    if (!TABS[tab]) tab = 'waitlist';
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', location.pathname + location.search + '#' + tab);
    $('#main').innerHTML = '<div class="card muted">Loading…</div>';
    guard(TABS[tab])();
  }
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); });

  // ---------- waitlist ----------
  const notifyAdmitted = async (ids) => {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(C.adminFn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.access_token, apikey: C.anonKey }, body: JSON.stringify({ action: 'notify_admitted', ids }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'notify failed');
    return j;
  };
  const statsHtml = (s) => `<div class="stats">
    <div class="stat hero"><div class="v">${s.waiting}</div><div class="l">Waiting</div></div>
    <div class="stat"><div class="v">${s.admitted}</div><div class="l">Admitted</div></div>
    <div class="stat"><div class="v">${s.total}</div><div class="l">Accounts</div></div>
    <div class="stat"><div class="v">${s.joined_7d}</div><div class="l">Joined, 7 days</div></div>
    <div class="stat"><div class="v">${s.active_7d}</div><div class="l">Active, 7 days</div></div>
    <div class="stat"><div class="v">${s.with_backup}</div><div class="l">With backup</div></div>
    <div class="stat"><div class="v">${s.with_push}</div><div class="l">Push enabled</div></div></div>`;
  const wl = { status: 'waiting', q: '' };
  TABS.waitlist = async function render() {
    const stats = must(await sb.rpc('admin_stats'));
    let q = sb.from('profiles').select('id,email,status,waitlist_seq,created_at,admitted_at,notified_at,last_seen,push_token,existing_wallet', { count: 'exact' }).order('waitlist_seq').limit(200);
    if (wl.status !== 'all') q = q.eq('status', wl.status);
    if (wl.q) q = q.ilike('email', `%${wl.q.replace(/[%_]/g, '')}%`);
    const { data: rows, count, error } = await q;
    if (error) throw error;
    const posOf = new Map(); if (wl.status === 'waiting' && !wl.q) rows.forEach((r, i) => posOf.set(r.id, i + 1));
    $('#main').innerHTML = statsHtml(stats) + `<div class="card">
      <div class="head"><h2>Waitlist</h2>
        <div class="row"><input class="search" id="wq" placeholder="Search email" value="${esc(wl.q)}">
          <select id="wst" style="width:auto">${['waiting', 'admitted', 'blocked', 'all'].map((s) => `<option ${s === wl.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="row" style="margin-bottom:12px">
        <button class="btn" id="admitSel" disabled>Admit selected</button>
        <span class="muted">or admit the next</span><input id="nextN" type="number" min="1" max="1000" value="10" style="width:90px"><button class="btn sec" id="admitNext">Admit next</button>
        <button class="btn sec" id="renotify" title="Send the 'you are in' push/email to admitted users who were not told yet">Notify pending</button>
      </div>
      <div class="tablewrap"><table><thead><tr><th><input type="checkbox" id="all"></th><th>#</th><th>Email</th><th>Status</th><th>Joined</th><th>Last seen</th><th>Push</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-id="${r.id}"><td>${r.status === 'waiting' ? `<input type="checkbox" class="sel" value="${r.id}">` : ''}</td>
        <td class="num">${posOf.get(r.id) ?? '<span class="muted">' + r.waitlist_seq + '</span>'}</td>
        <td>${esc(r.email)}${r.existing_wallet ? ' <span class="pill off" title="Signed in from an install that already had a wallet">had wallet</span>' : ''}</td>
        <td><span class="pill ${r.status}">${r.status}</span>${r.status === 'admitted' && !r.notified_at ? ' <span class="small muted">not notified</span>' : ''}</td>
        <td class="small">${fmtDate(r.created_at)}</td><td class="small">${ago(r.last_seen)}</td><td>${r.push_token ? 'yes' : '<span class="muted">no</span>'}</td>
        <td style="text-align:right;white-space:nowrap">${r.status === 'waiting' ? '<button class="btn sm one">Admit</button> ' : ''}${r.status !== 'blocked' ? '<button class="btn sm danger blk">Block</button>' : '<button class="btn sm sec unblk">Unblock</button>'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nobody here.</td></tr>'}
      </tbody></table></div><p class="small muted" style="margin:10px 0 0">${count ?? rows.length} total${rows.length < (count ?? 0) ? `, showing first ${rows.length}` : ''}.</p></div>`;
    const sel = () => $$('.sel:checked').map((c) => c.value);
    const upd = () => { $('#admitSel').disabled = !sel().length; $('#admitSel').textContent = sel().length ? `Admit ${sel().length} selected` : 'Admit selected'; };
    $$('.sel').forEach((c) => c.addEventListener('change', upd));
    $('#all').addEventListener('change', (e) => { $$('.sel').forEach((c) => (c.checked = e.target.checked)); upd(); });
    let t; $('#wq').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { wl.q = e.target.value.trim(); render().catch((x) => toast(x.message, true)); }, 300); });
    $('#wst').addEventListener('change', (e) => { wl.status = e.target.value; render(); });
    const after = async (n, ids) => {
      let note = '';
      try { const r = await notifyAdmitted(ids); note = ` · notified ${r.users} (push ${r.push_ok}${r.email_configured ? `, email ${r.emailed}` : ', email not set up'})`; } catch (e) { note = ' · notify failed: ' + e.message; }
      toast(`Admitted ${n}${note}`); render();
    };
    $('#admitSel').addEventListener('click', guard(async () => { const ids = sel(); if (!confirm(`Admit ${ids.length} people?`)) return; const n = must(await sb.rpc('admin_admit', { p_ids: ids })); await after(n, ids); }));
    $('#admitNext').addEventListener('click', guard(async () => { const n0 = Math.max(1, Math.min(1000, Number($('#nextN').value) || 0)); if (!confirm(`Admit the next ${n0} people in line?`)) return; const n = must(await sb.rpc('admin_admit_next', { p_n: n0 })); await after(n, []); }));
    $('#renotify').addEventListener('click', guard(async () => { const r = await notifyAdmitted([]); toast(`Notified ${r.users} (push ok ${r.push_ok}, errors ${r.push_errors}${r.email_configured ? `, email ${r.emailed}` : ', email not set up'})`); render(); }));
    $$('tr[data-id]').forEach((tr) => {
      const id = tr.dataset.id;
      $('.one', tr)?.addEventListener('click', guard(async () => { const n = must(await sb.rpc('admin_admit', { p_ids: [id] })); await after(n, [id]); }));
      $('.blk', tr)?.addEventListener('click', guard(async () => { if (!confirm('Block this account? They will see "Access paused".')) return; must(await sb.rpc('admin_set_status', { p_id: id, p_status: 'blocked' })); toast('Blocked'); render(); }));
      $('.unblk', tr)?.addEventListener('click', guard(async () => { must(await sb.rpc('admin_set_status', { p_id: id, p_status: 'waiting' })); toast('Back on the waitlist'); render(); }));
    });
  };

  // ---------- users ----------
  const us = { q: '', page: 0 };
  TABS.users = async function render() {
    const stats = must(await sb.rpc('admin_stats'));
    let q = sb.from('profiles').select('email,status,created_at,last_seen,app_version,platform,push_token,existing_wallet', { count: 'exact' }).order('created_at', { ascending: false }).range(us.page * 50, us.page * 50 + 49);
    if (us.q) q = q.ilike('email', `%${us.q.replace(/[%_]/g, '')}%`);
    const { data: rows, count, error } = await q; if (error) throw error;
    $('#main').innerHTML = statsHtml(stats) + `<div class="card"><div class="head"><h2>Users</h2><input class="search" id="uq" placeholder="Search email" value="${esc(us.q)}"></div>
      <div class="tablewrap"><table><thead><tr><th>Email</th><th>Status</th><th>Joined</th><th>Last seen</th><th>App</th><th>Push</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.email)}${r.existing_wallet ? ' <span class="pill off">had wallet</span>' : ''}</td><td><span class="pill ${r.status}">${r.status}</span></td><td class="small">${fmtDate(r.created_at)}</td><td class="small" title="${esc(fmtDate(r.last_seen))}">${ago(r.last_seen)}</td><td class="small">${esc(r.app_version || '—')} ${esc(r.platform || '')}</td><td>${r.push_token ? 'yes' : '<span class="muted">no</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No users yet.</td></tr>'}
      </tbody></table></div>
      <div class="row" style="margin-top:12px;justify-content:space-between"><span class="small muted">${count ?? 0} users · page ${us.page + 1}</span><span class="row"><button class="btn sec sm" id="prev" ${us.page ? '' : 'disabled'}>Previous</button><button class="btn sec sm" id="next" ${(us.page + 1) * 50 < (count ?? 0) ? '' : 'disabled'}>Next</button></span></div></div>`;
    let t; $('#uq').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { us.q = e.target.value.trim(); us.page = 0; render(); }, 300); });
    $('#prev').addEventListener('click', () => { us.page--; render(); }); $('#next').addEventListener('click', () => { us.page++; render(); });
  };

  // ---------- banners ----------
  const SCREENS = Object.keys(Z.BANNER_SCREENS);
  const actionEditor = (pfx, a) => {
    a = a || { kind: 'none' };
    return `<div class="grid2">
      <label class="f">Tap action<select id="${pfx}kind">${['none', 'screen', 'event', 'promo', 'dapp', 'url'].map((k) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${({ none: 'Nothing (not tappable)', screen: 'Open an app screen', event: 'Event page', promo: 'Promo page', dapp: 'Open site in dApp browser', url: 'Open link in system browser' })[k]}</option>`).join('')}</select></label>
      <label class="f ${pfx}k-screen">Screen<select id="${pfx}screen">${SCREENS.map((s) => `<option ${a.screen === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f ${pfx}k-url">https URL<input id="${pfx}url" placeholder="https://" value="${esc(a.url)}"></label>
      <label class="f ${pfx}k-page">Page id <span class="h">Empty = this banner's own page. Or the id of another banner that has a page.</span><input id="${pfx}pid" value="${esc(a.id && a.id !== '__self' ? a.id : '')}"></label>
      <label class="f ${pfx}k-coin">Coin network<select id="${pfx}chain">${Z.CHAIN_IDS.map((c) => `<option value="${c.id}" ${a.params?.chain === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="f ${pfx}k-coin">Coin symbol or contract<input id="${pfx}coin" placeholder="USDT or 0x…" value="${esc(a.params?.symbol || a.params?.address || '')}"></label></div>`;
  };
  const wireAction = (root, pfx) => {
    const sync = () => {
      const k = $(`#${pfx}kind`, root).value, s = $(`#${pfx}screen`, root).value;
      $$(`.${pfx}k-screen`, root).forEach((e) => e.classList.toggle('hidden', k !== 'screen'));
      $$(`.${pfx}k-url`, root).forEach((e) => e.classList.toggle('hidden', k !== 'dapp' && k !== 'url'));
      $$(`.${pfx}k-page`, root).forEach((e) => e.classList.toggle('hidden', k !== 'event' && k !== 'promo'));
      $$(`.${pfx}k-coin`, root).forEach((e) => e.classList.toggle('hidden', !(k === 'screen' && s === 'coin')));
    };
    $(`#${pfx}kind`, root).addEventListener('change', sync); $(`#${pfx}screen`, root).addEventListener('change', sync); sync();
  };
  const readAction = (root, pfx) => {
    const k = $(`#${pfx}kind`, root).value;
    if (k === 'screen') {
      const screen = $(`#${pfx}screen`, root).value;
      if (screen !== 'coin') return { kind: 'screen', screen };
      const v = $(`#${pfx}coin`, root).value.trim();
      return { kind: 'screen', screen: 'coin', params: { chain: $(`#${pfx}chain`, root).value, ...(/^[A-Za-z0-9]{20,64}$/.test(v) ? { address: v } : { symbol: v }) } };
    }
    if (k === 'event' || k === 'promo') { const id = $(`#${pfx}pid`, root).value.trim(); return id ? { kind: k, id } : { kind: k }; }
    if (k === 'dapp' || k === 'url') return { kind: k, url: $(`#${pfx}url`, root).value.trim() };
    return { kind: 'none' };
  };
  const describe = (a) => a.kind === 'none' ? 'not tappable' : a.kind === 'screen' ? `opens ${a.screen}${a.params ? ` (${a.params.chain} ${a.params.symbol || a.params.address})` : ''}` : a.kind === 'event' || a.kind === 'promo' ? `${a.kind} page "${a.id}"` : `${a.kind} → ${a.url}`;

  TABS.banners = async function render() {
    const rows = must(await sb.from('banners').select('*').order('sort'));
    const list = rows.map((r) => ({ ...r.data, id: r.id }));
    const clean = Z.normalizeBanners(list);
    $('#main').innerHTML = `<div class="card"><div class="head"><h2>Home banners</h2><button class="btn" id="newB">New banner</button></div>
      <p class="muted" style="margin-top:-6px">Shown on the app's Home in this order. Phones fall back to the bundled banners when this list is empty or unreachable.</p>
      <div class="tablewrap"><table><thead><tr><th>Art</th><th>Banner</th><th>Tap</th><th>Order</th><th>Live</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const c = clean.find((x) => x.id === r.id); const d = r.data || {}; return `<tr data-id="${esc(r.id)}">
        <td>${d.image ? `<img class="thumb" src="${esc(d.image)}" alt="">` : `<div class="thumb">${d.local ? 'bundled: ' + esc(d.local) : 'no art'}</div>`}</td>
        <td><b>${esc(d.title || r.id)}</b><div class="small muted">${esc(r.id)}${d.page ? ' · has page' : ''}</div></td>
        <td class="small">${c ? esc(describe(c.action)) : '<span class="pill blocked">dropped by app</span>'}</td>
        <td class="num">${r.sort}</td>
        <td><label class="sw"><input type="checkbox" class="act" ${r.active ? 'checked' : ''}><i></i></label></td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm sec ed">Edit</button> <button class="btn sm danger del">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No banners: phones show the bundled ones.</td></tr>'}
      </tbody></table></div></div>`;
    $('#newB').addEventListener('click', () => bannerForm(null, rows));
    $$('tr[data-id]').forEach((tr) => {
      const r = rows.find((x) => x.id === tr.dataset.id);
      $('.ed', tr).addEventListener('click', () => bannerForm(r, rows));
      $('.del', tr).addEventListener('click', guard(async () => { if (!confirm(`Delete banner "${r.id}"?`)) return; must(await sb.from('banners').delete().eq('id', r.id)); toast('Deleted'); render(); }));
      $('.act', tr).addEventListener('change', guard(async (e) => { must(await sb.from('banners').update({ active: e.target.checked, updated_at: new Date().toISOString() }).eq('id', r.id)); toast(e.target.checked ? 'Live' : 'Hidden'); }));
    });
  };
  function bannerForm(r, rows) {
    const d = r?.data || {}; const p = d.page || {};
    const body = Array.isArray(p.body) ? p.body.join('\n\n') : p.body || '';
    const root = openDlg(`<form method="dialog" class="stack" id="bf">
      <div class="head" style="margin:0"><h2>${r ? 'Edit banner' : 'New banner'}</h2><button class="btn sec sm" value="cancel">Close</button></div>
      <div class="grid2"><label class="f">Id <span class="h">Letters, numbers, - and _. Can't change later.</span><input id="bid" value="${esc(r?.id || '')}" ${r ? 'disabled' : ''} required pattern="[A-Za-z0-9_-]{1,64}"></label>
        <label class="f">Order <span class="h">Lower shows first.</span><input id="bsort" type="number" value="${r?.sort ?? (rows.length ? Math.max(...rows.map((x) => x.sort)) + 10 : 0)}"></label></div>
      <label class="f">Title <span class="h">Accessibility label. The words people see are part of the artwork.</span><input id="btitle" value="${esc(d.title || '')}" maxlength="120"></label>
      <div class="grid2"><label class="f">Image URL (https, 1200×500) <span class="h">Wins over bundled art.</span><input id="bimg" placeholder="https://…/banner.png" value="${esc(d.image || '')}"></label>
        <label class="f">Or bundled art<select id="blocal"><option value="">None</option>${C.bundledArt.map((a) => `<option ${d.local === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div>
      <div class="grid2"><label class="f">Background colour <span class="h">Shown while the image loads, e.g. #F6F1EA</span><input id="bbg" value="${esc(d.bg || '')}" placeholder="#F6F1EA"></label>
        <label class="f">Aspect ratio <span class="h">Width / height. Default 2.4</span><input id="basp" type="number" step="0.1" value="${esc(d.aspect || '')}"></label></div>
      <div class="sec-title">Tap</div>${actionEditor('a', d.action)}
      <div class="sec-title">Event / promo page <span class="small muted" style="text-transform:none">(needed when the tap opens this banner's page)</span></div>
      <div class="grid2"><label class="f">Page title<input id="ptitle" value="${esc(p.title || '')}" maxlength="80"></label><label class="f">Subtitle<input id="psub" value="${esc(p.subtitle || '')}" maxlength="140"></label></div>
      <label class="f">Date <span class="h">2026-12-01, 2026-12-01T18:00 or free text</span><input id="pdate" value="${esc(p.date || '')}" maxlength="60"></label>
      <label class="f">Body <span class="h">Plain text. Blank line = new paragraph.</span><textarea id="pbody">${esc(body)}</textarea></label>
      <div class="grid2"><label class="f">Button label<input id="ctal" value="${esc(p.cta?.label || '')}" maxlength="28"></label></div>
      ${actionEditor('c', p.cta?.action)}
      <div class="sec-title">What phones will get</div><pre class="json" id="prev"></pre>
      <div class="row" style="justify-content:flex-end"><button class="btn sec" value="cancel">Cancel</button><button class="btn" id="bsave" value="default">Save banner</button></div></form>`);
    wireAction(root, 'a'); wireAction(root, 'c');
    const build = () => {
      const page = { title: $('#ptitle', root).value.trim(), subtitle: $('#psub', root).value.trim() || undefined, date: $('#pdate', root).value.trim() || undefined, body: $('#pbody', root).value.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean) };
      const ctaLabel = $('#ctal', root).value.trim();
      if (ctaLabel) page.cta = { label: ctaLabel, action: readAction(root, 'c') };
      const data = { title: $('#btitle', root).value.trim(), ...($('#bimg', root).value.trim() ? { image: $('#bimg', root).value.trim() } : {}), ...($('#blocal', root).value ? { local: $('#blocal', root).value } : {}),
        ...($('#bbg', root).value.trim() ? { bg: $('#bbg', root).value.trim() } : {}), ...(Number($('#basp', root).value) ? { aspect: Number($('#basp', root).value) } : {}), action: readAction(root, 'a'), ...(page.title || page.body.length ? { page } : {}) };
      return JSON.parse(JSON.stringify(data));
    };
    const preview = () => {
      const id = (r?.id || $('#bid', root).value.trim()) || 'new';
      const others = rows.filter((x) => x.id !== id).map((x) => ({ ...x.data, id: x.id }));
      const out = Z.normalizeBanners([...others, { ...build(), id }]).find((x) => x.id === id);
      $('#prev', root).textContent = out ? JSON.stringify({ action: out.action, page: out.page ?? null }, null, 2) + (out.action.kind === 'none' && build().action.kind !== 'none' ? '\n\n⚠ The tap target was rejected (bad URL, missing page, unknown coin…). The banner will show but won\'t be tappable.' : '') : '⚠ Phones will DROP this banner: it needs an https image URL or bundled art.';
    };
    root.addEventListener('input', preview); root.addEventListener('change', preview); preview();
    $('#bsave', root).addEventListener('click', guard(async (e) => {
      e.preventDefault();
      const id = r?.id || $('#bid', root).value.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return toast('Id: letters, numbers, - and _ only', true);
      if (!r && rows.some((x) => x.id === id)) return toast('That id is taken', true);
      const data = build();
      if (!Z.normalizeBanners([{ ...data, id }]).length) return toast('Add an https image URL or pick bundled art', true);
      must(await sb.from('banners').upsert({ id, sort: Number($('#bsort', root).value) || 0, active: r ? r.active : true, data, updated_at: new Date().toISOString() }));
      dlg.close(); toast('Banner saved'); TABS.banners();
    }));
  }

  // ---------- dApps ----------
  TABS.dapps = async function render() {
    const rows = must(await sb.from('dapps').select('*').order('sort'));
    const cats = Object.fromEntries(Z.DAPP_CATEGORIES.map((c) => [c.id, c.title]));
    $('#main').innerHTML = `<div class="card"><div class="head"><h2>Discover dApps</h2><button class="btn" id="newD">Add dApp</button></div>
      <p class="muted" style="margin-top:-6px">The curated list on the Discover tab. Empty list = phones use the bundled one.</p>
      <div class="tablewrap"><table><thead><tr><th></th><th>dApp</th><th>Category</th><th>Networks</th><th>Order</th><th>Live</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-id="${esc(r.id)}"><td><img class="fav" src="${esc(r.icon || 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(new URL(r.url).hostname) + '&sz=64')}" alt=""></td>
        <td><b>${esc(r.name)}</b><div class="small muted">${esc(r.url)}</div><div class="small">${esc(r.description)}</div></td><td>${esc(cats[r.category] || r.category)}</td>
        <td class="small">${esc((r.chains || []).join(', ') || '—')}</td><td class="num">${r.sort}</td><td><label class="sw"><input type="checkbox" class="act" ${r.active ? 'checked' : ''}><i></i></label></td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm sec ed">Edit</button> <button class="btn sm danger del">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">None.</td></tr>'}
      </tbody></table></div></div>`;
    $('#newD').addEventListener('click', () => dappForm(null, rows));
    $$('tr[data-id]').forEach((tr) => {
      const r = rows.find((x) => x.id === tr.dataset.id);
      $('.ed', tr).addEventListener('click', () => dappForm(r, rows));
      $('.del', tr).addEventListener('click', guard(async () => { if (!confirm(`Delete ${r.name}?`)) return; must(await sb.from('dapps').delete().eq('id', r.id)); toast('Deleted'); render(); }));
      $('.act', tr).addEventListener('change', guard(async (e) => { must(await sb.from('dapps').update({ active: e.target.checked }).eq('id', r.id)); toast(e.target.checked ? 'Live' : 'Hidden'); }));
    });
  };
  function dappForm(r, rows) {
    const root = openDlg(`<form method="dialog" class="stack"><div class="head" style="margin:0"><h2>${r ? 'Edit dApp' : 'Add dApp'}</h2><button class="btn sec sm" value="cancel">Close</button></div>
      <div class="grid2"><label class="f">Id<input id="did" value="${esc(r?.id || '')}" ${r ? 'disabled' : ''} pattern="[A-Za-z0-9_-]{1,64}"></label><label class="f">Name<input id="dname" value="${esc(r?.name || '')}" maxlength="40"></label></div>
      <label class="f">URL (https)<input id="durl" value="${esc(r?.url || '')}" placeholder="https://app.example.org"></label>
      <label class="f">Description<input id="ddesc" value="${esc(r?.description || '')}" maxlength="120"></label>
      <div class="grid3"><label class="f">Category<select id="dcat">${Z.DAPP_CATEGORIES.map((c) => `<option value="${c.id}" ${r?.category === c.id ? 'selected' : ''}>${c.title}</option>`).join('')}</select></label>
        <label class="f">Order<input id="dsort" type="number" value="${r?.sort ?? (rows.length ? Math.max(...rows.map((x) => x.sort)) + 10 : 0)}"></label>
        <label class="f">Icon URL <span class="h">Optional, https</span><input id="dicon" value="${esc(r?.icon || '')}"></label></div>
      <label class="f">Networks <span class="h">Comma separated tags, e.g. ethereum, base, bsc</span><input id="dchains" value="${esc((r?.chains || []).join(', '))}"></label>
      <div class="row" style="justify-content:flex-end"><button class="btn sec" value="cancel">Cancel</button><button class="btn" id="dsave">Save</button></div></form>`);
    $('#dsave', root).addEventListener('click', guard(async (e) => {
      e.preventDefault();
      const row = { id: r?.id || $('#did', root).value.trim(), name: $('#dname', root).value.trim(), url: $('#durl', root).value.trim(), description: $('#ddesc', root).value.trim(), category: $('#dcat', root).value,
        sort: Number($('#dsort', root).value) || 0, icon: $('#dicon', root).value.trim() || null, chains: $('#dchains', root).value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) };
      const ok = Z.normalizeDapps([{ ...row, icon: row.icon || undefined }]);
      if (!ok.length) return toast('Needs an id, a name and an https URL', true);
      if (!r && rows.some((x) => x.id === row.id)) return toast('That id is taken', true);
      must(await sb.from('dapps').upsert({ ...row, chains: ok[0].chains, active: r ? r.active : true, updated_at: new Date().toISOString() }));
      dlg.close(); toast('Saved'); TABS.dapps();
    }));
  }

  // ---------- tokens ----------
  TABS.tokens = async function render() {
    const rows = must(await sb.from('token_flags').select('*').order('mode').order('sort'));
    $('#main').innerHTML = `<div class="card"><div class="head"><h2>Featured and hidden tokens</h2></div>
      <p class="muted" style="margin-top:-6px"><b>Featured</b> tokens rank first in the coin pickers (swap, add token). <b>Hidden</b> tokens are removed from automatically discovered holdings (scam airdrops); tokens a user added themselves stay.</p>
      <form id="tf" class="grid3" style="align-items:end;margin-bottom:16px">
        <label class="f">Network<select id="tchain">${Z.CHAIN_IDS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label class="f">Contract address or symbol<input id="tval" placeholder="0x… / T… / mint, or USDT"></label>
        <label class="f">Mode<select id="tmode"><option value="featured">Featured</option><option value="hidden">Hidden</option></select></label>
        <label class="f" style="grid-column:span 2">Note <span class="h">For admins only</span><input id="tnote" maxlength="120"></label>
        <button class="btn" type="submit">Add</button></form>
      <div class="tablewrap"><table><thead><tr><th>Mode</th><th>Network</th><th>Token</th><th>Note</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-id="${r.id}"><td><span class="pill ${r.mode === 'featured' ? 'admitted' : 'blocked'}">${r.mode}</span></td><td>${esc(r.chain)}</td><td class="small">${esc(r.symbol || '')} ${esc(r.address || '')}</td><td class="small muted">${esc(r.note || '')}</td><td style="text-align:right"><button class="btn sm danger del">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}
      </tbody></table></div></div>`;
    $('#tf').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const v = $('#tval').value.trim(); const isAddr = /^[A-Za-z0-9]{20,64}$/.test(v);
      const row = { chain: $('#tchain').value, mode: $('#tmode').value, note: $('#tnote').value.trim() || null, ...(isAddr ? { address: v } : { symbol: v.toUpperCase() }) };
      if (!Z.normalizeTokenFlags([row]).length) return toast('Enter a contract address or a symbol (letters/numbers)', true);
      must(await sb.from('token_flags').insert(row)); toast('Added'); render();
    }));
    $$('tr[data-id]').forEach((tr) => $('.del', tr).addEventListener('click', guard(async () => { must(await sb.from('token_flags').delete().eq('id', Number(tr.dataset.id))); toast('Removed'); render(); })));
  };

  // ---------- flags ----------
  TABS.flags = async function render() {
    const rows = must(await sb.from('feature_flags').select('*').order('key'));
    const known = new Set(Z.FEATURE_KEYS);
    const all = [...Z.FEATURE_KEYS.map((k) => rows.find((r) => r.key === k) || { key: k, enabled: Z.FEATURE_DEFAULTS[k], description: '', missing: true }), ...rows.filter((r) => !known.has(r.key))];
    $('#main').innerHTML = `<div class="card"><div class="head"><h2>Feature flags</h2></div>
      <p class="muted" style="margin-top:-6px">Phones pick these up within about 5 minutes (next app open). Keys the app doesn't know are ignored.</p>
      <div class="notice" style="margin-bottom:12px">Turning <b>trade</b> on also needs the legal review and the buy/sell legal sections restored in the app. <b>importWallet</b> brings back "Import an existing wallet" on the welcome screen. <b>googleSignIn</b> needs the Google provider set up in Supabase Auth first.</div>
      <table><tbody>${all.map((r) => `<tr data-key="${esc(r.key)}"><td style="width:60px"><label class="sw"><input type="checkbox" ${r.enabled ? 'checked' : ''} ${known.has(r.key) ? '' : 'disabled'}><i></i></label></td>
        <td><b>${esc(r.key)}</b>${known.has(r.key) ? '' : ' <span class="pill off">unknown to app</span>'}${r.missing ? ' <span class="small muted">(app default)</span>' : ''}<div class="small muted">${esc(r.description || '')}</div></td></tr>`).join('')}</tbody></table></div>`;
    $$('tr[data-key] input').forEach((i) => i.addEventListener('change', guard(async (e) => {
      const key = e.target.closest('tr').dataset.key;
      if (key === 'accounts' && !e.target.checked && !confirm('Turn off accounts? New installs will create wallets without signing in or waiting.')) { e.target.checked = true; return; }
      must(await sb.from('feature_flags').upsert({ key, enabled: e.target.checked, updated_at: new Date().toISOString() }));
      toast(`${key} ${e.target.checked ? 'on' : 'off'}`);
    })));
  };

  // ---------- force update ----------
  TABS.update = async function render() {
    const row = must(await sb.from('app_settings').select('*').eq('key', 'min_version').maybeSingle());
    const v = row?.value || { version: '0.0.0', message: '', url: '' };
    $('#main').innerHTML = `<div class="card stack" style="max-width:640px"><h2>Force update</h2>
      <p class="muted" style="margin:0">Installs older than the minimum version see a full-screen "Update Zinzo to continue" (they try an over-the-air update first, then open the link). Current app version: <b>${esc(C.currentAppVersion)}</b>. Use 0.0.0 to turn it off.</p>
      <label class="f">Minimum version<input id="mv" value="${esc(v.version)}" placeholder="0.3.0"></label>
      <label class="f">Message <span class="h">Optional. Shown on the update screen.</span><textarea id="mm" maxlength="300" style="min-height:80px">${esc(v.message || '')}</textarea></label>
      <label class="f">Download link <span class="h">Optional https link (Play Store or APK page). Default: Play Store listing.</span><input id="mu" value="${esc(v.url || '')}" placeholder="https://"></label>
      <div class="notice" id="mvWarn"></div>
      <div class="row"><button class="btn" id="mvSave">Save</button><span class="small muted">Last change: ${fmtDate(row?.updated_at)}</span></div></div>`;
    const warn = () => { const n = Z.normalizeMinVersion({ version: $('#mv').value }); const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
      $('#mvWarn').textContent = !n ? 'Use numbers like 0.3.0' : cmp(n.version, C.currentAppVersion) > 0 ? `⚠ Every install below ${n.version} is blocked, including the current ${C.currentAppVersion}. Only do this when the new version is published.` : 'No current install is blocked.'; };
    $('#mv').addEventListener('input', warn); warn();
    $('#mvSave').addEventListener('click', guard(async () => {
      const n = Z.normalizeMinVersion({ version: $('#mv').value.trim(), message: $('#mm').value, url: $('#mu').value.trim() });
      if (!n) return toast('Version must look like 0.3.0', true);
      if ($('#mu').value.trim() && !n.url) return toast('Link must be https', true);
      must(await sb.from('app_settings').upsert({ key: 'min_version', value: { version: n.version, message: n.message, url: n.url || '' }, updated_at: new Date().toISOString() }));
      toast('Saved'); render();
    }));
  };

  // ---------- push ----------
  TABS.push = async function render() {
    const stats = must(await sb.rpc('admin_stats'));
    const log = must(await sb.from('push_log').select('*').order('sent_at', { ascending: false }).limit(20));
    $('#main').innerHTML = `<div class="card stack" style="max-width:640px"><h2>Push broadcast</h2>
      <p class="muted" style="margin:0">Sent through Expo push to phones that allowed notifications (${stats.with_push} right now). Android push also needs Firebase set up for the app build.</p>
      <label class="f">Send to<select id="pa"><option value="all">Everyone with push (not blocked)</option><option value="admitted">Admitted users only</option></select></label>
      <label class="f">Title<input id="pt" maxlength="80" placeholder="New in Zinzo"></label>
      <label class="f">Message<textarea id="pb" maxlength="300" style="min-height:80px"></textarea></label>
      <div class="row"><button class="btn" id="ps">Send push</button></div></div>
      <div class="card"><h2 style="margin-bottom:10px">Sent</h2><div class="tablewrap"><table><thead><tr><th>When</th><th>To</th><th>Message</th><th>Delivered</th></tr></thead><tbody>
      ${log.map((l) => `<tr><td class="small">${fmtDate(l.sent_at)}</td><td>${esc(l.audience)}</td><td><b>${esc(l.title)}</b><div class="small">${esc(l.body)}</div></td><td class="small">${l.ok}/${l.recipients}${l.errors ? ` · ${l.errors} failed` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing sent yet.</td></tr>'}
      </tbody></table></div></div>`;
    $('#ps').addEventListener('click', guard(async () => {
      const title = $('#pt').value.trim(), body = $('#pb').value.trim();
      if (!title || !body) return toast('Add a title and a message', true);
      if (!confirm(`Send "${title}" to ${$('#pa').selectedOptions[0].text.toLowerCase()}?`)) return;
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(C.adminFn, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.access_token, apikey: C.anonKey }, body: JSON.stringify({ action: 'broadcast', audience: $('#pa').value, title, body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'send failed');
      toast(`Sent to ${j.recipients} · ok ${j.ok}${j.errors ? ` · failed ${j.errors}` : ''}`); render();
    }));
  };

  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') showLogin(); });
  boot().catch((e) => { showLogin(); $('#loginMsg').textContent = e.message; });
})();
