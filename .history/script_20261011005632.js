'use strict';
// ============================================================
// FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyC19qXVO3sMbB2OibYOK4tTdJpa-fI2M98",
  authDomain:        "haji-chan-market.firebaseapp.com",
  projectId:         "haji-chan-market",
  storageBucket:     "haji-chan-market.firebasestorage.app",
  messagingSenderId: "596043711897",
  appId:             "1:596043711897:web:6de6044757ad4be2d07f08"
};

// ============================================================
// FIREBASE STATE
// ============================================================
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){ console.warn('localStorage full:',k); } }

// ============================================================
// DATE HELPERS — shob jaygay DD/MM/YYYY
// ============================================================
const DATE_BN_DIGITS = false;   // true korle 09/10/2026 ->  ০৯/১০/২০২৬
function _bnDigits(str){ return String(str).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]); }
function isoLocal(d){            // local-time YYYY-MM-DD (UTC bhul din hobe na)
  d = d instanceof Date ? d : new Date(d);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function fmtDate(v){             // 'YYYY-MM-DD' / ISO datetime / Date  ->  DD/MM/YYYY
  if (!v) return '';
  let y,m,d;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { y=v.slice(0,4); m=v.slice(5,7); d=v.slice(8,10); }
  else { const dt = v instanceof Date ? v : new Date(v); if (isNaN(dt)) return String(v);
         y=dt.getFullYear(); m=String(dt.getMonth()+1).padStart(2,'0'); d=String(dt.getDate()).padStart(2,'0'); }
  const out = d+'/'+m+'/'+y;
  return DATE_BN_DIGITS ? _bnDigits(out) : out;
}
function fmtDateTime(v){
  if (!v) return '';
  const dt = new Date(v); if (isNaN(dt)) return String(v);
  const t = String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0');
  return fmtDate(dt)+' '+(DATE_BN_DIGITS?_bnDigits(t):t);
}

// Date input gulo: screen e DD/MM/YYYY, bhitore YYYY-MM-DD (code er onno part kaj kore)
function initDatePickers(){
  if (typeof flatpickr === 'undefined') return;
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  ['tStartDate','tEndDate','rDate','leaveReqDate','leaveExitDate','agStartDate','agEndDate','mDate'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el._flatpickr) return;
    const hooks = {};
    if (id === 'agStartDate') hooks.onChange = [() => agRecalcEnd()];
    if (id === 'agEndDate')   hooks.onChange = [() => { const v = document.getElementById('agValidity'); if (v) v.value = 'custom'; }];
    const fp = flatpickr(el, Object.assign({ dateFormat:'Y-m-d', altInput:true, altFormat:'d/m/Y', allowInput:false, disableMobile:true }, hooks));
    let busy = false;
    Object.defineProperty(el, 'value', {
      configurable: true,
      get(){ return desc.get.call(el); },
      set(v){
        desc.set.call(el, v);
        if (busy) return;
        busy = true;
        try { fp.setDate(v || null, false, 'Y-m-d'); } finally { busy = false; }
      }
    });
  });
}

let db_fire = null, storage_fire = null, auth_fire = null;
let FIREBASE_READY = false;
let _realtimeUnsubs = [];

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db_fire      = firebase.firestore();
    try { storage_fire = firebase.storage(); } catch(e) { storage_fire = null; }
    auth_fire    = firebase.auth();
    FIREBASE_READY = true;
    console.log('✅ Firebase v2 connected');
  } catch(e) { console.warn('⚠️ Firebase init failed:', e); }
}

function startRealtimeListeners() {
  if (!FIREBASE_READY) return;
  _realtimeUnsubs.forEach(u => u());
  _realtimeUnsubs = [];
  const listen = (col, setter) => {
    const u = db_fire.collection(col).onSnapshot(
      snap => { const d = snap.docs.map(x=>({id:x.id,...x.data()})); lsSet(col, JSON.stringify(d)); setter(d); },
      err  => console.warn('onSnapshot:', col, err)
    );
    _realtimeUnsubs.push(u);
  };
  listen('tenants',  d => { tenants=d;  renderTenants(); updateNotifications(); });
  listen('shops',    d => { shops=d;    if(isActivePage('shops')) renderShops(); });
  listen('payments', d => { payments=d; buildMonthFilters(); if(isActivePage('rentCollection')) renderPayments(); if(isActivePage('paymentHistory')) renderHistory(); });
}
function isActivePage(id){ return document.getElementById('page-'+id)?.classList.contains('active'); }

// ── Storage helpers ─────────────────────────────────────────
async function uploadToStorage(path, base64DataUrl) {
  if (!FIREBASE_READY || !storage_fire) return base64DataUrl;
  try {
    const ref = storage_fire.ref(path);
    await ref.putString(base64DataUrl, 'data_url');
    return await ref.getDownloadURL();
  } catch(e) { console.warn('Storage upload failed:', e); return base64DataUrl; }
}

async function uploadFileToStorage(path, file) {
  if (!FIREBASE_READY || !storage_fire) return null;
  try {
    const ref = storage_fire.ref(path);
    await ref.put(file);
    return await ref.getDownloadURL();
  } catch(e) { console.warn('File upload failed:', e); return null; }
}

// ============================================================
// DATABASE LAYER (Hybrid: Firebase + LocalStorage fallback)
// ============================================================
const FDB = {
  getAll: async (col) => {
    if (!FIREBASE_READY) return JSON.parse(localStorage.getItem(col)||'[]');
    try {
      const snap = await db_fire.collection(col).get();
      const d = snap.docs.map(x=>({id:x.id,...x.data()}));
      lsSet(col, JSON.stringify(d));
      return d;
    } catch(e) { return JSON.parse(localStorage.getItem(col)||'[]'); }
  },
  save: async (col, id, data) => {
    const all = JSON.parse(localStorage.getItem(col)||'[]');
    const idx = all.findIndex(x=>x.id===id);
    const rec = {...(idx>=0?all[idx]:{}), ...data, id};
    if (idx>=0) all[idx]=rec; else all.push(rec);
    lsSet(col, JSON.stringify(all));
    if (!FIREBASE_READY) return true;
    try {
      const clean = Object.fromEntries(Object.entries(data).filter(([k,v])=>v!==undefined&&k!=='id'));
      clean._updatedAt = new Date().toISOString();
      await db_fire.collection(col).doc(id).set(clean, {merge:true});
      return true;
    } catch(e) { return false; }
  },
  delete: async (col, id) => {
    const all = JSON.parse(localStorage.getItem(col)||'[]');
    lsSet(col, JSON.stringify(all.filter(x=>x.id!==id)));
    if (!FIREBASE_READY) return true;
    try { await db_fire.collection(col).doc(id).delete(); return true; }
    catch(e) { return false; }
  },
  // Subcollection: tenant slips
  saveSlip: async (tenantId, slipData) => {
    const key = 'slips_' + tenantId;
    const all = JSON.parse(localStorage.getItem(key)||'[]');
    all.push(slipData);
    localStorage.setItem(key, JSON.stringify(all));
    if (!FIREBASE_READY) return true;
    try {
      await db_fire.collection('tenants').doc(tenantId).collection('slips').doc(slipData.slipNo).set(slipData);
      return true;
    } catch(e) { return false; }
  },
  getTenantSlips: async (tenantId) => {
    const key = 'slips_' + tenantId;
    if (!FIREBASE_READY) return JSON.parse(localStorage.getItem(key)||'[]');
    try {
      const snap = await db_fire.collection('tenants').doc(tenantId).collection('slips').orderBy('_createdAt').get();
      return snap.docs.map(x=>({...x.data()}));
    } catch(e) { return JSON.parse(localStorage.getItem(key)||'[]'); }
  },
  getSettings: async () => {
    if (!FIREBASE_READY) { try { return JSON.parse(localStorage.getItem('settings')||'null'); } catch { return null; } }
    try { const d=await db_fire.collection('config').doc('settings').get(); if(d.exists){localStorage.setItem('settings',JSON.stringify(d.data()));return d.data();} return null; }
    catch(e) { return JSON.parse(localStorage.getItem('settings')||'null'); }
  },
  saveSettings: async (data) => {
    localStorage.setItem('settings', JSON.stringify(data));
    if (!FIREBASE_READY) return true;
    try { await db_fire.collection('config').doc('settings').set(data,{merge:true}); return true; }
    catch(e) { return false; }
  },
  addActivity: async (data) => {
    const all = JSON.parse(localStorage.getItem('activities')||'[]');
    all.unshift(data); if(all.length>50) all.length=50;
    localStorage.setItem('activities', JSON.stringify(all));
    if (!FIREBASE_READY) return;
    try { await db_fire.collection('activities').add({...data,_createdAt:new Date().toISOString()}); }
    catch(e) {}
  },
  getActivities: async () => {
    if (!FIREBASE_READY) return JSON.parse(localStorage.getItem('activities')||'[]');
    try {
      const snap = await db_fire.collection('activities').orderBy('_createdAt','desc').limit(50).get();
      return snap.docs.map(x=>({id:x.id,...x.data()}));
    } catch(e) { return JSON.parse(localStorage.getItem('activities')||'[]'); }
  }
};

const DB = {
  get: k => { try{ return JSON.parse(localStorage.getItem(k))||[]; }catch{ return []; } },
  set: (k,v) => localStorage.setItem(k, JSON.stringify(v)),
  getObj: (k,d={}) => { try{ return JSON.parse(localStorage.getItem(k))||d; }catch{ return d; } }
};

// ============================================================
// APP STATE
// ============================================================
let tenants    = DB.get('tenants');
let shops      = DB.get('shops');
let payments   = DB.get('payments');
let activities = DB.get('activities');
let settings   = DB.getObj('settings', {
  mktName:'হাজী চাঁন মিয়া মার্কেট',
  mktAddress:'ডি.টি রোড, বার কোয়াটার, পাহাড়তলী, চট্টগ্রাম।',
  mktPhone:'০১৭৪৭৩৯৫৩২১',
  mktOwner:'মোঃ জয়নাল আবেদীন মজুমদার',
  mktHolding:'হোল্ডিং নং-২৪৯৩/২৭৯১'
});
let currentSlipPayment = null;
let currentUser = localStorage.getItem('currentUser') || null;
let ownerSignature = localStorage.getItem('ownerSignature') || '';
let currentLang = localStorage.getItem('appLang') || 'bn';
// Chart instances
let dashChartInst=null, shopPieInst=null, incomeChartInst=null, dueChartInst=null, occupancyChartInst=null, agreementChartInst=null;
// Signature state
let sigCanvas=null, sigCtx=null, sigDrawing=false, sigMode='draw';

// ============================================================
// I18N — TRANSLATION SYSTEM
// ============================================================
const TRANSLATIONS = {
  bn: {
    login:'লগইন করুন', appTitle:'ভাড়া ব্যবস্থাপনা সিস্টেম',
    navMain:'প্রধান', navDashboard:'ড্যাশবোর্ড', navTenants:'ভাড়াটিয়া',
    navShops:'দোকান', navRent:'ভাড়া', navRentCollection:'ভাড়া সংগ্রহ',
    navHistory:'পেমেন্ট ইতিহাস', navAgreements:'চুক্তি ট্র্যাকার',
    navAnalysis:'বিশ্লেষণ', navReports:'রিপোর্ট', navSystem:'সিস্টেম',
    navSettings:'সেটিংস', navBackup:'ব্যাকআপ', navImport:'আমদানি', navLogout:'লগআউট',
    tenantManagement:'ভাড়াটিয়া ব্যবস্থাপনা', shopManagement:'দোকান ব্যবস্থাপনা',
    rentCollection:'ভাড়া সংগ্রহ', paymentHistory:'পেমেন্ট ইতিহাস',
    agreementTracker:'চুক্তি ট্র্যাকার', reportsAnalysis:'রিপোর্ট ও বিশ্লেষণ',
    systemSettings:'সিস্টেম সেটিংস', addTenant:'নতুন ভাড়াটিয়া',
    addShop:'নতুন দোকান', newReceipt:'নতুন রসিদ তৈরি',
    monthlyIncomeSummary:'মাসিক আয়ের সারসংক্ষেপ', expiringContracts:'মেয়াদ শেষ হচ্ছে',
    recentActivities:'সাম্প্রতিক কার্যক্রম', shopStatus:'দোকান অবস্থা',
    activeContracts:'সক্রিয়', leaveRequests:'ছাড়ার আবেদন', archived:'আর্কাইভ',
    notifications:'নোটিফিকেশন', paid:'পরিশোধিত', partial:'আংশিক', due:'বাকি',
    active:'সক্রিয়', expired:'মেয়াদ উত্তীর্ণ', expiring:'মেয়াদ শেষ হচ্ছে',
    totalTenants:'মোট ভাড়াটিয়া', totalShops:'মোট দোকান',
    monthlyCollection:'মাসিক সংগ্রহ', pendingRent:'বকেয়া ভাড়া',
    occupiedShops:'দখলকৃত দোকান'
  },
  en: {
    login:'Login', appTitle:'Rent Management System',
    navMain:'MAIN', navDashboard:'Dashboard', navTenants:'Tenants',
    navShops:'Shops', navRent:'RENT', navRentCollection:'Rent Collection',
    navHistory:'Payment History', navAgreements:'Agreements',
    navAnalysis:'ANALYTICS', navReports:'Reports', navSystem:'SYSTEM',
    navSettings:'Settings', navBackup:'Backup', navImport:'Import', navLogout:'Logout',
    tenantManagement:'Tenant Management', shopManagement:'Shop Management',
    rentCollection:'Rent Collection', paymentHistory:'Payment History',
    agreementTracker:'Agreement Tracker', reportsAnalysis:'Reports & Analytics',
    systemSettings:'System Settings', addTenant:'Add Tenant',
    addShop:'Add Shop', newReceipt:'New Receipt',
    monthlyIncomeSummary:'Monthly Income Summary', expiringContracts:'Expiring Contracts',
    recentActivities:'Recent Activities', shopStatus:'Shop Status',
    activeContracts:'Active', leaveRequests:'Leave Requests', archived:'Archived',
    notifications:'Notifications', paid:'Paid', partial:'Partial', due:'Due',
    active:'Active', expired:'Expired', expiring:'Expiring Soon',
    totalTenants:'Total Tenants', totalShops:'Total Shops',
    monthlyCollection:'Monthly Collection', pendingRent:'Pending Rent',
    occupiedShops:'Occupied Shops'
  }
};

function t(key) { return (TRANSLATIONS[currentLang]||{})[key] || (TRANSLATIONS.bn||{})[key] || key; }

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
}

function setLanguage(lang, save=true) {
  currentLang = lang;
  if (save) localStorage.setItem('appLang', lang);
  const bn=document.getElementById('langBnBtn'), en=document.getElementById('langEnBtn');
  if (bn) { bn.className = lang==='bn' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'; bn.style.cssText='border-radius:20px 0 0 20px;padding:6px 14px;'; }
  if (en) { en.className = lang==='en' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'; en.style.cssText='border-radius:0 20px 20px 0;padding:6px 14px;'; }
  document.documentElement.lang = lang==='en' ? 'en' : 'bn';
  applyTranslations();
}

// ============================================================
// AUTH
// ============================================================
let _appStarted = false;

function authErrorBn(e) {
  const c = (e && e.code) || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-email')
    return 'ইমেইল বা পাসওয়ার্ড ভুল';
  if (c === 'auth/too-many-requests') return 'অনেকবার ভুল হয়েছে। কিছুক্ষণ পরে চেষ্টা করুন';
  if (c === 'auth/network-request-failed') return 'ইন্টারনেট সংযোগ নেই';
  if (c === 'auth/operation-not-allowed') return 'Firebase এ Email/Password লগইন চালু করা নেই';
  return 'লগইন ব্যর্থ: ' + (c || (e && e.message) || 'unknown');
}

async function doLogin() {
  const email = (document.getElementById('loginUser').value || '').trim();
  const pass  = document.getElementById('loginPass').value || '';
  if (!email || !pass) { showToast('ইমেইল ও পাসওয়ার্ড দিন', 'error'); return; }
  if (!auth_fire) { initFirebase(); }
  if (!auth_fire) { showToast('Firebase লোড হয়নি। ইন্টারনেট চেক করে পেজ রিফ্রেশ করুন', 'error'); return; }
  const btn = document.getElementById('loginBtn');
  if (btn) btn.disabled = true;
  try {
    await auth_fire.signInWithEmailAndPassword(email, pass);   // বাকি কাজ onAuthStateChanged এ হয়
  } catch (e) {
    showToast(authErrorBn(e), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function resetPassword() {
  const email = (document.getElementById('loginUser').value || '').trim();
  if (!email) { showToast('আগে ইমেইল লিখুন', 'warning'); return; }
  if (!auth_fire) initFirebase();
  if (!auth_fire) { showToast('Firebase লোড হয়নি', 'error'); return; }
  try {
    await auth_fire.sendPasswordResetEmail(email);
    showToast('পাসওয়ার্ড রিসেট লিংক ইমেইলে পাঠানো হয়েছে ✅');
  } catch (e) { showToast(authErrorBn(e), 'error'); }
}

async function doLogout() {
  if (!confirm('লগআউট করতে চান?')) return;
  try { if (auth_fire) await auth_fire.signOut(); } catch (e) { console.warn(e); }
  localStorage.removeItem('currentUser');
  location.reload();
}

function showLoginScreen() {
  _appStarted = false;
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function startAuthWatcher() {
  initFirebase();
  if (!auth_fire) { showLoginScreen(); return; }
  auth_fire.onAuthStateChanged(user => {
    if (user) {
      currentUser = user.email || 'admin';
      localStorage.setItem('currentUser', currentUser);
      document.getElementById('loginPage').style.display = 'none';
      document.getElementById('mainApp').style.display = 'block';
      if (!_appStarted) { _appStarted = true; init(); }
    } else {
      // logged out: local cache e thaka private data muche din
      ['tenants','shops','payments','activities','archivedTenants','leaveRequests','agreements','memos','expenses'].forEach(k => localStorage.removeItem(k));
      Object.keys(localStorage).filter(k => k.startsWith('slips_') || k.startsWith('agHistory_') || k.startsWith('agfile_')).forEach(k => localStorage.removeItem(k));
      showLoginScreen();
    }
  });
}

// ============================================================
// INIT
// ============================================================
async function init() {
  showSyncOverlay(true, 'সিস্টেম লোড হচ্ছে...');
  initFirebase();
  try {
    if (FIREBASE_READY) {
      showSyncStatus('Firebase থেকে ডেটা লোড হচ্ছে...');
      [tenants, shops, payments, activities] = await Promise.all([
        FDB.getAll('tenants'), FDB.getAll('shops'), FDB.getAll('payments'), FDB.getActivities()
      ]);
    } else {
      tenants=DB.get('tenants'); shops=DB.get('shops');
      payments=DB.get('payments'); activities=DB.get('activities');
    }
  } catch(e) {
    tenants=DB.get('tenants'); shops=DB.get('shops');
    payments=DB.get('payments'); activities=DB.get('activities');
  }
  await applySettings();
  setDateDisplay();
  loadSettingsForm();
  buildMonthFilters();
  updateNotifications();
  showSyncOverlay(false);
  setLanguage(currentLang, false);
  showPage('dashboard');
  updateSyncBadge();
  startRealtimeListeners();
  startScanWatcher();
  // Load owner signature
  if (!ownerSignature && settings.ownerSignatureUrl) ownerSignature = settings.ownerSignatureUrl;
}

function setDateDisplay() {
  const now = new Date();
  const el = document.getElementById('dashDate');
  if (el) el.textContent = now.toLocaleDateString('bn-BD', {weekday:'long'})+', '+fmtDate(now);
  const rDate = document.getElementById('rDate');
  if (rDate) rDate.value = isoLocal(now);
  const months = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  const rMonth = document.getElementById('rMonth');
  if (rMonth) rMonth.value = months[now.getMonth()];
}

async function applySettings() {
  const fs = await FDB.getSettings();
  if (fs) settings = {...settings, ...fs};
  else settings = DB.getObj('settings', settings);
  // Update sidebar name
  const sn = document.getElementById('sidebarMarketName');
  if (sn) sn.textContent = settings.mktName || 'হাজী চাঁন মিয়া মার্কেট';
}

function loadSettingsForm() {
  ['mktName','mktAddress','mktPhone','mktOwner','mktHolding','mktVerifyUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el && settings[id]) el.value = settings[id];
  });
  const ci = document.getElementById('collectorsInput');
  if (ci) ci.value = getCollectorList().join('\n');
}

async function saveSettings() {
  settings.mktName    = document.getElementById('mktName').value;
  settings.mktAddress = document.getElementById('mktAddress').value;
  settings.mktPhone   = document.getElementById('mktPhone').value;
  settings.mktOwner   = document.getElementById('mktOwner').value;
  settings.mktHolding = document.getElementById('mktHolding').value;
  settings.mktVerifyUrl = (document.getElementById('mktVerifyUrl')||{}).value||'';
  settings.collectors = ((document.getElementById('collectorsInput')||{}).value||'').split('\n').map(x=>x.trim()).filter(Boolean);
  await FDB.saveSettings(settings);
  addActivity('সেটিংস আপডেট করা হয়েছে', 'cog', '#6b7280');
  const sn = document.getElementById('sidebarMarketName');
  if (sn) sn.textContent = settings.mktName;
  showToast('সেটিংস সংরক্ষণ হয়েছে ☁️');
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + pageId);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'"+pageId+"'")) n.classList.add('active');
  });
  if (window.matchMedia('(max-width: 768px)').matches) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('mobileOverlay').classList.remove('show');
  }
  if (pageId==='dashboard')      renderDashboard();
  else if (pageId==='tenants')   renderTenants();
  else if (pageId==='shops')     renderShops();
  else if (pageId==='rentCollection') { populateRentTenantSelect(); renderPayments(); }
  else if (pageId==='paymentHistory') renderHistory();
  else if (pageId==='agreements')     renderAgreements();
  else if (pageId==='reports')        renderReports();
  else if (pageId==='calculator')     memoInit();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('mobileOverlay');
  if (window.matchMedia('(max-width: 768px)').matches) {
    sb.classList.toggle('mobile-open');
    ov.classList.toggle('show', sb.classList.contains('mobile-open'));
  } else {
    const c = document.body.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem('sidebarCollapsed', c ? '1' : '0'); } catch(e) {}
  }
}
try { if (localStorage.getItem('sidebarCollapsed') === '1') document.body.classList.add('sidebar-collapsed'); } catch(e) {}

// ============================================================
// DARK MODE
// ============================================================
function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('darkBtn').innerHTML = isDark ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
  localStorage.setItem('darkMode', isDark ? 'light' : 'dark');
  setTimeout(() => { renderDashboard(); renderReports(); }, 100);
}
(function(){
  const saved = localStorage.getItem('darkMode');
  if (saved==='dark') {
    document.documentElement.setAttribute('data-theme','dark');
    setTimeout(()=>{ const b=document.getElementById('darkBtn'); if(b) b.innerHTML='<i class="fas fa-sun"></i>'; },100);
  }
})();

// ============================================================
// MODALS
// ============================================================
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open'); });

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type='success') {
  const t = document.createElement('div');
  const clr = {success:'#16a34a',error:'#dc2626',warning:'#d97706',info:'#2563eb'};
  t.style.cssText = 'position:fixed;bottom:70px;right:16px;background:'+(clr[type]||clr.success)+';color:#fff;padding:12px 18px;border-radius:10px;font-size:0.87rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.25);transform:translateY(20px);opacity:0;transition:all 0.3s;font-family:Noto Sans Bengali,sans-serif;max-width:300px;word-break:break-word;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>{ t.style.transform='translateY(0)'; t.style.opacity='1'; },50);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),300); },3500);
}

// ============================================================
// ACTIVITIES
// ============================================================
async function addActivity(text, icon='circle', color='#16a34a') {
  const entry = { text, icon, color, time: new Date().toISOString() };
  await FDB.addActivity(entry);
  activities = await FDB.getActivities();
}

// ============================================================
// ADVANCE CALCULATOR
// ============================================================
function updateAdvanceCalc() {
  const advance   = parseFloat(document.getElementById('tAdvance')?.value)||0;
  const deduction = parseFloat(document.getElementById('tDeduction')?.value)||0;
  const calc      = document.getElementById('advanceCalc');
  if (!calc) return;
  if (advance > 0 && deduction > 0) {
    calc.style.display='block';
    const months = Math.floor(advance / deduction);
    const startDate = document.getElementById('tStartDate')?.value;
    const monthsElapsed = startDate
      ? Math.floor((new Date()-new Date(startDate))/(1000*60*60*24*30))
      : 0;
    const deducted  = Math.min(monthsElapsed * deduction, advance);
    const remaining = Math.max(0, advance - deducted);
    document.getElementById('calcTotal').textContent     = '৳'+advance.toLocaleString();
    document.getElementById('calcDeduction').textContent = '৳'+deduction.toLocaleString()+'/মাস';
    document.getElementById('calcMonths').textContent    = months+' মাসে শেষ';
    document.getElementById('calcRemaining').textContent = '৳'+remaining.toLocaleString();
  } else { calc.style.display='none'; }
}

// ============================================================
// TENANT CRUD
// ============================================================

