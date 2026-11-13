/* kuititon: connects the app to Supabase.
   The app was written against four helpers (db, assets, sample, downloads) that only exist inside Claude artifacts.
   This file provides the same helpers on top of Supabase, behind a sign-in screen. */
(function () {
  'use strict';
  var CFG = {
    url: 'https://lffzbaftsewbxcejmevz.supabase.co',
    key: 'sb_publishable_HM1lDmEl5PND1sf9REmdcg_p_JGGPiK',   // publishable key: meant to be public
    bucket: 'receipts'
  };
  var sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  var session = null, userId = null, profile = null;

  /* ---------- language (auth screens only; the app has its own) ---------- */
  function fi() {
    try { var g = JSON.parse(localStorage.getItem('innotate-books-general') || '{}'); if (g.ui) return g.ui === 'fi'; } catch (e) {}
    return true; /* Finnish is the default */
  }
  var T = {
    'Sign in': 'Kirjaudu sisään', 'Register': 'Rekisteröidy', 'Email': 'Sähköposti', 'Password': 'Salasana',
    'Full name': 'Koko nimi', 'Forgot password?': 'Unohtuiko salasana?', 'Create account': 'Luo tili',
    'Already have an account? Sign in': 'Onko sinulla jo tili? Kirjaudu sisään',
    'No account yet? Register for free': 'Ei vielä tiliä? Rekisteröidy ilmaiseksi',
    'Confirm your email': 'Vahvista sähköpostisi', 'Enter the code we sent to': 'Syötä koodi, jonka lähetimme osoitteeseen',
    'Code': 'Koodi', 'Confirm': 'Vahvista', 'Send a new code': 'Lähetä uusi koodi', 'Back': 'Takaisin',
    'Reset password': 'Nollaa salasana', 'Send code': 'Lähetä koodi', 'New password': 'Uusi salasana',
    'Repeat new password': 'Toista uusi salasana', 'Save password': 'Tallenna salasana', 'Cancel': 'Peruuta',
    'Change password': 'Vaihda salasana', 'Show password': 'Näytä salasana', 'Hide password': 'Piilota salasana',
    'Password rules': 'Salasanan vaatimukset',
    'At least 8 characters, a capital letter, a number and a special character.': 'Vähintään 8 merkkiä, iso kirjain, numero ja erikoismerkki.',
    'Passwords do not match.': 'Salasanat eivät täsmää.',
    'Enter a valid email.': 'Syötä kelvollinen sähköpostiosoite.',
    'Enter your full name.': 'Syötä koko nimesi.',
    'Wrong email or password.': 'Väärä sähköposti tai salasana.',
    'Check your email and confirm it first.': 'Vahvista ensin sähköpostisi.',
    'The code is wrong or has expired.': 'Koodi on väärä tai vanhentunut.',
    'Something went wrong. Try again.': 'Jokin meni pieleen. Yritä uudelleen.',
    'Too many attempts. Wait a moment and try again.': 'Liian monta yritystä. Odota hetki ja yritä uudelleen.',
    'A new code was sent.': 'Uusi koodi lähetettiin.',
    'Password changed.': 'Salasana vaihdettu.',
    'We sent a code to your email.': 'Lähetimme koodin sähköpostiisi.',
    'Signing in…': 'Kirjaudutaan…', 'Loading…': 'Ladataan…'
  };
  function t(s) { return fi() && T[s] ? T[s] : s; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var emailOk = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); };
  var pwOk = function (v) { v = String(v || ''); return v.length >= 8 && /[A-ZÅÄÖ]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9ÅÄÖåäö\s]/.test(v); };
  function mapErr(e) {
    var m = String((e && (e.message || e.error_description)) || '').toLowerCase(), c = e && (e.code || e.status);
    if (m.indexOf('invalid login') >= 0) return t('Wrong email or password.');
    if (m.indexOf('not confirmed') >= 0) return t('Check your email and confirm it first.');
    if (m.indexOf('expired') >= 0 || m.indexOf('invalid') >= 0 || m.indexOf('token') >= 0) return t('The code is wrong or has expired.');
    if (c === 429 || m.indexOf('rate limit') >= 0 || m.indexOf('too many') >= 0) return t('Too many attempts. Wait a moment and try again.');
    return t('Something went wrong. Try again.');
  }

  /* ---------- sign-in screens ---------- */
  var overlay = null, ui = { view: 'login', email: '', name: '', busy: false, msg: '', err: '' }, resolveReady;
  var authReady = new Promise(function (r) { resolveReady = r; });

  function css() {
    if (document.getElementById('kauth-css')) return;
    var s = document.createElement('style'); s.id = 'kauth-css';
    s.textContent = '#kauth{position:fixed;inset:0;z-index:9000;background:var(--bg,#e9efea);color:var(--ink,#0e2219);overflow:auto;display:flex;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 16px 32px}' +
      '#kauth .kbox{width:100%;max-width:400px;margin:auto 0}#kauth h1{font:700 30px/1.1 var(--display,Inter,system-ui,sans-serif);margin:0 0 6px;letter-spacing:-.02em}' +
      '#kauth .kwm{font:800 26px var(--display,Inter,system-ui,sans-serif);letter-spacing:-.03em;margin:0 0 26px}#kauth .kwm i{font-style:normal;color:var(--accent-text,#1f6b3a)}' +
      '#kauth p{margin:0 0 14px;color:var(--muted,#5d7568)}#kauth label{display:block;font:600 12px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5d7568);margin:0 0 5px}' +
      '#kauth .kf{margin:0 0 14px}#kauth input{width:100%;min-height:48px;font-size:16px;padding:10px 14px;border:1px solid var(--line,#dbe5dd);border-radius:12px;background:var(--surface,#fff);color:inherit}' +
      '#kauth button.kp{width:100%;min-height:50px;border:0;border-radius:14px;background:var(--accent,#a6e8b4);color:#0e2219;font:700 16px Inter,system-ui,sans-serif;cursor:pointer;margin-top:4px}#kauth button.kp:disabled{opacity:.55}' +
      '#kauth .kl{display:block;margin:16px 0 0;background:none;border:0;padding:6px 0;font:600 15px Inter,system-ui,sans-serif;color:inherit;text-decoration:underline;cursor:pointer;text-align:left}' +
      '#kauth .ke{color:var(--bad,#b3261e);font-weight:600;margin:0 0 12px}#kauth .km{color:var(--ok,#1d7448);font-weight:600;margin:0 0 12px}#kauth .kh{font-size:13px;margin:-6px 0 14px}' +
      '#kauth .kcode{letter-spacing:.3em;font-size:22px;text-align:center}' +
      '.kpw{position:relative}.kpw .keye{position:absolute;right:2px;top:0;bottom:0;width:48px;display:flex;align-items:center;justify-content:center;background:none!important;border:0!important;padding:0;min-height:0!important;flex:none!important;color:var(--muted,#5d7568);cursor:pointer;border-radius:12px}.kpw .keye:focus-visible{outline:2px solid var(--accent-text,#1f6b3a)}' +
      '#kmodal{position:fixed;inset:0;z-index:9100;display:grid;place-items:center;padding:20px;background:rgba(10,12,14,.55)}#kmodal .kbox{background:var(--surface,#fff);color:var(--ink,#0e2219);border-radius:24px;padding:22px 20px;width:100%;max-width:380px}' +
      '#kmodal h3{margin:0 0 12px;font:700 20px Inter,system-ui,sans-serif}' +
      '#kmodal .kf{margin:0 0 12px}#kmodal label{display:block;font:600 12px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#5d7568);margin:0 0 5px}' +
      '#kmodal input{width:100%;min-height:48px;font-size:16px;padding:10px 14px;border:1px solid var(--line,#dbe5dd);border-radius:12px;background:var(--bg,#e9efea);color:inherit}' +
      '#kmodal .krow{display:flex;gap:8px;margin-top:6px}#kmodal button{flex:1;min-height:48px;border-radius:14px;border:1px solid var(--line,#dbe5dd);background:var(--surface,#fff);color:inherit;font:600 15px Inter,system-ui,sans-serif;cursor:pointer}#kmodal button.kp{background:var(--accent,#a6e8b4);border-color:var(--accent,#a6e8b4);color:#0e2219}' +
      '#kmodal .ke{color:var(--bad,#b3261e);font-weight:600;margin:0 0 10px}';
    document.head.appendChild(s);
  }
  var EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  function field(id, label, type, val, extra) {
    var inp = '<input id="' + id + '" type="' + type + '" value="' + esc(val || '') + '" ' + (extra || '') + '>';
    if (type === 'password') inp = '<div class="kpw">' + inp.replace('<input ', '<input style="padding-right:52px" ') + '<button type="button" class="keye" data-eye="' + id + '" aria-label="' + esc(t('Show password')) + '" title="' + esc(t('Show password')) + '">' + EYE + '</button></div>';
    return '<div class="kf"><label for="' + id + '">' + esc(t(label)) + '</label>' + inp + '</div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-eye]'); if (!b) return;
    e.preventDefault();
    var i = document.getElementById(b.dataset.eye); if (!i) return;
    var show = i.type === 'password'; i.type = show ? 'text' : 'password';
    var lbl = t(show ? 'Hide password' : 'Show password');
    b.innerHTML = show ? EYE_OFF : EYE; b.setAttribute('aria-label', lbl); b.title = lbl; i.focus();
  });
  function status() {
    return (ui.err ? '<p class="ke" role="alert">' + esc(ui.err) + '</p>' : '') + (ui.msg ? '<p class="km">' + esc(ui.msg) + '</p>' : '');
  }
  function draw() {
    css();
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'kauth'; document.body.appendChild(overlay); overlay.addEventListener('submit', onSubmit); overlay.addEventListener('click', onClick); }
    var v = ui.view, h = '<div class="kbox"><div class="kwm">kuititon<i>.</i></div>';
    if (v === 'login') {
      h += '<h1>' + t('Sign in') + '</h1><p></p>' + status() + '<form data-f="login">' + field('ka_email', 'Email', 'email', ui.email, 'autocomplete="email" inputmode="email" autocapitalize="off"') +
        field('ka_pw', 'Password', 'password', '', 'autocomplete="current-password"') + '<button class="kp" ' + (ui.busy ? 'disabled' : '') + '>' + t('Sign in') + '</button></form>' +
        '<button class="kl" data-go="forgot">' + t('Forgot password?') + '</button><button class="kl" data-go="register">' + t('No account yet? Register for free') + '</button>';
    } else if (v === 'register') {
      h += '<h1>' + t('Register') + '</h1><p></p>' + status() + '<form data-f="register">' + field('ka_name', 'Full name', 'text', ui.name, 'autocomplete="name" autocapitalize="words"') +
        field('ka_email', 'Email', 'email', ui.email, 'autocomplete="email" inputmode="email" autocapitalize="off"') + field('ka_pw', 'Password', 'password', '', 'autocomplete="new-password"') +
        '<p class="kh">' + t('At least 8 characters, a capital letter, a number and a special character.') + '</p><button class="kp" ' + (ui.busy ? 'disabled' : '') + '>' + t('Create account') + '</button></form>' +
        '<button class="kl" data-go="login">' + t('Already have an account? Sign in') + '</button>';
    } else if (v === 'verify') {
      h += '<h1>' + t('Confirm your email') + '</h1><p>' + t('Enter the code we sent to') + ' <b>' + esc(ui.email) + '</b></p>' + status() + '<form data-f="verify">' +
        field('ka_code', 'Code', 'text', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="10" class="kcode"') + '<button class="kp" ' + (ui.busy ? 'disabled' : '') + '>' + t('Confirm') + '</button></form>' +
        '<button class="kl" data-act="resend">' + t('Send a new code') + '</button><button class="kl" data-go="login">' + t('Back') + '</button>';
    } else if (v === 'forgot') {
      h += '<h1>' + t('Reset password') + '</h1><p></p>' + status() + '<form data-f="forgot">' + field('ka_email', 'Email', 'email', ui.email, 'autocomplete="email" inputmode="email" autocapitalize="off"') +
        '<button class="kp" ' + (ui.busy ? 'disabled' : '') + '>' + t('Send code') + '</button></form><button class="kl" data-go="login">' + t('Back') + '</button>';
    } else if (v === 'recover') {
      h += '<h1>' + t('Reset password') + '</h1><p>' + t('Enter the code we sent to') + ' <b>' + esc(ui.email) + '</b></p>' + status() + '<form data-f="recover">' +
        field('ka_code', 'Code', 'text', '', 'inputmode="numeric" autocomplete="one-time-code" maxlength="10" class="kcode"') + field('ka_pw', 'New password', 'password', '', 'autocomplete="new-password"') +
        '<p class="kh">' + t('At least 8 characters, a capital letter, a number and a special character.') + '</p><button class="kp" ' + (ui.busy ? 'disabled' : '') + '>' + t('Save password') + '</button></form><button class="kl" data-go="login">' + t('Back') + '</button>';
    } else { h += '<p>' + t('Loading…') + '</p>'; }
    overlay.innerHTML = h + '</div>';
  }
  function go(view, keep) { ui.view = view; ui.err = ''; if (!keep) ui.msg = ''; draw(); var f = overlay && overlay.querySelector('input'); if (f && view !== 'login') try { f.focus(); } catch (e) {} }
  function $v(id) { var e = overlay.querySelector('#' + id); return e ? e.value : ''; }
  function busy(b) { ui.busy = b; var bt = overlay.querySelector('button.kp'); if (bt) bt.disabled = b; }
  function onClick(e) {
    var g = e.target.closest('[data-go]'); if (g) { ui.email = ($v('ka_email') || ui.email).trim(); go(g.dataset.go); return; }
    if (e.target.closest('[data-act=resend]')) {
      sb.auth.resend({ type: 'signup', email: ui.email }).then(function (r) { ui.err = r.error ? mapErr(r.error) : ''; ui.msg = r.error ? '' : t('A new code was sent.'); draw(); });
    }
  }
  async function onSubmit(e) {
    e.preventDefault(); if (ui.busy) return;
    var f = e.target.dataset.f; ui.err = ''; ui.msg = '';
    try {
      if (f === 'login') {
        ui.email = $v('ka_email').trim(); var pw = $v('ka_pw');
        if (!emailOk(ui.email)) { ui.err = t('Enter a valid email.'); return draw(); }
        busy(true); var r = await sb.auth.signInWithPassword({ email: ui.email, password: pw });
        if (r.error) { ui.err = mapErr(r.error); ui.busy = false; return draw(); }
        ui.busy = false;
      } else if (f === 'register') {
        ui.name = $v('ka_name').trim(); ui.email = $v('ka_email').trim(); var p1 = $v('ka_pw');
        if (!ui.name) { ui.err = t('Enter your full name.'); return draw(); }
        if (!emailOk(ui.email)) { ui.err = t('Enter a valid email.'); return draw(); }
        if (!pwOk(p1)) { ui.err = t('At least 8 characters, a capital letter, a number and a special character.'); return draw(); }
        busy(true); var r2 = await sb.auth.signUp({ email: ui.email, password: p1, options: { data: { full_name: ui.name } } });
        ui.busy = false; if (r2.error) { ui.err = mapErr(r2.error); return draw(); }
        if (!r2.data.session) { ui.msg = t('We sent a code to your email.'); return go('verify', true); }
      } else if (f === 'verify') {
        var code = $v('ka_code').replace(/\s/g, ''); busy(true);
        var r3 = await sb.auth.verifyOtp({ email: ui.email, token: code, type: 'signup' });
        ui.busy = false; if (r3.error) { ui.err = mapErr(r3.error); return draw(); }
      } else if (f === 'forgot') {
        ui.email = $v('ka_email').trim(); if (!emailOk(ui.email)) { ui.err = t('Enter a valid email.'); return draw(); }
        busy(true); var r4 = await sb.auth.resetPasswordForEmail(ui.email); ui.busy = false;
        if (r4.error) { ui.err = mapErr(r4.error); return draw(); }
        ui.msg = t('We sent a code to your email.'); return go('recover', true);
      } else if (f === 'recover') {
        var code2 = $v('ka_code').replace(/\s/g, ''), np = $v('ka_pw');
        if (!pwOk(np)) { ui.err = t('At least 8 characters, a capital letter, a number and a special character.'); return draw(); }
        busy(true); var r5 = await sb.auth.verifyOtp({ email: ui.email, token: code2, type: 'recovery' });
        if (r5.error) { ui.err = mapErr(r5.error); ui.busy = false; return draw(); }
        var r6 = await sb.auth.updateUser({ password: np }); ui.busy = false;
        if (r6.error) { ui.err = mapErr(r6.error); return draw(); }
      }
    } catch (err) { ui.busy = false; ui.err = mapErr(err); draw(); }
  }

  /* ---------- session handling ---------- */
  async function loadProfile() {
    if (!userId) return;
    var r = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    if (r.data) profile = r.data;
    return profile;
  }
  /* The app caches settings in this browser (account choice, "setup done", language). If a different person signs in on the
     same browser, that cache must not carry over, otherwise the new user skips the setup wizard or lands in the wrong account. */
  function otherUserCache(uid) {
    try {
      if (localStorage.getItem('kuititon-uid') === uid) return false;
      Object.keys(localStorage).filter(function (k) { return k.indexOf('innotate-books') === 0 || k === 'innotate-range' || k === 'innotate-period'; })
        .forEach(function (k) { localStorage.removeItem(k); });
      localStorage.setItem('kuititon-uid', uid);
      return true;
    } catch (e) { return false; }
  }
  function start(s) {
    if (otherUserCache(s.user.id)) { location.reload(); return; }
    session = s; userId = s.user.id;
    loadProfile().then(function () {
      if (overlay) { overlay.remove(); overlay = null; }
      resolveReady();
    });
  }
  sb.auth.onAuthStateChange(function (ev, s) {
    if (ev === 'SIGNED_OUT') { try { sessionStorage.clear(); } catch (e) {} location.reload(); return; }
    if (s && !session) start(s); else if (s) { session = s; }
  });
  sb.auth.getSession().then(function (r) {
    if (r.data && r.data.session) start(r.data.session);
    else { var go2 = function () { draw(); }; if (document.body) go2(); else document.addEventListener('DOMContentLoaded', go2); }
  });

  /* ---------- db: documents as rows (owner, path, data) ---------- */
  var store = new Map(), loadedExact = new Set(), loadedPrefix = new Set();
  var docL = new Map(), colL = new Map(), channel = null;
  var SERVER_FIELDS = ['trialStart', 'sub', 'trialScans'];

  function decorate(path, data) {
    if (path !== 'meta/general') return data;
    var d = Object.assign({}, data || {});
    var u = (session && session.user) || {};
    if (!d.fullName && u.user_metadata && u.user_metadata.full_name) d.fullName = u.user_metadata.full_name;
    if (!d.email && u.email) d.email = u.email;
    if (profile) {
      delete d.sub; delete d.trialStart;
      if (profile.plan === 'business') d.sub = 'account';
      else if (profile.plan === 'projects') d.sub = 'project';
      else d.trialStart = +new Date(profile.trial_start);
      d.trialScans = profile.scans_trial || 0;
    }
    return d;
  }
  function strip(path, data) {
    if (path !== 'meta/general') return data;
    var d = Object.assign({}, data); SERVER_FIELDS.forEach(function (k) { delete d[k]; }); return d;
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function childOf(prefix, path) { return path.indexOf(prefix + '/') === 0 && path.indexOf('/', prefix.length + 1) < 0; }
  function docSnap(path) {
    var has = store.has(path);
    return { exists: has, id: path.split('/').pop(), data: function () { return has ? clone(decorate(path, store.get(path))) : undefined; } };
  }
  function colSnap(prefix) {
    var docs = [];
    store.forEach(function (v, p) { if (childOf(prefix, p)) docs.push({ id: p.slice(prefix.length + 1), data: function () { return clone(v); } }); });
    return { docs: docs, empty: !docs.length, size: docs.length };
  }
  function fire(path) {
    (docL.get(path) || []).forEach(function (cb) { try { cb(docSnap(path)); } catch (e) { console.error(e); } });
    colL.forEach(function (set, prefix) { if (childOf(prefix, path)) set.forEach(function (cb) { try { cb(colSnap(prefix)); } catch (e) { console.error(e); } }); });
  }
  function dbErr(e) { var x = new Error(e && e.message || 'db error'); x.code = (e && (e.code || e.status)) || 'error'; return x; }

  async function fetchExact(path) {
    var r = await sb.from('docs').select('path,data').eq('path', path).maybeSingle();
    if (r.error) throw dbErr(r.error);
    if (r.data) store.set(path, r.data.data); else store.delete(path);
    loadedExact.add(path);
  }
  async function fetchPrefix(prefix) {
    var from = 0, size = 1000, seen = {};
    for (;;) {
      var r = await sb.from('docs').select('path,data').like('path', prefix + '/%').order('path').range(from, from + size - 1);
      if (r.error) throw dbErr(r.error);
      r.data.forEach(function (row) { seen[row.path] = 1; store.set(row.path, row.data); });
      if (r.data.length < size) break; from += size;
    }
    Array.from(store.keys()).forEach(function (p) { if (childOf(prefix, p) && !seen[p]) store.delete(p); });
    loadedPrefix.add(prefix);
  }
  function ensureChannel() {
    if (channel || !userId) return;
    channel = sb.channel('docs-' + userId).on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'owner=eq.' + userId }, function (p) {
      var path = (p.new && p.new.path) || (p.old && p.old.path); if (!path) return;
      if (p.eventType === 'DELETE') store.delete(path); else store.set(path, p.new.data);
      fire(path);
    }).subscribe();
  }
  function addL(map, key, cb) {
    var set = map.get(key); if (!set) { set = new Set(); map.set(key, set); } set.add(cb);
    return function () { set.delete(cb); };
  }
  var db = {
    doc: function (path) {
      return {
        async set(data) {
          var r = await sb.from('docs').upsert({ owner: userId, path: path, data: strip(path, data), updated_at: new Date().toISOString() }, { onConflict: 'owner,path' });
          if (r.error) { var e = dbErr(r.error); if (/ACCOUNT_LIMIT/.test(r.error.message || '')) e.code = r.error.message.indexOf('BUSINESS') >= 0 ? 'account_limit_business' : 'account_limit_project'; throw e; }
          store.set(path, strip(path, data)); fire(path);
        },
        async delete() {
          var r = await sb.from('docs').delete().eq('path', path);
          if (r.error) throw dbErr(r.error);
          store.delete(path); fire(path);
        },
        async get() { if (!loadedExact.has(path)) await fetchExact(path); return docSnap(path); },
        onSnapshot: function (cb, errCb) {
          ensureChannel(); var off = addL(docL, path, cb), dead = false;
          fetchExact(path).then(function () { if (!dead) cb(docSnap(path)); }).catch(function (e) { if (errCb) errCb(e); });
          return function () { dead = true; off(); };
        }
      };
    },
    collection: function (prefix) {
      return {
        onSnapshot: function (cb, errCb) {
          ensureChannel(); var off = addL(colL, prefix, cb), dead = false;
          fetchPrefix(prefix).then(function () { if (!dead) cb(colSnap(prefix)); }).catch(function (e) { if (errCb) errCb(e); });
          return function () { dead = true; off(); };
        }
      };
    }
  };
  // plan and scan counters can change on the server: refresh them when the user returns to the app
  function refreshProfile() { loadProfile().then(function () { fire('meta/general'); }); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && userId) refreshProfile(); });

  /* ---------- assets: receipt photos and PDFs in private storage ---------- */
  var blobCache = new Map(), urlCache = new Map();
  var bucket = function () { return sb.storage.from(CFG.bucket); };
  var assets = {
    async upload(blob, opts) {
      var id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
      var r = await bucket().upload(userId + '/' + id, blob, { contentType: (opts && opts.type) || blob.type || 'application/octet-stream', upsert: false });
      if (r.error) throw dbErr(r.error);
      blobCache.set(id, blob); return { id: id };
    },
    async delete(id) {
      blobCache.delete(id); var u = urlCache.get(id); if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
      var r = await bucket().remove([userId + '/' + id]); if (r.error) throw dbErr(r.error);
    }
  };
  async function getBlob(id) {
    if (blobCache.has(id)) return blobCache.get(id);
    var r = await bucket().download(userId + '/' + id);
    if (r.error) throw dbErr(r.error);
    blobCache.set(id, r.data); return r.data;
  }
  // The app refers to stored files as /_blob/<id>: serve those from storage.
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    var m = /^(?:https?:\/\/[^/]+)?\/_blob\/([^/?#]+)/.exec(u);
    if (!m) return realFetch(input, init);
    return authReady.then(function () { return getBlob(decodeURIComponent(m[1])); })
      .then(function (b) { return new Response(b, { status: 200, headers: { 'content-type': b.type || 'application/octet-stream' } }); })
      .catch(function () { return new Response('', { status: 404 }); });
  };
  function fixImg(img) {
    var src = img.getAttribute && img.getAttribute('src'); var m = src && /^\/_blob\/([^/?#]+)/.exec(src); if (!m) return;
    var id = decodeURIComponent(m[1]);
    if (urlCache.has(id)) { img.src = urlCache.get(id); return; }
    img.removeAttribute('src');
    authReady.then(function () { return getBlob(id); }).then(function (b) {
      var u = urlCache.get(id) || URL.createObjectURL(b); urlCache.set(id, u); img.src = u;
    }).catch(function () {});
  }
  new MutationObserver(function (list) {
    list.forEach(function (mu) {
      if (mu.type === 'attributes') { if (mu.target.tagName === 'IMG') fixImg(mu.target); return; }
      mu.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG') fixImg(n); else if (n.querySelectorAll) n.querySelectorAll('img[src^="/_blob/"]').forEach(fixImg);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  /* ---------- sample: automatic receipt reading through the server function ---------- */
  function toJpegBase64(blob, maxSide) {
    return createImageBitmap(blob).then(function (bmp) {
      var k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
      var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    });
  }
  var sample = {
    async limits() { return { images: true }; },
    async json(prompt, opts) {
      var img = opts && opts.images; if (Array.isArray(img)) img = img[0];
      var b64 = await toJpegBase64(img, 1600);
      var tok = (await sb.auth.getSession()).data.session;
      var res = await fetch(CFG.url + '/functions/v1/read-receipt', {
        method: 'POST', headers: { 'content-type': 'application/json', 'apikey': CFG.key, 'authorization': 'Bearer ' + tok.access_token },
        body: JSON.stringify({ prompt: prompt, image: b64, mediaType: 'image/jpeg', lang: fi() ? 'fi' : 'en' })
      });
      var j = null; try { j = await res.json(); } catch (e) {}
      if (!res.ok) { var er = new Error((j && j.message) || 'read failed'); er.code = (j && j.code) || 'read_failed'; throw er; }
      refreshProfile();
      return j && j.result || {};
    }
  };

  /* ---------- downloads ---------- */
  var downloads = {
    async save(o) {
      var d = o.data, blob = d instanceof Blob ? d : new Blob([d]);
      var a = document.createElement('a'), u = URL.createObjectURL(blob);
      a.href = u; a.download = o.filename; a.style.display = 'none'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
      return { status: 'saved' };
    }
  };

  /* ---------- password change and sign-out, used by the app's settings page ---------- */
  function changePassword() {
    css(); var m = document.createElement('div'); m.id = 'kmodal';
    m.innerHTML = '<form class="kbox"><h3>' + t('Change password') + '</h3><div id="kme"></div>' + field('kp1', 'New password', 'password', '', 'autocomplete="new-password"') +
      field('kp2', 'Repeat new password', 'password', '', 'autocomplete="new-password"') + '<div class="krow"><button type="button" data-x>' + t('Cancel') + '</button><button class="kp">' + t('Save password') + '</button></div></form>';
    document.body.appendChild(m);
    m.querySelector('[data-x]').onclick = function () { m.remove(); };
    m.querySelector('form').onsubmit = async function (e) {
      e.preventDefault(); var p1 = m.querySelector('#kp1').value, p2 = m.querySelector('#kp2').value, er = m.querySelector('#kme');
      if (!pwOk(p1)) { er.innerHTML = '<p class="ke">' + esc(t('At least 8 characters, a capital letter, a number and a special character.')) + '</p>'; return; }
      if (p1 !== p2) { er.innerHTML = '<p class="ke">' + esc(t('Passwords do not match.')) + '</p>'; return; }
      var r = await sb.auth.updateUser({ password: p1 });
      if (r.error) { er.innerHTML = '<p class="ke">' + esc(mapErr(r.error)) + '</p>'; return; }
      m.remove(); window.dispatchEvent(new CustomEvent('kuititon-toast', { detail: t('Password changed.') }));
    };
  }
  window.kuititon = {
    signOut: function () { return sb.auth.signOut(); },
    changePassword: changePassword,
    sb: sb
  };

  /* ---------- what the app asks for ---------- */
  var adapters = { db: db, assets: assets, sample: sample, downloads: downloads };
  window.claude = { use: function (name) { return authReady.then(function () { return adapters[name] || null; }); } };
})();
