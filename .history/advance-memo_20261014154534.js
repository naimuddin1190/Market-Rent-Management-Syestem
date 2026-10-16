/* ============================================================
   advance-memo.js
   script.js এর পরে লোড হবে (index.html এর একদম শেষে)।
   ১) লগইন পেজ আপগ্রেড
   ২) "হিসাব ও মেমো" এ নতুন PREMIUM ট্যাব: "অগ্রিম মেমো"
      - Firebase এ সেভ (memos collection, kind = 'adv-memo')
      - মেমোর নিচে QR কোড (verify.html এ যাচাই)
      - জমিদার / ভাড়াটিয়ার স্বাক্ষর নেই
   ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const val = id => ($(id) || {}).value || '';

  function injectCss(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }

  /* ============================================================
     1) LOGIN PAGE
     ============================================================ */
  const LOGIN_CSS = `
    .lg-field{position:relative}
    .lg-field .lead{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#16a34a;font-size:.9rem;pointer-events:none}
    .lg-field .form-input{padding-left:36px;padding-right:42px;background:#f0fdf4;color:#14532d;border-color:#bbf7d0}
    .lg-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#6b7280;padding:8px 10px;font-size:.9rem}
    .lg-eye:hover{color:#16a34a}
    .lg-msg{display:none;border-radius:8px;padding:9px 12px;font-size:.82rem;margin-bottom:12px;text-align:left;line-height:1.5}
    .lg-msg.error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
    .lg-msg.success{background:#dcfce7;color:#166534;border:1px solid #86efac}
    .lg-msg.info{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}
    .lg-row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:.8rem;margin:4px 0 14px}
    .lg-check{display:flex;gap:6px;align-items:center;cursor:pointer;color:#14532d;user-select:none}
    .lg-check input{accent-color:#16a34a;width:15px;height:15px}
    .lg-caps{display:none;font-size:.74rem;color:#b45309;margin-top:4px}
    .lg-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:lgspin .7s linear infinite;display:inline-block}
    @keyframes lgspin{to{transform:rotate(360deg)}}
    @keyframes lgshake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
    .lg-shake{animation:lgshake .35s}
    .lg-foot{margin-top:18px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:.72rem;color:#6b7280;line-height:1.6}
    .lg-net{display:none;margin-bottom:10px;font-size:.76rem;color:#b45309;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:6px 10px;text-align:left}
  `;

  function buildLogin() {
    const card = document.querySelector('#loginPage .login-card');
    if (!card || card.dataset.lg) return;
    card.dataset.lg = '1';
    injectCss('lgCss', LOGIN_CSS);

    let savedEmail = '', remember = true;
    try {
      savedEmail = localStorage.getItem('rememberEmail') || '';
      remember = localStorage.getItem('rememberMe') !== '0';
    } catch (e) {}

    card.innerHTML =
      '<div style="margin-bottom:18px;">' +
        '<div style="width:70px;height:70px;background:linear-gradient(135deg,#14532d,#16a34a);border-radius:16px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-store" style="color:#fff;font-size:1.6rem;"></i></div>' +
        '<h1 style="font-family:\'Noto Serif Bengali\',serif;font-size:1.5rem;font-weight:800;color:#14532d;line-height:1.3;">হাজী চাঁন মিয়া মার্কেট</h1>' +
        '<p style="color:#6b7280;font-size:0.82rem;margin-top:4px;">ভাড়া ব্যবস্থাপনা সিস্টেম v2.0</p>' +
      '</div>' +
      '<div style="text-align:left;">' +
        '<div id="lgNet" class="lg-net"><i class="fas fa-wifi"></i> ইন্টারনেট সংযোগ নেই — সংযোগ ফিরলে লগইন করুন</div>' +
        '<div id="loginMsg" class="lg-msg" role="alert"></div>' +
        '<div class="form-group">' +
          '<label class="form-label" style="color:#14532d;" for="loginUser">ইমেইল</label>' +
          '<div class="lg-field"><i class="fas fa-envelope lead"></i>' +
          '<input type="email" id="loginUser" class="form-input" placeholder="admin@example.com" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:6px;">' +
          '<label class="form-label" style="color:#14532d;" for="loginPass">পাসওয়ার্ড</label>' +
          '<div class="lg-field"><i class="fas fa-lock lead"></i>' +
          '<input type="password" id="loginPass" class="form-input" placeholder="••••••••" autocomplete="current-password">' +
          '<button type="button" class="lg-eye" id="lgEye" onclick="loginTogglePass()" title="পাসওয়ার্ড দেখুন / লুকান" aria-label="পাসওয়ার্ড দেখুন"><i class="fas fa-eye"></i></button></div>' +
          '<div id="lgCaps" class="lg-caps"><i class="fas fa-exclamation-triangle"></i> Caps Lock চালু আছে</div>' +
        '</div>' +
        '<div class="lg-row">' +
          '<label class="lg-check"><input type="checkbox" id="loginRemember"' + (remember ? ' checked' : '') + '> আমাকে মনে রাখুন</label>' +
          '<a href="#" id="lgForgot" onclick="resetPassword();return false;" style="color:#16a34a;font-weight:600;">পাসওয়ার্ড ভুলে গেছেন?</a>' +
        '</div>' +
        '<button id="loginBtn" onclick="doLogin()" class="btn btn-primary" style="width:100%;justify-content:center;padding:12px;font-size:1rem;"><i class="fas fa-sign-in-alt"></i> <span>লগইন করুন</span></button>' +
        '<div class="lg-foot" style="text-align:center;"><i class="fas fa-shield-alt" style="color:#16a34a;"></i> শুধুমাত্র অনুমোদিত অ্যাডমিনদের জন্য।<br>শেয়ার্ড কম্পিউটারে "আমাকে মনে রাখুন" বন্ধ রাখুন।</div>' +
      '</div>';

    if (savedEmail) $('loginUser').value = savedEmail;

    const pass = $('loginPass');
    const caps = e => {
      let on = false;
      try { on = e.getModifierState && e.getModifierState('CapsLock'); } catch (er) {}
      const c = $('lgCaps'); if (c) c.style.display = on ? 'block' : 'none';
    };
    pass.addEventListener('keydown', caps);
    pass.addEventListener('keyup', caps);
    pass.addEventListener('blur', () => { const c = $('lgCaps'); if (c) c.style.display = 'none'; });

    const net = () => { const n = $('lgNet'); if (n) n.style.display = navigator.onLine ? 'none' : 'block'; };
    window.addEventListener('online', net); window.addEventListener('offline', net); net();
  }

  function loginMsg(text, type) {
    const m = $('loginMsg'); if (!m) return;
    if (!text) { m.style.display = 'none'; m.textContent = ''; return; }
    m.className = 'lg-msg ' + (type || 'error');
    m.textContent = text; m.style.display = 'block';
  }
  function loginBusy(on, label) {
    const b = $('loginBtn'); if (!b) return;
    b.disabled = !!on;
    b.innerHTML = on ? '<span class="lg-spin"></span> <span>' + (label || 'অপেক্ষা করুন...') + '</span>' : '<i class="fas fa-sign-in-alt"></i> <span>লগইন করুন</span>';
  }

  window.loginTogglePass = function () {
    const p = $('loginPass'), e = $('lgEye'); if (!p || !e) return;
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    e.innerHTML = '<i class="fas fa-eye' + (show ? '-slash' : '') + '"></i>';
    p.focus();
  };

  let _loginRunning = false;
  window.doLogin = async function () {
    if (_loginRunning) return;
    const email = val('loginUser').trim(), pass = val('loginPass');
    loginMsg('');
    const fail = t => {
      loginMsg(t, 'error');
      const c = document.querySelector('#loginPage .login-card');
      if (c) { c.classList.remove('lg-shake'); void c.offsetWidth; c.classList.add('lg-shake'); }
    };
    if (!email || !pass) { fail('ইমেইল ও পাসওয়ার্ড দিন'); return; }
    if (navigator.onLine === false) { fail('ইন্টারনেট সংযোগ নেই'); return; }
    if (!auth_fire) initFirebase();
    if (!auth_fire) { fail('Firebase লোড হয়নি। ইন্টারনেট চেক করে পেজ রিফ্রেশ করুন'); return; }

    const remember = !!($('loginRemember') || {}).checked;
    _loginRunning = true; loginBusy(true, 'লগইন হচ্ছে...');
    try {
      const P = firebase.auth.Auth.Persistence;
      try { await auth_fire.setPersistence(remember ? P.LOCAL : P.SESSION); } catch (e) { console.warn('persistence', e); }
      await auth_fire.signInWithEmailAndPassword(email, pass);   // বাকি কাজ onAuthStateChanged এ হয়
      try {
        localStorage.setItem('rememberMe', remember ? '1' : '0');
        if (remember) localStorage.setItem('rememberEmail', email); else localStorage.removeItem('rememberEmail');
      } catch (e) {}
      const p = $('loginPass'); if (p) p.value = '';
    } catch (e) {
      fail(authErrorBn(e));
    } finally {
      _loginRunning = false; loginBusy(false);
    }
  };

  window.resetPassword = async function () {
    const email = val('loginUser').trim();
    loginMsg('');
    if (!email) { loginMsg('পাসওয়ার্ড রিসেটের জন্য আগে উপরে ইমেইল লিখুন', 'info'); const u = $('loginUser'); if (u) u.focus(); return; }
    if (!auth_fire) initFirebase();
    if (!auth_fire) { loginMsg('Firebase লোড হয়নি', 'error'); return; }
    const a = $('lgForgot'); if (a) a.style.pointerEvents = 'none';
    loginMsg('রিসেট লিংক পাঠানো হচ্ছে...', 'info');
    try {
      await auth_fire.sendPasswordResetEmail(email);
      loginMsg('পাসওয়ার্ড রিসেট লিংক ' + email + ' এ পাঠানো হয়েছে। ইনবক্স ও স্প্যাম ফোল্ডার দেখুন।', 'success');
    } catch (e) { loginMsg(authErrorBn(e), 'error'); }
    finally { if (a) a.style.pointerEvents = ''; }
  };

  /* ============================================================
     2) ADVANCE MEMO (PREMIUM)
     ============================================================ */
  const ADV_MEMO_TAB = { id: 'advmemo', icon: 'fa-file-invoice-dollar', title: 'অগ্রিম মেমো' };
  if (!PREMIUM_IDS.includes('advmemo')) PREMIUM_IDS.push('advmemo');

  const METHODS = ['নগদ (ক্যাশ)', 'বিকাশ', 'নগদ (অ্যাপ)', 'রকেট', 'ব্যাংক ট্রান্সফার', 'চেক'];
  let _amEditId = null, _amEditMeta = null;

  /* ---- হিসাব ---- */
  function amCalc(d) {
    const adv = Math.max(0, _n(d.adv));
    let recv = String(d.recv == null ? '' : d.recv).trim() === '' ? adv : Math.max(0, _n(d.recv));
    if (adv > 0) recv = Math.min(recv, adv);
    const ded = Math.max(0, _n(d.ded));
    const months = Math.max(0, Math.floor(_n(d.months)));
    const deducted = ded > 0 ? Math.min(recv, ded * months) : 0;
    const remain = recv - deducted;
    const pending = Math.max(0, adv - recv);
    const fullMonths = ded > 0 ? Math.ceil(recv / ded) : 0;
    const monthsLeft = ded > 0 ? Math.ceil(remain / ded) : 0;
    const rows = [];
    if (d.sched && ded > 0 && recv > 0) {
      const baseStr = d.start || d.date || isoLocal(new Date());
      const base = new Date(baseStr + 'T00:00:00');
      let cum = 0;
      for (let i = 0; i < fullMonths && i < 120; i++) {
        const cut = Math.min(ded, recv - cum); cum += cut;
        const dt = new Date(base.getFullYear(), base.getMonth() + i, 1);
        rows.push([BN_MONTHS[dt.getMonth()] + ' ' + dt.getFullYear(), money(cut), money(recv - cum), i < months ? 'কর্তিত ✓' : 'বাকি']);
      }
    }
    return { adv, recv, ded, months, deducted, remain, pending, fullMonths, monthsLeft, rows };
  }

  function amTables(d, c) {
    const sum = [['মোট অগ্রিম (নির্ধারিত)', money(c.adv)],
      ['গ্রহণ করা হয়েছে' + (d.method ? ' (' + d.method + ')' : ''), money(c.recv)]];
    if (c.pending > 0) sum.push(['বাকি অগ্রিম (এখনো আদায় হয়নি)', money(c.pending)]);
    if (c.ded > 0) {
      sum.push(['মাসিক কর্তন', money(c.ded)]);
      sum.push(['কর্তনের মাস', c.months + ' মাস']);
      sum.push(['কর্তন বাবদ কাটা হয়েছে', '−' + money(c.deducted)]);
    }
    const tables = [{ title: 'অগ্রিম হিসাব', cols: ['বিবরণ', 'টাকা'], num: [1], rows: sum, foot: ['বর্তমান গচ্ছিত অগ্রিম', money(c.remain)] }];
    if (c.rows.length) tables.push({ title: 'মাসভিত্তিক কর্তন তালিকা', cols: ['মাস', 'কর্তন', 'অবশিষ্ট অগ্রিম', 'অবস্থা'], num: [1, 2], rows: c.rows, foot: ['মোট কর্তন', money(c.recv), '', ''] });
    return tables;
  }

  function amInputs(m) {          // সেভ করা মেমো -> calc input
    const a = m.advData || {};
    return { adv: a.adv, recv: a.recv, ded: a.ded, months: a.months, start: a.start || '', date: m.date, method: a.method || '', sched: !!a.sched };
  }

  /* ---- QR / receipt (verify.html) ---- */
  async function amPublishReceipt(m) {
    if (!FIREBASE_READY || !db_fire) return false;
    const c = amCalc(amInputs(m)), a = m.advData || {};
    const rec = {
      kind: 'advance', token: m.verifyToken, memoId: m.id, memoNo: m.no,
      mktName: settings.mktName || '', mktAddress: settings.mktAddress || '', mktPhone: settings.mktPhone || '',
      tenantName: m.name || '', shop: m.shop || '', date: m.date || '',
      advance: c.adv, received: c.recv, pending: c.pending, monthlyDeduction: c.ded,
      deductedMonths: c.months, deducted: c.deducted, remaining: c.remain, method: a.method || '',
      createdAt: m.createdAt || new Date().toISOString()
    };
    try {
      await Promise.race([
        db_fire.collection('receipts').doc(m.verifyToken).set(rec),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      return true;
    } catch (e) { console.warn('Advance receipt publish failed:', e); return false; }
  }

  async function amQrHtml(m) {
    if (typeof QRCode === 'undefined' || !m.verifyToken) return '';
    if (!m.receiptSynced && FIREBASE_READY) {            // আগের বার পাবলিশ ব্যর্থ হলে আবার চেষ্টা
      if (await amPublishReceipt(m)) {
        m.receiptSynced = true;
        try { FDB.save('memos', m.id, { receiptSynced: true }); } catch (e) {}
      }
    }
    const src = await generateQRDataUrl(verifyUrlFor(m.verifyToken));
    if (!src) return '';
    return '<div class="qr-container" style="display:flex;flex-direction:column;align-items:center;">' +
      '<img src="' + src + '" width="84" height="84" alt="QR" style="display:block;border:2px solid #86efac;border-radius:6px;padding:3px;background:#fff;">' +
      '<div style="font-size:0.7rem;color:#14532d;font-weight:600;margin-top:4px;line-height:1.3;white-space:nowrap;">QR স্ক্যান করে যাচাই করুন</div></div>';
  }

  /* ---- মেমোর HTML (কোনো স্বাক্ষর নেই, নিচে QR) ---- */
  function amMemoHtml(m, qrHtml) {
    const s = settings || {};
    const d = amInputs(m), c = amCalc(d), tables = amTables(d, c);
    return '<div class="slip-copy" style="margin-bottom:0;border-top:4px solid #14532d;">' +
      '<div class="slip-decorative" style="margin-bottom:10px;"></div>' +
      '<div style="text-align:center;margin-bottom:10px;">' +
        '<div class="slip-title-bn">' + _esc(s.mktName || 'হাজী চাঁন মিয়া মার্কেট') + '</div>' +
        '<div class="slip-sub-bn">' + _esc(s.mktAddress || '') + '</div>' +
        '<div class="slip-sub-bn">ফোন : ' + _esc(s.mktPhone || '') + '</div>' +
        (s.mktHolding ? '<div class="slip-sub-bn">' + _esc(s.mktHolding) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
        '<div class="slip-stamp">অগ্রিম মেমো</div>' +
        '<div style="font-size:.9rem;font-weight:800;color:#14532d;">নং-' + _esc(m.no) + '</div>' +
        '<div style="margin-left:auto;font-size:.84rem;color:#166534;">তারিখ: <span class="slip-field">' + fmtDate(m.date) + '</span></div>' +
      '</div>' +
      '<div class="memo-meta">' +
        '<div>ভাড়াটিয়ার নাম : <span class="slip-field">' + _esc(m.name || '-') + '</span></div>' +
        (m.shop ? '<div>দোকান : <span class="slip-field">' + _esc(m.shop) + '</span></div>' : '') +
        (m.mobile ? '<div>মোবাইল : <span class="slip-field">' + _esc(m.mobile) + '</span></div>' : '') +
      '</div>' +
      tables.map(calcTableHtml).join('') +
      '<div class="memo-words">অগ্রিম গ্রহণ (কথায়) : <span class="slip-note">' + takaInWords(c.recv) + '</span></div>' +
      (m.collector ? '<div style="font-size:.8rem;color:#14532d;">সংগ্রহকারী : <span class="slip-field">' + _esc(m.collector) + '</span></div>' : '') +
      (m.note ? '<div style="font-size:.8rem;color:#4b5563;margin-top:2px;">মন্তব্য : <span class="slip-note">' + _esc(m.note) + '</span></div>' : '') +
      '<div style="display:flex;justify-content:center;margin-top:18px;padding-top:12px;border-top:1px dashed #86efac;">' + (qrHtml || '') + '</div>' +
      '<div class="slip-decorative" style="margin-top:10px;"></div>' +
    '</div>';
  }

  async function amMemoShow(m) {
    currentMemo = m;
    showSyncOverlay(true, 'মেমো প্রস্তুত হচ্ছে...');
    let qr = '';
    try { qr = await amQrHtml(m); } catch (e) { console.warn(e); }
    showSyncOverlay(false);
    $('memoSlipContent').innerHTML = '<div class="slip-container" id="printMemoArea" style="max-width:640px;margin:0 auto;">' + amMemoHtml(m, qr) + '</div>';
    openModal('memoModal');
  }

  /* ---- প্যানেল UI ---- */
  function amBuild() {
    const box = $('advMemoPanel');
    if (!box || box.dataset.built) return;
    box.dataset.built = '1';
    const f = (label, inner, full) => '<div class="form-group"' + (full ? ' style="grid-column:1/-1;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>';
    box.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start;">' +
        '<div class="stat-card" style="padding:20px;">' +
          '<h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-crown" style="color:#f59e0b;"></i> <i class="fas fa-file-invoice-dollar" style="color:var(--accent);"></i> অগ্রিম মেমো ক্যালকুলেটর</h3>' +
          '<p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px;">শুধু অগ্রিম টাকার মেমো। সেভ করলে Firebase-এ থাকবে এবং মেমোর নিচে QR কোড বসবে। এতে কোনো স্বাক্ষর লাগে না।</p>' +
          '<div id="amEditBanner" style="display:none;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:8px;padding:8px 12px;font-size:.82rem;margin-bottom:10px;"></div>' +
          '<div class="form-grid">' +
            f('ভাড়াটিয়া (বাছাই করলে সব নিজে বসবে)', '<select id="amTenant" class="form-input form-select" onchange="amTenantPick()"></select>', true) +
            f('নাম *', '<input id="amName" class="form-input" placeholder="ভাড়াটিয়ার নাম" oninput="amRun()">') +
            f('দোকান নং', '<input id="amShop" class="form-input" oninput="amRun()">') +
            f('মোবাইল (WhatsApp এর জন্য)', '<input id="amMobile" class="form-input" inputmode="tel">') +
            f('মেমোর তারিখ', '<input id="amDate" class="form-input" placeholder="তারিখ বাছুন">') +
            f('মোট অগ্রিম (৳) *', '<input id="amAdv" class="form-input" type="number" step="any" inputmode="decimal" oninput="amRun()">') +
            f('এ পর্যন্ত গ্রহণ (৳)', '<input id="amRecv" class="form-input" type="number" step="any" inputmode="decimal" placeholder="ফাঁকা = পুরো অগ্রিম" oninput="amRun()">') +
            f('পেমেন্ট মাধ্যম', '<select id="amMethod" class="form-input form-select" onchange="amRun()"><option value="">-- বাছুন --</option>' + METHODS.map(x => '<option>' + x + '</option>').join('') + '</select>') +
            f('মাসিক কর্তন (৳)', '<input id="amDed" class="form-input" type="number" step="any" inputmode="decimal" value="0" oninput="amRun()">') +
            f('কত মাস কর্তন হয়েছে', '<input id="amMonths" class="form-input" type="number" value="0" oninput="amRun()">') +
            f('কর্তন শুরুর তারিখ', '<input id="amStart" class="form-input" placeholder="ঐচ্ছিক">') +
            f('সংগ্রহকারী', '<input id="amCollector" class="form-input" list="amCollectorList" placeholder="নাম"><datalist id="amCollectorList"></datalist>') +
            f('মন্তব্য', '<input id="amNote" class="form-input" placeholder="ঐচ্ছিক" oninput="amRun()">', true) +
          '</div>' +
          '<label style="display:flex;gap:8px;align-items:center;font-size:.84rem;margin:2px 0 14px;cursor:pointer;"><input type="checkbox" id="amSched" onchange="amRun()" style="accent-color:#16a34a;width:16px;height:16px;"> মাসভিত্তিক কর্তনের তালিকা মেমোতে দেখাবে</label>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" id="amSaveBtn" class="btn btn-primary" onclick="amSave()" style="flex:1;justify-content:center;"><i class="fas fa-cloud-upload-alt"></i> সেভ করে মেমো তৈরি করুন (QR সহ)</button>' +
            '<button type="button" class="btn btn-ghost" onclick="amReset()"><i class="fas fa-eraser"></i> নতুন</button>' +
          '</div>' +
          '<button type="button" id="amCancelBtn" class="btn btn-ghost" onclick="amReset()" style="display:none;margin-top:6px;width:100%;justify-content:center;"><i class="fas fa-times"></i> সম্পাদনা বাতিল</button>' +
        '</div>' +
        '<div class="stat-card" style="padding:20px;"><h3 style="font-weight:700;margin-bottom:12px;font-size:.95rem;"><i class="fas fa-calculator" style="color:var(--accent);"></i> লাইভ হিসাব</h3><div id="amResult"></div></div>' +
      '</div>' +
      '<div class="stat-card" style="padding:20px;margin-top:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-cloud" style="color:var(--accent);"></i> সংরক্ষিত অগ্রিম মেমো (Firebase)</h3><div id="amList"></div></div>';

    if (typeof flatpickr !== 'undefined') {
      ['amDate', 'amStart'].forEach(id => {
        const el = $(id); if (!el) return;
        flatpickr(el, { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: false, disableMobile: true, onChange: [() => amRun()] });
      });
    }
    setVal('amDate', isoLocal(new Date()));
  }

  function setVal(id, v) {
    const el = $(id); if (!el) return;
    el.value = v == null ? '' : v;
    if (el._flatpickr) el._flatpickr.setDate(v || null, false, 'Y-m-d');
  }

  function amInit() {
    amBuild();
    const sel = $('amTenant'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- ভাড়াটিয়া নির্বাচন করুন (বা নিচে নিজে লিখুন) --</option>' +
      (tenants || []).filter(t => !t.archived).map(t => '<option value="' + t.id + '">' + _esc(t.name) + ' - ' + _esc(t.shop) + '</option>').join('');
    sel.value = cur;
    const dl = $('amCollectorList'); if (dl) dl.innerHTML = getCollectorList().map(n => '<option value="' + _esc(n) + '">').join('');
    amRun(); amRenderList();
    try { FDB.getAll('memos').then(() => amRenderList()).catch(() => {}); } catch (e) {}
  }

  window.amTenantPick = function () {
    const tn = (tenants || []).find(t => t.id === val('amTenant'));
    if (tn) {
      setVal('amName', tn.name || ''); setVal('amShop', tn.shop || ''); setVal('amMobile', tn.mobile || '');
      setVal('amAdv', tn.advance || ''); setVal('amRecv', '');
      setVal('amDed', tn.monthlyDeduction || tn.deduction || 0);
      setVal('amMonths', _tmonths(tn));
      setVal('amStart', tn.startDate || '');
    }
    amRun();
  };

  function amRead() {
    return {
      tid: val('amTenant'), date: val('amDate') || isoLocal(new Date()), name: val('amName').trim(), shop: val('amShop').trim(), mobile: val('amMobile').trim(),
      adv: val('amAdv'), recv: val('amRecv'), method: val('amMethod'), ded: val('amDed'), months: val('amMonths'), start: val('amStart'),
      sched: !!($('amSched') || {}).checked, collector: val('amCollector').trim(), note: val('amNote').trim()
    };
  }

  window.amRun = function () {
    const out = $('amResult'); if (!out) return;
    const d = amRead(), c = amCalc(d);
    const rows = [['মোট অগ্রিম', money(c.adv)], ['গ্রহণ করা হয়েছে', money(c.recv)]];
    if (c.pending > 0) rows.push(['বাকি অগ্রিম', money(c.pending)]);
    if (c.ded > 0) {
      rows.push(['মাসিক কর্তন', money(c.ded)], ['কর্তনের মাস', c.months + ' মাস'], ['কর্তন বাবদ কাটা হয়েছে', '−' + money(c.deducted)],
        ['কত মাসে অগ্রিম শেষ হবে', c.fullMonths + ' মাস'], ['আরও কত মাস বাকি', c.monthsLeft + ' মাস']);
    }
    out.innerHTML = '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">' +
      rows.map((r, i) => '<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 14px;font-size:.86rem;' + (i ? 'border-top:1px solid var(--border);' : '') + '"><span style="color:var(--text-muted);">' + _esc(r[0]) + '</span><b style="text-align:right;">' + _esc(r[1]) + '</b></div>').join('') +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--accent);color:#fff;"><span style="font-weight:600;">বর্তমান গচ্ছিত অগ্রিম</span><span style="font-size:1.35rem;font-weight:800;">' + money(c.remain) + '</span></div></div>' +
      '<div style="font-size:.76rem;color:var(--text-muted);margin:6px 2px;">' + takaInWords(c.remain) + '</div>' +
      (c.rows.length ? calcTableHtml(amTables(d, c)[1]) : '');
  };

  /* ---- সেভ / এডিট ---- */
  function amNextNo() {
    const dt = new Date(), ymd = String(dt.getFullYear()).slice(2) + String(dt.getMonth() + 1).padStart(2, '0') + String(dt.getDate()).padStart(2, '0');
    const used = new Set(DB.get('memos').map(m => m.no));
    let n = DB.get('memos').filter(m => String(m.no || '').startsWith('AM-' + ymd)).length + 1, no;
    do { no = 'AM-' + ymd + '-' + String(n++).padStart(3, '0'); } while (used.has(no));
    return no;
  }

  window.amSave = async function () {
    const d = amRead();
    if (!d.name) { showToast('ভাড়াটিয়ার নাম দিন', 'error'); return; }
    if (!(_n(d.adv) > 0)) { showToast('মোট অগ্রিমের পরিমাণ দিন', 'error'); return; }
    const c = amCalc(d), editing = !!_amEditId;
    const memo = {
      id: editing ? _amEditId : 'MEMO' + Date.now(),
      no: editing ? _amEditMeta.no : amNextNo(),
      kind: 'adv-memo', title: 'অগ্রিম মেমো', date: d.date,
      tenantId: d.tid || '', name: d.name, shop: d.shop, mobile: d.mobile,
      items: [], tables: [], noSum: true,
      sub: _r2(c.recv), disc: 0, total: _r2(c.recv), paid: 0, due: 0,
      collector: d.collector, note: d.note,
      advData: { adv: c.adv, recv: c.recv, ded: c.ded, months: c.months, start: d.start || '', method: d.method || '', sched: !!d.sched },
      verifyToken: editing && _amEditMeta.verifyToken ? _amEditMeta.verifyToken : makeVerifyToken(),
      createdAt: editing ? (_amEditMeta.createdAt || new Date().toISOString()) : new Date().toISOString()
    };
    if (editing) memo.updatedAt = new Date().toISOString();

    showSyncOverlay(true, 'মেমো সংরক্ষণ হচ্ছে...');
    let ok = false;
    try {
      memo.receiptSynced = await amPublishReceipt(memo);
      ok = await FDB.save('memos', memo.id, Object.assign({}, memo, { tables: [], tablesJson: '[]' }));
    } catch (e) { console.error(e); }
    showSyncOverlay(false);

    addActivity((editing ? 'অগ্রিম মেমো আপডেট: ' : 'অগ্রিম মেমো সংরক্ষণ: ') + memo.no + ' — ' + memo.name, 'file-invoice-dollar', '#16a34a');
    showToast(ok ? (editing ? 'অগ্রিম মেমো আপডেট হয়েছে ✅' : 'অগ্রিম মেমো Firebase-এ সংরক্ষিত হয়েছে ✅') : 'শুধু এই ডিভাইসে সেভ হয়েছে (ইন্টারনেট/লগইন দেখুন)', ok ? 'success' : 'error');
    if (!memo.receiptSynced && FIREBASE_READY) showToast('QR যাচাই পেজ আপডেট হয়নি — মেমো খুললে আবার চেষ্টা হবে', 'warning');
    if (memo.tenantId) _memoFolderOpen[memo.tenantId] = true;
    amReset(); amRenderList();
    if (typeof memoRenderHistory === 'function') memoRenderHistory();
    amMemoShow(memo);
  };

  window.amReset = function () {
    _amEditId = null; _amEditMeta = null;
    ['amTenant', 'amName', 'amShop', 'amMobile', 'amAdv', 'amRecv', 'amMethod', 'amStart', 'amCollector', 'amNote'].forEach(id => setVal(id, ''));
    setVal('amDed', 0); setVal('amMonths', 0); setVal('amDate', isoLocal(new Date()));
    const s = $('amSched'); if (s) s.checked = false;
    const b = $('amEditBanner'); if (b) b.style.display = 'none';
    const sb = $('amSaveBtn'); if (sb) sb.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> সেভ করে মেমো তৈরি করুন (QR সহ)';
    const cb = $('amCancelBtn'); if (cb) cb.style.display = 'none';
    amRun();
  };

  function amLoad(m) {
    amInit();
    const a = m.advData || {};
    _amEditId = m.id; _amEditMeta = { no: m.no, createdAt: m.createdAt, verifyToken: m.verifyToken };
    setVal('amTenant', m.tenantId || ''); setVal('amName', m.name); setVal('amShop', m.shop); setVal('amMobile', m.mobile);
    setVal('amDate', m.date); setVal('amAdv', a.adv); setVal('amRecv', a.recv === a.adv ? '' : a.recv); setVal('amMethod', a.method || '');
    setVal('amDed', a.ded); setVal('amMonths', a.months); setVal('amStart', a.start || '');
    setVal('amCollector', m.collector); setVal('amNote', m.note);
    const s = $('amSched'); if (s) s.checked = !!a.sched;
    const b = $('amEditBanner'); if (b) { b.style.display = 'block'; b.innerHTML = '<i class="fas fa-pen"></i> সম্পাদনা চলছে: <b>' + _esc(m.no) + '</b> — পরিবর্তন করে "আপডেট করুন" চাপুন (QR একই থাকবে)'; }
    const sb = $('amSaveBtn'); if (sb) sb.innerHTML = '<i class="fas fa-sync-alt"></i> আপডেট করুন';
    const cb = $('amCancelBtn'); if (cb) cb.style.display = '';
    amRun();
    const p = $('advMemoPanel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function amRenderList() {
    const box = $('amList'); if (!box) return;
    const list = DB.get('memos').filter(m => m.kind === 'adv-memo').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    box.innerHTML = list.length ? list.map(m =>
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);">' +
        '<div style="min-width:180px;"><div style="font-weight:700;">' + _esc(m.name) + ' <span style="font-size:.74rem;font-weight:400;color:var(--text-muted);">' + _esc(m.shop || '') + '</span></div>' +
        '<div style="font-size:.78rem;color:var(--text-muted);">' + _esc(m.no) + ' • ' + fmtDate(m.date) + ' • গ্রহণ <b style="color:#16a34a;">' + money(m.total) + '</b></div></div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
          '<button class="btn btn-primary btn-sm" onclick="memoOpen(\'' + m.id + '\')"><i class="fas fa-eye"></i> View</button>' +
          '<button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="memoEdit(\'' + m.id + '\')"><i class="fas fa-edit"></i> Update</button>' +
          '<button class="btn btn-gray btn-sm" onclick="amScanLog(\'' + m.id + '\')" title="QR স্ক্যান রেকর্ড"><i class="fas fa-qrcode"></i></button>' +
          '<button class="btn btn-danger btn-sm" onclick="memoDelete(\'' + m.id + '\')"><i class="fas fa-trash"></i> Delete</button>' +
        '</div></div>').join('')
      : '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:.84rem;">এখনো কোনো অগ্রিম মেমো সেভ করা নেই</p>';
  }

  window.amScanLog = function (id) {
    const m = DB.get('memos').find(x => x.id === id);
    if (!m || !m.verifyToken) { showToast('এই মেমোর QR নেই', 'error'); return; }
    const fake = { id: '__am_' + id, verifyToken: m.verifyToken, tenantSlipNo: m.no, tenantName: m.name };
    payments.push(fake);
    try { openScanLog(fake.id); }
    finally { const i = payments.indexOf(fake); if (i >= 0) payments.splice(i, 1); }
  };

  /* ---- বিদ্যমান ফাংশনে হুক ---- */
  const _origSelect = window.calcSelect;
  window.calcSelect = function (id) {
    const p = $('advMemoPanel');
    if (id === 'advmemo') {
      _calcActive = id; window.renderCalcTabs();
      ['calcGrid', 'memoHistoryCard', 'expensePanel', 'advPanel'].forEach(x => { const e = $(x); if (e) e.style.display = 'none'; });
      if (p) p.style.display = 'block';
      amInit(); return;
    }
    if (p) p.style.display = 'none';
    return _origSelect.apply(this, arguments);
  };

  window.renderCalcTabs = function () {
    const box = $('calcTabs'); if (!box) return;
    const all = CALCS.concat([EXPENSE_TAB, ADV_TAB, ADV_MEMO_TAB]);
    const btn = c => '<button type="button" class="tab-btn' + (PREMIUM_IDS.includes(c.id) ? ' prem' : '') + (c.id === _calcActive ? ' active' : '') + '" onclick="calcSelect(\'' + c.id + '\')">' + (PREMIUM_IDS.includes(c.id) ? '<i class="fas fa-crown"></i> ' : '') + '<i class="fas ' + c.icon + '"></i> ' + c.title + '</button>';
    const prem = PREMIUM_IDS.map(id => all.find(c => c.id === id)).filter(Boolean);
    const rest = all.filter(c => !PREMIUM_IDS.includes(c.id));
    box.innerHTML = '<div class="prem-group"><span class="pg-label"><i class="fas fa-crown"></i> PREMIUM</span>' + prem.map(btn).join('') + '</div>' + rest.map(btn).join('');
  };

  const _origMemoShow = window.memoShow;
  window.memoShow = function (m) {
    if (m && m.kind === 'adv-memo') return amMemoShow(m);
    return _origMemoShow.apply(this, arguments);
  };

  const _origMemoEdit = window.memoEdit;
  window.memoEdit = function (id) {
    const m = DB.get('memos').find(x => x.id === id);
    if (m && m.kind === 'adv-memo') { window.calcSelect('advmemo'); amLoad(m); return; }
    return _origMemoEdit.apply(this, arguments);
  };

  const _origMemoDelete = window.memoDelete;
  window.memoDelete = async function (id) {
    const m = DB.get('memos').find(x => x.id === id);
    await _origMemoDelete.apply(this, arguments);
    if (m && m.kind === 'adv-memo' && !DB.get('memos').some(x => x.id === id)) {
      if (m.verifyToken && FIREBASE_READY) { try { await db_fire.collection('receipts').doc(m.verifyToken).delete(); } catch (e) { console.warn(e); } }
      if (_amEditId === id) window.amReset();
      amRenderList();
    }
  };

  const _origMemoWA = window.memoWhatsApp;
  window.memoWhatsApp = async function () {
    const m = currentMemo;
    if (!m || m.kind !== 'adv-memo') return _origMemoWA.apply(this, arguments);
    const c = amCalc(amInputs(m)), mob = (m.mobile || '').replace(/[^0-9]/g, '');
    const text = '📋 *অগ্রিম মেমো - ' + (settings.mktName || '') + '*\n\nনং: ' + m.no + '\nতারিখ: ' + fmtDate(m.date) + '\nনাম: ' + m.name + (m.shop ? '\nদোকান: ' + m.shop : '') +
      '\n\nমোট অগ্রিম: ' + money(c.adv) + '\nগ্রহণ: ' + money(c.recv) + (c.pending > 0 ? '\nবাকি অগ্রিম: ' + money(c.pending) : '') +
      (c.ded > 0 ? '\nমাসিক কর্তন: ' + money(c.ded) + ' (' + c.months + ' মাস)' : '') + '\n*বর্তমান গচ্ছিত অগ্রিম: ' + money(c.remain) + '*' +
      (m.verifyToken ? '\n\nযাচাই: ' + verifyUrlFor(m.verifyToken) : '') + '\n\nধন্যবাদ।';
    const url = 'https://wa.me/' + (mob ? (mob.startsWith('88') ? mob : '88' + mob) : '') + '?text=' + encodeURIComponent(text);
    const el = $('printMemoArea');
    try {
      if (el && typeof html2canvas !== 'undefined' && navigator.share && navigator.canShare) {
        const canvas = await slipCanvas(el), blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
        const file = new File([blob], 'advance_memo_' + m.no + '.jpg', { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'অগ্রিম মেমো ' + m.no }); return; }
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    window.open(url, '_blank');
  };

  /* ---- স্টার্ট ---- */
  (function mountPanel() {
    const adv = $('advPanel');
    if (adv && !$('advMemoPanel')) {
      const p = document.createElement('div');
      p.id = 'advMemoPanel'; p.style.display = 'none';
      adv.insertAdjacentElement('afterend', p);
    }
  })();
  buildLogin();

  window.__AdvMemo = { calc: amCalc, tables: amTables };   // টেস্টের জন্য
})();