function shrinkDataUrl(dataUrl, maxSize, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
function openTenantModal(id) {
  id = id || null;
  const nidIcon = '<span style="text-align:center;"><i class="fas fa-id-card" style="display:block;font-size:1.4rem;margin-bottom:4px;color:var(--accent);"></i>আপলোড করুন</span>';
  ['tenantId','tName','tMobile','tNid','tDeduction','tRent','tAdvance','tAddress','tNotes','nidFrontData','nidBackData'].forEach(f => { const el=document.getElementById(f); if(el) el.value=''; });
  document.getElementById('nidFrontPreview').innerHTML = nidIcon;
  document.getElementById('nidBackPreview').innerHTML  = nidIcon;
  document.getElementById('photoPreview').innerHTML    = '<i class="fas fa-camera" style="color:var(--accent);font-size:1.2rem;"></i><span style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;">ছবি আপলোড</span>';
  document.getElementById('photoPreview').dataset.photo = '';
  document.getElementById('advanceCalc').style.display = 'none';
  populateShopSelect();
  const now = new Date();
  document.getElementById('tStartDate').value = isoLocal(now);
  const end = new Date(now); end.setFullYear(end.getFullYear()+1);
  document.getElementById('tEndDate').value = isoLocal(end);

  if (id) {
    const tn = tenants.find(x=>x.id===id);
    if (!tn) return;
    document.getElementById('tenantModalTitle').textContent = 'ভাড়াটিয়ার তথ্য সম্পাদনা';
    document.getElementById('tenantId').value    = tn.id;
    document.getElementById('tName').value       = tn.name;
    document.getElementById('tMobile').value     = tn.mobile;
    document.getElementById('tNid').value        = tn.nid||'';
    document.getElementById('tShop').value       = tn.shop;
    document.getElementById('tFloor').value      = tn.floor;
    document.getElementById('tRent').value       = tn.rent;
    document.getElementById('tAdvance').value    = tn.advance||'';
    document.getElementById('tAddress').value    = tn.address||'';
    document.getElementById('tNotes').value      = tn.notes||'';
    document.getElementById('tStartDate').value  = tn.startDate||'';
    document.getElementById('tEndDate').value    = tn.endDate||'';
    if (document.getElementById('tDeduction')) document.getElementById('tDeduction').value = tn.monthlyDeduction||tn.deduction||'';
    // NID photos
    const nfp=document.getElementById('nidFrontPreview'), nbp=document.getElementById('nidBackPreview');
    if (tn.nidFrontUrl && nfp) nfp.innerHTML = '<img src="'+tn.nidFrontUrl+'" style="width:100%;height:100%;object-fit:cover;">';
    if (tn.nidBackUrl  && nbp) nbp.innerHTML = '<img src="'+tn.nidBackUrl+'"  style="width:100%;height:100%;object-fit:cover;">';
    if (tn.nidFrontUrl) { const el=document.getElementById('nidFrontData'); if(el) el.value=tn.nidFrontUrl; }
    if (tn.nidBackUrl)  { const el=document.getElementById('nidBackData');  if(el) el.value=tn.nidBackUrl; }
    if (tn.photo) {
      document.getElementById('photoPreview').innerHTML = '<img src="'+tn.photo+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
      document.getElementById('photoPreview').dataset.photo = tn.photo;
    }
    updateAdvanceCalc();
  } else {
    document.getElementById('tenantModalTitle').textContent = 'নতুন ভাড়াটিয়া যোগ করুন';
  }
  openModal('tenantModal');
}

function populateShopSelect() {
  const sel = document.getElementById('tShop');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- দোকান নির্বাচন --</option>';
  shops.forEach(s => { const o=document.createElement('option'); o.value=s.number; o.textContent=s.number+' ('+s.floor+')'; sel.appendChild(o); });
  if (!shops.length) ['A-01','A-02','B-01','B-02'].forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
}

function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  // Compress before storing
  compressImage(file, 300, 300, 0.7).then(b64 => {
    document.getElementById('photoPreview').innerHTML = '<img src="'+b64+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    document.getElementById('photoPreview').dataset.photo = b64;
  });
}

function compressImage(file, maxW, maxH, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxW) { h = h*maxW/w; w = maxW; }
        if (h > maxH) { w = w*maxH/h; h = maxH; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function saveTenant() {
  const name   = document.getElementById('tName').value.trim();
  const mobile = document.getElementById('tMobile').value.trim();
  const shop   = document.getElementById('tShop').value.trim();
  const rent   = document.getElementById('tRent').value;
  if (!name||!mobile||!shop||!rent) { showToast('অনুগ্রহ করে সব প্রয়োজনীয় তথ্য পূরণ করুন','error'); return; }

  const id = document.getElementById('tenantId').value;
  const tenantId = id || 'T'+Date.now();
  const photoEl = document.getElementById('photoPreview');
  let photoUrl = photoEl.dataset.photo || (photoEl.querySelector('img')?photoEl.querySelector('img').src:'');

  showSyncOverlay(true, 'ডেটা সংরক্ষণ হচ্ছে...');

  // Photo: Storage e na pathiye chhoto kore base64 hishebe Firestore e rakhbo
  if (photoUrl && photoUrl.startsWith('data:')) {
    showSyncStatus('প্রোফাইল ছবি প্রস্তুত হচ্ছে...');
    photoUrl = await shrinkDataUrl(photoUrl, 250, 0.6);
  }

  // NID Front
  const nidFrontRaw = (document.getElementById('nidFrontData')||{}).value||'';
  let nidFrontUrl = nidFrontRaw;
  if (nidFrontRaw && nidFrontRaw.startsWith('data:')) {
    showSyncStatus('NID সামনের ছবি প্রস্তুত হচ্ছে...');
    nidFrontUrl = await shrinkDataUrl(nidFrontRaw, 600, 0.5);
  }

  // NID Back
  const nidBackRaw = (document.getElementById('nidBackData')||{}).value||'';
  let nidBackUrl = nidBackRaw;
  if (nidBackRaw && nidBackRaw.startsWith('data:')) {
    showSyncStatus('NID পিছনের ছবি প্রস্তুত হচ্ছে...');
    nidBackUrl = await shrinkDataUrl(nidBackRaw, 600, 0.5);
  }

  const existing = id ? tenants.find(x=>x.id===id) : null;
  const tn = {
    id: tenantId, name, mobile,
    nid:              document.getElementById('tNid').value,
    shop,             floor:    document.getElementById('tFloor').value,
    rent:             parseFloat(rent),
    advance:          parseFloat(document.getElementById('tAdvance').value)||0,
    monthlyDeduction: parseFloat((document.getElementById('tDeduction')||{}).value)||0,
    deduction:        parseFloat((document.getElementById('tDeduction')||{}).value)||0, // backward compat
    address:  document.getElementById('tAddress').value,
    notes:    document.getElementById('tNotes').value,
    startDate: document.getElementById('tStartDate').value,
    endDate:   document.getElementById('tEndDate').value,
    photo:        photoUrl||'',
    nidFrontUrl:  nidFrontUrl||'',  // NEW: organized Storage path
    nidBackUrl:   nidBackUrl||'',   // NEW: organized Storage path
    serial:      id ? (existing?existing.serial:tenants.length+1) : tenants.length+1,
    slipCounter: id ? (existing?existing.slipCounter||0:0) : 0,
    archived: false,
    createdAt: id ? (existing?.createdAt||new Date().toISOString()) : new Date().toISOString()
  };

  await FDB.save('tenants', tn.id, tn);
  tenants = await FDB.getAll('tenants');
  if (!id) {
    const si = shops.findIndex(s=>s.number===shop);
    if (si>=0) { shops[si].status='occupied'; await FDB.save('shops', shops[si].id, shops[si]); }
  }
  addActivity((id?'ভাড়াটিয়া সম্পাদিত: ':'নতুন ভাড়াটিয়া: ')+name, id?'user-edit':'user-plus', id?'#2563eb':'#16a34a');
  showSyncOverlay(false);
  closeModal('tenantModal');
  renderTenants();
  updateNotifications();
  showToast(id?'ভাড়াটিয়ার তথ্য আপডেট হয়েছে ☁️':'নতুন ভাড়াটিয়া যোগ হয়েছে ☁️');
}

async function deleteTenant(id) {
  if (!confirm('এই ভাড়াটিয়া মুছে ফেলতে চান?')) return;
  const tn = tenants.find(x=>x.id===id);
  await FDB.delete('tenants', id);
  tenants = await FDB.getAll('tenants');
  addActivity('ভাড়াটিয়া মুছে ফেলা হয়েছে: '+(tn?tn.name:''),'trash','#dc2626');
  renderTenants(); updateNotifications();
  showToast('ভাড়াটিয়া মুছে ফেলা হয়েছে','error');
}

function viewTenant(id) {
  const tn = tenants.find(x=>x.id===id);
  if (!tn) return;
  const st = getAgreementStatus(tn);
  const tenantPays = payments.filter(p=>p.tenantId===id);
  const totalPaid = tenantPays.reduce((a,b)=>a+(b.paid||0),0);
  const totalDue  = tenantPays.reduce((a,b)=>a+(b.due||0),0);
  const photoHtml = tn.photo
    ? '<img src="'+tn.photo+'" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--accent);">'
    : '<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#14532d,#16a34a);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.8rem;font-weight:700;">'+tn.name.charAt(0)+'</div>';

  // Calculate refundable advance
  const monthsElapsed = tn.startDate
    ? Math.floor((new Date()-new Date(tn.startDate))/(1000*60*60*24*30))
    : 0;
  const deduction = tn.monthlyDeduction||tn.deduction||0;
  const deducted  = Math.min(monthsElapsed*deduction, tn.advance||0);
  const remaining = Math.max(0, (tn.advance||0)-deducted);

  const nidHtml = (tn.nidFrontUrl||tn.nidBackUrl)
    ? '<button onclick="viewNID(\''+id+'\')" class="btn btn-outline btn-sm" style="margin-top:8px;"><i class="fas fa-id-card"></i> NID দেখুন</button>'
    : '';

  const photoBtns = tn.photo
    ? '<div style="display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap;">'+
      '<button onclick="viewTenantPhoto(\''+id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-eye"></i> ছবি দেখুন</button>'+
      '<button onclick="deleteTenantPhoto(\''+id+'\')" class="btn btn-sm" style="background:#dc2626;color:#fff;"><i class="fas fa-trash"></i> মুছুন</button></div>'
    : '';

  const recentPays = tenantPays.slice(-5).reverse().map(p=>
    '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">'+
    '<span>'+p.month+' '+(p.year||'')+'</span><span>৳'+(p.paid||0).toLocaleString()+'</span>'+
    '<span class="badge '+(p.status==='paid'?'badge-green':p.status==='partial'?'badge-yellow':'badge-red')+'">'+
    (p.status==='paid'?'পরিশোধিত':p.status==='partial'?'আংশিক':'বাকি')+'</span></div>'
  ).join('') || '<p style="color:var(--text-muted);font-size:0.83rem;padding:10px 0;">কোনো পেমেন্ট নেই</p>';

  document.getElementById('tenantViewContent').innerHTML =
    '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">'+
    '<div style="text-align:center;flex-shrink:0;">'+photoHtml+
    '<span class="badge '+st.cls+'" style="margin-top:8px;display:block;">'+st.label+'</span>'+photoBtns+nidHtml+'</div>'+
    '<div style="flex:1;min-width:200px;">'+
    '<h2 style="font-size:1.2rem;font-weight:700;">'+tn.name+'</h2>'+
    '<p style="color:var(--text-muted);font-size:0.83rem;margin-bottom:10px;">'+tn.mobile+(tn.nid?' • NID: '+tn.nid:'')+'</p>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.83rem;">'+
    '<div><b>দোকান:</b> '+tn.shop+'</div><div><b>ফ্লোর:</b> '+tn.floor+'</div>'+
    '<div><b>মাসিক ভাড়া:</b> ৳'+(tn.rent||0).toLocaleString()+'</div>'+
    '<div><b>অগ্রিম:</b> ৳'+(tn.advance||0).toLocaleString()+'</div>'+
    '<div><b>মাসিক কর্তন:</b> ৳'+deduction.toLocaleString()+'</div>'+
    '<div><b>অবশিষ্ট অগ্রিম:</b> <span style="color:var(--accent);font-weight:700;">৳'+remaining.toLocaleString()+'</span></div>'+
    '<div><b>চুক্তি শুরু:</b> '+(fmtDate(tn.startDate)||'-')+'</div><div><b>চুক্তি শেষ:</b> '+(fmtDate(tn.endDate)||'-')+'</div>'+
    '<div><b>মোট পরিশোধিত:</b> ৳'+totalPaid.toLocaleString()+'</div>'+
    '<div><b>মোট বাকি:</b> <span style="color:#dc2626;">৳'+totalDue.toLocaleString()+'</span></div>'+
    '</div>'+(tn.address?'<p style="margin-top:8px;font-size:0.82rem;"><b>ঠিকানা:</b> '+tn.address+'</p>':'')+
    '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">'+
    '<button onclick="closeModal(\'tenantViewModal\');openTenantModal(\''+tn.id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-edit"></i> সম্পাদনা</button>'+
    '<button onclick="printTenant(\''+tn.id+'\')" class="btn btn-primary btn-sm"><i class="fas fa-print"></i> প্রিন্ট</button>'+
    '<a href="tel:'+tn.mobile+'" class="btn btn-gray btn-sm"><i class="fas fa-phone"></i> কল</a>'+
    '<a href="https://wa.me/88'+(tn.mobile||'').replace(/[^0-9]/g,'')+'" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;"><i class="fab fa-whatsapp"></i></a>'+
    '</div></div></div>'+
    '<hr style="margin:16px 0;border-color:var(--border);">'+
    '<h4 style="font-weight:700;margin-bottom:10px;font-size:0.9rem;">সাম্প্রতিক পেমেন্ট</h4>'+recentPays;
  openModal('tenantViewModal');
}

function viewTenantPhoto(id) {
  const tn = tenants.find(x=>x.id===id);
  if (!tn || !tn.photo) return;
  document.getElementById('nidViewContent').innerHTML =
    '<h3 style="margin-bottom:16px;font-weight:700;">'+tn.name+' — ছবি</h3>'+
    '<div style="text-align:center;"><img src="'+tn.photo+'" style="max-width:100%;max-height:70vh;border-radius:8px;border:2px solid var(--border);"></div>'+
    '<div style="margin-top:14px;text-align:center;"><button onclick="closeModal(\'nidViewModal\');viewTenant(\''+id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-arrow-left"></i> ফিরে যান</button></div>';
  closeModal('tenantViewModal');
  openModal('nidViewModal');
}

async function deleteTenantPhoto(id) {
  if (!confirm('প্রোফাইল ছবিটি মুছে ফেলবেন?')) return;
  try {
    await FDB.save('tenants', id, {photo:''});
    tenants = await FDB.getAll('tenants');
    showToast('ছবি মুছে ফেলা হয়েছে','error');
    viewTenant(id);
    if (typeof renderTenants==='function') renderTenants();
  } catch(e) { showToast('ছবি মুছতে সমস্যা হয়েছে','error'); }
}

function printNID(tenantId) {
  const tn = tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  const imgs = [tn.nidFrontUrl, tn.nidBackUrl].filter(Boolean);
  if (!imgs.length) return;
  const w = window.open('', '_blank');
  if (!w) { showToast('Pop-up বন্ধ আছে, অনুমতি দিন','error'); return; }
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title> </title><style>'+
    '@page{size:A4;margin:10mm}html,body{margin:0;padding:0}'+
    '.pg{width:190mm;height:277mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:12mm}'+
    '.pg img{max-width:100%;max-height:130mm;object-fit:contain;display:block}'+
    '</style></head><body><div class="pg">'+
    imgs.map(u=>'<img src="'+u+'">').join('')+
    '</div></body></html>');
  w.document.close();
  const go = () => { w.focus(); w.print(); };
  const els = Array.from(w.document.images);
  let left = els.length;
  if (!left) return go();
  els.forEach(im => { const d=()=>{ if(--left===0) go(); }; if (im.complete) d(); else { im.onload=d; im.onerror=d; } });
}

function viewNID(tenantId) {
  const tn = tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  let html = '<h3 style="margin-bottom:16px;font-weight:700;">'+tn.name+' — এনআইডি</h3>';
  if (tn.nidFrontUrl) html += '<div style="margin-bottom:12px;"><p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:6px;">সামনের দিক:</p><img src="'+tn.nidFrontUrl+'" style="max-width:100%;border-radius:8px;border:2px solid var(--border);"></div>';
  if (tn.nidBackUrl)  html += '<div><p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:6px;">পিছনের দিক:</p><img src="'+tn.nidBackUrl+'" style="max-width:100%;border-radius:8px;border:2px solid var(--border);"></div>';
  if (!tn.nidFrontUrl && !tn.nidBackUrl) html += '<p style="color:var(--text-muted);">কোনো NID ছবি আপলোড করা হয়নি।</p>';
  if (tn.nidFrontUrl || tn.nidBackUrl) html += '<div style="margin-top:16px;text-align:center;"><button onclick="printNID(\''+tenantId+'\')" class="btn btn-primary btn-sm"><i class="fas fa-print"></i> NID প্রিন্ট</button></div>';
  document.getElementById('nidViewContent').innerHTML = html;
  closeModal('tenantViewModal');
  openModal('nidViewModal');
}

function getAgreementStatus(tn) {
  if (!tn.endDate) return { label:'অজানা', cls:'badge-gray', days:null };
  const days = Math.ceil((new Date(tn.endDate)-new Date())/(1000*60*60*24));
  if (days<0)   return { label:'মেয়াদ উত্তীর্ণ', cls:'badge-red',    days };
  if (days<=30) return { label:days+' দিন বাকি',  cls:'badge-yellow', days };
  return { label:'সক্রিয়', cls:'badge-green', days };
}

function renderTenants() {
  tenants = DB.get('tenants');
  const search  = (document.getElementById('tenantSearch')?.value||'').toLowerCase();
  const floor   = document.getElementById('tenantFloorFilter')?.value||'';
  const statusF = document.getElementById('tenantStatusFilter')?.value||'';
  const sort    = document.getElementById('tenantSort')?.value||'name';

  let list = tenants.filter(tn => {
    if (tn.archived) return false;
    const ms = !search || tn.name.toLowerCase().includes(search)||tn.mobile.includes(search)||(tn.nid||'').includes(search);
    const mf = !floor  || tn.floor===floor;
    let ms2 = true;
    if (statusF) {
      const st = getAgreementStatus(tn);
      if (statusF==='active'   && st.days!==null && (st.days<0||st.days<=30)) ms2=false;
      if (statusF==='expiring' && (st.days===null||st.days<0||st.days>30))    ms2=false;
      if (statusF==='expired'  && (st.days===null||st.days>=0))               ms2=false;
    }
    return ms&&mf&&ms2;
  });
  list.sort((a,b) => {
    if (sort==='name') return a.name.localeCompare(b.name);
    if (sort==='shop') return (a.shop||'').localeCompare(b.shop||'');
    if (sort==='rent') return b.rent-a.rent;
    return 0;
  });

  const deduction = tn => tn.monthlyDeduction||tn.deduction||0;
  const monthsElapsed = tn => tn.startDate ? Math.floor((new Date()-new Date(tn.startDate))/(1000*60*60*24*30)) : 0;
  const remaining = tn => Math.max(0, (tn.advance||0) - Math.min(monthsElapsed(tn)*deduction(tn), tn.advance||0));

  const tbody = document.getElementById('tenantTableBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(tn => {
    const st = getAgreementStatus(tn);
    const ph = tn.photo
      ? '<img src="'+tn.photo+'" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">'
      : '<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#14532d,#16a34a);display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.9rem;font-weight:700;">'+tn.name.charAt(0)+'</div>';
    const rem = remaining(tn);
    return '<tr>'+
      '<td>'+ph+'</td>'+
      '<td><div style="font-weight:600;">'+tn.name+'</div><div style="font-size:0.75rem;color:var(--text-muted);">'+tn.mobile+'</div></td>'+
      '<td><span style="font-weight:600;">'+tn.shop+'</span><br><span style="font-size:0.75rem;color:var(--text-muted);">'+tn.floor+'</span></td>'+
      '<td><span style="font-weight:700;color:var(--accent);">৳'+(tn.rent||0).toLocaleString()+'</span></td>'+
      '<td><div style="font-size:0.78rem;">অগ্রিম: ৳'+(tn.advance||0).toLocaleString()+'</div>'+
      (deduction(tn)>0?'<div style="font-size:0.75rem;color:var(--text-muted);">অবশিষ্ট: <span style="color:var(--accent);font-weight:600;">৳'+rem.toLocaleString()+'</span></div>':'')+'</td>'+
      '<td><span class="badge '+st.cls+'">'+st.label+'</span></td>'+
      '<td><div style="display:flex;gap:3px;flex-wrap:wrap;">'+
      '<button onclick="viewTenant(\''+tn.id+'\')" class="btn btn-gray btn-sm" title="দেখুন"><i class="fas fa-eye"></i></button>'+
      '<button onclick="openTenantModal(\''+tn.id+'\')" class="btn btn-outline btn-sm" title="সম্পাদনা"><i class="fas fa-edit"></i></button>'+
      '<button onclick="quickRent(\''+tn.id+'\')" class="btn btn-primary btn-sm" title="রসিদ"><i class="fas fa-receipt"></i></button>'+
      '<button onclick="printTenant(\''+tn.id+'\')" class="btn btn-gray btn-sm" title="প্রিন্ট"><i class="fas fa-print"></i></button>'+
      '<button onclick="deleteTenant(\''+tn.id+'\')" class="btn btn-danger btn-sm" title="মুছুন"><i class="fas fa-trash"></i></button>'+
      '</div></td></tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">কোনো ভাড়াটিয়া পাওয়া যায়নি</td></tr>';
}


// ============================================================
// IMAGE REMOVE + TENANT PRINT
// ============================================================
function removeTenantPhoto() {
  const el = document.getElementById('photoPreview');
  el.innerHTML = '<i class="fas fa-camera" style="color:var(--accent);font-size:1.2rem;"></i><span style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;">ছবি আপলোড</span>';
  el.dataset.photo = '';
  const f = document.getElementById('tenantPhoto'); if (f) f.value = '';
}
function removeNID(previewId, dataId, fileId) {
  document.getElementById(previewId).innerHTML = '<span style="text-align:center;"><i class="fas fa-id-card" style="display:block;font-size:1.4rem;margin-bottom:4px;color:var(--accent);"></i>আপলোড করুন</span>';
  const d = document.getElementById(dataId); if (d) d.value = '';
  const f = document.getElementById(fileId); if (f) f.value = '';
}

function printTenant(id) {
  const tn = tenants.find(x => x.id === id);
  if (!tn) { showToast('ভাড়াটিয়া পাওয়া যায়নি', 'error'); return; }
  const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num = v => (parseFloat(v) || 0).toLocaleString('bn-BD');
  const deduction = tn.monthlyDeduction || tn.deduction || 0;
  const monthsElapsed = tn.startDate ? Math.floor((new Date() - new Date(tn.startDate)) / (1000*60*60*24*30)) : 0;
  const remaining = Math.max(0, (tn.advance||0) - Math.min(monthsElapsed*deduction, tn.advance||0));
  const row = (l, v) => '<tr><td class="l">'+l+'</td><td>'+esc(v||'-')+'</td></tr>';
  const img = (src, cap) => src ? '<div class="box"><div class="cap">'+cap+'</div><img src="'+src+'"></div>' : '';
  const photo = tn.photo
    ? '<img class="avatar" src="'+tn.photo+'">'
    : '<div class="avatar ph">'+esc((tn.name||'?').charAt(0))+'</div>';
  const sigImg = ownerSignature ? '<img src="'+ownerSignature+'" style="height:40px;display:block;margin:0 auto 2px;">' : '';

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>ভাড়াটিয়ার তথ্য - '+esc(tn.name)+'</title><style>'+
    "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap');"+
    "body{font-family:'Noto Sans Bengali',Arial,sans-serif;margin:14mm;color:#14532d;}"+
    'h1{text-align:center;font-size:22px;margin:0;} .sub{text-align:center;font-size:12px;color:#166534;margin:2px 0;}'+
    '.title{text-align:center;margin:12px 0;font-size:16px;font-weight:700;background:#16a34a;color:#fff;padding:4px;border-radius:4px;}'+
    '.top{display:flex;gap:16px;align-items:flex-start;} .avatar{width:110px;height:110px;border-radius:50%;object-fit:cover;border:2px solid #16a34a;flex-shrink:0;}'+
    '.avatar.ph{display:flex;align-items:center;justify-content:center;background:#16a34a;color:#fff;font-size:42px;font-weight:700;}'+
    'table{border-collapse:collapse;width:100%;font-size:14px;} td{border:1px solid #86efac;padding:6px 10px;} td.l{background:#f0fdf4;width:34%;font-weight:600;}'+
    '.nids{display:flex;gap:16px;margin-top:18px;} .box{flex:1;text-align:center;} .box img{width:100%;max-height:230px;object-fit:contain;border:1px solid #86efac;border-radius:4px;} .cap{font-size:12px;margin-bottom:4px;}'+
    '.sign{display:flex;justify-content:space-between;margin-top:70px;font-size:13px;} .sign div{border-top:1px solid #14532d;padding-top:4px;width:38%;text-align:center;}'+
    '@media print{body{margin:10mm;} @page{margin:8mm;}}'+
    '</style></head><body>'+
    '<h1>'+esc(settings.mktName||'')+'</h1><div class="sub">'+esc(settings.mktAddress||'')+'</div><div class="sub">ফোন : '+esc(settings.mktPhone||'')+'</div>'+
    '<div class="title">ভাড়াটিয়ার তথ্য</div>'+
    '<div class="top">'+photo+'<table>'+
      row('নাম', tn.name)+row('মোবাইল', tn.mobile)+row('এনআইডি নম্বর', tn.nid)+
      row('দোকান নং', tn.shop)+row('ফ্লোর', tn.floor)+
      row('মাসিক ভাড়া', '৳'+num(tn.rent))+row('অগ্রিম', '৳'+num(tn.advance))+
      row('মাসিক কর্তন', '৳'+num(deduction))+row('অবশিষ্ট অগ্রিম', '৳'+num(remaining))+
      row('চুক্তি শুরু', fmtDate(tn.startDate))+row('চুক্তি শেষ', fmtDate(tn.endDate))+
      row('ঠিকানা', tn.address)+row('মন্তব্য', tn.notes)+
    '</table></div>'+
    '<div class="nids">'+img(tn.nidFrontUrl,'এনআইডি — সামনের দিক')+img(tn.nidBackUrl,'এনআইডি — পিছনের দিক')+'</div>'+
    '<div class="sign"><div>ভাড়াটিয়ার স্বাক্ষর</div><div>'+sigImg+'জমিদারের স্বাক্ষর</div></div>'+
    '<div class="sub" style="margin-top:14px;">প্রিন্টের তারিখ: '+fmtDate(new Date())+'</div>'+
    '<scr'+'ipt>window.onload=function(){setTimeout(function(){window.print();},700);}</scr'+'ipt></body></html>';

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { showToast('Pop-up allow korun', 'warning'); return; }
  w.document.write(html); w.document.close();
}

// ============================================================
// SHOP CRUD
// ============================================================
function openShopModal(id) {
  id = id || null;
  ['shopId','sNumber','sSize','sRent'].forEach(f => { const el=document.getElementById(f); if(el) el.value=''; });
  if (id) {
    const s = shops.find(x=>x.id===id);
    if (!s) return;
    document.getElementById('shopModalTitle').textContent='দোকান সম্পাদনা';
    document.getElementById('shopId').value=s.id; document.getElementById('sNumber').value=s.number;
    document.getElementById('sFloor').value=s.floor; document.getElementById('sSize').value=s.size||'';
    document.getElementById('sRent').value=s.rent||''; document.getElementById('sStatus').value=s.status;
  } else { document.getElementById('shopModalTitle').textContent='নতুন দোকান যোগ করুন'; }
  openModal('shopModal');
}

async function saveShop() {
  const number = document.getElementById('sNumber').value.trim();
  if (!number) { showToast('দোকান নম্বর আবশ্যক','error'); return; }
  const id = document.getElementById('shopId').value;
  const s = {
    id: id||'S'+Date.now(), number, floor:document.getElementById('sFloor').value,
    size:document.getElementById('sSize').value, rent:parseFloat(document.getElementById('sRent').value)||0,
    status:document.getElementById('sStatus').value
  };
  await FDB.save('shops', s.id, s);
  shops = await FDB.getAll('shops');
  closeModal('shopModal'); renderShops();
  addActivity('দোকান '+(id?'সম্পাদিত':'যোগ')+': '+number,'store-alt','#16a34a');
  showToast(id?'দোকান আপডেট হয়েছে ☁️':'দোকান যোগ হয়েছে ☁️');
}

async function deleteShop(id) {
  if (!confirm('এই দোকান মুছে ফেলতে চান?')) return;
  await FDB.delete('shops', id);
  shops = await FDB.getAll('shops');
  renderShops(); showToast('দোকান মুছে ফেলা হয়েছে','error');
}

function renderShops() {
  shops = DB.get('shops');
  const grid = document.getElementById('shopGrid');
  if (!grid) return;
  const stClr  = {occupied:'#dcfce7',empty:'#dbeafe',maintenance:'#fef9c3'};
  const stText = {occupied:'ভাড়া দেওয়া',empty:'খালি',maintenance:'রক্ষণাবেক্ষণ'};
  const stCls  = {occupied:'badge-green',empty:'badge-blue',maintenance:'badge-yellow'};
  grid.innerHTML = shops.map(s => {
    const tn = tenants.find(t=>t.shop===s.number&&!t.archived);
    return '<div class="stat-card" style="padding:16px;background:'+(stClr[s.status]||'#fff')+'22;">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'+
      '<div><div style="font-size:1.2rem;font-weight:800;">'+s.number+'</div><div style="font-size:0.77rem;color:var(--text-muted);">'+s.floor+'</div></div>'+
      '<span class="badge '+stCls[s.status]+'">'+stText[s.status]+'</span></div>'+
      (s.rent?'<div style="font-size:0.85rem;font-weight:700;color:var(--accent);margin-bottom:4px;">৳'+s.rent.toLocaleString()+'/মাস</div>':'')+
      (s.size?'<div style="font-size:0.77rem;color:var(--text-muted);margin-bottom:4px;">'+s.size+' বর্গফুট</div>':'')+
      (tn?'<div style="font-size:0.8rem;padding:5px 8px;background:rgba(22,163,74,0.1);border-radius:6px;margin-bottom:8px;"><i class="fas fa-user" style="color:var(--accent);margin-right:4px;"></i>'+tn.name+'</div>':'')+
      '<div style="display:flex;gap:4px;margin-top:8px;">'+
      '<button onclick="openShopModal(\''+s.id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-edit"></i></button>'+
      '<button onclick="deleteShop(\''+s.id+'\')" class="btn btn-danger btn-sm"><i class="fas fa-trash"></i></button>'+
      '</div></div>';
  }).join('') || '<div style="grid-column:span 3;text-align:center;padding:40px;color:var(--text-muted);">কোনো দোকান নেই।</div>';
}

// ============================================================
// PAYMENT / RENT COLLECTION
// ============================================================
function openRentModal() {
  ['rShop','rMonthlyRent','rPaid','rDue','rCollector','rNotes'].forEach(f=>{ const el=document.getElementById(f); if(el) el.value=''; });
  populateRentTenantSelect();
  document.getElementById('rDate').value = isoLocal(new Date());
  const _nt = document.getElementById('rNoteType'); if (_nt) { _nt.value = 'none'; _nt.dataset.manual = ''; }
  document.getElementById('rNotes').style.display = 'none';
  renderCollectorPicker();
  toggleCollectorMenu(false);
  openModal('rentModal');
}

function quickRent(tenantId) {
  showPage('rentCollection');
  setTimeout(()=>{ openRentModal(); setTimeout(()=>{ document.getElementById('rTenant').value=tenantId; fillRentInfo(); },150); },100);
}

function populateRentTenantSelect() {
  tenants = DB.get('tenants');
  const sel = document.getElementById('rTenant');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- ভাড়াটিয়া নির্বাচন করুন --</option>';
  tenants.filter(t=>!t.archived).forEach(t => { const o=document.createElement('option'); o.value=t.id; o.textContent=t.name+' - '+t.shop; sel.appendChild(o); });
}

function fillRentInfo() {
  const tid = document.getElementById('rTenant').value;
  const tn  = tenants.find(x=>x.id===tid);
  if (!tn) return;
  document.getElementById('rShop').value        = tn.shop;
  document.getElementById('rMonthlyRent').value = tn.rent;
  calcDue();
}


// ============================================================
// COLLECTOR (সংগ্রহকারী) DROPDOWN — one or many
// ============================================================
function getCollectorList() {
  const raw = settings.collectors;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return String(raw || '').split('\n').map(x => x.trim()).filter(Boolean);
}
function renderCollectorPicker() {
  const list = getCollectorList();
  let last = [];
  try { last = JSON.parse(localStorage.getItem('lastCollectors') || '[]'); } catch(e) {}
  const box = document.getElementById('collectorList');
  if (!box) return;
  if (!list.length) {
    box.innerHTML = '<div style="padding:10px;font-size:.78rem;color:var(--text-muted);">তালিকা খালি। সেটিংস থেকে নাম যোগ করুন, অথবা নিচে লিখুন।</div>';
  } else {
    box.innerHTML = list.map((n, i) =>
      '<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;font-size:.85rem;">'+
      '<input type="checkbox" class="collCheck" value="'+n.replace(/"/g,'&quot;')+'" '+(last.includes(n)?'checked':'')+' onchange="syncCollector()"> <span>'+n+'</span></label>'
    ).join('');
  }
  const other = document.getElementById('collectorOther'); if (other) other.value = '';
  syncCollector();
}
function syncCollector() {
  const names = [...document.querySelectorAll('.collCheck:checked')].map(c => c.value);
  const other = (document.getElementById('collectorOther') || {}).value || '';
  if (other.trim()) names.push(other.trim());
  document.getElementById('rCollector').value = names.join(', ');
  const lbl = document.getElementById('collectorLabel');
  if (lbl) lbl.textContent = names.length ? names.join(', ') : '-- সংগ্রহকারী নির্বাচন করুন --';
  try { localStorage.setItem('lastCollectors', JSON.stringify([...document.querySelectorAll('.collCheck:checked')].map(c => c.value))); } catch(e) {}
}
function toggleCollectorMenu(force) {
  const m = document.getElementById('collectorMenu');
  if (!m) return;
  m.style.display = (force === false || m.style.display === 'block') ? 'none' : 'block';
}
document.addEventListener('click', e => {
  const w = document.getElementById('collectorWrap');
  if (w && !w.contains(e.target)) toggleCollectorMenu(false);
});

// ============================================================
// মন্তব্য (NOTE) DROPDOWN
// ============================================================
function noteTextFor(type) {
  const rent = parseFloat(document.getElementById('rMonthlyRent').value) || 0;
  const paid = parseFloat(document.getElementById('rPaid').value) || 0;
  const due  = Math.max(0, rent - paid);
  const bn = n => '৳' + Number(n).toLocaleString('en-IN');
  if (type === 'thanks')  return 'সময়মতো ভাড়া দেওয়ার জন্য আপনাকে ধন্যবাদ।';
  if (type === 'full_due') return 'সম্পূর্ণ বাকি';
  if (type === 'partial')  return 'আংশিক বাকি — দিয়েছেন ' + bn(paid) + ', বাকি ' + bn(due);
  return null;
}
function onNoteTypeChange() {
  const type = document.getElementById('rNoteType').value;
  const ta = document.getElementById('rNotes');
  if (type === 'custom') { ta.style.display = 'block'; ta.focus(); return; }
  if (type === 'none')   { ta.value = ''; ta.style.display = 'none'; return; }
  ta.value = noteTextFor(type);
  ta.style.display = 'block';
}
function autoNoteType() {            // payment er poriman onujayi auto select
  const sel = document.getElementById('rNoteType');
  if (!sel || sel.dataset.manual === '1') return;
  const rent = parseFloat(document.getElementById('rMonthlyRent').value) || 0;
  const paid = parseFloat(document.getElementById('rPaid').value) || 0;
  if (!rent) return;
  sel.value = paid <= 0 ? 'full_due' : (paid >= rent ? 'thanks' : 'partial');
  onNoteTypeChange();
}

function calcDue() {
  const rent = parseFloat(document.getElementById('rMonthlyRent').value)||0;
  const paid = parseFloat(document.getElementById('rPaid').value)||0;
  document.getElementById('rDue').value = Math.max(0, rent-paid);
  autoNoteType();
}

async function savePayment() {
  const tenantId = document.getElementById('rTenant').value;
  const paid     = parseFloat(document.getElementById('rPaid').value);
  const month    = document.getElementById('rMonth').value;
  if (!tenantId||isNaN(paid)) { showToast('অনুগ্রহ করে প্রয়োজনীয় তথ্য পূরণ করুন','error'); return; }
  const tn   = tenants.find(t=>t.id===tenantId);
  const rent = parseFloat(document.getElementById('rMonthlyRent').value)||(tn?tn.rent:0);
  const due  = Math.max(0, rent-paid);
  const status = paid>=rent?'paid':paid>0?'partial':'due';

  // Per-tenant serial (independent numbering)
  const tenantPays   = payments.filter(p=>p.tenantId===tenantId);
  const tenantSerial = tenantPays.length + 1;
  const globalSerial = payments.length + 1;
  const tenantSlipNo = String(tenantSerial).padStart(3,'0');

  // Update tenant slipCounter
  const tIdx = tenants.findIndex(x=>x.id===tenantId);
  if (tIdx>=0) { tenants[tIdx].slipCounter=tenantSerial; FDB.save('tenants', tenantId, {slipCounter:tenantSerial}); }

  const payment = {
    id: 'P'+Date.now(),
    tenantId, tenantName: tn?tn.name:'',
    shop:   document.getElementById('rShop').value,
    month,  year: new Date().getFullYear(),
    date:   document.getElementById('rDate').value,
    rent, paid, due, status,
    collector:    document.getElementById('rCollector').value,
    notes:        document.getElementById('rNotes').value,
    slipNo:       globalSerial,
    tenantSerial: tenantSerial,
    tenantSlipNo: tenantSlipNo,
    _createdAt:   new Date().toISOString()
  };

  showSyncOverlay(true,'রসিদ সংরক্ষণ হচ্ছে...');
  await FDB.save('payments', payment.id, payment);
  // Save to tenant subcollection
  await FDB.saveSlip(tenantId, {
    ...payment,
    slipNo: tenantSlipNo,
    _createdAt: new Date().toISOString()
  });
  payments = await FDB.getAll('payments');
  addActivity('ভাড়া সংগ্রহ: '+(tn?tn.name:'')+' - ৳'+paid.toLocaleString(),'money-bill-wave','#16a34a');
  showSyncOverlay(false);
  closeModal('rentModal');
  buildMonthFilters(); renderPayments(); updateNotifications();
  showToast('ভাড়া রসিদ তৈরি হয়েছে ☁️');
  setTimeout(()=>viewSlip(payment.id), 400);
}

function renderPayments() {
  payments = DB.get('payments');
  const monthF  = document.getElementById('rcMonthFilter')?.value||'';
  const statusF = document.getElementById('rcStatusFilter')?.value||'';
  let list = payments.filter(p=>(!monthF||(p.month+' '+p.year)===monthF)&&(!statusF||p.status===statusF)).reverse();
  const tbody = document.getElementById('paymentTableBody');
  if (!tbody) return;
  tbody.innerHTML = list.map(p =>
    '<tr>'+
    '<td><span style="font-weight:700;color:var(--accent);">#'+p.slipNo+'</span>'+
    (p.tenantSlipNo?'<br><span style="font-size:0.72rem;color:var(--text-muted);">'+p.tenantSlipNo+'</span>':'')+'</td>'+
    '<td><div style="font-weight:600;">'+p.tenantName+'</div></td>'+
    '<td>'+p.shop+'</td>'+
    '<td>'+p.month+' '+(p.year||'')+'</td>'+
    '<td>৳'+(p.rent||0).toLocaleString()+'</td>'+
    '<td style="color:#16a34a;font-weight:600;">৳'+(p.paid||0).toLocaleString()+'</td>'+
    '<td style="color:'+(p.due>0?'#dc2626':'#16a34a')+';font-weight:600;">৳'+(p.due||0).toLocaleString()+'</td>'+
    '<td><span class="badge '+(p.status==='paid'?'badge-green':p.status==='partial'?'badge-yellow':'badge-red')+'">'+(p.status==='paid'?'পরিশোধিত':p.status==='partial'?'আংশিক':'বাকি')+'</span></td>'+
    '<td><div style="display:flex;gap:3px;">'+
    '<button onclick="viewSlip(\''+p.id+'\')" class="btn btn-primary btn-sm"><i class="fas fa-receipt"></i></button>'+
    '<button onclick="openScanLog(\''+p.id+'\')" class="btn btn-gray btn-sm" title="QR স্ক্যান রেকর্ড"><i class="fas fa-qrcode"></i></button>'+
    '<button onclick="deletePayment(\''+p.id+'\')" class="btn btn-danger btn-sm"><i class="fas fa-trash"></i></button>'+
    '</div></td></tr>'
  ).join('') || '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted);">কোনো পেমেন্ট নেই</td></tr>';
}

async function deletePayment(id) {
  if (!confirm('এই রসিদ মুছে ফেলতে চান?')) return;
  const _p = payments.find(x=>x.id===id);
  if (_p && _p.verifyToken && FIREBASE_READY) { try { await db_fire.collection('receipts').doc(_p.verifyToken).delete(); } catch(e) { console.warn(e); } }
  await FDB.delete('payments', id);
  payments = await FDB.getAll('payments');
  renderPayments(); showToast('রসিদ মুছে ফেলা হয়েছে','error');
}

// ============================================================
// SLIP GENERATION — Enhanced with QR + Bengali Font + Both Copies
// ============================================================
// ── Receipt verification (QR -> verify.html) ─────────────────
function getVerifyBase() {
  const custom = (settings.mktVerifyUrl || '').trim();
  if (custom) return custom;
  try { return new URL('verify.html', location.href).href.split('?')[0]; } catch(e) { return 'verify.html'; }
}
function makeVerifyToken() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return Array.from(a, n => abc[n % abc.length]).join('');
}
function verifyUrlFor(token) { return getVerifyBase() + '?r=' + encodeURIComponent(token); }

// receipts/{token} : public-safe copy of the receipt (verify.html reads this)
async function ensureReceipt(p) {
  if (!p.verifyToken) {
    p.verifyToken = makeVerifyToken();
    try { await FDB.save('payments', p.id, { verifyToken: p.verifyToken }); } catch(e) {}
  }
  if (FIREBASE_READY && !p._receiptSynced) {
    const rec = {
      token: p.verifyToken, paymentId: p.id,
      mktName: settings.mktName || '', mktAddress: settings.mktAddress || '', mktPhone: settings.mktPhone || '',
      tenantName: p.tenantName || '', shop: p.shop || '',
      month: p.month || '', year: p.year || '', date: p.date || '',
      rent: p.rent || 0, paid: p.paid || 0, due: p.due || 0, status: p.status || 'due',
      slipNo: p.tenantSlipNo || String(p.slipNo || ''), createdAt: new Date().toISOString()
    };
    try {
      await Promise.race([
        db_fire.collection('receipts').doc(p.verifyToken).set(rec),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
      ]);
      p._receiptSynced = true;
    } catch(e) { console.warn('Receipt publish failed:', e); }
  }
  return p.verifyToken;
}

function generateQRDataUrl(text) {
  return new Promise(resolve => {
    try {
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
      document.body.appendChild(container);
      new QRCode(container, {
        text, width: 120, height: 120,
        colorDark: '#14532d', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      setTimeout(() => {
        const canvas = container.querySelector('canvas');
        const img    = container.querySelector('img');
        const src = canvas ? canvas.toDataURL('image/png') : (img?img.src:'');
        document.body.removeChild(container);
        resolve(src);
      }, 200);
    } catch(e) { resolve(''); }
  });
}

async function buildQrHtml(p) {
  if (typeof QRCode === 'undefined') return '';
  const token = await ensureReceipt(p);
  const src = await generateQRDataUrl(verifyUrlFor(token));
  if (!src) return '';
  return '<div class="qr-container" style="display:flex;flex-direction:column;align-items:center;">'+
    '<img src="'+src+'" width="84" height="84" alt="QR" style="display:block;border:2px solid #86efac;border-radius:6px;padding:3px;background:#fff;">'+
    '<div style="font-size:0.7rem;color:#14532d;font-weight:600;margin-top:4px;line-height:1.3;white-space:nowrap;">QR স্ক্যান করে যাচাই করুন</div>'+
    '</div>';
}

async function viewSlip(paymentId) {
  const p = payments.find(x=>x.id===paymentId);
  if (!p) return;
  currentSlipPayment = p;
  showSyncOverlay(true, 'রসিদ প্রস্তুত হচ্ছে...');
  let qrHtml = '';
  try { qrHtml = await buildQrHtml(p); } catch(e) { console.warn(e); }
  showSyncOverlay(false);

  const slipHTML =
    '<div class="slip-container" id="printSlipArea" style="max-width:720px;margin:0 auto;">'+
    generateSlipCopy(p, settings, 'owner', qrHtml)+
    '<div style="border-top:2px dashed #16a34a;padding:8px 0;text-align:center;font-size:.72rem;color:#6b7280;letter-spacing:0.05em;">✂ ─────── কাটুন / Cut Here ─────── ✂</div>'+
    generateSlipCopy(p, settings, 'tenant', qrHtml)+
    '<div style="text-align:center;margin-top:12px;font-size:0.72rem;color:#6b7280;">📌 বিঃদ্রঃ ভাড়া গৃহে কোন প্রকার অবৈধ কার্যকলাপ চলিবে না।</div>'+
    '</div>';
  document.getElementById('slipContent').innerHTML = slipHTML;
  openModal('slipModal');
}

function generateSlipCopy(p, s, copyType, qrHtml) {
  const isOwner = copyType === 'owner';
  const label   = isOwner ? 'মালিকের কপি' : 'ভাড়াটিয়ার কপি';
  const borderTop = isOwner ? '4px solid #14532d' : '4px solid #16a34a';
  const bannerCls = isOwner ? 'owner-banner' : 'tenant-banner';
  const ownerSig  = ownerSignature
    ? '<img src="'+ownerSignature+'" style="height:36px;object-fit:contain;display:block;margin-bottom:4px;">'
    : '<div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin-bottom:4px;"></div>';
  const dueHtml = p.due>0
    ? '<span style="margin-left:auto;">বাকি ঃ</span><span class="slip-field" style="color:#dc2626;font-weight:700;">৳'+(p.due||0).toLocaleString()+'</span><span>টাকা</span>'
    : '<span style="margin-left:auto;color:#16a34a;font-weight:700;font-size:0.9rem;">✓ পূর্ণ পরিশোধিত</span>';

  return '<div class="slip-copy" style="margin-bottom:16px;border-top:'+borderTop+';">'+
    '<div class="copy-label-banner '+bannerCls+'">'+label+' / '+(isOwner?'Owner Copy':'Tenant Copy')+'</div>'+
    '<div class="slip-decorative" style="margin-bottom:10px;"></div>'+
    // Header
    '<div style="text-align:center;margin-bottom:10px;">'+
    '<div style="font-size:0.75rem;color:#166534;margin-bottom:4px;">بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ</div>'+
    '<div class="slip-title-bn">'+( s.mktName||'হাজী চাঁন মিয়া মার্কেট')+'</div>'+
    '<div class="slip-sub-bn">'+( s.mktAddress||'')+'</div>'+
    '<div class="slip-sub-bn">ফোন : '+(s.mktPhone||'')+'</div>'+
    '<div class="slip-sub-bn">'+(s.mktHolding||'')+'</div>'+
    '<div class="slip-sub-bn">মালিক : '+(s.mktOwner||'')+'</div></div>'+
    // Slip Number + Date
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">'+
    '<div style="font-size:0.78rem;color:#166534;">নং-</div>'+
    '<div style="font-size:2rem;font-weight:900;color:#14532d;font-family:\'Noto Serif Bengali\',serif;line-height:1;">'+(p.tenantSlipNo||p.slipNo)+'</div>'+
    '<div class="slip-stamp">ভাড়া রশিদ</div>'+
    '<div style="margin-left:auto;font-size:0.78rem;color:#166534;">তারিখ: <span class="slip-field">'+formatBnDate(p.date)+'</span></div></div>'+
    '<div class="slip-decorative" style="margin-bottom:10px;height:4px;"></div>'+
    // Fields
    '<div style="font-size:0.85rem;color:#14532d;line-height:2.2;font-family:\'Noto Sans Bengali\',sans-serif;">'+
    '<div style="display:flex;align-items:baseline;gap:6px;"><span style="white-space:nowrap;min-width:180px;">অস্থায়ী ভাড়াটিয়ার নাম :</span><span class="slip-field" style="flex:1;font-weight:700;font-size:0.95rem;">'+p.tenantName+'</span></div>'+
    '<div style="display:flex;align-items:baseline;gap:6px;"><span style="white-space:nowrap;min-width:180px;">দোকান নং :</span><span class="slip-field" style="font-weight:700;">'+p.shop+'</span></div>'+
    '<div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;"><span style="white-space:nowrap;min-width:180px;">মাসের নাম :</span><span class="slip-field" style="font-weight:700;">'+p.month+' '+(p.year||'')+'</span><span style="white-space:nowrap;margin-left:auto;">মাসিক ভাড়া :</span><span class="slip-field" style="font-weight:700;">৳'+(p.rent||0).toLocaleString()+'</span><span>টাকা</span></div>'+
    '<div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;"><span style="min-width:80px;">পরিশোধিত :</span><span class="slip-field" style="font-weight:800;font-size:1.05rem;color:#14532d;">৳'+(p.paid||0).toLocaleString()+'</span><span>টাকা</span>'+dueHtml+'</div>'+
    (p.collector?'<div><span>সংগ্রহকারী : </span><span class="slip-field">'+p.collector+'</span></div>':'')+
    (p.notes?'<div style="font-size:0.78rem;color:#4b5563;">মন্তব্য : <span class="slip-note">'+p.notes+'</span></div>':'')+
    '</div>'+
    // Signatures + QR (QR centre, between the two signatures)
    '<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:8px;margin-top:16px;padding-top:10px;border-top:1px dashed #86efac;">'+
    '<div style="text-align:left;font-size:0.78rem;color:#14532d;"><div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin-bottom:4px;"></div><div>ভাড়াটিয়ার স্বাক্ষর</div></div>'+
    '<div style="text-align:center;">'+(qrHtml||'')+'</div>'+
    '<div style="text-align:right;font-size:0.78rem;color:#14532d;display:flex;flex-direction:column;align-items:flex-end;">'+ownerSig+'<div>জমিদারের স্বাক্ষর</div></div></div>'+
    '<div class="slip-decorative" style="margin-top:10px;"></div>'+
    '</div>';
}

function formatBnDate(dateStr) {
  return fmtDate(dateStr) || '...........';
}

// ── PRINT ───────────────────────────────────────────────────
const SLIP_PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700;800&family=Noto+Serif+Bengali:wght@400;600;700;800&display=swap');
  body { font-family:'Noto Sans Bengali','Noto Serif Bengali',serif; margin:8mm; background:#fff; color:#14532d; }
  .slip-container { max-width:720px; margin:0 auto; }
  .slip-copy { border:2px solid #16a34a; border-radius:6px; padding:16px; position:relative; margin-bottom:14px; background:#fff; }
  .slip-copy::before { content:''; position:absolute; inset:5px; border:1px solid #86efac; border-radius:3px; pointer-events:none; }
  .slip-title-bn { font-size:1.6rem; font-weight:800; color:#14532d; line-height:1.2; }
  .slip-sub-bn { font-size:0.8rem; color:#166534; line-height:1.5; }
  .slip-field { border-bottom:1.5px dashed #16a34a; min-width:70px; display:inline-block; padding:0 4px; }
  .slip-stamp { background:#16a34a; color:#fff; padding:3px 14px; border-radius:4px; font-size:1rem; font-weight:700; display:inline-block; border:2px solid #14532d; }
  .slip-decorative { border:1px solid #86efac; height:7px; border-radius:2px; background:repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(22,163,74,0.05) 4px,rgba(22,163,74,0.05) 8px); }
  .copy-label-banner { text-align:center; font-size:0.72rem; font-weight:700; letter-spacing:0.1em; padding:3px; margin-bottom:8px; border-radius:4px 4px 0 0; }
  .owner-banner { background:#14532d; color:#fff; }
  .tenant-banner { background:#16a34a; color:#fff; }
  .qr-container { display:flex; flex-direction:column; align-items:center; }
  @media print { @page { margin:8mm; } .slip-copy { page-break-inside:avoid; } }
`;

function printSlip() {
  const content = document.getElementById('printSlipArea').innerHTML;
  const win = window.open('','_blank','width=920,height=700');
  win.document.write(`<!DOCTYPE html><html><head><title>ভাড়া রশিদ</title><style>${SLIP_PRINT_CSS}</style></head><body>${content}</body></html>`);
  win.document.close(); win.focus();
  setTimeout(()=>win.print(), 800);
}

function downloadSlipPDF() { printSlip(); showToast('প্রিন্ট ডায়ালগ থেকে "PDF সংরক্ষণ" নির্বাচন করুন'); }

async function downloadSlipJPG(part) {
  const el = document.getElementById('printSlipArea');
  if (!el||typeof html2canvas==='undefined') { showToast('রসিদ পাওয়া যায়নি','error'); return; }
  showToast('ছবি তৈরি হচ্ছে...');
  try {
    const canvas = await slipCanvas(el);
    const url = canvas.toDataURL('image/jpeg', 0.95);
    const a = document.createElement('a');
    a.download = 'rent_slip_'+(currentSlipPayment?currentSlipPayment.tenantSlipNo||currentSlipPayment.slipNo:Date.now())+'.jpg';
    a.href = url; a.click();
    showToast('JPG ডাউনলোড হচ্ছে ✅');
  } catch(e) { showToast('JPG তৈরিতে সমস্যা','error'); }
}

async function downloadSlipPNG() {
  const el = document.getElementById('printSlipArea');
  if (!el||typeof html2canvas==='undefined') return;
  showToast('PNG তৈরি হচ্ছে...');
  try {
    const canvas = await slipCanvas(el);
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.download = 'rent_slip_'+(currentSlipPayment?currentSlipPayment.tenantSlipNo||currentSlipPayment.slipNo:Date.now())+'.png';
    a.href = url; a.click();
    showToast('PNG ডাউনলোড হচ্ছে ✅');
  } catch(e) { showToast('PNG তৈরিতে সমস্যা','error'); }
}

// ── WhatsApp Share — Tenant Copy Only (Auto Crop) ───────────
async function shareSlipWhatsApp() {
  const el = document.getElementById('printSlipArea');
  if (!el||typeof html2canvas==='undefined') { sendWhatsApp(); return; }
  showToast('ভাড়াটিয়ার কপি তৈরি হচ্ছে...');
  try {
    // Find tenant copy element
    const copies = el.querySelectorAll('.slip-copy');
    const tenantCopy = copies.length > 1 ? copies[copies.length-1] : el;
    const canvas = await slipCanvas(tenantCopy);
    const blob = await new Promise(r => canvas.toBlob(r,'image/jpeg',0.95));
    if (navigator.share && navigator.canShare && navigator.canShare({files:[new File([blob],'slip.jpg',{type:'image/jpeg'})]})) {
      await navigator.share({ files:[new File([blob],'rent_slip.jpg',{type:'image/jpeg'})], title:'ভাড়া রশিদ — '+settings.mktName });
    } else {
      // Download + open WA
      const url = canvas.toDataURL('image/jpeg',0.95);
      const link=document.createElement('a'); link.href=url; link.download='tenant_slip.jpg'; link.click();
      showToast('ছবি ডাউনলোড করে WhatsApp-এ শেয়ার করুন');
      if (currentSlipPayment) {
        const tn = tenants.find(t=>t.id===currentSlipPayment.tenantId);
        if (tn?.mobile) setTimeout(()=>window.open('https://wa.me/88'+tn.mobile.replace(/[^0-9]/g,''),'_blank'),1200);
      }
    }
  } catch(e) { sendWhatsApp(); }
}


// html2canvas kono kono phone e shobdo er majher space bad dey (Rokon Mia -> RokonMia).
// Tai image banar somoy proti ta shobdo alada box e rekhe majhe fanka dewa hoy.
function slipCanvas(el) {
  return html2canvas(el, {
    scale: 2, backgroundColor: '#fff', useCORS: true, logging: false,
    onclone: (doc) => {
      doc.querySelectorAll('.slip-field, .slip-note').forEach(node => {
        const text = node.textContent;
        if (!/\s/.test(text.trim())) return;
        node.textContent = '';
        text.trim().split(/\s+/).forEach((w, i, arr) => {
          const sp = doc.createElement('span');
          sp.textContent = w;
          sp.style.cssText = 'display:inline-block;white-space:pre;' + (i < arr.length - 1 ? 'margin-right:0.32em;' : '');
          node.appendChild(sp);
        });
      });
    }
  });
}

function sendWhatsApp() {
  if (!currentSlipPayment) return;
  const p = currentSlipPayment;
  const tn = tenants.find(x=>x.id===p.tenantId);
  if (!tn?.mobile) { showToast('ভাড়াটিয়ার মোবাইল নম্বর নেই','error'); return; }
  const msg = encodeURIComponent('📋 *ভাড়া রশিদ - '+settings.mktName+'*\n\nরসিদ নং: '+p.tenantSlipNo+'\nনাম: '+p.tenantName+'\nদোকান: '+p.shop+'\nমাস: '+p.month+' '+p.year+'\nভাড়া: ৳'+p.rent+'\nপরিশোধিত: ৳'+p.paid+'\nবাকি: ৳'+p.due+'\nতারিখ: '+fmtDate(p.date)+'\n\nধন্যবাদ।');
  window.open('https://wa.me/88'+tn.mobile.replace(/[^0-9]/g,'')+'?text='+msg,'_blank');
}

// ── Monthly Bundle Print ─────────────────────────────────────

// ── QR scan record (কয়জন / কতবার স্ক্যান করেছে) ───────────────
async function openScanLog(paymentId) {
  const p = payments.find(x => x.id === paymentId);
  if (!p) return;
  const box = document.getElementById('scanLogContent');
  document.getElementById('scanLogTitle').textContent = 'QR স্ক্যান রেকর্ড — #' + (p.tenantSlipNo || p.slipNo) + ' • ' + p.tenantName;
  box.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);">লোড হচ্ছে...</p>';
  openModal('scanLogModal');
  if (!p.verifyToken) { box.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);">এই রসিদের QR এখনো তৈরি হয়নি। আগে রসিদটি একবার খুলুন।</p>'; return; }
  if (!FIREBASE_READY) { box.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);">অনলাইন সংযোগ নেই।</p>'; return; }
  try {
    const snap = await db_fire.collection('receipts').doc(p.verifyToken).collection('scans').orderBy('at', 'desc').limit(300).get();
    const scans = snap.docs.map(d => d.data()).filter(x => x.at);
    const devices = new Set(scans.map(x => x.deviceId));
    const bn = n => String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
    const stat = (n, label, color) => '<div style="flex:1;text-align:center;padding:14px 8px;border-radius:12px;background:var(--bg-primary);border:1px solid var(--border);">'+
      '<div style="font-size:1.7rem;font-weight:800;color:'+color+';">'+bn(n)+'</div><div style="font-size:.74rem;color:var(--text-muted);">'+label+'</div></div>';
    let html = '<div style="display:flex;gap:10px;margin-bottom:14px;">'+stat(scans.length,'মোট স্ক্যান','#16a34a')+stat(devices.size,'আলাদা ব্যক্তি/ডিভাইস','#2563eb')+'</div>';
    if (!scans.length) {
      html += '<p style="text-align:center;padding:18px;color:var(--text-muted);">এখনো কেউ এই QR স্ক্যান করেনি।</p>';
    } else {
      const first = scans[scans.length - 1].at.toDate(), last = scans[0].at.toDate();
      html += '<div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px;">প্রথম স্ক্যান: <b>'+fmtDateTime(first)+'</b> • সর্বশেষ: <b>'+fmtDateTime(last)+'</b></div>';
      const ids = [...devices]; 
      html += '<div style="max-height:46vh;overflow:auto;border:1px solid var(--border);border-radius:10px;">'+
        scans.map((x, i) => '<div style="display:flex;justify-content:space-between;gap:8px;padding:9px 12px;font-size:.82rem;'+(i?'border-top:1px solid var(--border);':'')+'">'+
          '<span><i class="fas fa-mobile-alt" style="color:var(--accent);margin-right:6px;"></i>'+(x.ua||'-')+' <span style="color:var(--text-muted);font-size:.72rem;">(ডিভাইস '+bn(ids.indexOf(x.deviceId)+1)+')</span></span>'+
          '<span style="color:var(--text-muted);white-space:nowrap;">'+fmtDateTime(x.at.toDate())+'</span></div>').join('')+'</div>';
    }
    box.innerHTML = html;
  } catch (e) {
    console.error(e);
    box.innerHTML = '<p style="text-align:center;padding:24px;color:#dc2626;">লোড করা যায়নি: '+(e.code==='permission-denied'?'অনুমতি নেই। Firestore Rules এ scans এর নিয়ম যোগ করুন।':(e.message||e))+'</p>';
  }
}

async function printAllMonthReceipts() {
  const monthF = document.getElementById('rcMonthFilter')?.value||'';
  const list   = payments.filter(p=>!monthF||(p.month+' '+p.year)===monthF);
  if (!list.length) { showToast('প্রিন্ট করার মতো কোনো রসিদ নেই','warning'); return; }
  showToast(list.length+'টি রসিদ প্রিন্ট হচ্ছে...');
  let allHtml = '';
  showSyncOverlay(true, 'QR সহ রসিদ প্রস্তুত হচ্ছে...');
  for (const p of list) {
    let qr = '';
    try { qr = await buildQrHtml(p); } catch(e) { console.warn(e); }
    allHtml += '<div style="page-break-after:always;">'+
      generateSlipCopy(p,settings,'owner',qr)+
      '<div style="text-align:center;padding:4px;font-size:.7rem;color:#aaa;">✂ কাটুন</div>'+
      generateSlipCopy(p,settings,'tenant',qr)+'</div>';
  }
  showSyncOverlay(false);
  const win=window.open('','_blank','width=920,height=700');
  win.document.write('<!DOCTYPE html><html><head><title>মাসিক রসিদ</title><style>'+SLIP_PRINT_CSS+'</style></head><body>'+
    allHtml+
    '<scr'+'ipt>window.onload=function(){setTimeout(function(){window.print();},800);}</scr'+'ipt></body></html>');
  win.document.close();
}

function generateMonthlyBundle() {
  printAllMonthReceipts();
  showToast('মাসিক বান্ডেল তৈরি হচ্ছে...');
}

// ============================================================
// PAYMENT HISTORY
// ============================================================
function buildMonthFilters() {
  payments = DB.get('payments');
  const months = [...new Set(payments.map(p=>p.month+' '+p.year))].sort();
  ['rcMonthFilter','histMonthFilter'].forEach(id => {
    const sel=document.getElementById(id); if(!sel) return;
    const cur=sel.value; sel.innerHTML='<option value="">সব মাস</option>';
    months.forEach(m=>sel.innerHTML+='<option'+(m===cur?' selected':'')+'>'+m+'</option>');
  });
  const ht = document.getElementById('histTenantFilter');
  if (ht) {
    ht.innerHTML='<option value="">সব ভাড়াটিয়া</option>';
    tenants.filter(t=>!t.archived).forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; ht.appendChild(o); });
  }
  const cy = document.getElementById('chartYear');
  if (cy) {
    const years=[...new Set(payments.map(p=>p.year))].filter(Boolean).sort().reverse();
    const curY=new Date().getFullYear();
    if (!years.includes(curY)) years.unshift(curY);
    const cv=cy.value||curY;
    cy.innerHTML=years.map(y=>'<option'+(y==cv?' selected':'')+'>'+y+'</option>').join('');
  }
}

function renderHistory() {
  payments = DB.get('payments');
  const tf = document.getElementById('histTenantFilter')?.value||'';
  const mf = document.getElementById('histMonthFilter')?.value||'';
  let list = payments.filter(p=>(!tf||p.tenantId===tf)&&(!mf||(p.month+' '+p.year)===mf)).reverse();
  const totalPaid = list.reduce((a,b)=>a+(b.paid||0),0);
  const totalDue  = list.reduce((a,b)=>a+(b.due||0),0);
  const container = document.getElementById('historyContainer');
  if (!container) return;
  container.innerHTML =
    '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">'+
    '<div class="stat-card" style="padding:12px 18px;flex:1;min-width:120px;"><div style="font-size:0.78rem;color:var(--text-muted);">মোট রসিদ</div><div style="font-size:1.3rem;font-weight:700;color:var(--accent);">'+list.length+'টি</div></div>'+
    '<div class="stat-card" style="padding:12px 18px;flex:1;min-width:120px;"><div style="font-size:0.78rem;color:var(--text-muted);">মোট সংগ্রহ</div><div style="font-size:1.3rem;font-weight:700;color:#16a34a;">৳'+totalPaid.toLocaleString()+'</div></div>'+
    '<div class="stat-card" style="padding:12px 18px;flex:1;min-width:120px;"><div style="font-size:0.78rem;color:var(--text-muted);">মোট বাকি</div><div style="font-size:1.3rem;font-weight:700;color:#dc2626;">৳'+totalDue.toLocaleString()+'</div></div></div>'+
    '<div class="stat-card" style="padding:0;overflow:hidden;"><div style="overflow-x:auto;"><table class="data-table"><thead><tr>'+
    '<th>রসিদ নং</th><th>তারিখ</th><th>ভাড়াটিয়া</th><th>দোকান</th><th>মাস</th><th>ভাড়া</th><th>পরিশোধিত</th><th>বাকি</th><th>অবস্থা</th><th></th>'+
    '</tr></thead><tbody>'+
    list.map(p=>
      '<tr><td><b style="color:var(--accent);">#'+p.slipNo+'</b>'+(p.tenantSlipNo?'<br><span style="font-size:.7rem;color:var(--text-muted);">'+p.tenantSlipNo+'</span>':'')+'</td>'+
      '<td style="font-size:.8rem;">'+fmtDate(p.date)+'</td>'+
      '<td>'+p.tenantName+'</td><td>'+p.shop+'</td>'+
      '<td>'+p.month+' '+(p.year||'')+'</td>'+
      '<td>৳'+(p.rent||0).toLocaleString()+'</td>'+
      '<td style="color:#16a34a;font-weight:600;">৳'+(p.paid||0).toLocaleString()+'</td>'+
      '<td style="color:'+(p.due>0?'#dc2626':'#16a34a')+';font-weight:600;">৳'+(p.due||0).toLocaleString()+'</td>'+
      '<td><span class="badge '+(p.status==='paid'?'badge-green':p.status==='partial'?'badge-yellow':'badge-red')+'">'+(p.status==='paid'?'পরিশোধিত':p.status==='partial'?'আংশিক':'বাকি')+'</span></td>'+
      '<td><button onclick="viewSlip(\''+p.id+'\')" class="btn btn-primary btn-sm"><i class="fas fa-eye"></i></button></td></tr>'
    ).join('')||'<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">কোনো রেকর্ড নেই</td></tr>'+
    '</tbody></table></div></div>';
}

function exportPaymentHistory() {
  const data = JSON.stringify({payments,tenants,date:new Date().toISOString()},null,2);
  downloadFile('payment_history_'+isoLocal(new Date())+'.json', data, 'application/json');
  showToast('পেমেন্ট ইতিহাস ডাউনলোড হচ্ছে...');
}

// ============================================================
// AGREEMENTS
// ============================================================
function renderAgreements() {
  tenants = DB.get('tenants');
  const active = tenants.filter(t=>!t.archived);
  const grid = document.getElementById('agreementGrid');
  if (!grid) return;
  const sorted = [...active].sort((a,b)=>{
    const da=getAgreementStatus(a).days, db2=getAgreementStatus(b).days;
    if(da===null)return 1; if(db2===null)return -1; return da-db2;
  });
  grid.innerHTML = sorted.map(tn => {
    const st = getAgreementStatus(tn);
    const pct = tn.startDate&&tn.endDate ? (() => {
      const tot=new Date(tn.endDate)-new Date(tn.startDate);
      const el2=new Date()-new Date(tn.startDate);
      return Math.min(100,Math.max(0,Math.round(el2/tot*100)));
    })() : 0;
    const bc = st.cls==='badge-red'?'#dc2626':st.cls==='badge-yellow'?'#d97706':'#16a34a';
    const leaveTag = tn.leaveRequest ? '<span class="badge badge-yellow" style="margin-left:4px;font-size:0.68rem;"><i class="fas fa-door-open"></i> ছাড়ার আবেদন</span>' : '';

    return '<div class="stat-card agreement-card" style="border-left-color:'+bc+';">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:4px;">'+
      '<div><div style="font-weight:700;font-size:0.95rem;">'+tn.name+'</div>'+
      '<div style="font-size:0.78rem;color:var(--text-muted);">'+tn.shop+' • '+tn.floor+'</div></div>'+
      '<div style="display:flex;gap:4px;flex-wrap:wrap;"><span class="badge '+st.cls+'">'+st.label+'</span>'+leaveTag+'</div></div>'+
      '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">শুরু: '+(fmtDate(tn.startDate)||'-')+' → শেষ: '+(fmtDate(tn.endDate)||'-')+(validityLabel(tn.startDate,tn.endDate)?' <span class="badge badge-gray" style="margin-left:4px;">মেয়াদ: '+validityLabel(tn.startDate,tn.endDate)+'</span>':'')+'</div>'+
      '<div style="background:var(--border);border-radius:4px;height:5px;margin-bottom:6px;overflow:hidden;"><div style="height:100%;background:'+bc+';width:'+pct+'%;border-radius:4px;transition:width 0.5s;"></div></div>'+
      (st.days!==null&&st.days>=0?'<div style="font-size:0.75rem;color:var(--text-muted);">'+pct+'% সম্পন্ন • '+st.days+' দিন অবশিষ্ট</div>':'')+
      '<div style="display:flex;gap:5px;margin-top:10px;flex-wrap:wrap;">'+
      '<button onclick="openTenantModal(\''+tn.id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-sync"></i> নবায়ন</button>'+
      '<button onclick="openLeaveRequest(\''+tn.id+'\')" class="btn btn-warning btn-sm"><i class="fas fa-door-open"></i> ছাড়ার আবেদন</button>'+
      '<button onclick="openAgreementUpload(\''+tn.id+'\')" class="btn btn-ghost btn-sm"><i class="fas fa-upload"></i> আপলোড</button>'+
      '<button onclick="openAgreementView(\''+tn.id+'\')" class="btn btn-primary btn-sm"><i class="fas fa-file-pdf"></i> চুক্তি দেখুন</button>'+
      '<a href="https://wa.me/88'+(tn.mobile||'').replace(/[^0-9]/g,'')+'" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;"><i class="fab fa-whatsapp"></i></a>'+
      '</div></div>';
  }).join('') || '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">কোনো সক্রিয় চুক্তি নেই।</div>';
}

function showAgreementTab(tab) {
  ['active','leave','archived'].forEach(t2 => {
    const cap=t2.charAt(0).toUpperCase()+t2.slice(1);
    const el=document.getElementById('agreementTab'+cap), btn=document.getElementById('agTab'+cap);
    if(el) el.style.display=t2===tab?'block':'none';
    if(btn){ btn.className=t2===tab?'tab-btn active':'tab-btn'; }
  });
  if(tab==='leave')    renderLeaveRequests();
  if(tab==='archived') renderArchivedTenants();
  if(tab==='active')   renderAgreements();
}

// ── Leave Request ─────────────────────────────────────────────
function openLeaveRequest(tenantId) {
  const tn = tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  document.getElementById('leaveRequestTenantId').value = tenantId;
  const today=isoLocal(new Date());
  document.getElementById('leaveReqDate').value = today;
  const exit=new Date(); exit.setMonth(exit.getMonth()+3);
  document.getElementById('leaveExitDate').value = isoLocal(exit);
  document.getElementById('leaveReason').value = '';
  calcNoticedays();

  // Advance refund calc
  const deduction=tn.monthlyDeduction||tn.deduction||0;
  const monthsElapsed=tn.startDate?Math.floor((new Date()-new Date(tn.startDate))/(1000*60*60*24*30)):0;
  const deducted=Math.min(monthsElapsed*deduction, tn.advance||0);
  const refund=Math.max(0,(tn.advance||0)-deducted);
  if ((tn.advance||0) > 0) {
    document.getElementById('leaveAdvanceCalc').style.display='block';
    document.getElementById('leaveCalcTotal').textContent    = '৳'+(tn.advance||0).toLocaleString();
    document.getElementById('leaveCalcDeducted').textContent = '৳'+deducted.toLocaleString();
    document.getElementById('leaveCalcRefund').textContent   = '৳'+refund.toLocaleString();
  }
  openModal('leaveRequestModal');
}

function calcNoticedays() {
  const r=document.getElementById('leaveReqDate')?.value, x=document.getElementById('leaveExitDate')?.value;
  const el=document.getElementById('leaveNoticeDays');
  if (!r||!x||!el) return;
  const days=Math.ceil((new Date(x)-new Date(r))/86400000);
  el.style.display='block';
  if (days>=90) { el.style.background='#dcfce7'; el.style.color='#166534'; el.innerHTML='<i class="fas fa-check-circle"></i> নোটিশ সময়: '+days+' দিন (৩ মাসের শর্ত পূরণ ✅)'; }
  else          { el.style.background='#fee2e2'; el.style.color='#991b1b'; el.innerHTML='<i class="fas fa-exclamation-circle"></i> নোটিশ সময়: '+days+' দিন (৯০ দিন প্রয়োজন ❌)'; }
}

async function saveLeaveRequest() {
  const tenantId=document.getElementById('leaveRequestTenantId').value;
  const reqDate=document.getElementById('leaveReqDate').value;
  const exitDate=document.getElementById('leaveExitDate').value;
  const reason=document.getElementById('leaveReason').value;
  const days=Math.ceil((new Date(exitDate)-new Date(reqDate))/86400000);
  if (days<90) { showToast('কমপক্ষে ৩ মাস আগে নোটিশ দিতে হবে','error'); return; }
  const tn=tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  const req={id:'LR'+Date.now(), tenantId, tenantName:tn.name, shop:tn.shop, reqDate, exitDate, reason, days, status:'pending', createdAt:new Date().toISOString()};
  await FDB.save('leaveRequests', req.id, req);
  tn.leaveRequest=req;
  await FDB.save('tenants', tenantId, {leaveRequest:req});
  tenants = await FDB.getAll('tenants');
  closeModal('leaveRequestModal');
  addActivity(tn.name+'-এর ছাড়ার আবেদন জমা হয়েছে','door-open','#d97706');
  showToast('ছাড়ার আবেদন সংরক্ষণ হয়েছে ✅');
  // WhatsApp agreement notification
  if (tn.mobile) {
    const msg=encodeURIComponent('📋 *ছেড়ে দেওয়ার আবেদন নিশ্চিতকরণ*\n\nনাম: '+tn.name+'\nদোকান: '+tn.shop+'\nআবেদন তারিখ: '+fmtDate(reqDate)+'\nপ্রস্থান তারিখ: '+fmtDate(exitDate)+'\nনোটিশ সময়: '+days+' দিন\n\nধন্যবাদ।');
    setTimeout(()=>window.open('https://wa.me/88'+tn.mobile.replace(/[^0-9]/g,'')+'?text='+msg,'_blank'),500);
  }
  renderAgreements();
}

async function renderLeaveRequests() {
  let reqs=[];
  if (FIREBASE_READY) {
    try { const snap=await db_fire.collection('leaveRequests').get(); reqs=snap.docs.map(d=>({id:d.id,...d.data()})); } catch(e) {}
  }
  const el=document.getElementById('leaveRequestList'); if(!el) return;
  if (!reqs.length) { el.innerHTML='<p style="color:var(--text-muted);font-size:.83rem;text-align:center;padding:20px;">কোনো ছাড়ার আবেদন নেই</p>'; return; }
  el.innerHTML=reqs.map(r => {
    const daysLeft=Math.ceil((new Date(r.exitDate)-new Date())/86400000);
    const statusCls=r.status==='approved'?'badge-green':r.status==='completed'?'badge-gray':'badge-yellow';
    const statusLabel=r.status==='approved'?'অনুমোদিত':r.status==='completed'?'সম্পন্ন':'অপেক্ষমাণ';
    return '<div style="padding:14px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:4px;">'+
      '<div><div style="font-weight:700;font-size:.9rem;">'+r.tenantName+'</div><div style="font-size:.75rem;color:var(--text-muted);">'+r.shop+' • আবেদন: '+fmtDate(r.reqDate)+'</div></div>'+
      '<div style="display:flex;gap:4px;"><span class="badge '+(daysLeft>0?'badge-yellow':'badge-red')+'">'+(daysLeft>0?daysLeft+' দিন বাকি':'মেয়াদ শেষ')+'</span>'+
      '<span class="badge '+statusCls+'">'+statusLabel+'</span></div></div>'+
      '<div style="font-size:.82rem;margin-bottom:10px;">প্রস্থান: <strong>'+fmtDate(r.exitDate)+'</strong>'+(r.reason?' — '+r.reason:'')+'</div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
      '<button onclick="approveLeaveRequest(\''+r.id+'\',\'approved\')" class="btn btn-success btn-sm"><i class="fas fa-check"></i> অনুমোদন</button>'+
      '<button onclick="archiveTenant(\''+r.tenantId+'\')" class="btn btn-danger btn-sm"><i class="fas fa-archive"></i> আর্কাইভ করুন</button>'+
      '</div></div>';
  }).join('');
}

async function approveLeaveRequest(reqId, status) {
  await FDB.save('leaveRequests', reqId, {status});
  showToast('আবেদনের অবস্থা আপডেট হয়েছে ✅');
  renderLeaveRequests();
}

async function archiveTenant(tenantId) {
  if (!confirm('এই ভাড়াটিয়াকে আর্কাইভ করবেন? তিনি সক্রিয় তালিকা থেকে সরে যাবেন কিন্তু সব ডেটা সংরক্ষিত থাকবে।')) return;
  const tn=tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  // Archive: set archived=true, keep ALL data (DO NOT DELETE)
  const archivedData = {...tn, archived:true, archivedAt:new Date().toISOString()};
  await FDB.save('tenants', tenantId, archivedData);
  await FDB.save('archivedTenants', tenantId, archivedData);
  tenants = await FDB.getAll('tenants');
  addActivity(tn.name+' আর্কাইভ হয়েছেন','archive','#6b7280');
  showToast(tn.name+' আর্কাইভ হয়েছেন (সব ডেটা সংরক্ষিত)');
  renderAgreements();
}

async function renderArchivedTenants() {
  let list=[];
  try {
    if (FIREBASE_READY) {
      const snap=await db_fire.collection('archivedTenants').get();
      list=snap.docs.map(d=>({id:d.id,...d.data()}));
    } else { list=JSON.parse(localStorage.getItem('archivedTenants')||'[]'); }
  } catch(e) { list=JSON.parse(localStorage.getItem('archivedTenants')||'[]'); }
  const el=document.getElementById('archivedTenantList'); if(!el) return;
  if (!list.length) { el.innerHTML='<p style="color:var(--text-muted);font-size:.83rem;text-align:center;padding:20px;">কোনো আর্কাইভ নেই</p>'; return; }
  el.innerHTML='<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>নাম</th><th>দোকান</th><th>মাসিক ভাড়া</th><th>অগ্রিম</th><th>আর্কাইভ তারিখ</th><th>কার্যক্রম</th></tr></thead><tbody>'+
    list.map(t=>'<tr><td><div style="font-weight:600;">'+t.name+'</div><div style="font-size:.75rem;color:var(--text-muted);">'+t.mobile+'</div></td>'+
      '<td>'+t.shop+'</td>'+
      '<td>৳'+(t.rent||0).toLocaleString()+'</td>'+
      '<td>৳'+(t.advance||0).toLocaleString()+'</td>'+
      '<td style="font-size:.78rem;">'+fmtDate(t.archivedAt)+'</td>'+
      '<td><button onclick="viewArchivedTenant(\''+t.id+'\')" class="btn btn-gray btn-sm"><i class="fas fa-eye"></i> দেখুন</button></td></tr>'
    ).join('')+'</tbody></table></div>';
}

function viewArchivedTenant(id) {
  const list = JSON.parse(localStorage.getItem('archivedTenants')||'[]');
  const tn = list.find(x=>x.id===id);
  if (!tn) return;
  alert(JSON.stringify({name:tn.name,shop:tn.shop,rent:tn.rent,advance:tn.advance,nid:tn.nid,mobile:tn.mobile,archivedAt:fmtDate(tn.archivedAt)},null,2));
}

// ── Agreement Upload ─────────────────────────────────────────

// ── চুক্তির মেয়াদ (validity) ─────────────────────────────────
function validityLabel(start, end) {
  if (!start || !end) return '';
  const a = new Date(start), b = new Date(end);
  if (isNaN(a) || isNaN(b) || b < a) return '';
  const days = Math.round((b - a) / 86400000) + 1;      // shesh din soho
  const m = Math.round(days / 30.4375);
  const bn = n => String(n).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  if (days < 30 || m < 1) return bn(days) + ' দিন';
  const y = Math.floor(m / 12), r = m % 12;
  const parts = [];
  if (y) parts.push(bn(y) + ' বছর');
  if (r) parts.push(bn(r) + ' মাস');
  return parts.join(' ');
}
function agRecalcEnd() {
  const sel = document.getElementById('agValidity');
  if (!sel || sel.value === 'custom') return;
  const start = document.getElementById('agStartDate').value;
  if (!start) return;
  const months = parseInt(sel.value, 10);
  const d = new Date(start + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);                            // 01/01/2026 + 1 bochor = 31/12/2026
  document.getElementById('agEndDate').value = isoLocal(d);
}

function openAgreementUpload(tenantId) {
  const tn=tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  document.getElementById('agUploadTenantId').value   = tenantId;
  document.getElementById('agUploadTenantName').value = tn.name+' — '+tn.shop;
  document.getElementById('agUploadNote').value       = '';
  const _agf=document.getElementById('agFile'); if(_agf) _agf.value='';
  document.getElementById('agFilePreview').innerHTML  = '<i class="fas fa-file-pdf" style="color:#dc2626;font-size:2rem;display:block;margin-bottom:8px;"></i><span style="font-size:.82rem;color:var(--text-muted);">ক্লিক করে PDF/ছবি বেছে নিন</span>';
  const now=new Date(); document.getElementById('agStartDate').value=isoLocal(now);
  const _v=document.getElementById('agValidity'); if(_v) _v.value='12';
  agRecalcEnd();
  openModal('agreementUploadModal');
}

function previewAgreementFile(input) {
  const file=input.files[0]; if(!file) return;
  const p=document.getElementById('agFilePreview');
  if (file.type==='application/pdf') { p.innerHTML='<i class="fas fa-file-pdf" style="color:#dc2626;font-size:2rem;display:block;margin-bottom:4px;"></i><span style="font-size:.85rem;font-weight:600;">'+file.name+'</span>'; }
  else { const r=new FileReader(); r.onload=e=>{p.innerHTML='<img src="'+e.target.result+'" style="max-height:100px;border-radius:6px;">';}; r.readAsDataURL(file); }
}

// ── Agreement files: stored as base64 chunks in Firestore (no Storage / no card needed)
const AG_CHUNK = 700000;           // chars per Firestore chunk doc (< 1MB limit)
const AG_MAX_BYTES = 3 * 1024 * 1024; // 3MB max PDF

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('ফাইল পড়া যায়নি'));
    r.readAsDataURL(file);
  });
}

async function saveAgreementUpload() {
  const tenantId  = document.getElementById('agUploadTenantId').value;
  const type      = document.getElementById('agUploadType').value;
  const note      = document.getElementById('agUploadNote').value;
  const startDate = document.getElementById('agStartDate').value;
  const endDate   = document.getElementById('agEndDate').value;
  const file      = document.getElementById('agFile').files[0];
  const tn        = tenants.find(x => x.id === tenantId);
  if (!tn || !file) { showToast('ফাইল নির্বাচন করুন', 'error'); return; }

  const isPdf = file.type === 'application/pdf';
  if (isPdf && file.size > AG_MAX_BYTES) { showToast('PDF ৩MB এর বেশি বড়। ছোট করে আবার দিন', 'error'); return; }

  showSyncOverlay(true, 'চুক্তিপত্র সংরক্ষণ হচ্ছে...');
  try {
    // 1) file -> data URL (images are compressed)
    let dataUrl;
    if (isPdf) dataUrl = await fileToDataUrl(file);
    else       dataUrl = await compressImage(file, 1200, 1600, 0.6);

    const agId = 'AG' + Date.now();
    const chunks = [];
    for (let i = 0; i < dataUrl.length; i += AG_CHUNK) chunks.push(dataUrl.slice(i, i + AG_CHUNK));

    const agRecord = {
      id: agId, tenantId, tenantName: tn.name, type, note,
      fileName: file.name, fileType: isPdf ? 'application/pdf' : 'image/jpeg',
      size: file.size, chunks: chunks.length,
      startDate, endDate, validity: validityLabel(startDate, endDate), uploadedAt: new Date().toISOString()
    };

    // 2) save file data
    if (FIREBASE_READY) {
      const batch = db_fire.batch();
      chunks.forEach((c, i) => {
        batch.set(db_fire.collection('agreements').doc(agId).collection('chunks').doc(String(i).padStart(3, '0')), { i, data: c });
      });
      await batch.commit();
    } else {
      lsSet('agfile_' + agId, dataUrl);
    }

    // 3) save metadata (small)
    const agKey = 'agHistory_' + tenantId;
    const hist = JSON.parse(localStorage.getItem(agKey) || '[]');
    hist.push(agRecord);
    lsSet(agKey, JSON.stringify(hist));
    await FDB.save('agreements', agId, agRecord);

    // 4) renewal -> update tenant dates
    if (type === 'renewal' && startDate && endDate) {
      await FDB.save('tenants', tenantId, { startDate, endDate, renewedAt: new Date().toISOString() });
      tenants = await FDB.getAll('tenants');
    }

    closeModal('agreementUploadModal');
    addActivity('চুক্তিপত্র আপলোড: ' + tn.name, 'file-contract', '#16a34a');
    showToast('চুক্তিপত্র সংরক্ষণ হয়েছে ✅');
    renderAgreements();
  } catch (e) {
    console.error('Agreement upload failed:', e);
    showToast('আপলোড ব্যর্থ: ' + (e.message || e), 'error');
  } finally {
    showSyncOverlay(false);
  }
}

async function getAgreementList(tenantId) {
  let list = [];
  if (FIREBASE_READY) {
    try {
      const snap = await db_fire.collection('agreements').where('tenantId', '==', tenantId).get();
      list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(e); }
  }
  if (!list.length) list = JSON.parse(localStorage.getItem('agHistory_' + tenantId) || '[]');
  return list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

async function openAgreementView(tenantId) {
  const tn = tenants.find(x => x.id === tenantId);
  if (!tn) return;
  const box = document.getElementById('agreementViewContent');
  box.innerHTML = '<p style="text-align:center;padding:20px;color:var(--text-muted);">লোড হচ্ছে...</p>';
  document.getElementById('agreementViewTitle').textContent = tn.name + ' — চুক্তিপত্র';
  openModal('agreementViewModal');
  const list = await getAgreementList(tenantId);
  if (!list.length) { box.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);">কোনো চুক্তিপত্র আপলোড করা হয়নি</p>'; return; }
  box.innerHTML = list.map(a =>
    '<div style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;">'+
    '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">'+
    '<div><div style="font-weight:600;font-size:.88rem;"><i class="fas fa-'+(a.fileType==='application/pdf'?'file-pdf':'image')+'" style="color:'+(a.fileType==='application/pdf'?'#dc2626':'#2563eb')+';margin-right:6px;"></i>'+(a.fileName||'চুক্তি')+'</div>'+
    '<div style="font-size:.74rem;color:var(--text-muted);">'+(a.type==='renewal'?'নবায়ন':'নতুন')+' • '+(fmtDate(a.startDate)||'-')+' → '+(fmtDate(a.endDate)||'-')+(validityLabel(a.startDate,a.endDate)?' • মেয়াদ: <b>'+validityLabel(a.startDate,a.endDate)+'</b>':'')+'</div>'+
    (a.note?'<div style="font-size:.74rem;color:var(--text-muted);">'+a.note+'</div>':'')+'</div>'+
    '<div style="display:flex;gap:6px;">'+
    '<button onclick="viewAgreementFile(\''+a.id+'\','+(a.chunks||1)+',\''+(a.fileType||'')+'\')" class="btn btn-primary btn-sm"><i class="fas fa-eye"></i> দেখুন</button>'+
    '<button onclick="deleteAgreement(\''+a.id+'\',\''+tenantId+'\','+(a.chunks||1)+')" class="btn btn-danger btn-sm" title="মুছুন"><i class="fas fa-trash"></i></button>'+
    '<button onclick="downloadAgreementFile(\''+a.id+'\','+(a.chunks||1)+',\''+encodeURIComponent(a.fileName||'agreement')+'\')" class="btn btn-outline btn-sm"><i class="fas fa-download"></i></button>'+
    '</div></div></div>'
  ).join('') + '<div id="agreementPreviewArea" style="margin-top:8px;"></div>';
}


async function deleteAgreement(agId, tenantId, chunkCount) {
  if (!confirm('এই চুক্তিপত্রটি স্থায়ীভাবে মুছে ফেলতে চান?')) return;
  showSyncOverlay(true, 'চুক্তিপত্র মুছে ফেলা হচ্ছে...');
  try {
    if (FIREBASE_READY) {
      const ref = db_fire.collection('agreements').doc(agId);
      const snap = await ref.collection('chunks').get();
      const batch = db_fire.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await FDB.delete('agreements', agId);
    const key = 'agHistory_' + tenantId;
    const hist = JSON.parse(localStorage.getItem(key) || '[]').filter(x => x.id !== agId);
    lsSet(key, JSON.stringify(hist));
    try { localStorage.removeItem('agfile_' + agId); } catch(e) {}
    addActivity('চুক্তিপত্র মুছে ফেলা হয়েছে', 'trash', '#dc2626');
    showToast('চুক্তিপত্র মুছে ফেলা হয়েছে', 'error');
    await openAgreementView(tenantId);
  } catch (e) {
    console.error('Agreement delete failed:', e);
    showToast('মুছতে সমস্যা: ' + (e.message || e), 'error');
  } finally {
    showSyncOverlay(false);
  }
}

async function loadAgreementDataUrl(agId, chunkCount) {
  if (FIREBASE_READY) {
    const snap = await db_fire.collection('agreements').doc(agId).collection('chunks').orderBy('i').get();
    if (!snap.empty) return snap.docs.map(d => d.data().data).join('');
  }
  return localStorage.getItem('agfile_' + agId) || '';
}

async function viewAgreementFile(agId, chunkCount, fileType) {
  const area = document.getElementById('agreementPreviewArea');
  area.innerHTML = '<p style="text-align:center;padding:16px;color:var(--text-muted);">ফাইল লোড হচ্ছে...</p>';
  try {
    const dataUrl = await loadAgreementDataUrl(agId, chunkCount);
    if (!dataUrl) { area.innerHTML = '<p style="color:#dc2626;text-align:center;">ফাইল পাওয়া যায়নি</p>'; return; }
    if (fileType === 'application/pdf') {
      const blob = await (await fetch(dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      area.innerHTML = '<iframe src="'+url+'" style="width:100%;height:70vh;border:1px solid var(--border);border-radius:8px;"></iframe>'+
        '<div style="text-align:center;margin-top:6px;"><a href="'+url+'" target="_blank" class="btn btn-gray btn-sm"><i class="fas fa-external-link-alt"></i> নতুন ট্যাবে খুলুন</a></div>';
    } else {
      area.innerHTML = '<img src="'+dataUrl+'" style="max-width:100%;border:1px solid var(--border);border-radius:8px;">';
    }
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    area.innerHTML = '<p style="color:#dc2626;text-align:center;">লোড ব্যর্থ: '+(e.message||e)+'</p>';
  }
}

async function downloadAgreementFile(agId, chunkCount, encName) {
  try {
    const dataUrl = await loadAgreementDataUrl(agId, chunkCount);
    if (!dataUrl) { showToast('ফাইল পাওয়া যায়নি', 'error'); return; }
    const a = document.createElement('a');
    a.href = dataUrl; a.download = decodeURIComponent(encName); a.click();
  } catch (e) { showToast('ডাউনলোড ব্যর্থ', 'error'); }
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  tenants=DB.get('tenants'); shops=DB.get('shops');
  payments=DB.get('payments'); activities=DB.get('activities');
  const activeTenants = tenants.filter(t=>!t.archived);
  const thisMonths = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'][new Date().getMonth()];
  const mpays    = payments.filter(p=>p.month===thisMonths&&p.year===new Date().getFullYear());
  const collected = mpays.reduce((a,b)=>a+(b.paid||0),0);
  const totalDue  = payments.reduce((a,b)=>a+(b.due||0),0);
  const expiring  = activeTenants.filter(t=>{ const s=getAgreementStatus(t); return s.days!==null&&s.days>=0&&s.days<=30; }).length;
  const occupied  = shops.filter(s=>s.status==='occupied').length;
  const stats=[
    {label:t('totalTenants'),  value:activeTenants.length,         icon:'fa-users',             bg:'#dcfce7',iconBg:'#16a34a'},
    {label:t('totalShops'),    value:shops.length,                  icon:'fa-store-alt',          bg:'#dbeafe',iconBg:'#2563eb'},
    {label:t('monthlyCollection'),value:'৳'+collected.toLocaleString(),icon:'fa-money-bill-wave',bg:'#d1fae5',iconBg:'#059669'},
    {label:t('pendingRent'),   value:'৳'+totalDue.toLocaleString(), icon:'fa-exclamation-circle',bg:'#fee2e2',iconBg:'#dc2626'},
    {label:t('expiringContracts'),value:expiring+'টি',              icon:'fa-calendar-times',    bg:'#fef9c3',iconBg:'#d97706'},
    {label:t('occupiedShops'), value:occupied+'/'+shops.length,     icon:'fa-door-open',          bg:'#ede9fe',iconBg:'#7c3aed'},
  ];
  document.getElementById('statCards').innerHTML = stats.map(s=>
    '<div class="stat-card fade-in"><div class="icon" style="background:'+s.bg+';"><i class="fas '+s.icon+'" style="color:'+s.iconBg+';"></i></div>'+
    '<div class="value">'+s.value+'</div><div class="label">'+s.label+'</div></div>'
  ).join('');

  // Expiry widget
  const expList = activeTenants.filter(tn=>{const s=getAgreementStatus(tn);return s.days!==null&&s.days<=30;})
    .sort((a,b)=>getAgreementStatus(a).days-getAgreementStatus(b).days).slice(0,6);
  document.getElementById('expiryWidget').innerHTML = expList.map(tn=>{
    const st=getAgreementStatus(tn);
    return '<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">'+
      '<div><div style="font-weight:600;font-size:0.85rem;">'+tn.name+'</div><div style="font-size:0.75rem;color:var(--text-muted);">'+tn.shop+'</div></div>'+
      '<span class="badge '+st.cls+'">'+st.label+'</span></div>';
  }).join('') || '<p style="color:var(--text-muted);font-size:0.83rem;text-align:center;padding:20px;">মেয়াদ শেষ হওয়ার মতো কোনো চুক্তি নেই</p>';

  // Activity
  document.getElementById('activityTimeline').innerHTML = activities.slice(0,8).map(a=>
    '<div class="timeline-item"><div class="timeline-dot" style="background:'+a.color+'22;color:'+a.color+';"><i class="fas fa-'+(a.icon||'circle')+'"></i></div>'+
    '<div style="flex:1;"><div style="font-size:0.83rem;">'+a.text+'</div><div style="font-size:0.74rem;color:var(--text-muted);">'+fmtDateTime(a.time)+'</div></div></div>'
  ).join('') || '<p style="color:var(--text-muted);font-size:0.83rem;">কোনো কার্যক্রম নেই</p>';

  buildMonthFilters(); updateDashChart(); renderShopPieChart();
}

function updateDashChart() {
  const year = parseInt(document.getElementById('chartYear')?.value||new Date().getFullYear());
  const months=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  const coll = months.map(m=>payments.filter(p=>p.month===m&&p.year===year).reduce((a,b)=>a+(b.paid||0),0));
  const dues = months.map(m=>payments.filter(p=>p.month===m&&p.year===year).reduce((a,b)=>a+(b.due||0),0));
  const c=document.getElementById('dashChart'); if(!c) return;
  if (dashChartInst) dashChartInst.destroy();
  const dk=document.documentElement.getAttribute('data-theme')==='dark';
  dashChartInst=new Chart(c,{type:'bar',data:{labels:months.map(m=>m.slice(0,3)),datasets:[
    {label:'সংগৃহীত',data:coll,backgroundColor:'rgba(22,163,74,0.8)',borderRadius:6},
    {label:'বকেয়া',  data:dues,backgroundColor:'rgba(220,38,38,0.7)',borderRadius:6}
  ]},options:{responsive:true,maintainAspectRatio:true,
    plugins:{legend:{labels:{color:dk?'#86efac':'#166534',font:{family:'Noto Sans Bengali'}}}},
    scales:{x:{ticks:{color:dk?'#9ca3af':'#6b7280'}},y:{ticks:{color:dk?'#9ca3af':'#6b7280',callback:v=>'৳'+v.toLocaleString()}}}}});
}

function renderShopPieChart() {
  const occ=shops.filter(s=>s.status==='occupied').length;
  const emp=shops.filter(s=>s.status==='empty').length;
  const mnt=shops.filter(s=>s.status==='maintenance').length;
  const c=document.getElementById('shopPieChart'); if(!c) return;
  if (shopPieInst) shopPieInst.destroy();
  shopPieInst=new Chart(c,{type:'doughnut',data:{labels:['ভাড়া','খালি','রক্ষণাবেক্ষণ'],datasets:[{data:[occ,emp,mnt],backgroundColor:['#16a34a','#2563eb','#d97706'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false}}}});
  document.getElementById('shopPieLegend').innerHTML='<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font-size:0.78rem;">'+
    '<span><span style="color:#16a34a;">■</span> ভাড়া ('+occ+')</span>'+
    '<span><span style="color:#2563eb;">■</span> খালি ('+emp+')</span>'+
    '<span><span style="color:#d97706;">■</span> রক্ষণাবেক্ষণ ('+mnt+')</span></div>';
}

// ============================================================
// REPORTS
// ============================================================
function renderReports() {
  const months=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  const year=new Date().getFullYear();
  const dk=document.documentElement.getAttribute('data-theme')==='dark';
  const tc=dk?'#86efac':'#166534', mc=dk?'#9ca3af':'#6b7280';
  const bOpts=()=>({responsive:true,maintainAspectRatio:true,plugins:{legend:{labels:{color:tc,font:{family:'Noto Sans Bengali'}}}},scales:{x:{ticks:{color:mc}},y:{ticks:{color:mc,callback:v=>'৳'+v.toLocaleString()}}}});
  const c1=document.getElementById('incomeChart');
  if(c1){if(incomeChartInst)incomeChartInst.destroy();incomeChartInst=new Chart(c1,{type:'line',data:{labels:months.map(m=>m.slice(0,3)),datasets:[{label:'সংগৃহীত',data:months.map(m=>payments.filter(p=>p.month===m&&p.year===year).reduce((a,b)=>a+(b.paid||0),0)),borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,0.1)',fill:true,tension:0.4}]},options:bOpts()});}
  const c2=document.getElementById('dueChart');
  if(c2){if(dueChartInst)dueChartInst.destroy();dueChartInst=new Chart(c2,{type:'bar',data:{labels:months.map(m=>m.slice(0,3)),datasets:[{label:'বকেয়া',data:months.map(m=>payments.filter(p=>p.month===m&&p.year===year).reduce((a,b)=>a+(b.due||0),0)),backgroundColor:'rgba(220,38,38,0.7)',borderRadius:6}]},options:bOpts()});}
  const occ=shops.filter(s=>s.status==='occupied').length,emp=shops.filter(s=>s.status==='empty').length,mnt=shops.filter(s=>s.status==='maintenance').length;
  const c3=document.getElementById('occupancyChart');
  if(c3){if(occupancyChartInst)occupancyChartInst.destroy();occupancyChartInst=new Chart(c3,{type:'pie',data:{labels:['ভাড়া','খালি','রক্ষণাবেক্ষণ'],datasets:[{data:[occ,emp,mnt],backgroundColor:['#16a34a','#2563eb','#d97706'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{labels:{color:tc,font:{family:'Noto Sans Bengali'}}}}}});}
  const active=tenants.filter(t=>{const s=getAgreementStatus(t);return!t.archived&&s.days!==null&&s.days>30;}).length;
  const expiring=tenants.filter(t=>{const s=getAgreementStatus(t);return!t.archived&&s.days!==null&&s.days>=0&&s.days<=30;}).length;
  const expired=tenants.filter(t=>{const s=getAgreementStatus(t);return!t.archived&&s.days!==null&&s.days<0;}).length;
  const c4=document.getElementById('agreementChart');
  if(c4){if(agreementChartInst)agreementChartInst.destroy();agreementChartInst=new Chart(c4,{type:'doughnut',data:{labels:['সক্রিয়','মেয়াদ শেষ হচ্ছে','মেয়াদ উত্তীর্ণ'],datasets:[{data:[active,expiring,expired],backgroundColor:['#16a34a','#d97706','#dc2626'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{labels:{color:tc,font:{family:'Noto Sans Bengali'}}}}}});}
}

// ============================================================
// NOTIFICATIONS
// ============================================================

// ── QR scan live notification (কেউ রসিদ স্ক্যান করলে admin কে জানানো) ──
let _scanEvents = [], _scanFirstLoad = true;
function _scanSeenAt() { try { return parseInt(localStorage.getItem('scanSeenAt') || '0', 10); } catch (e) { return 0; } }
function scanEventMs(e) { return e && e.at && e.at.toMillis ? e.at.toMillis() : 0; }
function scanEventText(e) {
  return (e.tenantName || 'অজানা') + (e.shop ? ' (' + e.shop + ')' : '') + ' এর রসিদ' + (e.month ? ' — ' + e.month + ' ' + (e.year || '') : '') + ' স্ক্যান করা হয়েছে';
}
function scanBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination);
    o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 180);
  } catch (e) {}
}
function enableDeviceNotifications() {
  if (!('Notification' in window)) { showToast('এই ব্রাউজারে নোটিফিকেশন সাপোর্ট নেই', 'warning'); return; }
  Notification.requestPermission().then(r => { showToast(r === 'granted' ? 'ডিভাইস নোটিফিকেশন চালু হয়েছে ✅' : 'অনুমতি দেওয়া হয়নি', r === 'granted' ? 'success' : 'warning'); updateNotifications(); });
}
function startScanWatcher() {
  if (!FIREBASE_READY) return;
  _scanFirstLoad = true; _scanEvents = [];
  const u = db_fire.collection('scanEvents').orderBy('at', 'desc').limit(30).onSnapshot(snap => {
    if (_scanFirstLoad) {
      _scanEvents = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => scanEventMs(e));
      _scanFirstLoad = false;
    } else {
      snap.docChanges().forEach(ch => {
        if (ch.type !== 'added') return;
        const e = { id: ch.doc.id, ...ch.doc.data() };
        if (!scanEventMs(e) || _scanEvents.some(x => x.id === e.id)) return;
        _scanEvents.unshift(e);
        showToast('🔔 ' + scanEventText(e));
        scanBeep();
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('রসিদ স্ক্যান', { body: scanEventText(e), icon: 'assets/logo.png' }); } catch (er) {}
      });
      _scanEvents = _scanEvents.slice(0, 30);
    }
    updateNotifications();
  }, err => console.warn('scanEvents:', err && err.code));
  _realtimeUnsubs.push(u);
}

function updateNotifications() {
  tenants=DB.get('tenants'); payments=DB.get('payments');
  const notifs=[];
  tenants.filter(t=>!t.archived).forEach(tn=>{
    const st=getAgreementStatus(tn);
    if (st.days!==null&&st.days<0)      notifs.push({type:'danger', text:tn.name+'-এর চুক্তির মেয়াদ উত্তীর্ণ',icon:'calendar-times'});
    else if (st.days!==null&&st.days<=30) notifs.push({type:'warning',text:tn.name+'-এর চুক্তি '+st.days+' দিনে শেষ',icon:'exclamation-triangle'});
  });
  const thisM=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'][new Date().getMonth()];
  const paid=new Set(payments.filter(p=>p.month===thisM&&p.year===new Date().getFullYear()).map(p=>p.tenantId));
  tenants.filter(t=>!t.archived).forEach(tn=>{ if(!paid.has(tn.id)) notifs.push({type:'info',text:tn.name+' এই মাসের ভাড়া দেননি',icon:'money-bill-wave'}); });
  const seenAt = _scanSeenAt();
  const scanN = (_scanEvents || []).slice(0, 8).map(e => ({ type: 'scan', unread: scanEventMs(e) > seenAt, text: '🔔 ' + scanEventText(e), sub: fmtDateTime(new Date(scanEventMs(e))) + (e.ua ? ' • ' + e.ua : ''), icon: 'qrcode' }));
  const newScans = scanN.filter(n => n.unread).length;
  const b=document.getElementById('notifBadge'); if(b) b.style.display=(notifs.length||newScans)?'block':'none';
  const clrs={danger:'#dc2626',warning:'#d97706',info:'#2563eb',scan:'#16a34a'};
  const notifHtml = n => '<div class="notification-item'+(n.unread===false?'':' unread')+'"><div style="display:flex;align-items:center;gap:8px;">'+
    '<i class="fas fa-'+n.icon+'" style="color:'+clrs[n.type]+';font-size:0.8rem;"></i>'+
    '<span style="font-size:0.82rem;">'+n.text+(n.sub?'<br><span style="font-size:.7rem;color:var(--text-muted);">'+n.sub+'</span>':'')+'</span></div></div>';
  const devBtn = ('Notification' in window && Notification.permission === 'default')
    ? '<div style="padding:8px 12px;border-bottom:1px solid var(--border);"><button class="btn btn-outline btn-sm" style="width:100%;justify-content:center;" onclick="enableDeviceNotifications()"><i class="fas fa-bell"></i> ডিভাইস নোটিফিকেশন চালু করুন</button></div>' : '';
  document.getElementById('notifList').innerHTML=devBtn+scanN.concat(notifs).slice(0,14).map(notifHtml).join('')||'<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.83rem;">কোনো নোটিফিকেশন নেই</div>';
}

function toggleNotifPanel() {
  const p=document.getElementById('notifPanel');
  const opening = p.style.display!=='block';
  p.style.display=opening?'block':'none';
  if (!opening) { try { localStorage.setItem('scanSeenAt', String(Date.now())); } catch(e) {} updateNotifications(); }
}
document.addEventListener('click', e => {
  if (!e.target.closest('[onclick="toggleNotifPanel()"]')&&!e.target.closest('#notifPanel')) {
    const p=document.getElementById('notifPanel'); if(p) p.style.display='none';
  }
});

// ============================================================
// SEARCH
// ============================================================
function globalSearchFn(q) {
  if (!q) return;
  const ql=q.toLowerCase();
  const found=tenants.filter(t=>!t.archived&&(t.name.toLowerCase().includes(ql)||t.mobile.includes(ql)||t.shop.toLowerCase().includes(ql)));
  if (found.length) { showPage('tenants'); const ts=document.getElementById('tenantSearch'); if(ts){ts.value=q;renderTenants();} }
}

// ============================================================
// BACKUP / RESTORE
// ============================================================
async function exportBackup() {
  showToast('ব্যাকআপ তৈরি হচ্ছে...');
  const [t,s,p] = FIREBASE_READY
    ? await Promise.all([FDB.getAll('tenants'),FDB.getAll('shops'),FDB.getAll('payments')])
    : [DB.get('tenants'),DB.get('shops'),DB.get('payments')];
  const backup={tenants:t,shops:s,payments:p,settings:await FDB.getSettings()||DB.getObj('settings',{}),version:'2.0',exportedAt:new Date().toISOString()};
  downloadFile('hcm_backup_v2_'+isoLocal(new Date())+'.json', JSON.stringify(backup,null,2),'application/json');
  showToast('ব্যাকআপ ডাউনলোড হচ্ছে ☁️');
}

function importBackup(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try {
      const data=JSON.parse(e.target.result);
      if (confirm('বিদ্যমান সমস্ত ডেটা প্রতিস্থাপন করবেন?')) {
        showSyncOverlay(true,'ডেটা আমদানি হচ্ছে...');
        if(data.tenants)  DB.set('tenants',data.tenants);
        if(data.shops)    DB.set('shops',data.shops);
        if(data.payments) DB.set('payments',data.payments);
        if(data.settings) DB.set('settings',data.settings);
        if (FIREBASE_READY) {
          const saves=[];
          (data.tenants ||[]).forEach(r=>r.id&&saves.push(FDB.save('tenants', r.id,r)));
          (data.shops   ||[]).forEach(r=>r.id&&saves.push(FDB.save('shops',   r.id,r)));
          (data.payments||[]).forEach(r=>r.id&&saves.push(FDB.save('payments',r.id,r)));
          if(data.settings) saves.push(FDB.saveSettings(data.settings));
          await Promise.all(saves);
        }
        tenants=DB.get('tenants'); shops=DB.get('shops'); payments=DB.get('payments');
        showSyncOverlay(false); showToast('ব্যাকআপ আমদানি সফল হয়েছে ☁️'); showPage('dashboard');
      }
    } catch(err) { showSyncOverlay(false); showToast('ব্যাকআপ ফাইল অবৈধ','error'); }
  };
  reader.readAsText(file);
  event.target.value='';
}

function downloadFile(name,content,type) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=name; a.click(); URL.revokeObjectURL(a.href);
}

function clearAllData() {
  ['tenants','shops','payments','activities'].forEach(k=>localStorage.removeItem(k));
  tenants=[]; shops=[]; payments=[]; activities=[];
  showToast('সমস্ত ডেটা মুছে ফেলা হয়েছে','error'); showPage('dashboard');
}

// ============================================================
// DEMO DATA
// ============================================================
async function loadDemoData() {
  if (!confirm('ডেমো ডেটা লোড করবেন?')) return;
  const now=new Date();
  const e1=new Date(now); e1.setDate(e1.getDate()+15);
  const e2=new Date(now); e2.setDate(e2.getDate()-5);
  const e3=new Date(now); e3.setFullYear(e3.getFullYear()+1);
  const demoShops=[
    {id:'S1',number:'A-01',floor:'নিচতলা',size:'120',rent:8000,status:'occupied'},
    {id:'S2',number:'A-02',floor:'নিচতলা',size:'100',rent:7000,status:'occupied'},
    {id:'S3',number:'A-03',floor:'নিচতলা',size:'90', rent:6000,status:'empty'},
    {id:'S4',number:'B-01',floor:'২য় তলা',size:'80', rent:5000,status:'occupied'},
    {id:'S5',number:'B-02',floor:'২য় তলা',size:'80', rent:5000,status:'maintenance'},
    {id:'S6',number:'C-01',floor:'৩য় তলা',size:'70', rent:4000,status:'occupied'},
  ];
  const demoTenants=[
    {id:'T1',name:'মোঃ রফিকুল ইসলাম', mobile:'01712345678',nid:'1234567890',shop:'A-01',floor:'নিচতলা',rent:8000,advance:50000,monthlyDeduction:5000,deduction:5000,address:'পাহাড়তলী, চট্টগ্রাম',startDate:'2023-01-01',endDate:isoLocal(e1),serial:1,photo:'',archived:false},
    {id:'T2',name:'মোছাঃ সালমা বেগম',  mobile:'01898765432',nid:'9876543210',shop:'A-02',floor:'নিচতলা',rent:7000,advance:40000,monthlyDeduction:4000,deduction:4000,address:'নাসিরাবাদ, চট্টগ্রাম',startDate:'2022-06-01',endDate:isoLocal(e2),serial:2,photo:'',archived:false},
    {id:'T3',name:'মোঃ আব্দুল করিম',   mobile:'01611234567',nid:'5678901234',shop:'B-01',floor:'২য় তলা',rent:5000,advance:30000,monthlyDeduction:3000,deduction:3000,address:'বায়েজিদ, চট্টগ্রাম',  startDate:'2023-06-01',endDate:isoLocal(e3),serial:3,photo:'',archived:false},
    {id:'T4',name:'মোঃ জাহাঙ্গীর আলম', mobile:'01511234567',nid:'3456789012',shop:'C-01',floor:'৩য় তলা',rent:4000,advance:20000,monthlyDeduction:2000,deduction:2000,address:'চকবাজার, চট্টগ্রাম', startDate:'2023-03-01',endDate:isoLocal(e3),serial:4,photo:'',archived:false},
  ];
  const months=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট'];
  const demoPayments=[]; let sn=1;
  demoTenants.forEach((tn,ti)=>{
    months.forEach((m,mi)=>{
      if (Math.random()>0.2) {
        const full=Math.random()>0.3;
        const paid=full?tn.rent:Math.round(tn.rent*(0.4+Math.random()*0.4));
        const tSerial=mi+1;
        demoPayments.push({id:'P'+Date.now()+'_'+ti+'_'+mi,tenantId:tn.id,tenantName:tn.name,shop:tn.shop,month:m,year:2024,date:'2024-'+(String(mi+1).padStart(2,'0'))+'-05',rent:tn.rent,paid,due:tn.rent-paid,status:paid>=tn.rent?'paid':paid>0?'partial':'due',slipNo:sn++,tenantSerial:tSerial,tenantSlipNo:String(tSerial).padStart(3,'0'),notes:''});
      }
    });
  });
  const eS=DB.get('shops'),eT=DB.get('tenants'),eP=DB.get('payments');
  const nS=[...eS,...demoShops.filter(s=>!eS.find(e=>e.id===s.id))];
  const nT=[...eT,...demoTenants.filter(t=>!eT.find(e=>e.id===t.id))];
  const nP=[...eP,...demoPayments];
  DB.set('shops',nS); DB.set('tenants',nT); DB.set('payments',nP);
  if (FIREBASE_READY) {
    showSyncOverlay(true,'Firebase-এ ডেমো ডেটা আপলোড হচ্ছে...');
    const saves=[];
    nS.forEach(r=>saves.push(FDB.save('shops',   r.id,r)));
    nT.forEach(r=>saves.push(FDB.save('tenants', r.id,r)));
    nP.forEach(r=>saves.push(FDB.save('payments',r.id,r)));
    await Promise.all(saves);
    showSyncOverlay(false);
  }
  tenants=DB.get('tenants'); shops=DB.get('shops'); payments=DB.get('payments');
  addActivity('ডেমো ডেটা লোড করা হয়েছে','database','#7c3aed');
  buildMonthFilters(); showToast('ডেমো ডেটা সফলভাবে লোড হয়েছে ☁️'); showPage('dashboard');
}

// ============================================================
// NID PHOTO PREVIEW
// ============================================================
function previewNID(input, previewId, dataId) {
  const file=input.files[0]; if(!file) return;
  compressImage(file, 600, 450, 0.6).then(b64=>{
    const preview=document.getElementById(previewId);
    const dataEl=document.getElementById(dataId);
    if(preview) preview.innerHTML='<img src="'+b64+'" style="width:100%;height:100%;object-fit:cover;">';
    if(dataEl)  dataEl.value=b64;
  });
}

// ============================================================
// OWNER SIGNATURE
// ============================================================
function initSignatureCanvas() {
  setTimeout(()=>{
    sigCanvas=document.getElementById('sigCanvas');
    if (!sigCanvas) return;
    sigCtx=sigCanvas.getContext('2d');
    sigCtx.strokeStyle='#14532d'; sigCtx.lineWidth=2.5; sigCtx.lineCap='round'; sigCtx.lineJoin='round';
    const getPos=(e,c)=>{ const r=c.getBoundingClientRect(); const src=e.touches?e.touches[0]:e; return {x:(src.clientX-r.left)*(c.width/r.width), y:(src.clientY-r.top)*(c.height/r.height)}; };
    sigCanvas.onmousedown  = e=>{ sigDrawing=true; sigCtx.beginPath(); const p=getPos(e,sigCanvas); sigCtx.moveTo(p.x,p.y); };
    sigCanvas.onmousemove  = e=>{ if(!sigDrawing)return; const p=getPos(e,sigCanvas); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); };
    sigCanvas.onmouseup    = ()=>sigDrawing=false;
    sigCanvas.ontouchstart = e=>{ e.preventDefault(); sigDrawing=true; sigCtx.beginPath(); const p=getPos(e,sigCanvas); sigCtx.moveTo(p.x,p.y); },{passive:false};
    sigCanvas.ontouchmove  = e=>{ e.preventDefault(); if(!sigDrawing)return; const p=getPos(e,sigCanvas); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); },{passive:false};
    sigCanvas.ontouchend   = ()=>sigDrawing=false;
    if (ownerSignature) {
      const cur=document.getElementById('currentSigPreview'),img=document.getElementById('currentSigImg');
      if(cur) cur.style.display='block'; if(img) img.src=ownerSignature;
    }
  },200);
}

function setSignatureMode(mode) {
  sigMode=mode;
  const dm=document.getElementById('sigDrawMode'),um=document.getElementById('sigUploadMode');
  const db=document.getElementById('sigModeDrawBtn'),ub=document.getElementById('sigModeUploadBtn');
  if(!dm) return;
  dm.style.display=mode==='draw'?'block':'none'; um.style.display=mode==='upload'?'block':'none';
  db.className=mode==='draw'?'btn btn-primary btn-sm':'btn btn-ghost btn-sm';
  ub.className=mode==='upload'?'btn btn-primary btn-sm':'btn btn-ghost btn-sm';
  if(mode==='draw') initSignatureCanvas();
}

function previewSignatureUpload(input) {
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{const p=document.getElementById('sigUploadPreview'); if(p) p.innerHTML='<img src="'+e.target.result+'" style="max-height:100px;border-radius:6px;">';};
  reader.readAsDataURL(file);
}

function clearSignature() { if(sigCanvas&&sigCtx) sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height); }

async function saveOwnerSignature() {
  let sigData='';
  if (sigMode==='draw') {
    if (!sigCanvas) { showToast('ক্যানভাস পাওয়া যায়নি','error'); return; }
    sigData=sigCanvas.toDataURL('image/png');
  } else {
    const img=(document.getElementById('sigUploadPreview')||{}).querySelector('img');
    if(!img) { showToast('ছবি নির্বাচন করুন','error'); return; }
    sigData=img.src;
  }
  ownerSignature=sigData;
  localStorage.setItem('ownerSignature',sigData);
  // Upload to Firebase Storage: signatures/ folder
  if (FIREBASE_READY) {
    showSyncStatus('স্বাক্ষর আপলোড হচ্ছে...');
    const url=await uploadToStorage('signatures/owner_signature.png', sigData);
    if(url) ownerSignature=url;
    await FDB.saveSettings({...settings, ownerSignatureUrl:url});
  }
  closeModal('signatureModal');
  showToast('স্বাক্ষর সংরক্ষণ হয়েছে ✅');
}

// ============================================================
// SYNC UI
// ============================================================
let _syncOverlay=null;
function showSyncOverlay(show, msg) {
  if (!_syncOverlay) {
    _syncOverlay=document.createElement('div');
    _syncOverlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    _syncOverlay.innerHTML='<div style="background:#fff;border-radius:16px;padding:32px 40px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.3);font-family:Noto Sans Bengali,sans-serif;min-width:200px;">'+
      '<div style="width:48px;height:48px;border:4px solid #bbf7d0;border-top-color:#16a34a;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div>'+
      '<div id="syncMsg" style="font-size:1rem;color:#14532d;font-weight:600;">লোড হচ্ছে...</div></div>';
    const style=document.createElement('style'); style.textContent='@keyframes spin{to{transform:rotate(360deg)}}'; document.head.appendChild(style);
    document.body.appendChild(_syncOverlay);
  }
  _syncOverlay.style.display=show?'flex':'none';
  if (msg) showSyncStatus(msg);
}
function showSyncStatus(msg){const e=document.getElementById('syncMsg');if(e)e.textContent=msg;}

function updateSyncBadge() {
  const b=document.getElementById('syncBadge'); if(!b) return;
  b.style.cssText='display:flex;align-items:center;gap:5px;font-size:0.72rem;padding:3px 10px;border-radius:20px;font-family:Noto Sans Bengali,sans-serif;';
  if (FIREBASE_READY) { b.style.background='#dcfce7'; b.style.color='#166534'; b.innerHTML='<span style="width:7px;height:7px;background:#16a34a;border-radius:50%;display:inline-block;animation:pulse 2s infinite;"></span> Firebase Live ☁️'; }
  else                { b.style.background='#fef9c3'; b.style.color='#92400e'; b.innerHTML='<span style="width:7px;height:7px;background:#d97706;border-radius:50%;display:inline-block;"></span> LocalStorage'; }
  const sb=document.getElementById('fbStatusSidebar'); if(sb) sb.textContent=FIREBASE_READY?'☁️ Firebase Live':'💾 LocalStorage';
}

// ============================================================
// হিসাব (CALCULATOR) + তাৎক্ষণিক মেমো (INSTANT MEMO)
// ============================================================
const MEMO_EXTRA_CSS = `
  .memo-table{width:100%;border-collapse:collapse;font-size:.84rem;margin:10px 0;}
  .memo-table th{background:#16a34a;color:#fff;padding:6px 8px;text-align:left;font-weight:600;}
  .memo-table td{border-bottom:1px dashed #86efac;padding:6px 8px;vertical-align:top;}
  .memo-table .r{text-align:right;white-space:nowrap;}
  .memo-sum{margin-left:auto;width:min(260px,100%);font-size:.88rem;}
  .memo-sum div{display:flex;justify-content:space-between;padding:3px 0;}
  .memo-sum .tot{border-top:2px solid #14532d;font-weight:800;font-size:1rem;padding-top:6px;margin-top:4px;}
  .memo-words{font-size:.8rem;margin:8px 0;color:#14532d;}
  .memo-meta{display:flex;gap:10px 18px;flex-wrap:wrap;font-size:.84rem;margin:8px 0;}
`;
(function injectMemoCss() {
  if (document.getElementById('memoCss')) return;
  const st = document.createElement('style'); st.id = 'memoCss'; st.textContent = MEMO_EXTRA_CSS;
  document.head.appendChild(st);
})();

// ── helpers ──────────────────────────────────────────────────
const _n = x => { const v = parseFloat(String(x).replace(/,/g, '')); return isNaN(v) ? 0 : v; };
const _r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const money = x => '৳' + _r2(x).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const _esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BN_UNDER_100 = ['শূন্য','এক','দুই','তিন','চার','পাঁচ','ছয়','সাত','আট','নয়','দশ','এগারো','বারো','তেরো','চৌদ্দ','পনেরো','ষোল','সতেরো','আঠারো','উনিশ','বিশ','একুশ','বাইশ','তেইশ','চব্বিশ','পঁচিশ','ছাব্বিশ','সাতাশ','আঠাশ','ঊনত্রিশ','ত্রিশ','একত্রিশ','বত্রিশ','তেত্রিশ','চৌত্রিশ','পঁয়ত্রিশ','ছত্রিশ','সাঁইত্রিশ','আটত্রিশ','ঊনচল্লিশ','চল্লিশ','একচল্লিশ','বিয়াল্লিশ','তেতাল্লিশ','চুয়াল্লিশ','পঁয়তাল্লিশ','ছেচল্লিশ','সাতচল্লিশ','আটচল্লিশ','ঊনপঞ্চাশ','পঞ্চাশ','একান্ন','বায়ান্ন','তিপ্পান্ন','চুয়ান্ন','পঞ্চান্ন','ছাপ্পান্ন','সাতান্ন','আটান্ন','ঊনষাট','ষাট','একষট্টি','বাষট্টি','তেষট্টি','চৌষট্টি','পঁয়ষট্টি','ছেষট্টি','সাতষট্টি','আটষট্টি','ঊনসত্তর','সত্তর','একাত্তর','বাহাত্তর','তিয়াত্তর','চুয়াত্তর','পঁচাত্তর','ছিয়াত্তর','সাতাত্তর','আটাত্তর','ঊনআশি','আশি','একাশি','বিরাশি','তিরাশি','চুরাশি','পঁচাশি','ছিয়াশি','সাতাশি','আটাশি','ঊননব্বই','নব্বই','একানব্বই','বিরানব্বই','তিরানব্বই','চুরানব্বই','পঁচানব্বই','ছিয়ানব্বই','সাতানব্বই','আটানব্বই','নিরানব্বই'];
function takaInWords(amount) {
  let n = Math.round(Math.abs(amount));
  if (!n) return 'শূন্য টাকা মাত্র';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(BN_UNDER_100[crore % 100] + ' কোটি');
  if (lakh) parts.push(BN_UNDER_100[lakh] + ' লাখ');
  if (thousand) parts.push(BN_UNDER_100[thousand] + ' হাজার');
  if (hundred) parts.push(BN_UNDER_100[hundred] + 'শত');
  if (n) parts.push(BN_UNDER_100[n]);
  return (amount < 0 ? 'ঋণাত্মক ' : '') + parts.join(' ') + ' টাকা মাত্র';
}

// ── calculators ──────────────────────────────────────────────
// field types: number (default) | select | tenant
const CALCS = [
  { id: 'rent', icon: 'fa-money-bill-wave', title: 'ভাড়া গণনা',
    fields: [
      { k: 'rent', l: 'মাসিক ভাড়া (৳)' }, { k: 'months', l: 'কত মাস', v: 1 },
      { k: 'inc', l: 'ভাড়া বৃদ্ধি (%)', v: 0 }, { k: 'disc', l: 'ছাড় (৳)', v: 0 }],
    run: f => {
      const rent2 = _n(f.rent) * (1 + _n(f.inc) / 100), months = _n(f.months), base = rent2 * months, total = base - _n(f.disc);
      return { rows: [['মাসিক ভাড়া (বৃদ্ধিসহ)', money(rent2)], ['মাস', months], ['মোট ভাড়া', money(base)], ['ছাড়', '−' + money(_n(f.disc))]],
        main: ['পরিশোধযোগ্য', total],
        items: [{ desc: 'ভাড়া (' + months + ' মাস × ' + money(rent2) + ')', qty: months, rate: _r2(rent2) }].concat(_n(f.disc) ? [{ desc: 'ছাড়', qty: 1, rate: -_n(f.disc) }] : []) };
    } },
  { id: 'prorated', icon: 'fa-calendar-day', title: 'দিন অনুযায়ী ভাড়া',
    fields: [
      { k: 'rent', l: 'মাসিক ভাড়া (৳)' },
      { k: 'dim', l: 'মাসে মোট দিন', t: 'select', opts: [['30', '৩০ দিন'], ['31', '৩১ দিন'], ['29', '২৯ দিন'], ['28', '২৮ দিন']] },
      { k: 'used', l: 'কত দিন থাকবে/থেকেছে' }],
    run: f => {
      const dim = _n(f.dim) || 30, per = _n(f.rent) / dim, total = per * _n(f.used);
      return { rows: [['প্রতিদিনের ভাড়া', money(per)], ['দিন', _n(f.used) + ' / ' + dim]], main: ['দিন অনুযায়ী ভাড়া', total],
        items: [{ desc: 'দিন অনুযায়ী ভাড়া (' + _n(f.used) + '/' + dim + ' দিন)', qty: 1, rate: _r2(total) }] };
    } },
  { id: 'deduction', icon: 'fa-scissors', title: 'অগ্রিম কর্তন হিসাব (মাসভিত্তিক)',
    fill: tn => ({ adv: tn.advance || 0, ded: tn.monthlyDeduction || tn.deduction || 0, months: _tmonths(tn) }),
    fields: [
      { k: 'tid', l: 'ভাড়াটিয়া বাছুন (কর্তন, মাস নিজে আসবে)', t: 'tenant' },
      { k: 'ded', l: 'মাসিক কর্তন (৳)', v: 0 }, { k: 'months', l: 'কত মাস কর্তন হয়েছে', v: 0 },
      { k: 'adv', l: 'মোট অগ্রিম (৳) — এর বেশি কর্তন হবে না', v: 0 }],
    run: f => {
      const ded = _n(f.ded), m = Math.max(0, Math.floor(_n(f.months))), adv = _n(f.adv);
      if (!ded || !m) return { rows: [['ভাড়াটিয়া বাছুন বা কর্তন ও মাস দিন', '']], main: null, items: [], tables: [] };
      const tn = (tenants || []).find(t => t.id === f.tid);
      const rows = []; let cum = 0;
      for (let i = 0; i < Math.min(m, 120); i++) {
        const cut = adv > 0 ? Math.min(ded, adv - cum) : ded;
        if (cut <= 0) break;
        cum += cut;
        let label = (i + 1) + ' নং মাস';
        if (tn && tn.startDate) { const d = new Date(tn.startDate + 'T00:00:00'); d.setMonth(d.getMonth() + i); label = BN_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
        rows.push([label, money(cut)]);
      }
      const table = { title: 'অগ্রিম কর্তন', cols: ['মাস', 'কর্তন'], num: [1], counts: true, total: _r2(cum), rows, foot: ['মোট কর্তন', money(cum)] };
      return { rows: [['কর্তনের মাস', rows.length + ' মাস'], ['মাসিক কর্তন', money(ded)]], main: ['মোট কর্তন', cum], items: [], tables: [table], tenantId: f.tid };
    } },
  { id: 'advance', icon: 'fa-hand-holding-usd', title: 'অগ্রিম সমন্বয় / ফেরত',
    fill: tn => ({ adv: tn.advance || 0, ded: tn.monthlyDeduction || tn.deduction || 0, months: _tmonths(tn) }),
    fields: [
      { k: 'tid', l: 'ভাড়াটিয়া বাছুন (অগ্রিম, কর্তন, মাস নিজে আসবে)', t: 'tenant' },
      { k: 'adv', l: 'মোট অগ্রিম (৳)' }, { k: 'ded', l: 'মাসিক কর্তন (৳)', v: 0 },
      { k: 'months', l: 'কত মাস কর্তন হয়েছে', v: 0 }, { k: 'other', l: 'বকেয়া / ক্ষতি আদায় (৳)', v: 0 },
      { k: 'sched', l: 'মাসভিত্তিক কর্তনের তালিকা', t: 'select', opts: [['no', 'না, শুধু সারাংশ'], ['yes', 'হ্যাঁ, মাসভিত্তিক টেবল']] }],
    run: f => {
      const adv = _n(f.adv), ded = _n(f.ded), m = Math.max(0, Math.floor(_n(f.months)));
      const deducted = Math.min(adv, ded * m), remain = adv - deducted, other = _n(f.other), refund = remain - other;
      const tn = (tenants || []).find(t => t.id === f.tid);
      const rows = [['মোট অগ্রিম', money(adv)], ['মাসিক কর্তন', money(ded)], ['কর্তনের মাস', m + ' মাস'], ['কর্তন বাবদ কাটা হয়েছে', money(deducted)], ['অবশিষ্ট অগ্রিম', money(remain)]];
      if (other) rows.push(['বকেয়া / ক্ষতি আদায়', money(other)]);
      const tables = [{ title: 'অগ্রিম কর্তন হিসাব', cols: ['বিবরণ', 'টাকা'], num: [1], rows, foot: [refund >= 0 ? 'ফেরতযোগ্য অগ্রিম' : 'ভাড়াটিয়ার কাছে পাওনা', money(Math.abs(refund))] }];
      if (f.sched === 'yes' && ded > 0) {
        const sr = []; let cum = 0;
        for (let i = 0; i < Math.min(m, 120) && cum < adv; i++) {
          const cut = Math.min(ded, adv - cum); cum += cut;
          let label = (i + 1) + ' নং মাস';
          if (tn && tn.startDate) { const d = new Date(tn.startDate + 'T00:00:00'); d.setMonth(d.getMonth() + i); label = BN_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
          sr.push([label, money(cut), money(cum), money(adv - cum)]);
        }
        if (sr.length) tables.push({ title: 'মাসভিত্তিক কর্তন', cols: ['মাস', 'কর্তন', 'মোট কর্তন', 'অবশিষ্ট অগ্রিম'], num: [1, 2, 3], rows: sr, foot: ['মোট', money(deducted), money(deducted), money(remain)] });
      }
      return { rows: [['মোট অগ্রিম', money(adv)], ['কর্তন বাবদ কাটা হয়েছে', '−' + money(deducted)], ['অবশিষ্ট অগ্রিম', money(remain)], ['বকেয়া/ক্ষতি', '−' + money(other)]],
        main: [refund >= 0 ? 'ফেরতযোগ্য অগ্রিম' : 'ভাড়াটিয়ার কাছে পাওনা', Math.abs(refund)],
        items: [refund >= 0 ? { desc: 'অগ্রিম ফেরত', qty: 1, rate: _r2(refund) } : { desc: 'অগ্রিম সমন্বয়ের পর বকেয়া', qty: 1, rate: _r2(-refund) }],
        tables, tenantId: f.tid };
    } },
  { id: 'raise', icon: 'fa-arrow-trend-up', title: 'ভাড়া বৃদ্ধি',
    fields: [
      { k: 'cur', l: 'বর্তমান ভাড়া (৳)' },
      { k: 'mode', l: 'বৃদ্ধির ধরন', t: 'select', opts: [['pct', 'শতকরা (%)'], ['fix', 'নির্দিষ্ট টাকা (৳)']] },
      { k: 'val', l: 'বৃদ্ধির পরিমাণ', v: 10 }],
    run: f => {
      const cur = _n(f.cur), inc = f.mode === 'fix' ? _n(f.val) : cur * _n(f.val) / 100, nw = cur + inc;
      return { rows: [['বর্তমান ভাড়া', money(cur)], ['মাসিক বৃদ্ধি', '+' + money(inc)], ['বছরে অতিরিক্ত', money(inc * 12)]], main: ['নতুন মাসিক ভাড়া', nw],
        items: [{ desc: 'নতুন মাসিক ভাড়া', qty: 1, rate: _r2(nw) }] };
    } },
  { id: 'late', icon: 'fa-hourglass-half', title: 'বিলম্ব জরিমানা',
    fields: [
      { k: 'due', l: 'বকেয়া ভাড়া (৳)' }, { k: 'days', l: 'কত দিন দেরি' },
      { k: 'mode', l: 'জরিমানার ধরন', t: 'select', opts: [['pct', 'মাসিক শতকরা হার (%)'], ['day', 'প্রতিদিন নির্দিষ্ট টাকা']] },
      { k: 'rate', l: 'হার', v: 2 }],
    run: f => {
      const due = _n(f.due), days = _n(f.days), fee = f.mode === 'day' ? _n(f.rate) * days : due * _n(f.rate) / 100 / 30 * days;
      return { rows: [['বকেয়া', money(due)], ['দেরি', days + ' দিন'], ['জরিমানা', money(fee)]], main: ['মোট পরিশোধযোগ্য', due + fee],
        items: [{ desc: 'বকেয়া ভাড়া', qty: 1, rate: _r2(due) }, { desc: 'বিলম্ব জরিমানা (' + days + ' দিন)', qty: 1, rate: _r2(fee) }] };
    } },
  { id: 'electric', icon: 'fa-bolt', title: 'বিদ্যুৎ বিল',
    fields: [
      { k: 'prev', l: 'আগের রিডিং' }, { k: 'curr', l: 'বর্তমান রিডিং' }, { k: 'rate', l: 'প্রতি ইউনিট (৳)', v: 10 },
      { k: 'svc', l: 'সার্ভিস/ডিমান্ড চার্জ (৳)', v: 0 }, { k: 'vat', l: 'ভ্যাট (%)', v: 5 }],
    run: f => {
      const units = Math.max(0, _n(f.curr) - _n(f.prev)), energy = units * _n(f.rate), sub = energy + _n(f.svc), vat = sub * _n(f.vat) / 100;
      return { rows: [['ব্যবহৃত ইউনিট', units], ['বিদ্যুৎ বিল', money(energy)], ['সার্ভিস চার্জ', money(_n(f.svc))], ['ভ্যাট', money(vat)]], main: ['মোট বিল', sub + vat],
        items: [{ desc: 'বিদ্যুৎ বিল (' + units + ' ইউনিট)', qty: units, rate: _n(f.rate) }]
          .concat(_n(f.svc) ? [{ desc: 'সার্ভিস চার্জ', qty: 1, rate: _n(f.svc) }] : []).concat(vat ? [{ desc: 'ভ্যাট ' + _n(f.vat) + '%', qty: 1, rate: _r2(vat) }] : []) };
    } },
  { id: 'water', icon: 'fa-faucet', title: 'পানির বিল',
    fields: [
      { k: 'tid', l: 'ভাড়াটিয়া (ঐচ্ছিক)', t: 'tenant' },
      { k: 'rows', l: 'মাস অনুযায়ী বিল', t: 'rows' }],
    run: f => {
      const list = (f.rows || []).filter(r => _n(r.bill) || _n(r.fine));
      if (!list.length) return { rows: [['মাস ও বিলের পরিমাণ দিন', '']], main: null, items: [], tables: [] };
      const bill = list.reduce((a, r) => a + _n(r.bill), 0), fine = list.reduce((a, r) => a + _n(r.fine), 0), total = bill + fine;
      const table = { title: 'পানির বিল', cols: ['মাস', 'বিলের পরিমাণ', 'জরিমানা', 'মোট'], num: [1, 2, 3], counts: true, total: _r2(total),
        rows: list.map(r => [r.m + ' ' + r.y, money(_n(r.bill)), money(_n(r.fine)), money(_n(r.bill) + _n(r.fine))]),
        foot: ['মোট', money(bill), money(fine), money(total)] };
      return { rows: [['মাস', list.length], ['মোট বিল', money(bill)], ['মোট জরিমানা', money(fine)]], main: ['মোট পানির বিল', total], items: [], tables: [table], tenantId: f.tid };
    } },
  { id: 'split', icon: 'fa-people-arrows', title: 'খরচ ভাগ (দোকান অনুযায়ী)',
    fields: [
      { k: 'total', l: 'মোট খরচ (৳)' }, { k: 'count', l: 'কয়টি দোকান/ভাড়াটিয়া', v: 1 },
      { k: 'round', l: 'টাকা গোল করা', t: 'select', opts: [['no', 'না'], ['up', 'পূর্ণ টাকায় বাড়িয়ে']] }],
    run: f => {
      const total = _n(f.total), cnt = Math.max(1, _n(f.count)); let per = total / cnt; if (f.round === 'up') per = Math.ceil(per);
      return { rows: [['মোট খরচ', money(total)], ['ভাগ', cnt + ' জন'], ['মোট আদায়', money(per * cnt)]], main: ['প্রতি জনের ভাগ', per],
        items: [{ desc: 'খরচের ভাগ (' + money(total) + ' ÷ ' + cnt + ')', qty: 1, rate: _r2(per) }] };
    } },
  { id: 'due', icon: 'fa-user-clock', title: 'ভাড়াটিয়ার বকেয়া হিসাব',
    fields: [
      { k: 'tid', l: 'ভাড়াটিয়া', t: 'tenant' },
      { k: 'show', l: 'টেবলে কোন মাস দেখাবে', t: 'select', opts: [['due', 'শুধু বকেয়া মাস'], ['all', 'সব মাস']] }],
    run: f => {
      if (!f.tid) return { rows: [['ভাড়াটিয়া বেছে নিন', '']], main: null, items: [], tables: [] };
      const mi = p => (p.year || 0) * 12 + Math.max(0, BN_MONTHS.indexOf(p.month));
      const all = (payments || []).filter(p => p.tenantId === f.tid).sort((a, b) => mi(a) - mi(b) || String(a.date || '').localeCompare(String(b.date || '')));
      const list = f.show === 'all' ? all : all.filter(p => _n(p.due) > 0);
      const rent = list.reduce((a, p) => a + _n(p.rent), 0), paid = list.reduce((a, p) => a + _n(p.paid), 0), due = all.reduce((a, p) => a + _n(p.due), 0);
      if (!list.length) return { rows: [['মোট রসিদ', all.length], ['বকেয়া', 'কোনো বকেয়া নেই ✓']], main: null, items: [], tables: [], tenantId: f.tid };
      const table = { title: 'ভাড়া বকেয়া হিসাব', cols: ['মাস', 'ভাড়া', 'পরিশোধ', 'বাকি'], num: [1, 2, 3], counts: true, total: _r2(due),
        rows: list.map(p => [p.month + ' ' + (p.year || ''), money(_n(p.rent)), money(_n(p.paid)), money(_n(p.due))]),
        foot: ['মোট', money(rent), money(paid), money(f.show === 'all' ? list.reduce((a, p) => a + _n(p.due), 0) : due)] };
      return { rows: [['মোট রসিদ', all.length], ['বকেয়া মাস', all.filter(p => _n(p.due) > 0).length + ' টি']], main: ['মোট বকেয়া', due], items: [], tables: [table], tenantId: f.tid };
    } },
  { id: 'cash', icon: 'fa-coins', title: 'নগদ টাকা গণনা',
    fields: [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1].map(d => ({ k: 'n' + d, l: '৳' + d + ' × কয়টি নোট/কয়েন', v: 0 })),
    run: f => {
      const denoms = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
      const rows = [], total = denoms.reduce((a, d) => { const c = _n(f['n' + d]); if (c) rows.push(['৳' + d + ' × ' + c, money(c * d)]); return a + c * d; }, 0);
      return { rows: rows.length ? rows : [['কোনো নোট দেওয়া হয়নি', '']], main: ['মোট নগদ', total], items: total ? [{ desc: 'নগদ টাকা জমা', qty: 1, rate: total }] : [] };
    } },
  { id: 'general', icon: 'fa-calculator', title: 'সাধারণ ক্যালকুলেটর',
    fields: [{ k: 'expr', l: 'হিসাব লিখুন (যেমন: 3200*3 + 500 - 10%)', t: 'text' }],
    run: f => {
      let ex = String(f.expr || '').replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '');
      ex = ex.replace(/([0-9.]+)\s*%/g, '($1/100)');
      if (!ex.trim()) return { rows: [['উদাহরণ: 3200*3 + 500', '']], main: null, items: [] };
      if (!/^[0-9+\-*/().\s]+$/.test(ex)) return { rows: [['শুধু সংখ্যা ও + − × ÷ ( ) % ব্যবহার করুন', '']], main: null, items: [] };
      let v; try { v = Function('"use strict";return (' + ex + ')')(); } catch (e) { v = NaN; }
      if (typeof v !== 'number' || !isFinite(v)) return { rows: [['হিসাবটি সঠিক নয়', '']], main: null, items: [] };
      return { rows: [['হিসাব', f.expr]], main: ['ফলাফল', v], items: [{ desc: 'হিসাব: ' + f.expr, qty: 1, rate: _r2(v) }] };
    } }
];

const BN_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
const _tmonths = t => t.startDate ? Math.max(0, Math.floor((new Date() - new Date(t.startDate)) / (1000 * 60 * 60 * 24 * 30))) : 0;
let _calcActive = 'rent', _calcLast = null, _calcRows = {};

const PREMIUM_IDS = ['due', 'deduction', 'expense'];
const EXPENSE_TAB = { id: 'expense', icon: 'fa-wallet', title: 'মাসিক খরচ হিসাব' };
function renderCalcTabs() {
  const box = document.getElementById('calcTabs'); if (!box) return;
  const all = CALCS.concat([EXPENSE_TAB]);
  const btn = c => '<button type="button" class="tab-btn' + (PREMIUM_IDS.includes(c.id) ? ' prem' : '') + (c.id === _calcActive ? ' active' : '') + '" onclick="calcSelect(\'' + c.id + '\')">' + (PREMIUM_IDS.includes(c.id) ? '<i class="fas fa-crown"></i> ' : '') + '<i class="fas ' + c.icon + '"></i> ' + c.title + '</button>';
  const prem = PREMIUM_IDS.map(id => all.find(c => c.id === id)).filter(Boolean);
  const rest = all.filter(c => !PREMIUM_IDS.includes(c.id));
  box.innerHTML = '<div class="prem-group"><span class="pg-label"><i class="fas fa-crown"></i> PREMIUM</span>' + prem.map(btn).join('') + '</div>' + rest.map(btn).join('');
}
function calcSelect(id) {
  _calcActive = id; renderCalcTabs();
  const isExp = id === 'expense';
  ['calcGrid', 'memoHistoryCard'].forEach(x => { const e = document.getElementById(x); if (e) e.style.display = isExp ? 'none' : (x === 'calcGrid' ? 'grid' : ''); });
  const ep = document.getElementById('expensePanel'); if (ep) ep.style.display = isExp ? 'block' : 'none';
  if (isExp) { expInit(); return; }
  const c = CALCS.find(x => x.id === id), box = document.getElementById('calcForm'); if (!c || !box) return;
  box.innerHTML = '<div class="form-grid">' + c.fields.map(fl => {
    const val = fl.v == null ? '' : fl.v;
    let input;
    if (fl.t === 'select') input = '<select class="form-input form-select" data-k="' + fl.k + '" onchange="calcRun()">' + fl.opts.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>';
    else if (fl.t === 'tenant') input = '<select class="form-input form-select" data-k="' + fl.k + '" onchange="calcTenantPick()"><option value="">-- ভাড়াটিয়া নির্বাচন করুন --</option>' + (tenants || []).filter(t => !t.archived).map(t => '<option value="' + t.id + '">' + _esc(t.name) + ' - ' + _esc(t.shop) + '</option>').join('') + '</select>';
    else if (fl.t === 'rows') input = '<div id="calcRowsEditor"></div>';
    else if (fl.t === 'text') input = '<input class="form-input" data-k="' + fl.k + '" oninput="calcRun()" placeholder="3200*3 + 500">';
    else input = '<input class="form-input" type="number" inputmode="decimal" step="any" data-k="' + fl.k + '" value="' + val + '" oninput="calcRun()">';
    return '<div class="form-group"' + (['text', 'tenant', 'rows'].includes(fl.t) ? ' style="grid-column:1/-1;"' : '') + '><label class="form-label">' + fl.l + '</label>' + input + '</div>';
  }).join('') + '</div>';
  if (c.fields.some(fl => fl.t === 'rows')) {
    if (!_calcRows[id] || !_calcRows[id].length) _calcRows[id] = [{ m: BN_MONTHS[new Date().getMonth()], y: new Date().getFullYear(), bill: '', fine: 0 }];
    calcRowsRender();
  }
  calcRun();
}
function calcTenantPick() {
  const c = CALCS.find(x => x.id === _calcActive); if (!c) return;
  const sel = document.querySelector('#calcForm [data-k="tid"]');
  const tn = sel && (tenants || []).find(t => t.id === sel.value);
  if (tn && c.fill) { const vals = c.fill(tn); Object.keys(vals).forEach(k => { const e = document.querySelector('#calcForm [data-k="' + k + '"]'); if (e) e.value = vals[k]; }); }
  calcRun();
}
function calcRowsRender() {
  const box = document.getElementById('calcRowsEditor'); if (!box) return;
  const rows = _calcRows[_calcActive] || [];
  box.innerHTML = rows.map((r, i) =>
    '<div style="display:grid;grid-template-columns:1.3fr 70px 1fr 1fr 32px;gap:6px;margin-bottom:6px;align-items:center;">' +
    '<select class="form-input form-select" onchange="calcRowSet(' + i + ',\'m\',this.value)">' + BN_MONTHS.map(mn => '<option' + (mn === r.m ? ' selected' : '') + '>' + mn + '</option>').join('') + '</select>' +
    '<input class="form-input" type="number" value="' + _esc(r.y) + '" oninput="calcRowSet(' + i + ',\'y\',this.value)" title="সাল">' +
    '<input class="form-input" type="number" step="any" inputmode="decimal" placeholder="বিল ৳" value="' + _esc(r.bill) + '" oninput="calcRowSet(' + i + ',\'bill\',this.value)">' +
    '<input class="form-input" type="number" step="any" inputmode="decimal" placeholder="জরিমানা ৳" value="' + _esc(r.fine) + '" oninput="calcRowSet(' + i + ',\'fine\',this.value)">' +
    '<button type="button" class="btn btn-danger btn-sm" onclick="calcRowDel(' + i + ')"><i class="fas fa-times"></i></button></div>').join('') +
    '<button type="button" class="btn btn-outline btn-sm" onclick="calcRowAdd()"><i class="fas fa-plus"></i> মাস যোগ করুন</button>';
}
function calcRowSet(i, k, v) { const r = (_calcRows[_calcActive] || [])[i]; if (r) { r[k] = v; calcRun(); } }
function calcRowAdd() {
  const rows = _calcRows[_calcActive] = _calcRows[_calcActive] || [], last = rows[rows.length - 1];
  let mi = last ? BN_MONTHS.indexOf(last.m) + 1 : new Date().getMonth(), y = last ? _n(last.y) : new Date().getFullYear();
  if (mi > 11) { mi = 0; y++; }
  rows.push({ m: BN_MONTHS[mi], y, bill: '', fine: 0 }); calcRowsRender(); calcRun();
}
function calcRowDel(i) { const rows = _calcRows[_calcActive] || []; rows.splice(i, 1); if (!rows.length) rows.push({ m: BN_MONTHS[new Date().getMonth()], y: new Date().getFullYear(), bill: '', fine: 0 }); calcRowsRender(); calcRun(); }

function calcTableHtml(t) {
  return '<div style="overflow-x:auto;margin-top:12px;"><div style="font-weight:700;font-size:.84rem;margin-bottom:4px;">' + _esc(t.title) + '</div>' +
    '<table class="memo-table"><thead><tr>' + t.cols.map((c, i) => '<th' + ((t.num || []).includes(i) ? ' class="r"' : '') + '>' + _esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    t.rows.map(r => '<tr>' + r.map((c, i) => '<td' + ((t.num || []).includes(i) ? ' class="r"' : '') + '>' + _esc(c) + '</td>').join('') + '</tr>').join('') +
    (t.foot ? '<tr style="font-weight:800;background:#f0fdf4;">' + t.cols.map((c, i) => '<td' + ((t.num || []).includes(i) ? ' class="r"' : '') + '>' + _esc(t.foot[i] == null ? '' : t.foot[i]) + '</td>').join('') + '</tr>' : '') +
    '</tbody></table></div>';
}
function calcRun() {
  const c = CALCS.find(x => x.id === _calcActive); if (!c) return;
  const f = {}; document.querySelectorAll('#calcForm [data-k]').forEach(el => { f[el.dataset.k] = el.value; });
  c.fields.forEach(fl => { if (fl.t === 'rows') f[fl.k] = _calcRows[_calcActive] || []; });
  let res; try { res = c.run(f); } catch (e) { console.error(e); res = { rows: [['হিসাবে সমস্যা', '']], main: null, items: [] }; }
  res.tables = res.tables || []; _calcLast = res;
  const out = document.getElementById('calcResult'); if (!out) return;
  const canMemo = (res.items && res.items.length) || res.tables.length;
  out.innerHTML = '<div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;">' +
    res.rows.map((r, i) => '<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 14px;font-size:.86rem;' + (i ? 'border-top:1px solid var(--border);' : '') + '"><span style="color:var(--text-muted);">' + _esc(r[0]) + '</span><b style="text-align:right;">' + _esc(r[1]) + '</b></div>').join('') +
    (res.main ? '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--accent);color:#fff;"><span style="font-weight:600;">' + res.main[0] + '</span><span style="font-size:1.35rem;font-weight:800;">' + money(res.main[1]) + '</span></div>' : '') + '</div>' +
    (res.main ? '<div style="font-size:.76rem;color:var(--text-muted);margin:6px 2px;">' + takaInWords(res.main[1]) + '</div>' : '') +
    res.tables.map(calcTableHtml).join('') +
    (canMemo ? '<button type="button" class="btn btn-primary" style="margin-top:10px;width:100%;justify-content:center;" onclick="memoFromCalc()"><i class="fas fa-file-invoice"></i> এই হিসাব দিয়ে মেমো বানান</button>' : '');
}

function memoFromCalc() {
  const res = _calcLast; if (!res || (!(res.items || []).length && !(res.tables || []).length)) return;
  if (res.tenantId) memoSetTenant(res.tenantId);
  _memoItems = _memoItems.filter(it => String(it.desc).trim() || _n(it.rate));   // faka row bad
  (res.items || []).forEach(it => _memoItems.push({ desc: it.desc, qty: it.qty, rate: it.rate }));
  (res.tables || []).forEach(t => _memoTables.push(JSON.parse(JSON.stringify(t))));
  const c = CALCS.find(x => x.id === _calcActive), sel = document.getElementById('mType');
  if (c && sel && [...sel.options].some(o => o.value === c.title)) { sel.value = c.title; memoTypeChanged(); }
  memoRenderItems();
  showToast('মেমোতে যোগ হয়েছে ✅');
  const m = document.getElementById('memoPanel'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ── monthly expense calculator (Firebase: "expenses") ─────────
const EXP_CATS = ['বিদ্যুৎ বিল', 'পানির বিল', 'পরিষ্কার-পরিচ্ছন্নতা', 'জেনারেটর / লিফট', 'মেরামত ও রক্ষণাবেক্ষণ', 'কর্মচারী বেতন', 'নিরাপত্তা', 'ট্যাক্স / খাজনা', 'অন্যান্য'];
let _expDraft = [], _expEditId = null, _expYM = '', _expBuilt = false;
const _expNewRow = () => ({ date: isoLocal(new Date()), cat: '', details: '', amount: '' });
const _expAll = () => DB.get('expenses');
function _expCats() { const set = new Set(EXP_CATS); _expAll().forEach(e => e.cat && set.add(e.cat)); return [...set]; }

function expInit() {
  const box = document.getElementById('expensePanel'); if (!box) return;
  if (!_expYM) _expYM = isoLocal(new Date()).slice(0, 7);
  if (!_expDraft.length) _expDraft = [_expNewRow()];
  if (!_expBuilt) {
    const yNow = new Date().getFullYear();
    box.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start;">' +
      '<div class="stat-card" style="padding:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-crown" style="color:#f59e0b;"></i> <i class="fas fa-wallet" style="color:var(--accent);"></i> খরচ লিখুন</h3>' +
      '<p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px;">খরচের ধরন তালিকা থেকে বাছুন বা নিজে লিখুন। সেভ করলে Firebase-এ থাকবে।</p>' +
      '<div id="expEditBanner" style="display:none;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:8px;padding:8px 12px;font-size:.82rem;margin-bottom:10px;"></div>' +
      '<div id="expDraft"></div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="expAddRowBtn" onclick="expRowAdd()" style="margin-bottom:12px;"><i class="fas fa-plus"></i> আরেকটি খরচ যোগ</button>' +
      '<div id="expDraftTotal" style="background:var(--bg-primary);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:.9rem;margin-bottom:12px;"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn btn-primary" id="expSaveBtn" onclick="expSave()" style="flex:1;justify-content:center;"><i class="fas fa-cloud-upload-alt"></i> সেভ করুন</button>' +
      '<button type="button" class="btn btn-outline" onclick="expPrintDraft()" style="flex:1;justify-content:center;"><i class="fas fa-print"></i> তাৎক্ষণিক প্রিন্ট</button>' +
      '<button type="button" class="btn btn-ghost" onclick="expDraftReset()"><i class="fas fa-eraser"></i> নতুন</button></div></div>' +
      '<div class="stat-card" style="padding:20px;"><h3 style="font-weight:700;margin-bottom:12px;font-size:.95rem;"><i class="fas fa-calendar-alt" style="color:var(--accent);"></i> মাসিক খরচ</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<select id="expMonthSel" class="form-input form-select" style="flex:1;min-width:120px;" onchange="expYMChanged()">' + BN_MONTHS.map((mn, i) => '<option value="' + String(i + 1).padStart(2, '0') + '">' + mn + '</option>').join('') + '</select>' +
      '<select id="expYearSel" class="form-input form-select" style="width:110px;" onchange="expYMChanged()">' + Array.from({ length: 8 }, (_, i) => yNow - 5 + i).map(y => '<option>' + y + '</option>').join('') + '</select>' +
      '<button type="button" class="btn btn-primary" onclick="expPrintMonth()"><i class="fas fa-print"></i> মাসিক প্রিন্ট</button></div>' +
      '<div id="expMonthView"></div></div></div>';
    _expBuilt = true;
  }
  const [y, mo] = _expYM.split('-');
  const ms = document.getElementById('expMonthSel'), ys = document.getElementById('expYearSel');
  if (ys && ![...ys.options].some(o => o.value === y)) ys.insertAdjacentHTML('beforeend', '<option>' + y + '</option>');
  if (ms) ms.value = mo; if (ys) ys.value = y;
  expRenderDraft(); expRenderMonth();
  FDB.getAll('expenses').then(() => expRenderMonth()).catch(() => {});
}
function expYMChanged() { _expYM = document.getElementById('expYearSel').value + '-' + document.getElementById('expMonthSel').value; expRenderMonth(); }

function expRenderDraft() {
  const box = document.getElementById('expDraft'); if (!box) return;
  box.innerHTML = '<datalist id="expCatList">' + _expCats().map(c => '<option value="' + _esc(c) + '">').join('') + '</datalist>' +
    _expDraft.map((r, i) =>
      '<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
      '<input class="form-input exp-date" data-i="' + i + '" value="' + _esc(r.date) + '" placeholder="তারিখ">' +
      '<input class="form-input" list="expCatList" placeholder="খরচের ধরন (বাছুন বা লিখুন)" value="' + _esc(r.cat) + '" oninput="expRowSet(' + i + ',\'cat\',this.value)">' +
      '<input class="form-input" style="grid-column:1/-1;" placeholder="বিবরণ (কোথায় / কী বাবদ)" value="' + _esc(r.details) + '" oninput="expRowSet(' + i + ',\'details\',this.value)">' +
      '<div style="grid-column:1/-1;display:flex;gap:6px;"><input class="form-input" type="number" step="any" inputmode="decimal" placeholder="টাকা ৳" value="' + _esc(r.amount) + '" oninput="expRowSet(' + i + ',\'amount\',this.value)">' +
      (_expEditId ? '' : '<button type="button" class="btn btn-danger btn-sm" onclick="expRowDel(' + i + ')" title="বাদ দিন"><i class="fas fa-times"></i></button>') + '</div></div>').join('');
  if (typeof flatpickr !== 'undefined') box.querySelectorAll('.exp-date').forEach(el => {
    flatpickr(el, { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: false, disableMobile: true, defaultDate: el.value || null,
      onChange: [(sel, str) => expRowSet(+el.dataset.i, 'date', str)] });
  });
  const ab = document.getElementById('expAddRowBtn'); if (ab) ab.style.display = _expEditId ? 'none' : '';
  expDraftTotal();
}
function expDraftTotal() {
  const el = document.getElementById('expDraftTotal'); if (!el) return;
  const t = _expDraft.reduce((a, r) => a + _n(r.amount), 0);
  el.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>মোট খরচ</span><b style="color:var(--accent);font-size:1.05rem;">' + money(t) + '</b></div><div style="font-size:.74rem;color:var(--text-muted);margin-top:4px;">' + takaInWords(t) + '</div>';
}
function expRowSet(i, k, v) { if (_expDraft[i]) { _expDraft[i][k] = v; if (k === 'amount') expDraftTotal(); } }
function expRowAdd() { const last = _expDraft[_expDraft.length - 1]; _expDraft.push(Object.assign(_expNewRow(), last ? { date: last.date } : {})); expRenderDraft(); }
function expRowDel(i) { _expDraft.splice(i, 1); if (!_expDraft.length) _expDraft.push(_expNewRow()); expRenderDraft(); }
function expDraftReset() {
  _expEditId = null; _expDraft = [_expNewRow()];
  const b = document.getElementById('expEditBanner'); if (b) b.style.display = 'none';
  const sb = document.getElementById('expSaveBtn'); if (sb) sb.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> সেভ করুন';
  expRenderDraft();
}
async function expSave() {
  const rows = _expDraft.filter(r => _n(r.amount) > 0);
  if (!rows.length) { showToast('কমপক্ষে একটি খরচের টাকা দিন', 'error'); return; }
  let ok = true;
  for (const r of rows) {
    const id = _expEditId || ('EXP' + Date.now() + Math.floor(Math.random() * 1000));
    const rec = { cat: String(r.cat).trim() || 'অন্যান্য', details: String(r.details).trim(), amount: _r2(_n(r.amount)), date: r.date || isoLocal(new Date()), createdAt: new Date().toISOString() };
    if (_expEditId) delete rec.createdAt;
    if (!(await FDB.save('expenses', id, rec))) ok = false;
  }
  showToast(ok ? (_expEditId ? 'খরচ আপডেট হয়েছে ✅' : rows.length + ' টি খরচ সেভ হয়েছে ✅') : 'শুধু এই ডিভাইসে সেভ হয়েছে', ok ? 'success' : 'error');
  const d = rows[0].date || isoLocal(new Date()); _expYM = d.slice(0, 7);
  expDraftReset(); expInit();
}
function expEdit(id) {
  const e = _expAll().find(x => x.id === id); if (!e) return;
  _expEditId = id; _expDraft = [{ date: e.date, cat: e.cat, details: e.details, amount: e.amount }];
  const b = document.getElementById('expEditBanner'); if (b) { b.style.display = 'block'; b.innerHTML = '<i class="fas fa-pen"></i> সম্পাদনা চলছে — পরিবর্তন করে "আপডেট" চাপুন <button type="button" class="btn btn-ghost btn-sm" onclick="expDraftReset()" style="margin-left:6px;">বাতিল</button>'; }
  const sb = document.getElementById('expSaveBtn'); if (sb) sb.innerHTML = '<i class="fas fa-sync-alt"></i> আপডেট';
  expRenderDraft(); const p = document.getElementById('expDraft'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function expDelete(id) {
  if (!confirm('এই খরচটি মুছে ফেলবেন?')) return;
  await FDB.delete('expenses', id); if (_expEditId === id) expDraftReset();
  expRenderMonth(); showToast('খরচ মুছে ফেলা হয়েছে', 'error');
}
function _expMonthList() { return _expAll().filter(e => (e.date || '').slice(0, 7) === _expYM).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))); }
function _expCatSummary(list) { const m = {}; list.forEach(e => { m[e.cat || 'অন্যান্য'] = (m[e.cat || 'অন্যান্য'] || 0) + _n(e.amount); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function expRenderMonth() {
  const box = document.getElementById('expMonthView'); if (!box) return;
  const list = _expMonthList(), total = list.reduce((a, e) => a + _n(e.amount), 0);
  if (!list.length) { box.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:18px;font-size:.85rem;">এই মাসে কোনো খরচ সেভ করা নেই</p>'; return; }
  box.innerHTML = '<div style="background:var(--accent);color:#fff;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span>মাসের মোট খরচ (' + list.length + ' টি)</span><b style="font-size:1.25rem;">' + money(total) + '</b></div>' +
    '<div style="margin-bottom:10px;">' + _expCatSummary(list).map(c => '<div style="display:flex;justify-content:space-between;font-size:.82rem;padding:4px 2px;border-bottom:1px dashed var(--border);"><span>' + _esc(c[0]) + '</span><b>' + money(c[1]) + '</b></div>').join('') + '</div>' +
    list.map(e => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--border);">' +
      '<div style="min-width:0;"><div style="font-weight:600;font-size:.86rem;">' + _esc(e.cat) + ' — <span style="color:var(--accent);">' + money(e.amount) + '</span></div>' +
      '<div style="font-size:.74rem;color:var(--text-muted);">' + fmtDate(e.date) + (e.details ? ' • ' + _esc(e.details) : '') + '</div></div>' +
      '<div style="display:flex;gap:4px;flex-shrink:0;"><button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="expEdit(\'' + e.id + '\')"><i class="fas fa-edit"></i></button>' +
      '<button class="btn btn-danger btn-sm" onclick="expDelete(\'' + e.id + '\')"><i class="fas fa-trash"></i></button></div></div>').join('');
}
function _expPrint(title, sub, list) {
  const s = settings || {}, total = list.reduce((a, e) => a + _n(e.amount), 0);
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Pop-up allow korun', 'warning'); return; }
  const css = '@page{size:A4;margin:12mm}body{font-family:"Hind Siliguri","Noto Sans Bengali",Arial,sans-serif;color:#111;margin:0;padding:8px}h1,h2,h3,p{margin:0}.c{text-align:center}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}th{background:#16a34a;color:#fff;padding:6px 8px;text-align:left}td{border-bottom:1px solid #bbf7d0;padding:6px 8px;vertical-align:top}.r{text-align:right;white-space:nowrap}tfoot td{font-weight:800;background:#f0fdf4;border-top:2px solid #16a34a}';
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + _esc(title) + '</title><style>' + css + '</style></head><body>' +
    '<div class="c"><h2 style="color:#14532d;">' + _esc(s.mktName || '') + '</h2><p style="font-size:12px;">' + _esc(s.mktAddress || '') + '</p></div>' +
    '<div class="c" style="margin:10px 0 2px;"><h3>' + _esc(title) + '</h3><p style="font-size:12px;color:#166534;">' + _esc(sub) + '</p></div>' +
    '<table><thead><tr><th>#</th><th>তারিখ</th><th>খরচের ধরন</th><th>বিবরণ</th><th class="r">টাকা</th></tr></thead><tbody>' +
    list.map((e, i) => '<tr><td>' + (i + 1) + '</td><td>' + fmtDate(e.date) + '</td><td>' + _esc(e.cat) + '</td><td>' + _esc(e.details) + '</td><td class="r">' + money(e.amount) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td colspan="4">মোট খরচ</td><td class="r">' + money(total) + '</td></tr></tfoot></table>' +
    '<p style="font-size:12px;margin-top:6px;">কথায় : ' + takaInWords(total) + '</p>' +
    (_expCatSummary(list).length > 1 ? '<table style="width:60%;margin-top:14px;"><thead><tr><th>খরচের ধরন অনুযায়ী সারাংশ</th><th class="r">টাকা</th></tr></thead><tbody>' + _expCatSummary(list).map(c => '<tr><td>' + _esc(c[0]) + '</td><td class="r">' + money(c[1]) + '</td></tr>').join('') + '</tbody></table>' : '') +
    '<div style="display:flex;justify-content:flex-end;margin-top:40px;font-size:12px;"><div style="text-align:center;">' + (typeof ownerSignature !== 'undefined' && ownerSignature ? '<img src="' + ownerSignature + '" style="height:40px;display:block;margin:0 auto 2px;">' : '<div style="height:40px;"></div>') + '<div style="border-top:1px solid #16a34a;padding-top:3px;min-width:130px;">জমিদারের স্বাক্ষর</div></div></div>' +
    '</body></html>');
  win.document.close(); win.focus(); setTimeout(() => win.print(), 600);
}
function expPrintMonth() {
  const list = _expMonthList(); if (!list.length) { showToast('এই মাসে প্রিন্ট করার মতো খরচ নেই', 'error'); return; }
  const [y, mo] = _expYM.split('-');
  _expPrint('মাসিক খরচের হিসাব', BN_MONTHS[+mo - 1] + ' ' + y, list);
}
function expPrintDraft() {
  const list = _expDraft.filter(r => _n(r.amount) > 0).map(r => ({ date: r.date, cat: String(r.cat).trim() || 'অন্যান্য', details: r.details, amount: _n(r.amount) }));
  if (!list.length) { showToast('কমপক্ষে একটি খরচের টাকা দিন', 'error'); return; }
  _expPrint('খরচের হিসাব', 'তারিখ: ' + fmtDate(isoLocal(new Date())), list);
}

// ── memo builder ─────────────────────────────────────────────
let _memoItems = [];
let _memoTables = [];
let currentMemo = null;

function memoInit() {
  renderCalcTabs(); calcSelect(_calcActive);
  const mt = document.getElementById('mType');
  if (mt && !mt.options.length) { mt.innerHTML = memoTypeOptions().map(t => '<option value="' + _esc(t) + '">' + _esc(t) + '</option>').join('') + '<option value="__custom">✏️ নিজে লিখুন (Custom)</option>'; memoTypeChanged(); }
  const sel = document.getElementById('mTenant');
  if (sel) sel.innerHTML = '<option value="">-- ভাড়াটিয়া (ঐচ্ছিক) --</option>' + (tenants || []).filter(t => !t.archived).map(t => '<option value="' + t.id + '">' + _esc(t.name) + ' - ' + _esc(t.shop) + '</option>').join('');
  const dl = document.getElementById('mCollectorList'); if (dl) dl.innerHTML = getCollectorList().map(n => '<option value="' + _esc(n) + '">').join('');
  const d = document.getElementById('mDate'); if (d && !d.value) d.value = isoLocal(new Date());
  if (!_memoItems.length) _memoItems.push({ desc: '', qty: 1, rate: '' });
  memoRenderItems(); memoRenderHistory();
  FDB.getAll('memos').then(() => memoRenderHistory()).catch(() => {});
}
function memoTypeOptions() {
  return ['নগদ মেমো', 'টাকা প্রাপ্তি রসিদ'].concat(CALCS.map(c => c.title));
}
function memoTypeChanged() {
  const sel = document.getElementById('mType'), cu = document.getElementById('mTypeCustom'); if (!sel || !cu) return;
  cu.style.display = sel.value === '__custom' ? 'block' : 'none';
  if (sel.value === '__custom') cu.focus();
}
function memoTypeValue() {
  const sel = document.getElementById('mType'); if (!sel) return 'নগদ মেমো';
  return sel.value === '__custom' ? ((document.getElementById('mTypeCustom') || {}).value || '').trim() || 'মেমো' : (sel.value || 'নগদ মেমো');
}
function memoSetTenant(id) {
  const tn = tenants.find(t => t.id === id);
  const sel = document.getElementById('mTenant'); if (sel) sel.value = id || '';
  if (tn) {
    document.getElementById('mName').value = tn.name || '';
    document.getElementById('mShop').value = tn.shop || '';
    document.getElementById('mMobile').value = tn.mobile || '';
  }
}
function memoTenantChanged() { memoSetTenant(document.getElementById('mTenant').value); }

function memoRenderItems() {
  const box = document.getElementById('mItems'); if (!box) return;
  box.innerHTML = _memoItems.map((it, i) =>
    '<div style="display:grid;grid-template-columns:1fr 70px 100px 32px;gap:6px;margin-bottom:6px;align-items:center;">' +
    '<input class="form-input" placeholder="বিবরণ" value="' + _esc(it.desc) + '" oninput="memoItemSet(' + i + ',\'desc\',this.value)">' +
    '<input class="form-input" type="number" step="any" inputmode="decimal" placeholder="পরিমাণ" value="' + _esc(it.qty) + '" oninput="memoItemSet(' + i + ',\'qty\',this.value)">' +
    '<input class="form-input" type="number" step="any" inputmode="decimal" placeholder="দর ৳" value="' + _esc(it.rate) + '" oninput="memoItemSet(' + i + ',\'rate\',this.value)">' +
    '<button type="button" class="btn btn-danger btn-sm" onclick="memoItemDel(' + i + ')" title="মুছুন"><i class="fas fa-times"></i></button></div>').join('');
  const tb = document.getElementById('mTables');
  if (tb) tb.innerHTML = _memoTables.map((t, i) => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px;margin-bottom:6px;border:1px dashed #86efac;border-radius:8px;font-size:.84rem;background:#f0fdf4;">' +
    '<span><i class="fas fa-table" style="color:var(--accent);margin-right:6px;"></i><b>' + _esc(t.title) + '</b> • ' + t.rows.length + ' সারি' + (t.counts ? ' • ' + money(t.total) : '') + '</span>' +
    '<button type="button" class="btn btn-danger btn-sm" onclick="memoTableDel(' + i + ')"><i class="fas fa-times"></i></button></div>').join('');
  memoTotals();
}
function memoTableDel(i) { _memoTables.splice(i, 1); memoRenderItems(); }
function memoItemSet(i, k, v) { if (_memoItems[i]) { _memoItems[i][k] = v; memoTotals(); } }
function memoItemDel(i) { _memoItems.splice(i, 1); if (!_memoItems.length) _memoItems.push({ desc: '', qty: 1, rate: '' }); memoRenderItems(); }
function memoAddRow() { _memoItems.push({ desc: '', qty: 1, rate: '' }); memoRenderItems(); }
function memoCompute() {
  const sub = _memoItems.reduce((a, it) => a + _n(it.qty) * _n(it.rate), 0) + _memoTables.reduce((a, t) => a + (t.counts ? _n(t.total) : 0), 0);
  const disc = _n((document.getElementById('mDisc') || {}).value), total = sub - disc, paid = _n((document.getElementById('mPaid') || {}).value);
  return { sub, disc, total, paid, due: total - paid };
}

function memoTotals() {
  const t = memoCompute(), el = document.getElementById('mTotals'); if (!el) return;
  el.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>মোট</span><b>' + money(t.sub) + '</b></div>' +
    (t.disc ? '<div style="display:flex;justify-content:space-between;"><span>ছাড়</span><b>−' + money(t.disc) + '</b></div>' : '') +
    '<div style="display:flex;justify-content:space-between;font-size:1.05rem;"><span>সর্বমোট</span><b style="color:var(--accent);">' + money(t.total) + '</b></div>' +
    (t.paid ? '<div style="display:flex;justify-content:space-between;"><span>পরিশোধিত</span><b>' + money(t.paid) + '</b></div><div style="display:flex;justify-content:space-between;"><span>' + (t.due > 0 ? 'বাকি' : 'ফেরত/অতিরিক্ত') + '</span><b style="color:' + (t.due > 0 ? '#dc2626' : '#16a34a') + ';">' + money(Math.abs(t.due)) + '</b></div>' : '') +
    '<div style="font-size:.74rem;color:var(--text-muted);margin-top:4px;">' + takaInWords(t.total) + '</div>';
}
function memoReset() {
  _memoEditId = null; _memoEditMeta = null; memoEditUI(false);
  _memoItems = [{ desc: '', qty: 1, rate: '' }]; _memoTables = [];
  const _mt = document.getElementById('mType'); if (_mt) { _mt.value = 'নগদ মেমো'; memoTypeChanged(); }
  ['mTenant', 'mName', 'mShop', 'mMobile', 'mDisc', 'mPaid', 'mNote', 'mTypeCustom'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  document.getElementById('mDate').value = isoLocal(new Date());
  memoRenderItems();
}

function nextMemoNo() {
  const d = new Date(), ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const same = DB.get('memos').filter(m => (m.no || '').startsWith('M-' + ymd)).length;
  return 'M-' + ymd + '-' + String(same + 1).padStart(3, '0');
}

function memoHtml(m) {
  const s = settings || {};
  const sig = typeof ownerSignature !== 'undefined' && ownerSignature
    ? '<img src="' + ownerSignature + '" style="height:36px;object-fit:contain;display:block;margin:0 0 4px auto;">'
    : '<div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin:0 0 4px auto;"></div>';
  const rows = (m.items || []).map((it, i) =>
    '<tr><td>' + (i + 1) + '</td><td class="slip-note">' + _esc(it.desc) + '</td><td class="r">' + _esc(it.qty) + '</td><td class="r">' + money(_n(it.rate)) + '</td><td class="r"><b>' + money(_n(it.qty) * _n(it.rate)) + '</b></td></tr>').join('');
  return '<div class="slip-copy" style="margin-bottom:0;border-top:4px solid #14532d;">' +
    '<div class="slip-decorative" style="margin-bottom:10px;"></div>' +
    '<div style="text-align:center;margin-bottom:10px;">' +
    '<div class="slip-title-bn">' + _esc(s.mktName || 'হাজী চাঁন মিয়া মার্কেট') + '</div>' +
    '<div class="slip-sub-bn">' + _esc(s.mktAddress || '') + '</div>' +
    '<div class="slip-sub-bn">ফোন : ' + _esc(s.mktPhone || '') + '</div></div>' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
    '<div class="slip-stamp">' + _esc(m.title || 'নগদ মেমো') + '</div>' +
    '<div style="font-size:.9rem;font-weight:800;color:#14532d;">নং-' + _esc(m.no) + '</div>' +
    '<div style="margin-left:auto;font-size:.84rem;color:#166534;">তারিখ: <span class="slip-field">' + fmtDate(m.date) + '</span></div></div>' +
    '<div class="memo-meta">' +
    '<div>নাম : <span class="slip-field">' + _esc(m.name || '-') + '</span></div>' +
    (m.shop ? '<div>দোকান : <span class="slip-field">' + _esc(m.shop) + '</span></div>' : '') +
    (m.mobile ? '<div>মোবাইল : <span class="slip-field">' + _esc(m.mobile) + '</span></div>' : '') + '</div>' +
    ((m.items || []).length ? '<table class="memo-table"><thead><tr><th>#</th><th>বিবরণ</th><th class="r">পরিমাণ</th><th class="r">দর</th><th class="r">টাকা</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
    (m.tables || []).map(calcTableHtml).join('') +
    '<div class="memo-sum"><div><span>মোট</span><span>' + money(m.sub) + '</span></div>' +
    (m.disc ? '<div><span>ছাড়</span><span>−' + money(m.disc) + '</span></div>' : '') +
    '<div class="tot"><span>সর্বমোট</span><span>' + money(m.total) + '</span></div>' +
    (m.paid ? '<div><span>পরিশোধিত</span><span>' + money(m.paid) + '</span></div><div style="color:' + (m.due > 0 ? '#dc2626' : '#16a34a') + ';font-weight:700;"><span>' + (m.due > 0 ? 'বাকি' : 'পূর্ণ পরিশোধিত') + '</span><span>' + (m.due > 0 ? money(m.due) : '✓') + '</span></div>' : '') + '</div>' +
    '<div class="memo-words">কথায় : <span class="slip-note">' + takaInWords(m.total) + '</span></div>' +
    (m.note ? '<div style="font-size:.8rem;color:#4b5563;">মন্তব্য : <span class="slip-note">' + _esc(m.note) + '</span></div>' : '') +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px;padding-top:10px;border-top:1px dashed #86efac;font-size:.78rem;color:#14532d;">' +
    '<div><div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin-bottom:4px;"></div><div>গ্রহীতার স্বাক্ষর</div></div>' +
    '<div style="text-align:right;">' + (m.collector ? '<div style="margin-bottom:2px;">সংগ্রহকারী: <span class="slip-field">' + _esc(m.collector) + '</span></div>' : '') + sig + '<div>জমিদারের স্বাক্ষর</div></div></div>' +
    '<div class="slip-decorative" style="margin-top:10px;"></div></div>';
}

let _memoEditId = null, _memoEditMeta = null;
async function memoSave(store) {
  const items = _memoItems.filter(it => String(it.desc).trim() || _n(it.rate)).map(it => ({ desc: String(it.desc).trim() || 'বিবরণ নেই', qty: _n(it.qty) || 1, rate: _n(it.rate) }));
  if (!items.length && !_memoTables.length) { showToast('কমপক্ষে একটি আইটেম বা টেবল দিন', 'error'); return; }
  const g = id => (document.getElementById(id) || {}).value || '';
  const t = memoCompute(), editing = !!_memoEditId;
  const m = {
    id: editing ? _memoEditId : 'MEMO' + Date.now(), no: editing ? _memoEditMeta.no : nextMemoNo(), title: memoTypeValue(), date: g('mDate') || isoLocal(new Date()),
    tenantId: g('mTenant'), name: g('mName').trim(), shop: g('mShop').trim(), mobile: g('mMobile').trim(),
    items, tables: JSON.parse(JSON.stringify(_memoTables)), sub: _r2(t.sub), disc: _r2(t.disc), total: _r2(t.total), paid: _r2(t.paid), due: _r2(t.due),
    note: g('mNote').trim(), collector: g('mCollector').trim(), createdAt: editing ? (_memoEditMeta.createdAt || new Date().toISOString()) : new Date().toISOString()
  };
  if (editing) m.updatedAt = new Date().toISOString();
  if (store || editing) {
    const ok = await FDB.save('memos', m.id, m);
    addActivity((editing ? 'মেমো আপডেট: ' : 'মেমো সংরক্ষণ: ') + m.no + (m.name ? ' — ' + m.name : ''), 'file-invoice', '#16a34a');
    showToast(ok ? (editing ? 'মেমো আপডেট হয়েছে ✅' : 'মেমো Firebase-এ সংরক্ষিত হয়েছে ✅') : 'শুধু এই ডিভাইসে সেভ হয়েছে (ইন্টারনেট/লগইন দেখুন)', ok ? 'success' : 'error');
    memoRenderHistory();
    if (editing) memoReset();
    memoOpen(m.id);
  } else {
    memoShow(m);   // tatkhanik: store hobe na
  }
}
function memoShow(m) {
  currentMemo = m;
  document.getElementById('memoSlipContent').innerHTML = '<div class="slip-container" id="printMemoArea" style="max-width:640px;margin:0 auto;">' + memoHtml(m) + '</div>';
  openModal('memoModal');
}
function memoEdit(id) {
  const m = DB.get('memos').find(x => x.id === id); if (!m) return;
  memoReset();
  _memoEditId = id; _memoEditMeta = { no: m.no, createdAt: m.createdAt };
  _memoItems = (m.items || []).map(it => ({ desc: it.desc, qty: it.qty, rate: it.rate })); if (!_memoItems.length) _memoItems.push({ desc: '', qty: 1, rate: '' });
  _memoTables = JSON.parse(JSON.stringify(m.tables || []));
  const sel = document.getElementById('mType');
  if ([...sel.options].some(o => o.value === m.title)) sel.value = m.title; else { sel.value = '__custom'; document.getElementById('mTypeCustom').value = m.title || ''; }
  memoTypeChanged();
  const set = (i, v) => { const e = document.getElementById(i); if (e) e.value = v == null ? '' : v; };
  set('mTenant', m.tenantId); set('mName', m.name); set('mShop', m.shop); set('mMobile', m.mobile); set('mCollector', m.collector);
  set('mDate', m.date); set('mDisc', m.disc || ''); set('mPaid', m.paid || ''); set('mNote', m.note);
  memoRenderItems(); memoEditUI(true, m.no);
  const pn = document.getElementById('memoPanel'); if (pn) pn.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function memoEditUI(on, no) {
  const b = document.getElementById('memoEditBanner');
  if (b) { b.style.display = on ? 'block' : 'none'; b.innerHTML = on ? '<i class="fas fa-pen"></i> সম্পাদনা চলছে: <b>' + _esc(no) + '</b> — পরিবর্তন করে "আপডেট করুন" চাপুন' : ''; }
  const sh = (id, v) => { const e = document.getElementById(id); if (e) e.style.display = v ? '' : 'none'; };
  sh('memoBtnMake', !on); sh('memoBtnStore', !on); sh('memoBtnUpdate', on); sh('memoBtnCancel', on);
}
function memoOpen(id) {
  const m = DB.get('memos').find(x => x.id === id); if (!m) return;
  memoShow(m);
}
function memoRenderHistory() {
  const box = document.getElementById('memoHistory'); if (!box) return;
  const list = DB.get('memos').slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 30);
  box.innerHTML = list.length ? list.map(m =>
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--border);">' +
    '<div style="min-width:0;"><div style="font-weight:600;font-size:.86rem;">' + _esc(m.no) + ' • ' + _esc(m.name || 'নাম নেই') + '</div>' +
    '<div style="font-size:.74rem;color:var(--text-muted);">' + fmtDate(m.date) + ' • ' + _esc(m.title) + ' • <b>' + money(m.total) + '</b></div></div>' +
    '<div style="display:flex;gap:4px;"><button class="btn btn-primary btn-sm" onclick="memoOpen(\'' + m.id + '\')" title="দেখুন"><i class="fas fa-eye"></i></button>' +
    '<button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="memoEdit(\'' + m.id + '\')" title="Update"><i class="fas fa-edit"></i> Update</button>' +
    '<button class="btn btn-danger btn-sm" onclick="memoDelete(\'' + m.id + '\')" title="Delete"><i class="fas fa-trash"></i> Delete</button></div></div>').join('')
    : '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:.84rem;">কোনো সংরক্ষিত মেমো নেই। মেমো বানানোর সময় "সেভ করে মেমো তৈরি করুন" চাপলে এখানে থাকবে।</p>';
}
async function memoDelete(id) {
  if (!confirm('এই মেমো মুছে ফেলতে চান?')) return;
  await FDB.delete('memos', id);
  if (_memoEditId === id) memoReset();
  memoRenderHistory(); showToast('মেমো মুছে ফেলা হয়েছে', 'error');
}
function memoPrint() {
  const el = document.getElementById('printMemoArea'); if (!el) return;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Pop-up allow korun', 'warning'); return; }
  win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + _esc(currentMemo ? currentMemo.no : 'মেমো') + '</title><style>' + SLIP_PRINT_CSS + MEMO_EXTRA_CSS + '</style></head><body>' + el.outerHTML + '</body></html>');
  win.document.close(); win.focus(); setTimeout(() => win.print(), 800);
}
async function memoJPG() {
  const el = document.getElementById('printMemoArea');
  if (!el || typeof html2canvas === 'undefined') { showToast('ছবি তৈরি করা যায়নি', 'error'); return; }
  showToast('ছবি তৈরি হচ্ছে...');
  try {
    const canvas = await slipCanvas(el), a = document.createElement('a');
    a.download = 'memo_' + (currentMemo ? currentMemo.no : Date.now()) + '.jpg'; a.href = canvas.toDataURL('image/jpeg', 0.95); a.click();
    showToast('JPG ডাউনলোড হচ্ছে ✅');
  } catch (e) { showToast('JPG তৈরিতে সমস্যা', 'error'); }
}
async function memoWhatsApp() {
  if (!currentMemo) return;
  const m = currentMemo, mob = (m.mobile || '').replace(/[^0-9]/g, '');
  const text = '📋 *' + (m.title || 'মেমো') + ' - ' + (settings.mktName || '') + '*\n\nনং: ' + m.no + '\nতারিখ: ' + fmtDate(m.date) + (m.name ? '\nনাম: ' + m.name : '') + (m.shop ? '\nদোকান: ' + m.shop : '') + '\n\n' +
    (m.items || []).map((it, i) => (i + 1) + '. ' + it.desc + ' — ' + money(_n(it.qty) * _n(it.rate))).join('\n') + (m.tables || []).map(t => '\n*' + t.title + '*\n' + t.rows.map(r => r.join(' | ')).join('\n') + (t.foot ? '\n' + t.foot.filter(Boolean).join(' | ') : '')).join('\n') + '\n\n*সর্বমোট: ' + money(m.total) + '*' + (m.paid ? '\nপরিশোধিত: ' + money(m.paid) + '\n' + (m.due > 0 ? 'বাকি: ' + money(m.due) : '✓ পূর্ণ পরিশোধিত') : '') + '\n\nধন্যবাদ।';
  const url = 'https://wa.me/' + (mob ? (mob.startsWith('88') ? mob : '88' + mob) : '') + '?text=' + encodeURIComponent(text);
  const el = document.getElementById('printMemoArea');
  try {
    if (el && typeof html2canvas !== 'undefined' && navigator.share && navigator.canShare) {
      const canvas = await slipCanvas(el), blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
      const file = new File([blob], 'memo_' + m.no + '.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: m.title + ' ' + m.no }); return; }
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  window.open(url, '_blank');
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  initDatePickers();
  startAuthWatcher();
});
document.addEventListener('keydown', e=>{
  if (e.key==='Enter'&&document.getElementById('loginPage').style.display!=='none') doLogin();
  if (e.ctrlKey&&e.key==='n') { e.preventDefault(); showPage('rentCollection'); openRentModal(); }
});