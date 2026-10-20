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
    activeContracts:'সক্রিয়', leaveRequests:'ছাড়ার আবেদন', archived:'পুরাতন ভাড়াটিয়া',
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
    activeContracts:'Active', leaveRequests:'Leave Requests', archived:'Old Tenants',
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

// doLogin / resetPassword — নিচে "লগইন আপগ্রেড" অংশে আছে

async function doLogout() {
  if (!await uiConfirm('লগআউট করতে চান?')) return;
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
      ['tenants','shops','payments','activities','archivedTenants','leaveRequests','agreements','memos','expenses','advLedger','agreementDocs'].forEach(k => localStorage.removeItem(k));
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
  if (rMonth) rMonth.value = rentDueMonth(now).name;
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
  ownerSigUI();
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
  else if (pageId==='agWriter')       agwInit();
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
// ============================================================
// সুন্দর বার্তা: টোস্ট (alert/warning) + কনফার্ম ডায়ালগ — ওয়েবসাইটের সবুজ থিমে, ডার্ক মোডসহ
// ============================================================
(function injectUiMsgCss() {
  if (document.getElementById('uiMsgCss')) return;
  const st = document.createElement('style'); st.id = 'uiMsgCss';
  st.textContent = `
  #toastBox{position:fixed;right:16px;bottom:70px;z-index:10050;display:flex;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none;max-width:calc(100vw - 32px);}
  .ui-toast{--c:#16a34a;--t:#dcfce7;pointer-events:auto;position:relative;display:flex;align-items:flex-start;gap:11px;width:min(360px,calc(100vw - 32px));background:var(--bg-card,#fff);color:var(--text-primary,#14532d);border:1px solid var(--border,#bbf7d0);border-left:5px solid var(--c);border-radius:14px;padding:12px 38px 14px 12px;box-shadow:0 10px 30px rgba(20,83,45,.18),0 2px 6px rgba(0,0,0,.06);font-family:var(--font-bn,'Noto Sans Bengali',sans-serif);overflow:hidden;opacity:0;transform:translateX(30px) scale(.97);transition:opacity .3s,transform .3s cubic-bezier(.2,.8,.2,1);}
  .ui-toast.show{opacity:1;transform:none;}
  .ui-toast.error{--c:#dc2626;--t:#fee2e2;}.ui-toast.warning{--c:#d97706;--t:#fef3c7;}.ui-toast.info{--c:#2563eb;--t:#dbeafe;}
  [data-theme="dark"] .ui-toast{--t:rgba(255,255,255,.08);}
  .ui-toast .ti{flex:0 0 34px;height:34px;border-radius:50%;background:var(--t);color:var(--c);display:flex;align-items:center;justify-content:center;font-size:1rem;}
  .ui-toast .tb{flex:1;min-width:0;}
  .ui-toast .tt{font-weight:700;font-size:.8rem;color:var(--c);margin-bottom:1px;}
  .ui-toast .tm{font-size:.86rem;line-height:1.45;word-break:break-word;color:var(--text-primary,#14532d);}
  .ui-toast .tx{position:absolute;top:8px;right:8px;width:24px;height:24px;border:none;border-radius:50%;background:transparent;color:var(--text-muted,#6b7280);cursor:pointer;font-size:.8rem;}
  .ui-toast .tx:hover{background:var(--t);color:var(--c);}
  .ui-toast .tp{position:absolute;left:0;bottom:0;height:3px;background:var(--c);opacity:.55;width:100%;transform-origin:left;animation:uiToastBar linear forwards;}
  @keyframes uiToastBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
  .ui-dlg-ov{position:fixed;inset:0;z-index:10060;background:rgba(10,26,16,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s;}
  .ui-dlg-ov.show{opacity:1;}
  .ui-dlg{--c:#16a34a;--t:#dcfce7;width:min(420px,100%);background:var(--bg-card,#fff);color:var(--text-primary,#14532d);border:1px solid var(--border,#bbf7d0);border-radius:20px;box-shadow:0 24px 60px rgba(0,0,0,.35);padding:24px 22px 18px;text-align:center;font-family:var(--font-bn,'Noto Sans Bengali',sans-serif);transform:translateY(14px) scale(.96);transition:transform .25s cubic-bezier(.2,.8,.2,1);}
  .ui-dlg-ov.show .ui-dlg{transform:none;}
  .ui-dlg.danger{--c:#dc2626;--t:#fee2e2;}.ui-dlg.warning{--c:#d97706;--t:#fef3c7;}
  [data-theme="dark"] .ui-dlg{--t:rgba(255,255,255,.08);}
  .ui-dlg .di{width:58px;height:58px;border-radius:50%;margin:0 auto 12px;background:var(--t);color:var(--c);display:flex;align-items:center;justify-content:center;font-size:1.5rem;box-shadow:0 0 0 7px color-mix(in srgb,var(--c) 12%,transparent);}
  .ui-dlg .dt{font-weight:800;font-size:1.02rem;margin-bottom:6px;}
  .ui-dlg .dm{font-size:.88rem;line-height:1.6;color:var(--text-secondary,#166534);white-space:pre-line;word-break:break-word;}
  .ui-dlg .db{display:flex;gap:10px;margin-top:18px;}
  .ui-dlg .db button{flex:1;padding:10px 14px;border-radius:11px;font:inherit;font-weight:700;font-size:.88rem;cursor:pointer;border:1.5px solid var(--border,#bbf7d0);background:transparent;color:var(--text-primary,#14532d);transition:transform .1s,filter .15s;}
  .ui-dlg .db button:hover{filter:brightness(.96);}.ui-dlg .db button:active{transform:scale(.97);}
  .ui-dlg .db .ok{background:var(--c);border-color:var(--c);color:#fff;}
  .ui-dlg .db button:focus-visible{outline:3px solid color-mix(in srgb,var(--c) 40%,transparent);outline-offset:1px;}
  .dash-clock{display:inline-flex;align-items:center;gap:7px;margin-left:10px;padding:3px 11px 3px 9px;border-radius:999px;background:linear-gradient(135deg,#14532d,#16a34a);color:#fff;font-size:.82rem;font-weight:700;letter-spacing:.04em;font-variant-numeric:tabular-nums;box-shadow:0 2px 8px rgba(22,163,74,.3);font-family:'Segoe UI',Roboto,Arial,sans-serif;vertical-align:middle;}
  .dash-clock i{font-size:.78rem;opacity:.9;}
  `;
  document.head.appendChild(st);
})();
const _TOAST = {
  success: { icon: 'fa-check', title: 'সফল হয়েছে' },
  error:   { icon: 'fa-exclamation', title: 'সমস্যা হয়েছে' },
  warning: { icon: 'fa-triangle-exclamation', title: 'সতর্কতা' },
  info:    { icon: 'fa-info', title: 'তথ্য' }
};
function showToast(msg, type = 'success') {
  type = _TOAST[type] ? type : 'success';
  let box = document.getElementById('toastBox');
  if (!box) { box = document.createElement('div'); box.id = 'toastBox'; document.body.appendChild(box); }
  while (box.children.length >= 4) box.firstChild.remove();
  const ms = type === 'error' || type === 'warning' ? 5000 : 3500;
  const t = document.createElement('div'); t.className = 'ui-toast ' + type; t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.innerHTML = '<div class="ti"><i class="fas ' + _TOAST[type].icon + '"></i></div><div class="tb"><div class="tt">' + _TOAST[type].title + '</div><div class="tm"></div></div><button class="tx" aria-label="বন্ধ করুন"><i class="fas fa-times"></i></button><div class="tp" style="animation-duration:' + ms + 'ms"></div>';
  t.querySelector('.tm').textContent = msg;
  box.appendChild(t);
  let gone = false;
  const close = () => { if (gone) return; gone = true; t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  t.querySelector('.tx').onclick = close;
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  let timer = setTimeout(close, ms);
  t.addEventListener('mouseenter', () => { clearTimeout(timer); t.querySelector('.tp').style.animationPlayState = 'paused'; });
  t.addEventListener('mouseleave', () => { t.querySelector('.tp').style.animationPlayState = 'running'; timer = setTimeout(close, 1500); });
}
// confirm() এর সুন্দর রূপ — await uiConfirm('...') → true/false
function uiConfirm(msg, o) {
  o = o || {};
  const text = String(msg || '');
  const danger = o.type ? o.type === 'danger' : /মুছ|ডিলিট|delete|প্রতিস্থাপন/i.test(text);
  const type = o.type || (danger ? 'danger' : (/লগআউট/.test(text) ? 'warning' : 'info'));
  const icon = o.icon || (danger ? 'fa-trash-can' : (/লগআউট/.test(text) ? 'fa-right-from-bracket' : 'fa-circle-question'));
  const parts = text.split('\n\n'); const head = parts.length > 1 ? parts.shift() : '', body = parts.length ? parts.join('\n\n') : text;
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'ui-dlg-ov';
    ov.innerHTML = '<div class="ui-dlg ' + (type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : '') + '" role="alertdialog" aria-modal="true"><div class="di"><i class="fas ' + icon + '"></i></div>' +
      '<div class="dt"></div><div class="dm"></div><div class="db"><button type="button" class="no"></button><button type="button" class="ok"></button></div></div>';
    ov.querySelector('.dt').textContent = o.title || (danger ? 'আপনি কি নিশ্চিত?' : (type === 'warning' ? 'নিশ্চিত করুন' : 'নিশ্চিত করুন'));
    ov.querySelector('.dm').textContent = head ? head + '\n\n' + body : body;
    ov.querySelector('.no').textContent = o.no || 'না, বাতিল';
    ov.querySelector('.ok').textContent = o.yes || (danger ? 'হ্যাঁ, মুছুন' : 'হ্যাঁ, নিশ্চিত');
    document.body.appendChild(ov);
    const prev = document.activeElement;
    const done = v => { document.removeEventListener('keydown', key, true); ov.classList.remove('show'); setTimeout(() => ov.remove(), 220); try { prev && prev.focus && prev.focus(); } catch (e) {} res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter' && document.activeElement === ov.querySelector('.ok')) { e.stopPropagation(); } };
    document.addEventListener('keydown', key, true);
    ov.querySelector('.no').onclick = () => done(false);
    ov.querySelector('.ok').onclick = () => done(true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) done(false); });
    requestAnimationFrame(() => { ov.classList.add('show'); ov.querySelector(danger ? '.no' : '.ok').focus(); });
  });
}

// ড্যাশবোর্ডের ডিজিটাল ঘড়ি (ইংরেজিতে, সেকেন্ডসহ)
(function dashClockTick() {
  const tick = () => {
    const el = document.getElementById('dashClockTxt'); if (!el) return;
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  };
  tick(); setInterval(tick, 1000);
})();

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
// বার্ষিক ভাড়া বৃদ্ধি + স্বাক্ষর অন/অফ
// ============================================================
const _BNM = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
// চুক্তি শুরুর মাস থেকে প্রতি ১২ মাস পূর্ণ হলে একবার করে annualIncrease যোগ হয়
function rentYearsPassed(tn, monthName, year) {
  if (!tn || !tn.startDate) return 0;
  const sd = new Date(tn.startDate + 'T00:00:00'); if (isNaN(sd)) return 0;
  let mi = _BNM.indexOf(monthName), y = parseInt(year, 10);
  const now = new Date();
  if (mi < 0) mi = now.getMonth();
  if (!y) y = now.getFullYear();
  const diff = (y * 12 + mi) - (sd.getFullYear() * 12 + sd.getMonth());
  return Math.max(0, Math.floor(diff / 12));
}
function effectiveRent(tn, monthName, year) {
  const base = parseFloat(tn && tn.rent) || 0, inc = parseFloat(tn && tn.annualIncrease) || 0;
  return base + inc * rentYearsPassed(tn, monthName, year);
}
function updateRentIncreaseHint() {
  const el = document.getElementById('tIncreaseHint'); if (!el) return;
  const inc = parseFloat((document.getElementById('tIncrease') || {}).value) || 0;
  const rent = parseFloat((document.getElementById('tRent') || {}).value) || 0;
  el.textContent = inc > 0 ? 'প্রতি ১২ মাস পূর্ণ হলে ভাড়া ৳' + inc.toLocaleString() + ' করে বাড়বে' + (rent ? ' (১ম বছর ৳' + rent.toLocaleString() + ' → ২য় বছর ৳' + (rent + inc).toLocaleString() + ')' : '') : '';
}
// ভাড়া আগের মাসের জন্য পরের মাসের শুরুতে আসে: জানুয়ারির ভাড়া ফেব্রুয়ারিতে → ডিফল্ট মাস = তারিখের আগের মাস
const RENT_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
function rentDueMonth(ref) {
  const d = ref ? new Date(ref + (String(ref).length <= 10 ? 'T00:00:00' : '')) : new Date();
  const b = isNaN(d) ? new Date() : d;
  const p = new Date(b.getFullYear(), b.getMonth() - 1, 1);
  return { name: RENT_MONTHS[p.getMonth()], idx: p.getMonth(), year: p.getFullYear() };
}
// মাসের নাম + তারিখ থেকে সাল: তারিখের মাসের পরের মাস হলে আগের সাল (জানুয়ারিতে ডিসেম্বরের ভাড়া)
function rentYearFor(monthName, dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date(), b = isNaN(d) ? new Date() : d;
  const mi = RENT_MONTHS.indexOf(monthName);
  return mi > b.getMonth() ? b.getFullYear() - 1 : b.getFullYear();
}
function rentDateChanged() {
  const m = document.getElementById('rMonth'); if (!m) return;
  if (!m.dataset.manual) m.value = rentDueMonth(document.getElementById('rDate').value).name;
  fillRentInfo();
}
const sigOn = () => settings.showOwnerSig !== false;
function ownerSigUI() {
  const b = document.getElementById('ownerSigToggle'), h = document.getElementById('ownerSigToggleHint'); if (!b) return;
  const on = sigOn();
  b.className = on ? 'btn btn-primary btn-sm' : 'btn btn-gray btn-sm';
  b.innerHTML = on ? '<i class="fas fa-toggle-on"></i> চালু' : '<i class="fas fa-toggle-off"></i> বন্ধ';
  if (h) h.textContent = on ? 'রসিদ, মেমো, তথ্যপত্র ও চুক্তিপত্রে জমিদার ও ভাড়াটিয়ার স্বাক্ষর দেখাচ্ছে' : 'কোথাও জমিদার/ভাড়াটিয়ার স্বাক্ষর দেখানো হচ্ছে না';
}
async function toggleOwnerSig() {
  settings.showOwnerSig = !sigOn();
  ownerSigUI();
  await FDB.saveSettings(settings);
  showToast(sigOn() ? 'জমিদার ও ভাড়াটিয়ার স্বাক্ষর চালু হয়েছে ✅' : 'জমিদার ও ভাড়াটিয়ার স্বাক্ষর বন্ধ হয়েছে');
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
  ['tenantId','tName','tMobile','tNid','tDeduction','tRent','tIncrease','tAdvance','tAddress','tNotes','nidFrontData','nidBackData'].forEach(f => { const el=document.getElementById(f); if(el) el.value=''; });
  document.getElementById('nidFrontPreview').innerHTML = nidIcon;
  document.getElementById('nidBackPreview').innerHTML  = nidIcon;
  document.getElementById('photoPreview').innerHTML    = '<i class="fas fa-camera" style="color:var(--accent);font-size:1.2rem;"></i><span style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;">ছবি আপলোড</span>';
  document.getElementById('photoPreview').dataset.photo = '';
  document.getElementById('advanceCalc').style.display = 'none';
  updateRentIncreaseHint();
  populateShopSelect(id);
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
    document.getElementById('tIncrease').value   = tn.annualIncrease||'';
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
    updateAdvanceCalc(); updateRentIncreaseHint();
  } else {
    document.getElementById('tenantModalTitle').textContent = 'নতুন ভাড়াটিয়া যোগ করুন';
  }
  openModal('tenantModal');
}

// দোকান কার কাছে ভাড়া দেওয়া — ভাড়াটিয়ার ডেটা থেকেই (সবসময় সত্য)
const shopTenant = (number, exceptId) => (tenants || []).find(t => !t.archived && t.shop === number && t.id !== exceptId) || null;
function shopEffStatus(s) { return shopTenant(s.number) ? 'occupied' : (s.status === 'maintenance' ? 'maintenance' : 'empty'); }
async function syncShopStatus(number) {
  if (!number) return;
  const si = (shops || []).findIndex(x => x.number === number); if (si < 0) return;
  const want = shopTenant(number) ? 'occupied' : (shops[si].status === 'maintenance' ? 'maintenance' : 'empty');
  if (shops[si].status !== want) { shops[si].status = want; await FDB.save('shops', shops[si].id, shops[si]); }
}
function populateShopSelect(editId) {
  const sel = document.getElementById('tShop');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- দোকান নির্বাচন --</option>';
  shops.forEach(s => {
    const o = document.createElement('option'); o.value = s.number;
    const other = shopTenant(s.number, editId), mine = editId && (tenants || []).some(t => t.id === editId && t.shop === s.number);
    const fl = ' (' + s.floor + ')';
    if (other) { o.textContent = s.number + fl + ' ভাড়া দেওয়া'; o.disabled = true; o.style.opacity = '.4'; }
    else if (mine) { o.textContent = s.number + fl + ' ভাড়া দেওয়া (এই ভাড়াটিয়া)'; }
    else if (s.status === 'maintenance') { o.textContent = s.number + fl + ' রক্ষণাবেক্ষণ'; o.disabled = true; o.style.opacity = '.4'; }
    else o.textContent = s.number + fl + ' খালি';
    sel.appendChild(o);
  });
  if (!shops.length) ['A-01','A-02','B-01','B-02'].forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
}

// দোকান বাছলে তার ফ্লোর নিজে বসে যায়
function tShopChanged() {
  const s = (shops || []).find(x => x.number === document.getElementById('tShop').value); if (!s || !s.floor) return;
  const f = document.getElementById('tFloor');
  if (![...f.options].some(o => o.value === s.floor)) { const o = document.createElement('option'); o.textContent = s.floor; f.appendChild(o); }
  f.value = s.floor;
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
  { const other = shopTenant(shop, id); if (other) { showToast('দোকান ' + shop + ' এখন ' + other.name + '-কে ভাড়া দেওয়া আছে। খালি দোকান বাছুন', 'error'); return; } }
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
    annualIncrease:   parseFloat((document.getElementById('tIncrease')||{}).value)||0,
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
  { const oldShop = id && existing ? existing.shop : ''; await syncShopStatus(shop); if (oldShop && oldShop !== shop) await syncShopStatus(oldShop); renderShops(); }
  addActivity((id?'ভাড়াটিয়া সম্পাদিত: ':'নতুন ভাড়াটিয়া: ')+name, id?'user-edit':'user-plus', id?'#2563eb':'#16a34a');
  showSyncOverlay(false);
  closeModal('tenantModal');
  renderTenants();
  updateNotifications();
  showToast(id?'ভাড়াটিয়ার তথ্য আপডেট হয়েছে ☁️':'নতুন ভাড়াটিয়া যোগ হয়েছে ☁️');
}

function deleteTenant(id) { return tenantMoveToOld(id); }   // মুছলে চুক্তি ট্র্যাকারের "পুরাতন ভাড়াটিয়া"-তে সরে যায়

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
    '<div><b>মাসিক ভাড়া:</b> ৳'+effectiveRent(tn,_BNM[new Date().getMonth()],new Date().getFullYear()).toLocaleString()+(tn.annualIncrease>0?'<div style="font-size:.72rem;color:var(--text-muted);">নির্ধারিত ৳'+(tn.rent||0).toLocaleString()+' • প্রতি বছরে +৳'+tn.annualIncrease.toLocaleString()+'</div>':'')+'</div>'+
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
    '<button onclick="tnSendWhatsApp(\''+tn.id+'\')" class="btn btn-primary btn-sm"><i class="fas fa-paper-plane"></i> WhatsApp পাঠান</button>'+
    '<a href="tel:'+tn.mobile+'" class="btn btn-gray btn-sm"><i class="fas fa-phone"></i> কল</a>'+
    '<button onclick="lfWaChat(\''+(tn.mobile||'')+'\')" class="btn btn-sm" style="background:#25d366;color:#fff;" title="ভাড়াটিয়ার সাথে সরাসরি WhatsApp চ্যাট"><i class="fab fa-whatsapp"></i></button>'+
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
  if (!await uiConfirm('প্রোফাইল ছবিটি মুছে ফেলবেন?')) return;
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
      '<td><span style="font-weight:700;color:var(--accent);">৳'+effectiveRent(tn,_BNM[new Date().getMonth()],new Date().getFullYear()).toLocaleString()+'</span>'+(tn.annualIncrease>0?'<div style="font-size:.68rem;color:var(--text-muted);">নির্ধারিত ৳'+(tn.rent||0).toLocaleString()+' • বছরে +৳'+tn.annualIncrease.toLocaleString()+'</div>':'')+'</td>'+
      '<td><div style="font-size:0.78rem;">অগ্রিম: ৳'+(tn.advance||0).toLocaleString()+'</div>'+
      (deduction(tn)>0?'<div style="font-size:0.75rem;color:var(--text-muted);">অবশিষ্ট: <span style="color:var(--accent);font-weight:600;">৳'+rem.toLocaleString()+'</span></div>':'')+'</td>'+
      '<td><span class="badge '+st.cls+'">'+st.label+'</span></td>'+
      '<td><div style="display:flex;gap:3px;flex-wrap:wrap;">'+
      '<button onclick="viewTenant(\''+tn.id+'\')" class="btn btn-gray btn-sm" title="দেখুন"><i class="fas fa-eye"></i></button>'+
      '<button onclick="openTenantModal(\''+tn.id+'\')" class="btn btn-outline btn-sm" title="সম্পাদনা"><i class="fas fa-edit"></i></button>'+
      '<button onclick="quickRent(\''+tn.id+'\')" class="btn btn-primary btn-sm" title="রসিদ"><i class="fas fa-receipt"></i></button>'+
      '<button onclick="printTenant(\''+tn.id+'\')" class="btn btn-gray btn-sm" title="প্রিন্ট"><i class="fas fa-print"></i></button>'+
      '<button onclick="deleteTenant(\''+tn.id+'\')" class="btn btn-danger btn-sm" title="মুছুন (পুরাতন ভাড়াটিয়ায় যাবে)"><i class="fas fa-trash"></i></button>'+
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

async function printTenant(id) {
  const tn = tenants.find(x => x.id === id);
  if (!tn) { showToast('ভাড়াটিয়া পাওয়া যায়নি', 'error'); return; }
  await tnQrFor(tn);
  lfPrintHtml(tnDossierBody(tn, { title: 'ভাড়াটিয়ার তথ্য পত্র', sign: true }), 'ভাড়াটিয়ার তথ্য - ' + tn.name);
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
  if (!await uiConfirm('এই দোকান মুছে ফেলতে চান?')) return;
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
    s = Object.assign({}, s, { status: shopEffStatus(s) });
    return '<div class="stat-card" style="padding:16px;background:'+(stClr[s.status]||'#fff')+'22;">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">'+
      '<div><div style="font-size:1.2rem;font-weight:800;">'+s.number+'</div><div style="font-size:0.77rem;color:var(--text-muted);">'+s.floor+'</div></div>'+
      '<span class="badge '+stCls[s.status]+'">'+stText[s.status]+'</span></div>'+
      (s.rent?'<div style="font-size:0.85rem;font-weight:700;color:var(--accent);margin-bottom:4px;">৳'+s.rent.toLocaleString()+'/মাস</div>':'')+
      (s.size?'<div style="font-size:0.77rem;color:var(--text-muted);margin-bottom:4px;">'+s.size+' বর্গফুট</div>':'')+
      (tn?'<div style="font-size:0.8rem;padding:4px 8px;background:rgba(22,163,74,0.1);border-radius:6px;margin-bottom:8px;display:flex;align-items:center;gap:7px;">'+(tn.photo?'<img src="'+tn.photo+'" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid var(--accent);">':'<i class="fas fa-user" style="color:var(--accent);"></i>')+'<span>'+tn.name+'</span></div>':'')+
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
  const _rm = document.getElementById('rMonth'); if (_rm) { _rm.dataset.manual = ''; _rm.value = rentDueMonth(new Date()).name; }
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
  const rmEl = document.getElementById('rMonth');
  let mName = rmEl.value, yr = rentYearFor(mName, document.getElementById('rDate').value);
  // চুক্তি শুরুর মাসের আগের মাস ডিফল্ট হলে শুরুর মাসে নেওয়া হবে
  if (!rmEl.dataset.manual && tn.startDate) {
    const sd = new Date(tn.startDate + 'T00:00:00');
    if (!isNaN(sd) && (yr * 12 + RENT_MONTHS.indexOf(mName)) < (sd.getFullYear() * 12 + sd.getMonth())) { mName = RENT_MONTHS[sd.getMonth()]; yr = sd.getFullYear(); rmEl.value = mName; }
  }
  const yrs = rentYearsPassed(tn, mName, yr), rent = effectiveRent(tn, mName, yr);
  document.getElementById('rMonthlyRent').value = rent;
  let note = document.getElementById('rRentNote');
  if (!note) { note = document.createElement('div'); note.id = 'rRentNote'; note.style.cssText = 'font-size:.72rem;color:#92400e;margin-top:3px;'; document.getElementById('rMonthlyRent').insertAdjacentElement('afterend', note); }
  note.textContent = yrs > 0 ? 'বর্ধিত ভাড়া: নির্ধারিত ৳' + (tn.rent||0).toLocaleString() + ' + ৳' + (tn.annualIncrease||0).toLocaleString() + ' × ' + yrs + ' বছর' : '';
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
    month,  year: rentYearFor(month, document.getElementById('rDate').value),
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
  _payFolderOpen[tenantId] = true;
  buildMonthFilters(); renderPayments(); updateNotifications();
  showToast('ভাড়া রসিদ তৈরি হয়েছে ☁️');
  setTimeout(()=>viewSlip(payment.id), 400);
}

let _payFolderOpen = {}, _payFolderStatus = {};
function payFolderStatusSet(key, v) { _payFolderStatus[key] = v; renderPayments(); }
function payFolderToggle(key) { _payFolderOpen[key] = !_payFolderOpen[key]; renderPayments(); }
function _payRowHtml(p, idx) {
  return '<tr>'+
    '<td><span style="font-weight:700;color:var(--accent);">#'+(p.tenantSlipNo||String(idx).padStart(3,'0'))+'</span></td>'+
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
    '</div></td></tr>';
}
function renderPayments() {
  payments = DB.get('payments');
  const monthF  = document.getElementById('rcMonthFilter')?.value||'';
  const statusF = document.getElementById('rcStatusFilter')?.value||'';
  const list = payments.filter(p=>(!monthF||(p.month+' '+p.year)===monthF)&&(!statusF||p.status===statusF));
  const tbody = document.getElementById('paymentTableBody');
  if (!tbody) return;
  const table = tbody.closest('table');
  let box = document.getElementById('paymentFolders');
  if (!box) {
    box = document.createElement('div'); box.id = 'paymentFolders'; box.style.padding = '12px';
    table.insertAdjacentElement('afterend', box);
    table.style.display = 'none';
  }
  // ভাড়াটিয়া অনুযায়ী আলাদা ফোল্ডার
  const g = {};
  list.forEach(p => {
    const key = p.tenantId || ('n_' + (p.tenantName||''));
    const tn = tenants.find(t => t.id === p.tenantId);
    (g[key] = g[key] || { key, name: (tn ? tn.name : p.tenantName) || 'নামহীন', shop: (tn ? tn.shop : p.shop) || '', list: [] }).list.push(p);
  });
  const folders = Object.values(g).sort((a,b) => a.name.localeCompare(b.name, 'bn'));
  folders.forEach(f => f.list.sort((a,b) => (a.slipNo||0) - (b.slipNo||0)));   // পুরোনো -> নতুন, ফোল্ডারের নিজস্ব ক্রম
  const filtering = !!(monthF || statusF);
  const totalReceipts = list.length;
  const head = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:.8rem;">'+
    '<span class="badge badge-blue">মোট ফোল্ডার: '+folders.length+' টি</span>'+
    '<span class="badge badge-green">মোট রসিদ: '+totalReceipts+' টি</span></div>';
  box.innerHTML = head + folders.map(f => {
    const open = _payFolderOpen[f.key] !== undefined ? _payFolderOpen[f.key] : false;
    const fk = String(f.key).replace(/'/g,'%27').replace(/\\/g,'');
    const fst = _payFolderStatus[f.key] || '';
    const shown = fst ? f.list.filter(p => p.status === fst) : f.list;
    const paid = f.list.reduce((a,p)=>a+(p.paid||0),0), due = f.list.reduce((a,p)=>a+(p.due||0),0);
    return '<div style="border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden;">'+
      '<button type="button" onclick="payFolderToggle(\''+fk+'\')" style="width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;background:'+(open?'rgba(22,163,74,.08)':'transparent')+';border:none;cursor:pointer;color:var(--text-primary);font-family:inherit;text-align:left;flex-wrap:wrap;">'+
      '<i class="fas '+(open?'fa-folder-open':'fa-folder')+'" style="color:#f59e0b;font-size:1.1rem;"></i>'+
      '<span style="flex:1;min-width:140px;font-weight:700;font-size:.9rem;">'+_esc(f.name)+(f.shop?' <span style="font-weight:400;font-size:.76rem;color:var(--text-muted);">— '+_esc(f.shop)+'</span>':'')+'</span>'+
      '<span class="badge badge-blue" style="font-size:.74rem;">মোট '+f.list.length+' টি মেমো</span>'+
      '<span style="font-size:.74rem;color:#16a34a;font-weight:600;">পরিশোধিত ৳'+paid.toLocaleString()+'</span>'+
      (due>0?'<span style="font-size:.74rem;color:#dc2626;font-weight:600;">বাকি ৳'+due.toLocaleString()+'</span>':'')+
      '<i class="fas fa-chevron-'+(open?'up':'down')+'" style="font-size:.7rem;color:var(--text-muted);"></i></button>'+
      (open?'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--border);">'+
        '<select onchange="payFolderStatusSet(\''+fk+'\',this.value)" class="form-input form-select" style="width:auto;padding:4px 28px 4px 8px;font-size:.78rem;">'+
        [['','সব অবস্থা'],['paid','পরিশোধিত'],['partial','আংশিক'],['due','বাকি']].map(o=>'<option value="'+o[0]+'"'+(o[0]===fst?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>'+
        '<span style="font-size:.76rem;color:var(--text-muted);">দেখানো হচ্ছে '+shown.length+' / '+f.list.length+' টি</span></div>'+
        '<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>রসিদ নং</th><th>দোকান</th><th>মাস</th><th>মাসিক ভাড়া</th><th>পরিশোধিত</th><th>বাকি</th><th>অবস্থা</th><th>কার্যক্রম</th></tr></thead><tbody>'+(shown.map(p=>_payRowHtml(p, f.list.indexOf(p)+1)).join('')||'<tr><td colspan="8" style="text-align:center;padding:14px;color:var(--text-muted);">এই অবস্থায় কোনো রসিদ নেই</td></tr>')+'</tbody></table></div>':'')+
      '</div>';
  }).join('') || '<div style="text-align:center;padding:30px;color:var(--text-muted);">কোনো পেমেন্ট নেই</div>';
}

async function deletePayment(id) {
  if (!await uiConfirm('এই রসিদ মুছে ফেলতে চান?')) return;
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
    (sigOn()?'<div style="text-align:left;font-size:0.78rem;color:#14532d;"><div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin-bottom:4px;"></div><div>ভাড়াটিয়ার স্বাক্ষর</div></div>':'<div></div>')+
    '<div style="text-align:center;">'+(qrHtml||'')+'</div>'+
    (sigOn()?'<div style="text-align:right;font-size:0.78rem;color:#14532d;display:flex;flex-direction:column;align-items:flex-end;">'+ownerSig+'<div>জমিদারের স্বাক্ষর</div></div>':'<div></div>')+'</div>'+
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
      '<button onclick="openRenewal(\''+tn.id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-sync"></i> নবায়ন</button>'+
      ((tn.renewals&&tn.renewals.length)?'<button onclick="rnLatest(\''+tn.id+'\')" class="btn btn-gray btn-sm" title="সর্বশেষ নবায়নের তথ্য"><i class="fas fa-history"></i> নবায়ন তথ্য</button>':'')+
      '<button onclick="openLeaveRequest(\''+tn.id+'\')" class="btn btn-warning btn-sm"><i class="fas fa-door-open"></i> ছাড়ার আবেদন</button>'+
      '<button onclick="openAgreementUpload(\''+tn.id+'\')" class="btn btn-ghost btn-sm"><i class="fas fa-upload"></i> আপলোড</button>'+
      '<button onclick="openAgreementView(\''+tn.id+'\')" class="btn btn-primary btn-sm"><i class="fas fa-file-pdf"></i> চুক্তি দেখুন</button>'+
      '<button onclick="lfWaChat(\''+(tn.mobile||'')+'\')" class="btn btn-sm" style="background:#25d366;color:#fff;" title="সরাসরি WhatsApp চ্যাট"><i class="fab fa-whatsapp"></i></button>'+
      '<button onclick="tenantMoveToOld(\''+tn.id+'\')" class="btn btn-danger btn-sm" title="ভাড়াটিয়া সেকশন থেকে মুছে পুরাতন ভাড়াটিয়ায় রাখুন"><i class="fas fa-user-times"></i> ভাড়াটিয়া মুছুন</button>'+
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
      '<button onclick="tenantMoveToOld(\''+r.tenantId+'\')" class="btn btn-danger btn-sm"><i class="fas fa-user-times"></i> পুরাতন ভাড়াটিয়ায় সরান</button>'+
      '</div></div>';
  }).join('');
}

async function approveLeaveRequest(reqId, status) {
  await FDB.save('leaveRequests', reqId, {status});
  showToast('আবেদনের অবস্থা আপডেট হয়েছে ✅');
  renderLeaveRequests();
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
  if (!await uiConfirm('এই চুক্তিপত্রটি স্থায়ীভাবে মুছে ফেলতে চান?')) return;
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
  const dueM = rentDueMonth(), thisMonths = dueM.name;
  const mpays    = payments.filter(p=>p.month===dueM.name&&p.year===dueM.year);
  const collected = mpays.reduce((a,b)=>a+(b.paid||0),0);
  const totalDue  = payments.reduce((a,b)=>a+(b.due||0),0);
  const expiring  = activeTenants.filter(t=>{ const s=getAgreementStatus(t); return s.days!==null&&s.days>=0&&s.days<=30; }).length;
  const occupied  = shops.filter(s=>shopEffStatus(s)==='occupied').length;
  const stats=[
    {label:t('totalTenants'),  value:activeTenants.length,         icon:'fa-users',             bg:'#dcfce7',iconBg:'#16a34a'},
    {label:t('totalShops'),    value:shops.length,                  icon:'fa-store-alt',          bg:'#dbeafe',iconBg:'#2563eb'},
    {label:t('monthlyCollection')+' ('+dueM.name+')',value:'৳'+collected.toLocaleString(),icon:'fa-money-bill-wave',bg:'#d1fae5',iconBg:'#059669'},
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
  const occ=shops.filter(s=>shopEffStatus(s)==='occupied').length;
  const emp=shops.filter(s=>shopEffStatus(s)==='empty').length;
  const mnt=shops.filter(s=>shopEffStatus(s)==='maintenance').length;
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
  const occ=shops.filter(s=>shopEffStatus(s)==='occupied').length,emp=shops.filter(s=>shopEffStatus(s)==='empty').length,mnt=shops.filter(s=>shopEffStatus(s)==='maintenance').length;
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
  return (e.tenantName || 'অজানা') + (e.shop ? ' (' + e.shop + ')' : '') + (e.month === 'ভাড়াটিয়া তথ্যপত্র' ? ' এর তথ্যপত্রের QR' : ' এর রসিদ' + (e.month ? ' — ' + e.month + ' ' + (e.year || '') : '')) + ' স্ক্যান করা হয়েছে';
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
  const dueM2=rentDueMonth();
  const paid=new Set(payments.filter(p=>p.month===dueM2.name&&p.year===dueM2.year).map(p=>p.tenantId));
  tenants.filter(t=>!t.archived).forEach(tn=>{
    const sd = tn.startDate ? new Date(tn.startDate+'T00:00:00') : null;
    if (sd && !isNaN(sd) && (dueM2.year*12+dueM2.idx) < (sd.getFullYear()*12+sd.getMonth())) return;   // চুক্তি শুরুর আগের মাস
    if(!paid.has(tn.id)) notifs.push({type:'info',text:tn.name+' '+dueM2.name+' মাসের ভাড়া দেননি',icon:'money-bill-wave'}); });
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
      if (await uiConfirm('বিদ্যমান সমস্ত ডেটা প্রতিস্থাপন করবেন?')) {
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
  if (!await uiConfirm('ডেমো ডেটা লোড করবেন?')) return;
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

const PREMIUM_IDS = ['due', 'deduction', 'expense', 'advledger'];
const ADV_TAB = { id: 'advledger', icon: 'fa-piggy-bank', title: 'অগ্রিম খাতা (ফেরত হিসাব)' };
const EXPENSE_TAB = { id: 'expense', icon: 'fa-wallet', title: 'মাসিক খরচ হিসাব' };
function renderCalcTabs() {
  const box = document.getElementById('calcTabs'); if (!box) return;
  const all = CALCS.concat([EXPENSE_TAB, ADV_TAB]);
  const btn = c => '<button type="button" class="tab-btn' + (PREMIUM_IDS.includes(c.id) ? ' prem' : '') + (c.id === _calcActive ? ' active' : '') + '" onclick="calcSelect(\'' + c.id + '\')">' + (PREMIUM_IDS.includes(c.id) ? '<i class="fas fa-crown"></i> ' : '') + '<i class="fas ' + c.icon + '"></i> ' + c.title + '</button>';
  const prem = PREMIUM_IDS.map(id => all.find(c => c.id === id)).filter(Boolean);
  const rest = all.filter(c => !PREMIUM_IDS.includes(c.id));
  box.innerHTML = '<div class="prem-group"><span class="pg-label"><i class="fas fa-crown"></i> PREMIUM</span>' + prem.map(btn).join('') + '</div>' + rest.map(btn).join('');
}
function calcSelect(id) {
  _calcActive = id; renderCalcTabs();
  const panels = { expense: 'expensePanel', advledger: 'advPanel' }, isPanel = !!panels[id];
  ['calcGrid', 'memoHistoryCard'].forEach(x => { const e = document.getElementById(x); if (e) e.style.display = isPanel ? 'none' : (x === 'calcGrid' ? 'grid' : ''); });
  Object.keys(panels).forEach(k => { const e = document.getElementById(panels[k]); if (e) e.style.display = (k === id) ? 'block' : 'none'; });
  if (id === 'expense') { expInit(); return; }
  if (id === 'advledger') { advInit(); return; }
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



// ── অগ্রিম খাতা: ফেরত হিসাব + নিজের ব্যক্তিগত খরচ ট্র্যাক (Firebase: "advLedger") ──
// entries  = ক্ষতি/জরিমানা (অগ্রিম থেকে কাটা যাবে)
// personal = আমি নিজের কাজে অগ্রিম থেকে যা খরচ করেছি (কাটা যাবে না, পুরোটাই ফেরত দিতে হবে)
let _advTid = '', _advDoc = null, _advBuilt = false, _advEdit = { entries: null, personal: null, repaid: null }, _advDirty = false;
const _advAll = () => DB.get('advLedger');
const _advTenant = () => (tenants || []).find(t => t.id === _advTid);
const ADV_LISTS = {
  entries:  { suf: 'F', title: 'ক্ষতি / জরিমানা (অগ্রিম থেকে কাটা যাবে)', icon: 'fa-hammer', ph: 'বিবরণ (কী ক্ষতি / কীসের জরিমানা)', color: '#dc2626', empty: 'কোনো ক্ষতি / জরিমানা নেই' },
  repaid:   { suf: 'R', title: 'ব্যক্তিগত খরচ ফেরত দিলাম (অগ্রিমে জমা হবে)', icon: 'fa-undo-alt', ph: 'নোট (যেমন: নগদ ফেরত জমা)', color: '#16a34a', empty: 'এখনো কিছু ফেরত দেওয়া হয়নি' },
  personal: { suf: 'P', title: 'আমার ব্যক্তিগত খরচ (অগ্রিম থেকে — পুরোটা ফেরত দিতে হবে)', icon: 'fa-user-lock', ph: 'কীসের জন্য খরচ করলাম', color: '#b45309', empty: 'কোনো ব্যক্তিগত খরচ ট্র্যাক করা নেই' }
};
function _advDefault(tn) { return { tenantId: tn.id, ded: tn.monthlyDeduction || tn.deduction || 0, months: _tmonths(tn), due: null, entries: [], personal: [], repaid: [] }; }
function advInit() {
  const box = document.getElementById('advPanel'); if (!box) return;
  if (!_advBuilt) {
    box.innerHTML =
      '<div class="stat-card" style="padding:20px;margin-bottom:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-crown" style="color:#f59e0b;"></i> <i class="fas fa-piggy-bank" style="color:var(--accent);"></i> অগ্রিম খাতা (ফেরত হিসাব)</h3>' +
      '<p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px;">বকেয়া, কর্তন ও ক্ষতির জরিমানা অগ্রিম থেকে কাটা যাবে। নিজের কাজে অগ্রিম থেকে খরচ করলে সেটা আলাদা ট্র্যাক হবে — ওটা কাটা যাবে না, পুরোটাই ফেরত দিতে হবে। সবকিছু Firebase-এ সেভ থাকে।</p>' +
      '<select id="advTenant" class="form-input form-select" onchange="advSelect(this.value)"></select></div>' +
      '<div id="advBody"></div>' +
      '<div class="stat-card" style="padding:20px;margin-top:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-cloud" style="color:var(--accent);"></i> সংরক্ষিত অগ্রিম খাতা (Firebase)</h3><div id="advList"></div></div>';
    _advBuilt = true;
  }
  const sel = document.getElementById('advTenant');
  sel.innerHTML = '<option value="">-- ভাড়াটিয়া নির্বাচন করুন --</option>' + (tenants || []).map(t => '<option value="' + t.id + '"' + (t.id === _advTid ? ' selected' : '') + '>' + _esc(t.name) + ' - ' + _esc(t.shop) + (t.archived ? ' (আর্কাইভ)' : '') + '</option>').join('');
  advRender(); advRenderList();
  FDB.getAll('advLedger').then(() => { if (_advTid && !_advDirty) advSelect(_advTid); advRenderList(); }).catch(() => {});
  FDB.getAll('payments').then(r => { if (r && r.length) { payments = r; advSummary(); } }).catch(() => {});
}
function advSelect(tid) {
  _advTid = tid; _advEdit = { entries: null, personal: null, repaid: null }; _advDirty = false;
  const tn = _advTenant();
  if (!tn) { _advDoc = null; advRender(); return; }
  const saved = _advAll().find(x => x.id === tid), cp = a => (a || []).map(e => Object.assign({}, e));
  _advDoc = saved ? { tenantId: tid, ded: saved.ded || 0, months: saved.months || 0, due: saved.due == null ? null : saved.due, entries: cp(saved.entries), personal: cp(saved.personal), repaid: cp(saved.repaid) } : _advDefault(tn);
  const sel = document.getElementById('advTenant'); if (sel) sel.value = tid;
  advRender();
}
function advAutoDue() { return (payments || []).filter(p => p.tenantId === _advTid).reduce((a, p) => a + _n(p.due), 0); }
function advCalcNums() {
  const tn = _advTenant(), d = _advDoc; if (!tn || !d) return null;
  const adv = _n(tn.advance), deducted = Math.min(adv, _n(d.ded) * Math.max(0, Math.floor(_n(d.months))));
  const due = d.due == null || d.due === '' ? advAutoDue() : _n(d.due);
  const sum = a => a.reduce((x, e) => x + _n(e.amount), 0);
  const fine = sum(d.entries), personal = sum(d.personal), repaid = sum(d.repaid || []), personalDue = Math.max(0, personal - repaid);
  const refund = adv - deducted - due - fine;                 // ভাড়াটিয়াকে মোট যা ফেরত দিতে হবে
  const inHand = adv - personal + repaid;                              // অগ্রিমের টাকা থেকে নিজের খরচ বাদে যা হাতে আছে
  const shortfall = Math.max(0, refund - inHand);             // ফেরত দিতে নিজের তহবিল থেকে যা যোগ করতে হবে
  return { adv, deducted, due, fine, personal, repaid, personalDue, refund, inHand, shortfall };
}
function _advListCard(key) {
  const L = ADV_LISTS[key], x = L.suf;
  return '<div class="stat-card" style="padding:20px;' + (key === 'personal' ? 'border:1.5px dashed #f59e0b;' : '') + '"><h3 style="font-weight:700;margin-bottom:12px;font-size:.92rem;"><i class="fas ' + L.icon + '" style="color:' + L.color + ';"></i> ' + L.title + '</h3>' +
    '<div id="advBanner' + x + '" style="display:none;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:8px;padding:8px 12px;font-size:.82rem;margin-bottom:8px;"></div>' +
    '<div style="display:grid;gap:6px;margin-bottom:10px;"><input id="advDate' + x + '" class="form-input" placeholder="তারিখ বাছুন" value="' + isoLocal(new Date()) + '"><input id="advDet' + x + '" class="form-input" placeholder="' + L.ph + '"><input id="advAmt' + x + '" class="form-input" type="number" step="any" inputmode="decimal" placeholder="টাকা ৳">' +
    '<button type="button" id="advBtn' + x + '" class="btn btn-primary" onclick="advEntrySave(\'' + key + '\')" style="justify-content:center;"><i class="fas fa-plus"></i> যোগ করুন</button></div>' +
    (key === 'repaid' ? '<button type="button" class="btn btn-outline btn-sm" onclick="advRepayAll()" style="margin-bottom:10px;width:100%;justify-content:center;border-color:#16a34a;color:#166534;"><i class="fas fa-check-double"></i> বাকি সবটুকু ফেরত দিলাম</button>' : '') +
    '<div id="advEntries' + x + '"></div></div>';
}
function advRender() {
  const box = document.getElementById('advBody'); if (!box) return;
  const tn = _advTenant();
  if (!tn || !_advDoc) { box.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;font-size:.86rem;">উপর থেকে ভাড়াটিয়া বাছুন</p>'; return; }
  const d = _advDoc;
  box.innerHTML = '<div id="advSummary" style="margin-bottom:16px;"></div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start;">' +
    '<div class="stat-card" style="padding:20px;"><h3 style="font-weight:700;margin-bottom:12px;font-size:.95rem;"><i class="fas fa-sliders-h" style="color:var(--accent);"></i> কর্তন ও বকেয়া</h3><div class="form-grid">' +
    '<div class="form-group"><label class="form-label">মোট অগ্রিম (৳)</label><input class="form-input" value="' + _n(tn.advance) + '" disabled></div>' +
    '<div class="form-group"><label class="form-label">মাসিক কর্তন (৳)</label><input class="form-input" type="number" step="any" value="' + _esc(d.ded) + '" oninput="advParam(\'ded\',this.value)" onchange="advPersist()"></div>' +
    '<div class="form-group"><label class="form-label">কত মাস কর্তন</label><input class="form-input" type="number" value="' + _esc(d.months) + '" oninput="advParam(\'months\',this.value)" onchange="advPersist()"></div>' +
    '<div class="form-group"><label class="form-label">বকেয়া ভাড়া (৳) — ফাঁকা = অটো</label><input class="form-input" type="number" step="any" placeholder="অটো: ' + money(advAutoDue()) + '" value="' + (d.due == null ? '' : _esc(d.due)) + '" oninput="advParam(\'due\',this.value)" onchange="advPersist()"></div></div></div>' +
    _advListCard('entries') + _advListCard('personal') + _advListCard('repaid') + '</div>' +
    '<div class="stat-card" style="padding:16px 20px;margin-top:16px;"><div style="font-weight:700;font-size:.9rem;margin-bottom:10px;"><i class="fas fa-folder" style="color:#f59e0b;"></i> মেমো — ' + _esc(tn.name) + ' এর ফোল্ডারে সেভ হবে</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">' +
    '<div style="border:1px solid var(--border);border-radius:10px;padding:10px;"><div style="font-weight:600;font-size:.84rem;margin-bottom:6px;">ভাড়াটিয়ার ফেরত মেমো</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn btn-outline btn-sm" onclick="advView(\'refund\')"><i class="fas fa-eye"></i> দেখুন / প্রিন্ট</button><button type="button" class="btn btn-primary btn-sm" onclick="advSaveMemo(\'refund\')"><i class="fas fa-folder-plus"></i> সেভ করুন</button></div></div>' +
    '<div style="border:1px solid #f59e0b;border-radius:10px;padding:10px;"><div style="font-weight:600;font-size:.84rem;margin-bottom:6px;">ব্যক্তিগত খরচের মেমো <span style="font-weight:400;color:var(--text-muted);">(কর্তন/বকেয়া ছাড়া)</span></div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn btn-outline btn-sm" onclick="advView(\'personal\')"><i class="fas fa-eye"></i> দেখুন / প্রিন্ট</button><button type="button" class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="advSaveMemo(\'personal\')"><i class="fas fa-folder-plus"></i> সেভ করুন</button></div></div>' +
    '<div style="border:1px solid var(--border);border-radius:10px;padding:10px;"><div style="font-weight:600;font-size:.84rem;margin-bottom:6px;">আমার সম্পূর্ণ খাতা</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn btn-outline btn-sm" onclick="advView(\'full\')"><i class="fas fa-eye"></i> দেখুন</button><button type="button" class="btn btn-outline btn-sm" onclick="advSaveMemo(\'full\')"><i class="fas fa-folder-plus"></i> সেভ করুন</button></div></div></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="advPersist(true)" style="margin-top:10px;"><i class="fas fa-cloud-upload-alt"></i> হিসাব সেভ করুন</button></div>';
  if (typeof flatpickr !== 'undefined') ['F', 'P', 'R'].forEach(x => { const el = document.getElementById('advDate' + x); if (el) flatpickr(el, { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: false, disableMobile: true, defaultDate: el.value || null }); });
  advSummary(); advRenderEntries('entries'); advRenderEntries('personal'); advRenderEntries('repaid');
}
function advSummary() {
  const el = document.getElementById('advSummary'), n = advCalcNums(); if (!el || !n) return;
  const tn = _advTenant(), box = (l, v, c) => '<div style="flex:1;min-width:120px;"><div style="font-size:.72rem;opacity:.85;">' + l + '</div><div style="font-size:1.2rem;font-weight:800;color:' + (c || '#fff') + ';">' + v + '</div></div>';
  el.innerHTML = '<div style="background:linear-gradient(135deg,#14532d,#16a34a);color:#fff;border-radius:14px;padding:16px 18px;">' +
    '<div style="font-weight:700;font-size:.9rem;margin-bottom:10px;">' + _esc(tn.name) + ' — ' + _esc(tn.shop) + '</div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + box('মোট অগ্রিম', money(n.adv)) + box('মাসিক কর্তন বাবদ', '−' + money(n.deducted), '#fecaca') + box('বকেয়া ভাড়া', '−' + money(n.due), '#fecaca') + box('ক্ষতি / জরিমানা', '−' + money(n.fine), '#fecaca') + '</div>' +
    '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.3);display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:600;">' + (n.refund >= 0 ? 'ভাড়াটিয়াকে ফেরত দিতে হবে' : 'ভাড়াটিয়ার কাছে পাওনা') + '</span><b style="font-size:1.5rem;">' + money(Math.abs(n.refund)) + '</b></div></div>' +
    '<div style="margin-top:10px;background:linear-gradient(135deg,#78350f,#d97706);color:#fff;border-radius:14px;padding:14px 18px;">' +
    '<div style="font-weight:700;font-size:.85rem;margin-bottom:8px;"><i class="fas fa-user-lock"></i> আমার ব্যক্তিগত খরচ ট্র্যাক (পুরোটাই ফেরত দিতে হবে)</div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + box('অগ্রিম থেকে খরচ করেছি', money(n.personal)) + box('ফেরত দিয়েছি (অগ্রিমে জমা)', money(n.repaid), '#bbf7d0') + box('এখনো ফেরত বাকি', money(n.personalDue), n.personalDue > 0 ? '#fecaca' : '#bbf7d0') + '</div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;">' + box('অগ্রিম থেকে হাতে আছে', money(n.inHand), n.inHand < 0 ? '#fecaca' : '#fff') + box('ঘাটতি (নিজের তহবিল থেকে দিতে হবে)', money(n.shortfall), n.shortfall > 0 ? '#fecaca' : '#bbf7d0') + '</div></div>';
}
function advParam(k, v) { if (!_advDoc) return; _advDoc[k] = (k === 'due' && v === '') ? null : v; _advDirty = true; advSummary(); }
function advRenderEntries(key) {
  const x = ADV_LISTS[key].suf, box = document.getElementById('advEntries' + x); if (!box || !_advDoc) return;
  const list = _advDoc[key].slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  box.innerHTML = (list.length ? list.map(e => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--border);">' +
    '<div style="min-width:0;"><div style="font-weight:600;font-size:.86rem;">' + _esc(e.details || 'খরচ') + ' — <span style="color:' + ADV_LISTS[key].color + ';">' + money(e.amount) + '</span></div><div style="font-size:.74rem;color:var(--text-muted);">' + fmtDate(e.date) + '</div></div>' +
    '<div style="display:flex;gap:4px;flex-shrink:0;"><button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="advEntryEdit(\'' + key + '\',\'' + e.id + '\')"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm" onclick="advEntryDel(\'' + key + '\',\'' + e.id + '\')"><i class="fas fa-trash"></i></button></div></div>').join('')
    : '<p style="text-align:center;color:var(--text-muted);padding:10px;font-size:.82rem;">' + ADV_LISTS[key].empty + '</p>') +
    (list.length ? '<div style="display:flex;justify-content:space-between;padding:9px 0 0;border-top:2px solid var(--border);font-weight:800;"><span>মোট</span><span>' + money(list.reduce((a, e) => a + _n(e.amount), 0)) + '</span></div>' : '');
}
async function advEntrySave(key) {
  if (!_advDoc) return;
  const x = ADV_LISTS[key].suf, g = id => (document.getElementById(id + x) || {}).value || '', amt = _n(g('advAmt'));
  if (!(amt > 0)) { showToast('টাকার পরিমাণ দিন', 'error'); return; }
  const rec = { date: g('advDate') || isoLocal(new Date()), details: g('advDet').trim(), amount: _r2(amt) };
  _advDoc[key] = _advDoc[key] || [];
  if (_advEdit[key]) { const e = _advDoc[key].find(v => v.id === _advEdit[key]); if (e) Object.assign(e, rec); }
  else _advDoc[key].push(Object.assign({ id: 'AE' + Date.now() + Math.floor(Math.random() * 1000) }, rec));
  _advEdit[key] = null;
  await advPersist();
  advRender();
}
async function advRepayAll() {
  const n = advCalcNums(); if (!_advDoc || !n) return;
  if (!(n.personalDue > 0)) { showToast('ফেরত দেওয়ার মতো কিছু বাকি নেই', 'error'); return; }
  if (!await uiConfirm(money(n.personalDue) + ' ফেরত দেওয়া হিসেবে অগ্রিমে জমা করবেন?')) return;
  _advDoc.repaid = _advDoc.repaid || [];
  _advDoc.repaid.push({ id: 'AE' + Date.now() + Math.floor(Math.random() * 1000), date: isoLocal(new Date()), details: 'ব্যক্তিগত খরচ ফেরত', amount: _r2(n.personalDue) });
  await advPersist(); advRender();
}
function advEntryEdit(key, id) {
  const e = _advDoc && _advDoc[key].find(v => v.id === id); if (!e) return;
  const x = ADV_LISTS[key].suf; _advEdit[key] = id;
  const set = (i, v) => { const el = document.getElementById(i + x); if (el) el.value = v; };
  set('advDate', e.date); set('advDet', e.details); set('advAmt', e.amount);
  const b = document.getElementById('advBanner' + x); if (b) { b.style.display = 'block'; b.textContent = 'সম্পাদনা চলছে — পরিবর্তন করে "আপডেট" চাপুন'; }
  const ab = document.getElementById('advBtn' + x); if (ab) ab.innerHTML = '<i class="fas fa-sync-alt"></i> আপডেট';
}
async function advEntryDel(key, id) {
  if (!_advDoc || !await uiConfirm('এই এন্ট্রিটি মুছে ফেলবেন?')) return;
  _advDoc[key] = _advDoc[key].filter(e => e.id !== id); _advEdit[key] = null;
  await advPersist(); advRender();
}
async function advPersist(toast) {
  if (!_advDoc || !_advTid) return;
  const d = _advDoc, n = advCalcNums(), cl = a => a.map(e => ({ id: e.id, date: e.date, details: e.details || '', amount: _n(e.amount) }));
  const ok = await FDB.save('advLedger', _advTid, { tenantId: _advTid, ded: _n(d.ded), months: Math.max(0, Math.floor(_n(d.months))), due: d.due == null ? null : _n(d.due), entries: cl(d.entries), personal: cl(d.personal), repaid: cl(d.repaid || []),
    refund: n ? _r2(n.refund) : 0, personalTotal: n ? _r2(n.personal) : 0, personalDue: n ? _r2(n.personalDue) : 0, updatedAt: new Date().toISOString() });
  _advDirty = false;
  showToast(ok ? 'অগ্রিম খাতা Firebase-এ সেভ হয়েছে ✅' : 'শুধু এই ডিভাইসে সেভ হয়েছে (ইন্টারনেট/লগইন দেখুন)', ok ? 'success' : 'error');
  advRenderList();
}
function advRenderList() {
  const box = document.getElementById('advList'); if (!box) return;
  const list = _advAll().filter(x => (tenants || []).some(t => t.id === x.id));
  box.innerHTML = list.length ? list.map(x => {
    const tn = tenants.find(t => t.id === x.id), r = _n(x.refund), pt = x.personalDue != null ? _n(x.personalDue) : _n(x.personalTotal);
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);">' +
      '<div style="min-width:180px;"><div style="font-weight:700;">' + _esc(tn.name) + ' <span style="font-size:.74rem;font-weight:400;color:var(--text-muted);">' + _esc(tn.shop) + '</span></div>' +
      '<div style="font-size:.78rem;color:var(--text-muted);">' + (r >= 0 ? 'ফেরত দিতে হবে ' : 'পাওনা ') + '<b style="color:' + (r >= 0 ? '#16a34a' : '#dc2626') + ';">' + money(Math.abs(r)) + '</b>' + (pt ? ' • ব্যক্তিগত খরচ বাকি <b style="color:#b45309;">' + money(pt) + '</b>' : '') + '</div></div>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" onclick="advOpen(\'' + x.id + '\',true)"><i class="fas fa-eye"></i> View</button>' +
      '<button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="advOpen(\'' + x.id + '\')"><i class="fas fa-edit"></i> Update</button>' +
      '<button class="btn btn-danger btn-sm" onclick="advDeleteLedger(\'' + x.id + '\')"><i class="fas fa-trash"></i> Delete</button></div>' +
      '<div style="width:100%;">' + memoFolderHtml({ key: x.id, label: tn.name + ' — মেমো ফোল্ডার', list: DB.get('memos').filter(m => m.tenantId === x.id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) }) + '</div></div>';
  }).join('') : '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:.84rem;">এখনো কোনো অগ্রিম খাতা সেভ করা নেই</p>';
}
function advOpen(tid, view) {
  advSelect(tid);
  if (view) { advView('refund'); return; }
  const b = document.getElementById('advBody'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function advDeleteLedger(tid) {
  const tn = (tenants || []).find(t => t.id === tid);
  if (!await uiConfirm((tn ? tn.name + ' এর ' : '') + 'অগ্রিম খাতা মুছে ফেলবেন?')) return;
  await FDB.delete('advLedger', tid);
  if (_advTid === tid) { _advDoc = null; _advTid = ''; const sel = document.getElementById('advTenant'); if (sel) sel.value = ''; advRender(); }
  advRenderList(); showToast('অগ্রিম খাতা মুছে ফেলা হয়েছে', 'error');
}
function advMemoObj(kind) {
  const tn = _advTenant(), n = advCalcNums(); if (!tn || !n) return null;
  const d = _advDoc, mcount = Math.max(0, Math.floor(_n(d.months)));
  const sorted = a => a.slice().sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const listTable = (title, arr, total) => ({ title, cols: ['#', 'তারিখ', 'বিবরণ', 'টাকা'], num: [3], rows: sorted(arr).map((e, i) => [i + 1, fmtDate(e.date), e.details || 'খরচ', money(e.amount)]), foot: ['', '', 'মোট', money(total)] });
  let tables = [], title, total;
  if (kind === 'personal') {
    title = 'ব্যক্তিগত খরচের মেমো'; total = n.personal;
    tables = [{ title: 'অগ্রিম জমা ছিল: ' + money(n.adv), cols: ['বিবরণ', 'টাকা'], num: [1],
      rows: [['অগ্রিম থেকে ব্যক্তিগত খরচ (মোট)', '−' + money(n.personal)]].concat(n.repaid ? [['খরচের টাকা ফেরত দেওয়া হয়েছে (অগ্রিমে জমা)', '+' + money(n.repaid)]] : []),
      foot: ['অগ্রিম অবশিষ্ট আছে', money(n.inHand)] }];
    tables.push(listTable('অগ্রিম থেকে খরচের তালিকা (কখন, কীসের জন্য)', d.personal, n.personal));
    if ((d.repaid || []).length) tables.push(listTable('ফেরত দেওয়ার তালিকা (অগ্রিমে জমা)', d.repaid, n.repaid));
  } else {
    title = kind === 'full' ? 'অগ্রিম খাতা (ব্যক্তিগতসহ)' : 'অগ্রিম ফেরত হিসাব'; total = Math.abs(n.refund);
    tables = [{ title: 'অগ্রিম ফেরত হিসাব', cols: ['বিবরণ', 'টাকা'], num: [1],
      rows: [['মোট অগ্রিম', money(n.adv)], ['মাসিক কর্তন বাবদ (' + money(_n(d.ded)) + ' × ' + mcount + ' মাস)', '−' + money(n.deducted)], ['বকেয়া ভাড়া', '−' + money(n.due)], ['ক্ষতি / জরিমানা', '−' + money(n.fine)]],
      foot: [n.refund >= 0 ? 'ফেরত দিতে হবে' : 'ভাড়াটিয়ার কাছে পাওনা', money(Math.abs(n.refund))] }];
    if (d.entries.length) tables.push(listTable('ক্ষতি / জরিমানার তালিকা', d.entries, n.fine));
    if (kind === 'full') {
      if (d.personal.length) tables.push(listTable('ব্যক্তিগত খরচ (অগ্রিম থেকে — পুরোটা ফেরত দিতে হবে)', d.personal, n.personal));
      tables.push({ title: 'ব্যক্তিগত খরচের সারাংশ', cols: ['বিবরণ', 'টাকা'], num: [1],
        rows: [['মোট অগ্রিম', money(n.adv)], ['অগ্রিম থেকে ব্যক্তিগত খরচ', '−' + money(n.personal)], ['ফেরত দিয়েছি (অগ্রিমে জমা)', '+' + money(n.repaid)], ['অগ্রিম থেকে হাতে আছে', money(n.inHand)], ['ভাড়াটিয়াকে ফেরত দিতে হবে', money(Math.abs(n.refund))]],
        foot: ['ঘাটতি (নিজের তহবিল থেকে দিতে হবে)', money(n.shortfall)] });
    }
  }
  return { id: 'ADV-' + kind + '-' + tn.id, no: 'ADV-' + (tn.shop || tn.id), title, date: isoLocal(new Date()), tenantId: tn.id, name: tn.name, shop: tn.shop || '', mobile: tn.mobile || '', items: [], tables, collector: '', note: '', noSum: true,
    sub: _r2(total), disc: 0, total: _r2(total), paid: 0, due: _r2(total), kind: 'adv-' + kind };
}
function advView(kind) { const m = advMemoObj(kind === true ? 'full' : (kind || 'refund')); if (m) memoShow(m); }
async function advSaveMemo(kind) {
  if (!_advDoc) return;
  if (kind === 'personal' && !_advDoc.personal.length) { showToast('আগে ব্যক্তিগত খরচ যোগ করুন', 'error'); return; }
  const m = advMemoObj(kind); if (!m) return;
  m.id = 'MEMO' + Date.now(); m.no = nextMemoNo(); m.createdAt = new Date().toISOString();
  const ok = await FDB.save('memos', m.id, Object.assign({}, m, { tables: [], tablesJson: JSON.stringify(m.tables) }));
  addActivity('মেমো সংরক্ষণ: ' + m.no + ' — ' + m.name + ' (' + m.title + ')', 'file-invoice', '#16a34a');
  showToast(ok ? m.name + ' এর ফোল্ডারে মেমো সেভ হয়েছে ✅' : 'শুধু এই ডিভাইসে সেভ হয়েছে (ইন্টারনেট/লগইন দেখুন)', ok ? 'success' : 'error');
  _memoFolderOpen[m.tenantId] = true;
  memoRenderHistory(); memoShow(m);
}

// ── monthly expense calculator (Firebase: "expenses") ─────────
const EXP_CATS = ['বিদ্যুৎ বিল', 'পানির বিল', 'পরিষ্কার-পরিচ্ছন্নতা', 'জেনারেটর / লিফট', 'মেরামত ও রক্ষণাবেক্ষণ', 'কর্মচারী বেতন', 'নিরাপত্তা', 'ট্যাক্স / খাজনা', 'অন্যান্য'];
let _expDraft = [], _expEditIds = null, _expYM = '', _expFormYM = '', _expBuilt = false;
const _expKey = e => e.ym || (e.date || '').slice(0, 7);
const _expNewRow = () => ({ date: isoLocal(new Date()), details: '', amount: '' });
const _expAll = () => DB.get('expenses');

function expInit() {
  const box = document.getElementById('expensePanel'); if (!box) return;
  if (!_expYM) _expYM = isoLocal(new Date()).slice(0, 7);
  if (!_expFormYM) _expFormYM = _expYM;
  if (!_expDraft.length) _expDraft = [_expNewRow()];
  if (!_expBuilt) {
    const yNow = new Date().getFullYear();
    box.innerHTML = '<div id="expLive" style="margin-bottom:16px;"></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start;">' +
      '<div class="stat-card" style="padding:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-crown" style="color:#f59e0b;"></i> <i class="fas fa-wallet" style="color:var(--accent);"></i> খরচ লিখুন</h3>' +
      '<p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px;">তারিখ বাছুন, বিবরণ ও টাকা লিখুন। সেভ করলে Firebase-এ থাকবে।</p>' +
      '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:10px 12px;margin-bottom:12px;"><label class="form-label" style="color:#166534;font-weight:700;">কোন মাসের টাকা থেকে খরচ করছেন?</label><div style="display:flex;gap:8px;"><select id="expFMonth" class="form-input form-select" style="flex:1;" onchange="expFormYMChanged()">' + BN_MONTHS.map((mn, i) => '<option value="' + String(i + 1).padStart(2, '0') + '">' + mn + '</option>').join('') + '</select><select id="expFYear" class="form-input form-select" style="width:110px;" onchange="expFormYMChanged()">' + Array.from({ length: 8 }, (_, i) => yNow - 5 + i).map(y => '<option>' + y + '</option>').join('') + '</select></div><div style="font-size:.72rem;color:var(--text-muted);margin-top:4px;">খরচের তারিখ যেকোনো হতে পারে — হিসাব এই মাসের নামে জমা হবে।</div></div>' +
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
      '<button type="button" class="btn btn-outline" onclick="expViewMonth()"><i class="fas fa-file-invoice"></i> মেমো দেখুন</button>' +
      '<button type="button" class="btn btn-primary" onclick="expPrintMonth()"><i class="fas fa-print"></i> মাসিক প্রিন্ট</button></div>' +
      '<div id="expMonthView"></div></div></div>' +
      '<div class="stat-card" style="padding:20px;margin-top:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-cloud" style="color:var(--accent);"></i> মাসওয়ারি সংরক্ষিত হিসাব (Firebase)</h3><div id="expMonthsList"></div></div>';
    _expBuilt = true;
  }
  const [y, mo] = _expYM.split('-');
  const ms = document.getElementById('expMonthSel'), ys = document.getElementById('expYearSel');
  if (ys && ![...ys.options].some(o => o.value === y)) ys.insertAdjacentHTML('beforeend', '<option>' + y + '</option>');
  if (ms) ms.value = mo; if (ys) ys.value = y;
  const [fy, fm] = _expFormYM.split('-'), fys = document.getElementById('expFYear'), fms = document.getElementById('expFMonth');
  if (fys && ![...fys.options].some(o => o.value === fy)) fys.insertAdjacentHTML('beforeend', '<option>' + fy + '</option>');
  if (fms) fms.value = fm; if (fys) fys.value = fy;
  expRenderDraft(); expRenderMonth();
  FDB.getAll('expenses').then(() => expRenderMonth()).catch(() => {});
  FDB.getAll('payments').then(r => { if (r && r.length) payments = r; expLive(); }).catch(() => {});
}
function expRent(ym) {
  const [y, mo] = ym.split('-'), mn = BN_MONTHS[+mo - 1];
  return (payments || []).filter(p => p.month === mn && String(p.year) === String(y)).reduce((a, p) => a + _n(p.paid), 0);
}
function expLive() {
  const el = document.getElementById('expLive'); if (!el) return;
  const ym = _expFormYM || _expYM, [y, mo] = ym.split('-'), rent = expRent(ym);
  const spent = _expAll().filter(e => _expKey(e) === ym).reduce((a, e) => a + _n(e.amount), 0), bal = rent - spent;
  const pend = _expEditIds ? 0 : _expDraft.reduce((a, r) => a + _n(r.amount), 0);
  const box = (l, v, c) => '<div style="flex:1;min-width:130px;"><div style="font-size:.74rem;opacity:.85;">' + l + '</div><div style="font-size:1.35rem;font-weight:800;color:' + (c || '#fff') + ';">' + v + '</div></div>';
  el.innerHTML = '<div style="background:linear-gradient(135deg,#14532d,#16a34a);color:#fff;border-radius:14px;padding:16px 18px;">' +
    '<div style="font-weight:700;font-size:.9rem;margin-bottom:10px;"><i class="fas fa-circle" style="color:#4ade80;font-size:.5rem;vertical-align:middle;"></i> লাইভ — ' + BN_MONTHS[+mo - 1] + ' ' + y + ' এর টাকা থেকে খরচ</div>' +
    '<div style="display:flex;gap:14px;flex-wrap:wrap;">' + box(BN_MONTHS[+mo - 1] + ' মোট ভাড়া', money(rent)) + box('মোট খরচ', '−' + money(spent), '#fecaca') + box('অবশিষ্ট ব্যালেন্স', money(bal), bal < 0 ? '#fecaca' : '#bbf7d0') + '</div>' +
    (pend > 0 ? '<div style="margin-top:10px;font-size:.78rem;opacity:.9;">ফর্মের অসেভড খরচ ' + money(pend) + ' সেভ হলে ব্যালেন্স হবে <b>' + money(bal - pend) + '</b></div>' : '') + '</div>';
}
function expFormYMChanged() { _expFormYM = document.getElementById('expFYear').value + '-' + document.getElementById('expFMonth').value; expLive(); }
function expYMChanged() { _expYM = document.getElementById('expYearSel').value + '-' + document.getElementById('expMonthSel').value; expRenderMonth(); }

function expRenderDraft() {
  const box = document.getElementById('expDraft'); if (!box) return;
  box.innerHTML = _expDraft.map((r, i) =>
      '<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
      '<input class="form-input exp-date" style="grid-column:1/-1;" data-i="' + i + '" value="' + _esc(r.date) + '" placeholder="তারিখ বাছুন">' +
      '<input class="form-input" style="grid-column:1/-1;" placeholder="বিবরণ (কোথায় / কী বাবদ খরচ)" value="' + _esc(r.details) + '" oninput="expRowSet(' + i + ',\'details\',this.value)">' +
      '<div style="grid-column:1/-1;display:flex;gap:6px;"><input class="form-input" type="number" step="any" inputmode="decimal" placeholder="টাকা ৳" value="' + _esc(r.amount) + '" oninput="expRowSet(' + i + ',\'amount\',this.value)">' +
      '<button type="button" class="btn btn-danger btn-sm" onclick="expRowDel(' + i + ')" title="বাদ দিন"><i class="fas fa-times"></i></button>' + '</div></div>').join('');
  if (typeof flatpickr !== 'undefined') box.querySelectorAll('.exp-date').forEach(el => {
    flatpickr(el, { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: false, disableMobile: true, defaultDate: el.value || null,
      onChange: [(sel, str) => expRowSet(+el.dataset.i, 'date', str)] });
  });
  const ab = document.getElementById('expAddRowBtn'); if (ab) ab.style.display = '';
  expDraftTotal();
}
function expDraftTotal() {
  expLive();
  const el = document.getElementById('expDraftTotal'); if (!el) return;
  const t = _expDraft.reduce((a, r) => a + _n(r.amount), 0);
  el.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>মোট খরচ</span><b style="color:var(--accent);font-size:1.05rem;">' + money(t) + '</b></div><div style="font-size:.74rem;color:var(--text-muted);margin-top:4px;">' + takaInWords(t) + '</div>';
}
function expRowSet(i, k, v) { if (_expDraft[i]) { _expDraft[i][k] = v; if (k === 'amount') expDraftTotal(); } }
function expRowAdd() { const last = _expDraft[_expDraft.length - 1]; _expDraft.push(Object.assign(_expNewRow(), last ? { date: last.date } : {})); expRenderDraft(); }
function expRowDel(i) { _expDraft.splice(i, 1); if (!_expDraft.length) _expDraft.push(_expNewRow()); expRenderDraft(); }
function expDraftReset() {
  _expEditIds = null; _expDraft = [_expNewRow()];
  const b = document.getElementById('expEditBanner'); if (b) b.style.display = 'none';
  const sb = document.getElementById('expSaveBtn'); if (sb) sb.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> সেভ করুন';
  expRenderDraft();
}
async function expSave() {
  const rows = _expDraft.filter(r => _n(r.amount) > 0), editing = !!_expEditIds;
  if (!rows.length) { showToast('কমপক্ষে একটি খরচের টাকা দিন', 'error'); return; }
  let ok = true;
  for (const r of rows) {
    const id = r.id || ('EXP' + Date.now() + Math.floor(Math.random() * 100000));
    const rec = { details: String(r.details).trim(), amount: _r2(_n(r.amount)), date: r.date || isoLocal(new Date()), ym: _expFormYM };
    if (!r.id) rec.createdAt = new Date().toISOString();
    if (!(await FDB.save('expenses', id, rec))) ok = false;
  }
  if (editing) for (const id of _expEditIds.filter(id => !rows.some(r => r.id === id))) await FDB.delete('expenses', id);
  showToast(ok ? (editing ? 'হিসাব আপডেট হয়েছে ✅' : rows.length + ' টি খরচ সেভ হয়েছে ✅') : 'শুধু এই ডিভাইসে সেভ হয়েছে', ok ? 'success' : 'error');
  expDraftReset(); expInit();
}
function _expEditMode(ids, text) {
  _expEditIds = ids;
  const b = document.getElementById('expEditBanner'); if (b) { b.style.display = 'block'; b.innerHTML = '<i class="fas fa-pen"></i> ' + text + ' — পরিবর্তন করে "আপডেট" চাপুন <button type="button" class="btn btn-ghost btn-sm" onclick="expDraftReset()" style="margin-left:6px;">বাতিল</button>'; }
  const sb = document.getElementById('expSaveBtn'); if (sb) sb.innerHTML = '<i class="fas fa-sync-alt"></i> আপডেট';
  expRenderDraft(); const p = document.getElementById('expDraft'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function expEdit(id) {
  const e = _expAll().find(x => x.id === id); if (!e) return;
  _expFormYM = _expKey(e); _expDraft = [{ id, date: e.date, details: e.details || e.cat || '', amount: e.amount }];
  _expEditMode([id], 'একটি খরচ সম্পাদনা');
}
function _ymLabel(ym) { const [y, m] = ym.split('-'); return BN_MONTHS[+m - 1] + ' ' + y; }
function expEditMonth(ym) {
  _expYM = ym; _expFormYM = ym; const list = _expMonthList(); if (!list.length) return;
  expInit();
  _expDraft = list.map(e => ({ id: e.id, date: e.date, details: e.details || e.cat || '', amount: e.amount }));
  _expEditMode(list.map(e => e.id), _ymLabel(ym) + ' মাসের হিসাব সম্পাদনা');
}
function expViewMonth(ym) {
  if (ym) { _expYM = ym; expInit(); }
  const list = _expMonthList();
  if (!list.length) { showToast('এই মাসে কোনো খরচ নেই', 'error'); return; }
  const spent = list.reduce((a, e) => a + _n(e.amount), 0), rent = expRent(_expYM), bal = rent - spent;
  const m = {
    id: 'EXPM-' + _expYM, no: 'EXP-' + _expYM, title: 'মাসিক খরচের হিসাব', date: isoLocal(new Date()),
    nameLabel: 'মাস', name: _ymLabel(_expYM), shop: '', mobile: '', items: [], collector: '', note: '',
    tables: [
      { title: 'খরচের তালিকা', cols: ['#', 'তারিখ', 'বিবরণ', 'টাকা'], num: [3], rows: list.map((e, i) => [i + 1, fmtDate(e.date), _expText(e), money(e.amount)]), foot: ['', '', 'মোট খরচ', money(spent)] },
      { title: 'ভাড়া ও অবশিষ্ট ব্যালেন্স', cols: ['বিবরণ', 'টাকা'], num: [1], rows: [[_ymLabel(_expYM) + ' মোট ভাড়া আদায়', money(rent)], ['মোট খরচ', '−' + money(spent)]], foot: ['অবশিষ্ট ব্যালেন্স', money(bal)] }
    ],
    noSum: true, sub: _r2(spent), disc: 0, total: _r2(spent), paid: 0, due: _r2(spent)
  };
  memoShow(m);
}
async function expDeleteMonth(ym) {
  const prev = _expYM; _expYM = ym; const list = _expMonthList(); _expYM = prev;
  if (!list.length || !await uiConfirm(_ymLabel(ym) + ' মাসের সব খরচ (' + list.length + ' টি) মুছে ফেলবেন?')) return;
  for (const e of list) await FDB.delete('expenses', e.id);
  if (_expEditIds) expDraftReset();
  expRenderMonth(); showToast(_ymLabel(ym) + ' মাসের হিসাব মুছে ফেলা হয়েছে', 'error');
}
async function expDelete(id) {
  if (!await uiConfirm('এই খরচটি মুছে ফেলবেন?')) return;
  await FDB.delete('expenses', id); if (_expEditIds && _expEditIds.includes(id)) expDraftReset();
  expRenderMonth(); showToast('খরচ মুছে ফেলা হয়েছে', 'error');
}
function expRenderMonths() {
  const box = document.getElementById('expMonthsList'); if (!box) return;
  const g = {}; _expAll().forEach(e => { const k = _expKey(e); if (k.length === 7) g[k] = (g[k] || []).concat(e); });
  const keys = Object.keys(g).sort().reverse();
  box.innerHTML = keys.length ? keys.map(k => {
    const spent = g[k].reduce((a, e) => a + _n(e.amount), 0), rent = expRent(k), bal = rent - spent;
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);' + (k === _expYM ? 'background:rgba(22,163,74,.06);' : '') + '">' +
      '<div style="min-width:180px;"><div style="font-weight:700;">' + _ymLabel(k) + ' <span style="font-size:.74rem;font-weight:400;color:var(--text-muted);">(' + g[k].length + ' টি খরচ)</span></div>' +
      '<div style="font-size:.78rem;color:var(--text-muted);">ভাড়া ' + money(rent) + ' • খরচ <b style="color:#dc2626;">' + money(spent) + '</b> • অবশিষ্ট <b style="color:' + (bal < 0 ? '#dc2626' : '#16a34a') + ';">' + money(bal) + '</b></div></div>' +
      '<div style="display:flex;gap:4px;"><button class="btn btn-primary btn-sm" onclick="expViewMonth(\'' + k + '\')"><i class="fas fa-eye"></i> View</button>' +
      '<button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="expEditMonth(\'' + k + '\')"><i class="fas fa-edit"></i> Update</button>' +
      '<button class="btn btn-danger btn-sm" onclick="expDeleteMonth(\'' + k + '\')"><i class="fas fa-trash"></i> Delete</button></div></div>';
  }).join('') : '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:.84rem;">এখনো কোনো মাসের হিসাব সেভ করা নেই</p>';
}
function _expMonthList() { return _expAll().filter(e => _expKey(e) === _expYM).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))); }
const _expText = e => e.details || e.cat || 'খরচ';
function expRenderMonth() {
  expLive(); expRenderMonths();
  const box = document.getElementById('expMonthView'); if (!box) return;
  const list = _expMonthList(), total = list.reduce((a, e) => a + _n(e.amount), 0);
  if (!list.length) { box.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:18px;font-size:.85rem;">এই মাসে কোনো খরচ সেভ করা নেই</p>'; return; }
  box.innerHTML = '<div style="background:var(--accent);color:#fff;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><span>মাসের মোট খরচ (' + list.length + ' টি)</span><b style="font-size:1.25rem;">' + money(total) + '</b></div>' +
        list.map(e => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--border);">' +
      '<div style="min-width:0;"><div style="font-weight:600;font-size:.86rem;">' + _esc(_expText(e)) + ' — <span style="color:var(--accent);">' + money(e.amount) + '</span></div>' +
      '<div style="font-size:.74rem;color:var(--text-muted);">' + fmtDate(e.date) + '</div></div>' +
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
    '<table><thead><tr><th>#</th><th>তারিখ</th><th>বিবরণ</th><th class="r">টাকা</th></tr></thead><tbody>' +
    list.map((e, i) => '<tr><td>' + (i + 1) + '</td><td>' + fmtDate(e.date) + '</td><td>' + _esc(_expText(e)) + '</td><td class="r">' + money(e.amount) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td colspan="3">মোট খরচ</td><td class="r">' + money(total) + '</td></tr></tfoot></table>' +
    '<p style="font-size:12px;margin-top:6px;">কথায় : ' + takaInWords(total) + '</p>' +
    (sigOn() ? '<div style="display:flex;justify-content:flex-end;margin-top:40px;font-size:12px;"><div style="text-align:center;">' + (typeof ownerSignature !== 'undefined' && ownerSignature ? '<img src="' + ownerSignature + '" style="height:40px;display:block;margin:0 auto 2px;">' : '<div style="height:40px;"></div>') + '<div style="border-top:1px solid #16a34a;padding-top:3px;min-width:130px;">জমিদারের স্বাক্ষর</div></div></div>' : '') +
    '</body></html>');
  win.document.close(); win.focus(); setTimeout(() => win.print(), 600);
}
function expPrintMonth() {
  const list = _expMonthList(); if (!list.length) { showToast('এই মাসে প্রিন্ট করার মতো খরচ নেই', 'error'); return; }
  const [y, mo] = _expYM.split('-');
  _expPrint('মাসিক খরচের হিসাব', BN_MONTHS[+mo - 1] + ' ' + y, list);
}
function expPrintDraft() {
  const list = _expDraft.filter(r => _n(r.amount) > 0).map(r => ({ date: r.date, details: r.details, amount: _n(r.amount) }));
  if (!list.length) { showToast('কমপক্ষে একটি খরচের টাকা দিন', 'error'); return; }
  _expPrint('খরচের হিসাব', _ymLabel(_expFormYM) + ' মাসের টাকা থেকে • ' + fmtDate(isoLocal(new Date())), list);
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
    '<div>' + (m.nameLabel || 'নাম') + ' : <span class="slip-field">' + _esc(m.name || '-') + '</span></div>' +
    (m.shop ? '<div>দোকান : <span class="slip-field">' + _esc(m.shop) + '</span></div>' : '') +
    (m.mobile ? '<div>মোবাইল : <span class="slip-field">' + _esc(m.mobile) + '</span></div>' : '') + '</div>' +
    ((m.items || []).length ? '<table class="memo-table"><thead><tr><th>#</th><th>বিবরণ</th><th class="r">পরিমাণ</th><th class="r">দর</th><th class="r">টাকা</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
    (m.tables || []).map(calcTableHtml).join('') +
    (m.noSum ? '' : '<div class="memo-sum"><div><span>মোট</span><span>' + money(m.sub) + '</span></div>' +
    (m.disc ? '<div><span>ছাড়</span><span>−' + money(m.disc) + '</span></div>' : '') +
    '<div class="tot"><span>সর্বমোট</span><span>' + money(m.total) + '</span></div>' +
    (m.paid ? '<div><span>পরিশোধিত</span><span>' + money(m.paid) + '</span></div><div style="color:' + (m.due > 0 ? '#dc2626' : '#16a34a') + ';font-weight:700;"><span>' + (m.due > 0 ? 'বাকি' : 'পূর্ণ পরিশোধিত') + '</span><span>' + (m.due > 0 ? money(m.due) : '✓') + '</span></div>' : '') + '</div>') +
    '<div class="memo-words">কথায় : <span class="slip-note">' + takaInWords(m.total) + '</span></div>' +
    (m.note ? '<div style="font-size:.8rem;color:#4b5563;">মন্তব্য : <span class="slip-note">' + _esc(m.note) + '</span></div>' : '') +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px;padding-top:10px;border-top:1px dashed #86efac;font-size:.78rem;color:#14532d;">' +
    (sigOn() ? '<div><div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin-bottom:4px;"></div><div>গ্রহীতার স্বাক্ষর</div></div>' : '<div></div>') +
    '<div style="text-align:right;">' + (m.collector ? '<div style="margin-bottom:2px;">সংগ্রহকারী: <span class="slip-field">' + _esc(m.collector) + '</span></div>' : '') + (sigOn() ? sig + '<div>জমিদারের স্বাক্ষর</div>' : '') + '</div></div>' +
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
    const ok = await FDB.save('memos', m.id, Object.assign({}, m, { tables: [], tablesJson: JSON.stringify(m.tables || []) }));   // Firestore nested array support kore na
    addActivity((editing ? 'মেমো আপডেট: ' : 'মেমো সংরক্ষণ: ') + m.no + (m.name ? ' — ' + m.name : ''), 'file-invoice', '#16a34a');
    showToast(ok ? (editing ? 'মেমো আপডেট হয়েছে ✅' : 'মেমো Firebase-এ সংরক্ষিত হয়েছে ✅') : 'শুধু এই ডিভাইসে সেভ হয়েছে (ইন্টারনেট/লগইন দেখুন)', ok ? 'success' : 'error');
    memoRenderHistory();
    if (editing) memoReset();
    memoOpen(m.id);
  } else {
    memoShow(m);   // tatkhanik: store hobe na
  }
}
function memoNorm(m) {
  if (!m) return m;
  if (m.tablesJson) { try { m = Object.assign({}, m, { tables: JSON.parse(m.tablesJson) }); } catch (e) {} }
  return m;
}
function memoShow(m) {
  currentMemo = m;
  document.getElementById('memoSlipContent').innerHTML = '<div class="slip-container" id="printMemoArea" style="max-width:640px;margin:0 auto;">' + memoHtml(m) + '</div>';
  openModal('memoModal');
}
function memoEdit(id) {
  const m = memoNorm(DB.get('memos').find(x => x.id === id)); if (!m) return;
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
  const m = memoNorm(DB.get('memos').find(x => x.id === id)); if (!m) return;
  memoShow(m);
}
let _memoFolderOpen = {};
const _fKey = k => String(k).replace(/'/g, '%27');
function memoRowHtml(m) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0 9px 6px;border-top:1px solid var(--border);">' +
    '<div style="min-width:0;"><div style="font-weight:600;font-size:.84rem;">' + _esc(m.title || 'মেমো') + ' <span style="font-weight:400;color:var(--text-muted);font-size:.74rem;">' + _esc(m.no) + '</span></div>' +
    '<div style="font-size:.74rem;color:var(--text-muted);">' + fmtDate(m.date) + ' • <b>' + money(m.total) + '</b></div></div>' +
    '<div style="display:flex;gap:4px;flex-shrink:0;"><button class="btn btn-primary btn-sm" onclick="memoOpen(\'' + m.id + '\')" title="দেখুন"><i class="fas fa-eye"></i></button>' +
    '<button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="memoEdit(\'' + m.id + '\')" title="Update"><i class="fas fa-edit"></i> Update</button>' +
    '<button class="btn btn-danger btn-sm" onclick="memoDelete(\'' + m.id + '\')" title="Delete"><i class="fas fa-trash"></i> Delete</button></div></div>';
}
function memoFolders() {
  const g = {};
  DB.get('memos').forEach(m => {
    const tn = m.tenantId && (tenants || []).find(t => t.id === m.tenantId);
    const key = m.tenantId || (m.name ? '__n_' + encodeURIComponent(m.name) : '__none');
    const label = tn ? tn.name + (tn.shop ? ' — ' + tn.shop : '') : (m.name || 'ভাড়াটিয়া ছাড়া (অন্যান্য)');
    (g[key] = g[key] || { key, label, list: [] }).list.push(m);
  });
  const out = Object.values(g);
  out.forEach(f => f.list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
  return out.sort((a, b) => (a.key === '__none') - (b.key === '__none') || a.label.localeCompare(b.label, 'bn'));
}
function memoFolderToggle(key) { _memoFolderOpen[key] = !_memoFolderOpen[key]; memoRenderHistory(); }
function memoFolderHtml(f) {
  const open = !!_memoFolderOpen[f.key];
  return '<div style="border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden;">' +
    '<button type="button" onclick="memoFolderToggle(\'' + _fKey(f.key) + '\')" style="width:100%;display:flex;align-items:center;gap:10px;padding:11px 14px;background:' + (open ? 'rgba(22,163,74,.08)' : 'transparent') + ';border:none;cursor:pointer;color:var(--text-primary);font-family:inherit;text-align:left;">' +
    '<i class="fas ' + (open ? 'fa-folder-open' : 'fa-folder') + '" style="color:#f59e0b;font-size:1.1rem;"></i><span style="flex:1;font-weight:700;font-size:.9rem;">' + _esc(f.label) + '</span>' +
    '<span style="font-size:.74rem;color:var(--text-muted);">' + f.list.length + ' টি মেমো</span><i class="fas fa-chevron-' + (open ? 'up' : 'down') + '" style="font-size:.7rem;color:var(--text-muted);"></i></button>' +
    (open ? '<div style="padding:0 12px 6px;">' + f.list.map(memoRowHtml).join('') + '</div>' : '') + '</div>';
}
function memoRenderHistory() {
  const box = document.getElementById('memoHistory'); if (!box) return;
  const fs = memoFolders();
  box.innerHTML = fs.length ? fs.map(memoFolderHtml).join('')
    : '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:.84rem;">কোনো সংরক্ষিত মেমো নেই। মেমো বানানোর সময় "সেভ করে মেমো তৈরি করুন" চাপলে ভাড়াটিয়ার নামের ফোল্ডারে থাকবে।</p>';
  if (typeof advRenderList === 'function') advRenderList();
}
async function memoDelete(id) {
  if (!await uiConfirm('এই মেমো মুছে ফেলতে চান?')) return;
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
// লগইন আপগ্রেড + অগ্রিম জমা মেমো (PREMIUM) — আগে advance-memo.js ছিল, এখন এখানেই
// ============================================================
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

  // মেমোতে শুধু দুটি লাইন: মোট অগ্রিম নির্ধারিত (হেডিং) + মোট অগ্রিম জমা
  function amTables(d, c) {
    return [{ heading: 'মোট অগ্রিম নির্ধারিত (চুক্তিপত্র অনুযায়ী)', headingAmt: money(c.adv), cols: ['বিবরণ', 'টাকা'], num: [1], rows: [['মোট অগ্রিম জমা', money(c.recv)]] }];
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
      advance: c.adv, received: c.recv, method: a.method || '',
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

  function amSummaryHtml(t) {
    return '<div style="margin:14px 0 6px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;border-bottom:2px solid #14532d;padding-bottom:6px;">' +
        '<div style="font-size:1.05rem;font-weight:800;color:#14532d;">' + _esc(t.heading) + '</div>' +
        '<div style="font-size:1.25rem;font-weight:800;color:#14532d;">' + _esc(t.headingAmt) + '</div></div>' +
      t.rows.map(r => '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:10px 0;border-bottom:1px dashed #86efac;font-size:1rem;font-weight:700;color:#166534;"><span>' + _esc(r[0]) + '</span><span style="font-size:1.15rem;">' + _esc(r[1]) + '</span></div>').join('') +
    '</div>';
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
        '<div class="slip-stamp">অগ্রিম জমা মেমো</div>' +
        '<div style="font-size:.9rem;font-weight:800;color:#14532d;">নং-' + _esc(m.no) + '</div>' +
        '<div style="margin-left:auto;font-size:.84rem;color:#166534;">তারিখ: <span class="slip-field">' + fmtDate(m.date) + '</span></div>' +
      '</div>' +
      '<div class="memo-meta">' +
        '<div>ভাড়াটিয়ার নাম : <span class="slip-field">' + _esc(m.name || '-') + '</span></div>' +
        (m.shop ? '<div>দোকান : <span class="slip-field">' + _esc(m.shop) + '</span></div>' : '') +
        (m.mobile ? '<div>মোবাইল : <span class="slip-field">' + _esc(m.mobile) + '</span></div>' : '') +
      '</div>' +
      tables.map(amSummaryHtml).join('') +
      '<div class="memo-words">অগ্রিম জমা (কথায়) : <span class="slip-note">' + takaInWords(c.recv) + '</span></div>' +
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
          '<p style="font-size:.78rem;color:var(--text-muted);margin-bottom:12px;">শুধু অগ্রিম জমার মেমো। সেভ করলে Firebase-এ থাকবে এবং মেমোর নিচে QR কোড বসবে। কোনো স্বাক্ষর লাগে না। কর্তনের ঘরগুলো শুধু লাইভ হিসাবের জন্য — মেমোতে আসবে না।</p>' +
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
      sched: false, collector: val('amCollector').trim(), note: val('amNote').trim()
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
      '<div style="font-size:.74rem;color:var(--text-muted);margin:6px 2px;">ℹ️ মেমোতে শুধু "মোট অগ্রিম নির্ধারিত" ও "মোট অগ্রিম জমা" দেখানো হবে; কর্তনের হিসাব মেমোতে আসবে না।</div>';
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
      kind: 'adv-memo', title: 'অগ্রিম জমা মেমো', date: d.date,
      tenantId: d.tid || '', name: d.name, shop: d.shop, mobile: d.mobile,
      items: [], tables: [], noSum: true,
      sub: _r2(c.recv), disc: 0, total: _r2(c.recv), paid: 0, due: 0,
      collector: d.collector, note: d.note,
      advData: { adv: c.adv, recv: c.recv, ded: c.ded, months: c.months, start: d.start || '', method: d.method || '', sched: false },
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
    const text = '📋 *অগ্রিম জমা মেমো - ' + (settings.mktName || '') + '*\n\nনং: ' + m.no + '\nতারিখ: ' + fmtDate(m.date) + '\nনাম: ' + m.name + (m.shop ? '\nদোকান: ' + m.shop : '') +
      '\n\nমোট অগ্রিম নির্ধারিত (চুক্তিপত্র অনুযায়ী): ' + money(c.adv) + '\n*মোট অগ্রিম জমা: ' + money(c.recv) + '*' +
      (m.verifyToken ? '\n\nযাচাই: ' + verifyUrlFor(m.verifyToken) : '') + '\n\nধন্যবাদ।';
    const url = 'https://wa.me/' + (mob ? (mob.startsWith('88') ? mob : '88' + mob) : '') + '?text=' + encodeURIComponent(text);
    const el = $('printMemoArea');
    try {
      if (el && typeof html2canvas !== 'undefined' && navigator.share && navigator.canShare) {
        const canvas = await slipCanvas(el), blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
        const file = new File([blob], 'advance_memo_' + m.no + '.jpg', { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'অগ্রিম জমা মেমো ' + m.no }); return; }
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
  window.buildLogin = buildLogin;
  buildLogin();

  window.__AdvMemo = { calc: amCalc, tables: amTables };   // টেস্টের জন্য
})();

// ============================================================
// চুক্তিপত্র লিখুন — লিগ্যাল (৮.৫×১৪ ইঞ্চি) ভাড়া চুক্তিপত্র, Firebase: "agreementDocs"
// মার্জিন: উপরে ৪" (১ম পাতা, স্ট্যাম্পের জন্য), নিচে ১", বামে-ডানে ১"
// ============================================================
const AGW_CSS = `
  .agw-txt{font-family:'Noto Serif Bengali','Noto Sans Bengali',serif;font-size:12pt;line-height:1.75;color:#000;text-align:justify;}
  .agw-page{width:816px;height:1344px;box-sizing:border-box;position:relative;background:#fff;padding-left:96px;padding-right:96px;padding-bottom:96px;overflow:hidden;}
  .agw-b{margin:0 0 10px;}
  .agw-b p{margin:0;}
  .agw-ph{text-align:center;font-style:italic;text-decoration:underline;font-size:.9em;height:34px;line-height:34px;margin-bottom:6px;}
  .agw-pf{position:absolute;right:96px;bottom:46px;font-style:italic;text-decoration:underline;font-size:.9em;}
  .agw-party{text-align:right;font-weight:700;text-decoration:underline;margin-top:2px;}
  .agw-line{border-top:1px solid #000;width:230px;margin-left:auto;text-align:center;padding-top:2px;font-size:.9em;}
  .agw-var{outline:1.5px dashed #2563eb;outline-offset:1px;background:#eff6ff;border-radius:3px;padding:0 2px;cursor:pointer;}
  .agw-var:hover{background:#dbeafe;}
`;
(function injectAgwCss() {
  if (document.getElementById('agwCss')) return;
  const st = document.createElement('style'); st.id = 'agwCss'; st.textContent = AGW_CSS; document.head.appendChild(st);
})();

const AGW_TERMS = [
  'তফসিলোক্ত দোকান গৃহের অগ্রিম বা জামানত হিসাবে এককালীন {{advance}} টাকা ২য় পক্ষ, ১ম পক্ষ/জমিদারকে প্রদান করিলেন। অত্র চুক্তিপত্রের মেয়াদ {{startDate}} ইং তারিখ হইতে শুরু হইয়া আগামী {{endDate}} ইং পর্যন্ত {{periodOf}} জন্য বলবৎ থাকিবে। {{period}} মেয়াদ শেষে ২য় পক্ষ ভাড়াটিয়া তপশীলোক্ত দোকানগৃহ খালি করিয়া সাবেক অবস্থায় ১ম পক্ষ জমিদারকে বুঝাইয়া দিবে। উক্ত ক্ষেত্রে ১ম পক্ষ জমিদারগণ অগ্রিম বাবদ গৃহীত কর্তনবাদে হিসাব নিকাশে যাহা পাওনা থাকে তাহা ২য় পক্ষ ভাড়াটিয়াকে ফেরত প্রদান করিবেন। {{period}} মেয়াদ শেষে উক্ত চুক্তিপত্রটি বাতিল বলিয়া গণ্য হইবে।',
  'তফসিলোক্ত দোকান গৃহের মাসিক মূল ভাড়া {{rent}} টাকা নির্ধারণ করা হইলো। ২য় পক্ষ ভাড়াটিয়া প্রতি চলিত মাসের ভাড়া পরবর্তী মাসের ১ হইতে {{dueDay}} তারিখের মধ্যে ১ম পক্ষ/জমিদার বরাবর {{netRent}} টাকা নগদে প্রদান করিবেন এবং {{deduction}} টাকা অগ্রিম বা জামানত হইতে কর্তন যাইবে। প্রতি নতুন বছর ({{increaseMonth}}) নির্ধারিত মূল ভাড়ার সাথে {{increase}} টাকা ভাড়া বৃদ্ধি করা হইবে। কোন মাসের ভাড়া বকেয়া রাখা যাইবে না। ভাড়া বকেয়া রাখিলে ২য় পক্ষ ডিফল্টার হিসাবে গণ্য হইবে। এক্ষেত্রে পর পর {{notice}} মাস ভাড়া বকেয়া রাখিলে ২য় পক্ষ ভাড়াটিয়া উচ্ছেদযোগ্য হইবে। সেইক্ষেত্রে অত্র চুক্তিনামার কার্যকারিতা অবসান হইবে।',
  '২য় পক্ষ/ভাড়াটিয়া উক্ত দোকান গৃহটি "{{business}}" হিসেবে ব্যবহার করিবেন। তবে কোন অবৈধ বা দেশ ও সমাজ বিরোধ ব্যবসা করিতে পারিবেন না। করিলে তজ্জন্য ২য় পক্ষ/ভাড়াটিয়াই এককভাবে দায়ী থাকিবেন।',
  '২য় পক্ষ/ভাড়াটিয়া তফসিলোক্ত দোকান গৃহে নির্ধারিত "{{business}}" করিতে অপারগ হইলে ১ম পক্ষ/জমিদারকে {{notice}} মাস পূর্বে জানাইবেন এবং সেই ক্ষেত্রে তাহার অগ্রীম/ জামানতকৃত টাকা হইতে ১ম পক্ষের যাবতীয় পাওনাদী পরিশোধ করিয়া অবশিষ্ট টাকা দোকান বুঝাইয়া দিয়া ফেরৎ নিতে পারিবেন।',
  'প্রথম পক্ষ জমিদার যে কোন প্রয়োজনে {{notice}} মাস পূর্বে লিখিত বা মৌখিক নোটিশ প্রদানের মাধ্যমে দ্বিতীয় পক্ষ ভাড়াটিয়াকে উচ্ছেদ করার অধিকার সংরক্ষন করেন। এক্ষেত্রে দ্বিতীয় পক্ষ ভাড়াটিয়ার জামানতের টাকা কর্তনের পর যদি অবশিষ্ট থাকে তাহা প্রথম পক্ষ জমিদার ফেরত প্রদান করিবেন।',
  '২য় পক্ষ/ভাড়াটিয়া তফসিলোক্ত দোকান গৃহের ক্ষতি হয় এমন কোনরূপ পরিবর্তন ও পরিমার্জন করিতে পারিবেন না। {{premise}} গৃহে কোন প্রকার কাজ করিতে হইলে তাহা ১ম পক্ষ জমিদারকে অবগত করিয়া অনুমতি সাপেক্ষে কাজ সম্পন্ন করিতে হইবে।',
  '২য় পক্ষ/ভাড়াটিয়া তফসিলোক্ত {{premise}} গৃহটিতে অথবা তাহার কোন অংশে কোনরূপ উপ- ভাড়াটিয়া অথবা সাবলেট দিতে পারিবেন না। যদি এই ধরণের কোন ঘটনা ঘটে সেই ক্ষেত্রে ২য় পক্ষ আইনত উচ্ছেদ হইবেন।',
  '২য় পক্ষ/ভাড়াটিয়া তফসিলোক্ত {{premise}} গৃহে নির্ধারিত "{{business}}" ব্যতীত অন্য কোন ব্যবসা করিতে পারিবেন না এবং তফসিলোক্ত {{premise}} গৃহের বিপরীতে কোন অর্থলগ্নীকারী ব্যক্তি প্রতিষ্ঠান ও ব্যাংক হইতে কোন ঋণ গ্রহণ করিতে পারিবেন না। করিলে তার জন্য উক্ত অর্থলগ্নীকারী ব্যক্তি, প্রতিষ্ঠান ও ব্যাংক এবং ২য় পক্ষ/ভাড়াটিয়া দায়ী থাকিবেন। ১ম পক্ষ/জমিদার কিংবা তফসিলোক্ত দোকান গৃহ কোনরূপ দায়ী থাকিবেন না।',
  '২য়পক্ষ/ ভাড়াটিয়া তফসিলোক্ত {{premise}} গৃহের মাসিক বিদ্যুৎ বিল নিয়মিতভাবে পরিশোধ করিতে বাধ্য থাকিবেন। পরিশোধিত বিলের কপি ১ম পক্ষ/জমিদার বরাবর প্রদান করিতে হইবে।',
  '২য় পক্ষ/ভাড়াটিয়া ভাড়া নেওয়া {{premise}} গৃহে টেলিফোন বা ফ্যাক্স সংযোগ নিলে তাহা সম্পূর্ণ ২য় পক্ষের নিজ দায়িত্বে থাকিবে। তাহাতে ১ম পক্ষ কোন ভাবে দায়ী থাকিবেন না।',
  '২য় পক্ষ/ভাড়াটিয়া ব্যবসা সংক্রান্ত যাবতীয় কর, ট্যাক্স, ভ্যাট এবং ট্রেড লাইসেন্স ফি ইত্যাদি পরিশোধ করিবেন।',
  '১ম পক্ষ/জমিদার {{premise}} গৃহের সব ধরনের মেরামত কাজ করে ২য় পক্ষ ভাড়াটিয়াকে {{premise}} গৃহখানা বুঝাইয়া দিল। পরবর্তীতে অর্থাৎ চুক্তিপত্রের মেয়াদের শেষ তারিখ পর্যন্ত {{premise}} গৃহের কোন কিছুর মেরামত করার প্রয়োজন হইলে ২য় পক্ষ ভাড়াটিয়া নিজ খরচ ও নিজ দায়িত্বে মেরামত করে নিবে। কোন ভাবেই ১ম পক্ষ/জমিদার নিকট মেরামত সংক্রান্ত বিষয়ে আবদার করতি পারিবে না।',
  'অত্র দোকান চুক্তির {{period}} মেয়াদকালে মধ্যে দোকানের কোন প্রকার ক্ষতি সাধিত হইলে {{premise}} ছাড়ার সময় দ্বিতীয় পক্ষ ভাড়াটিয়া নিজ খরচে তাহা মেরামত করিয়া দিতে বাধ্য থাকিবে। যদি মেরামত করে না দেয় তবে অগ্রিম বা জামানতের টাকা হইতে প্রথমপক্ষ জমিদার কর্তন করিয়া অবশিষ্ট টাকা ফেরত প্রদান করিবেন।'
];
const AGW_DEFAULTS = () => Object.assign({
  docTitle: 'অস্থায়ী দোকান ভাড়ার চুক্তিপত্র',
  landlordText: '১। মোঃ নাদিম মজুমদার, ২। মোঃ নাঈম উদ্দিন মজুমদার, উভয় পিতা- মরহুম মোহাম্মদ জয়নাল আবেদীন, ঠিকানা- ১ নং চাঁন ভবন, হাজী ফজু মিয়া রোড, ডাকঘর- পাহাড়তলী, থানা- পাহাড়তলী, জেলা- চট্টগ্রাম, জাতীয়তা- বাংলাদেশী।',
  preamble: 'পরম করুণাময় মহান আল্লাহ তায়ালার নামে আরম্ভ করিতেছি যে, নিম্নে তফসিলে বর্ণিত দোকান গৃহটি অত্র চুক্তিপত্রের ১ম পক্ষ/জমিদারের খরিদা খাস দখলীয় সম্পত্তি হয়। ১ম পক্ষ তফসিলে বর্ণিত {{premise}} গৃহটি মাসিক ভাড়ায় লাগিয়তের ঘোষণা করিলে ২য় পক্ষ তাহাতে ভাড়া লইতে সম্মত হওয়ায় উভয় পক্ষ আলাপ আলোচনাক্রমে নিম্নে বর্ণিত শর্তাবলীর ভিত্তিতে অত্র ভাড়া চুক্তিপত্র সম্পাদন করিলাম।',
  terms: AGW_TERMS.slice(),
  closing: 'এই করারে, স্বেচ্ছায়, স্বজ্ঞানে, সুস্থ মস্তিষ্কে কাহারো বিনা প্ররোচনায় উপস্থিত স্বাক্ষীগণের সম্মুখে উপরে উল্লেখিত চুক্তিপত্রের শর্তাবলী নিজে পড়িয়া, পড়াইয়া ও ইহার সম্যক মর্ম আবগত হইয়া ভবিষ্যতের ভালমন্দ ভাবিয়া অত্র মাসিক দোকান ভাড়ার চুক্তিপত্রের শিরভাগে আমাদের নিজ নিজ স্বাক্ষর করিয়া চুক্তিপত্রটি সম্পাদন করিয়া দিলাম। তারিখ: {{signDate}} ইংরেজি।',
  schedule: 'জেলা- চট্টগ্রাম, থানা- পাহাড়তলী, মৌজা- পশ্চিম নাছিরাবাদ, হোল্ডিং নং : ২৪৯৩/২৭৯১, ডি.টি রোড, বার কোয়ার্টার, হাজী চাঁন মিয়া মার্কেটের পিছনে অবস্থিত অবশিষ্ট দোকান গৃহটি মাসিক ভাড়ায় লাগিয়তকৃত।',
  business: 'সিএনজি গ্যারেজ', premise: 'গ্যারেজ', dueDay: 5, notice: 3, years: 2, increaseMonth: 'জানুয়ারিতে', fontSize: 12, topIn: 4, topIn2: 1
}, (settings && settings.agwDefaults) || {});

let _agw = null, _agwBuilt = false, _agwEndManual = false, _agwTimer = null, _agwView = 'normal', _agwMarks = true;
function agwBlank() {
  const t = isoLocal(new Date());
  const base = AGW_DEFAULTS(); base.terms = (base.terms || []).slice();
  return Object.assign(base, { id: '', tenantId: '', name: '', father: '', address: '', nid: '', mobile: '', shop: '', advance: '', rent: '', deduction: '', increase: '', startDate: t, endDate: '', signDate: t });
}
const agwBn = n => _bnDigits(String(n));
const agwNum = n => _bnDigits(Number(n).toLocaleString('en-IN'));
const agwWords = n => takaInWords(n).replace(/ টাকা মাত্র$/, '').replace(/লাখ/g, 'লক্ষ');
const agwMoney = n => agwNum(Math.round(n)) + '/= (' + agwWords(n) + ')';
const agwCount = (n, pad) => (pad ? agwBn(String(n).padStart(2, '0')) : agwBn(n)) + ' (' + (BN_UNDER_100[n] || agwBn(n)) + ')';
const agwDate = v => v ? agwBn(fmtDate(v)) : '...........';
const agwOr = (v, def) => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? def : Number(v);
// মেয়াদ: বছর (০.৫ পর্যন্ত দশমিক চলে) ↔ শুরু/শেষ তারিখ
const agwMonths = d => Math.round(_n(d.years) * 12);
function agwEnd(d) {
  const s = new Date(d.startDate + 'T00:00:00'), m = agwMonths(d);
  if (isNaN(s) || m <= 0) return '';
  const t = new Date(s.getFullYear(), s.getMonth() + m, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return isoLocal(new Date(t.getFullYear(), t.getMonth(), Math.min(s.getDate(), last) - 1));
}
function agwYearsFromDates(d) {
  const s = new Date(d.startDate + 'T00:00:00'), e = new Date(d.endDate + 'T00:00:00');
  if (isNaN(s) || isNaN(e) || e < s) return null;
  const e1 = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
  const m = Math.round((e1.getFullYear() - s.getFullYear()) * 12 + (e1.getMonth() - s.getMonth()) + (e1.getDate() - s.getDate()) / 30);
  return m > 0 ? Math.round(m / 12 * 100) / 100 : null;
}
function agwPeriod(d, of) {
  const m = agwMonths(d), y = Math.floor(m / 12), r = m % 12, p = [], e = of ? 'ের' : '';
  if (y) p.push(agwCount(y) + ' বছর' + (r ? '' : e));
  if (r) p.push(agwCount(r) + ' মাস' + e);
  return p.length ? p.join(' ') : agwCount(0) + ' বছর' + e;
}
function agwVars(d, mark) {
  const rent = _n(d.rent), ded = _n(d.deduction), adv = _n(d.advance), inc = _n(d.increase);
  const w = (k, h) => mark ? '<span class="agw-var" data-var="' + k + '" title="এডিট করতে ক্লিক করুন" onclick="agwFocusVar(\'' + k + '\')">' + h + '</span>' : h;
  const b = x => '<b>' + _esc(x) + '</b>';
  const yrs = Math.floor(_n(d.years)) || 0;
  return {
    advance: w('advance', agwMoney(adv)), rent: w('rent', agwMoney(rent)), netRent: w('rent', agwMoney(Math.max(0, rent - ded))), deduction: w('deduction', agwMoney(ded)), increase: w('increase', agwMoney(inc)),
    startDate: w('startDate', agwDate(d.startDate)), endDate: w('endDate', agwDate(d.endDate)), signDate: w('signDate', agwDate(d.signDate)),
    years: w('years', agwCount(yrs)), period: w('years', agwPeriod(d)), periodOf: w('years', agwPeriod(d, true)), notice: w('notice', agwCount(Math.floor(_n(d.notice)) || 0, true)), dueDay: w('dueDay', agwBn(Math.floor(_n(d.dueDay)) || 5)),
    business: w('business', b(d.business || '')), premise: w('premise', b(d.premise || '')), increaseMonth: w('increaseMonth', _esc(d.increaseMonth || '')), shop: w('shop', _esc(d.shop || '')), name: w('name', _esc(d.name || ''))
  };
}
function agwFill(text, v) {
  return _esc(text || '').replace(/\{\{years\}\}\s*বছরের/g, '{{periodOf}}').replace(/\{\{years\}\}\s*বছর/g, '{{period}}').replace(/\{\{(\w+)\}\}/g, (m, k) => v[k] != null ? v[k] : m).replace(/\n/g, '<br>');
}
function agwBlocks(d, mark) {
  const v = agwVars(d, mark), P = t => '<p>' + t + '</p>';
  const mk = (k, h) => mark ? '<span class="agw-var" title="এডিট করতে ক্লিক করুন" onclick="agwFocusVar(\'' + k + '\')">' + h + '</span>' : h;
  const tenantP = '<b>' + mk('name', _esc(d.name || '..........')) + '</b>' + (d.father ? ', পিতা- ' + mk('father', _esc(d.father)) : '') + (d.address ? ', ঠিকানাঃ ' + mk('address', _esc(d.address)) : '') + ', জাতীয়তা- বাংলাদেশী' + (d.nid ? '। জাতীয় পরিচয়পত্র নং- ' + mk('nid', agwBn(_esc(d.nid))) : '') + '।';
  const out = [];
  out.push('<div style="text-align:center;font-style:italic;font-size:.85em;">বিসমিল্লাহির রাহমানির রাহিম</div><div style="text-align:center;font-size:1.55em;font-weight:800;text-decoration:underline;margin:4px 0 6px;line-height:1.4;">' + _esc(d.docTitle) + '</div>');
  out.push(P(agwFill(d.landlordText, v)) + '<div class="agw-party">======= ১মপক্ষ/জমিদার।</div>');
  out.push(P(tenantP) + '<div class="agw-party">======= ২য়পক্ষ/ ভাড়াটিয়া।</div>');
  out.push(P(agwFill(d.preamble, v)));
  out.push('<div style="text-align:center;font-size:1.55em;font-weight:800;text-decoration:underline;line-height:1.4;">শর্ত সমূহ</div>');
  (d.terms || []).forEach((t, i) => out.push('<div style="display:flex;gap:6px;"><span style="min-width:30px;">' + agwBn(i + 1) + '।</span><span style="flex:1;">' + agwFill(t, v) + '</span></div>'));
  const tail = [];
  tail.push(P(agwFill(d.closing, v)));
  tail.push('<div style="text-align:center;font-size:1.2em;font-weight:800;text-decoration:underline;margin-bottom:4px;">‘দোকানের তফসিল’</div>' + P(agwFill(d.schedule, v)));
  tail.push('<div style="margin-top:6px;"><div style="text-decoration:underline;margin-bottom:10px;">সাক্ষীগণের স্বাক্ষর, নাম ও ঠিকানাঃ</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;height:50px;"><span>১।</span>' + (sigOn() ? '<div class="agw-line">১ম পক্ষ/ জমিদারের স্বাক্ষর</div>' : '') + '</div>' +
    '<div style="height:44px;"><span>২।</span></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;height:50px;"><span>৩।</span>' + (sigOn() ? '<div class="agw-line">২য় পক্ষ/ভাড়াটিয়ার স্বাক্ষর</div>' : '') + '</div></div>');
  out.push(tail.map(t => '<div class="agw-b">' + t + '</div>').join(''));
  return out;
}
// শুধু প্রিভিউর জন্য — ১০০ টাকার নন-জুডিসিয়াল স্ট্যাম্পের ধাঁচে নমুনা (প্রিন্ট/PDF-এ আসে না)
function agwStampSvg() {
  const W = 624, H = 324, C = '#2f7d5f', F = "'Noto Serif Bengali','Noto Sans Bengali',serif";
  let g = '';
  for (let k = 0; k < 18; k++) {
    let p = '';
    for (let x = 0; x <= W; x += 4) { const y = H / 2 + Math.sin(x / 34 + k * .42) * (34 + k * 5.5) * Math.cos(x / 210 + k * .05); p += (x ? ' L' : 'M') + x + ' ' + y.toFixed(1); }
    g += '<path d="' + p + '" fill="none" stroke="' + C + '" stroke-width=".55" opacity=".32"/>';
  }
  const medal = cx => '<g><circle cx="' + cx + '" cy="162" r="64" fill="#fff" fill-opacity=".75" stroke="' + C + '" stroke-width="2"/><circle cx="' + cx + '" cy="162" r="58" fill="none" stroke="' + C + '" stroke-width="1" stroke-dasharray="2 3"/><circle cx="' + cx + '" cy="162" r="48" fill="none" stroke="' + C + '" stroke-width=".8"/>' +
    '<text x="' + cx + '" y="172" text-anchor="middle" font-family="' + F + '" font-size="40" font-weight="800" fill="' + C + '">১০০</text><text x="' + cx + '" y="196" text-anchor="middle" font-family="' + F + '" font-size="13" font-weight="700" fill="' + C + '">টাকা</text></g>';
  let petals = '';
  [-70, -42, -16, 16, 42, 70].forEach(a => { petals += '<ellipse cx="0" cy="-26" rx="10" ry="30" transform="rotate(' + a + ')" fill="#fff" stroke="' + C + '" stroke-width="1.4"/>'; });
  petals += '<ellipse cx="0" cy="-30" rx="11" ry="34" fill="#fff" stroke="' + C + '" stroke-width="1.6"/>';
  let grains = '';
  for (let i = 0; i < 7; i++) { const t = i / 6, x = -64 - 6 * Math.sin(t * 3) + t * 30, y = -4 - t * 82; grains += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="3.2" ry="6" transform="rotate(' + (-25 + t * 50).toFixed(0) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')" fill="' + C + '" opacity=".75"/>'; }
  const sheaf = '<path d="M-58 6 C-80 -28 -62 -68 -30 -86" fill="none" stroke="' + C + '" stroke-width="2.4"/>' + grains;
  const emblem = '<g transform="translate(312,208)">' + sheaf + '<g transform="scale(-1,1)">' + sheaf + '</g>' + petals +
    '<path d="M-70 8 q14 -9 28 0 t28 0 t28 0 t28 0 t28 0" fill="none" stroke="' + C + '" stroke-width="1.6"/><path d="M-60 16 q12 -8 24 0 t24 0 t24 0 t24 0 t24 0" fill="none" stroke="' + C + '" stroke-width="1.2"/>' +
    '<text x="0" y="-112" text-anchor="middle" font-size="13" fill="' + C + '" letter-spacing="9">★ ★ ★ ★</text></g>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="display:block;">' +
    '<defs><clipPath id="agwSc"><rect x="18" y="18" width="' + (W - 36) + '" height="' + (H - 36) + '"/></clipPath></defs>' +
    '<rect x="3" y="3" width="' + (W - 6) + '" height="' + (H - 6) + '" fill="#eef6ea" stroke="' + C + '" stroke-width="3"/>' +
    '<rect x="11" y="11" width="' + (W - 22) + '" height="' + (H - 22) + '" fill="none" stroke="' + C + '" stroke-width="1"/>' +
    '<rect x="16" y="16" width="' + (W - 32) + '" height="' + (H - 32) + '" fill="none" stroke="' + C + '" stroke-width="1" stroke-dasharray="3 3"/>' +
    '<g clip-path="url(#agwSc)">' + g + '</g>' + medal(88) + medal(W - 88) + emblem +
    '<text x="312" y="48" text-anchor="middle" font-family="' + F + '" font-size="27" font-weight="800" fill="' + C + '">বাংলাদেশ</text>' +
    '<text x="312" y="64" text-anchor="middle" font-family="' + F + '" font-size="11" font-weight="700" fill="' + C + '" letter-spacing="5">BANGLADESH</text>' +
    '<text x="312" y="262" text-anchor="middle" font-family="' + F + '" font-size="15" font-weight="800" fill="' + C + '">নন-জুডিসিয়াল স্ট্যাম্প</text>' +
    '<text x="312" y="278" text-anchor="middle" font-family="' + F + '" font-size="9.5" font-weight="700" fill="' + C + '" letter-spacing="2.5">NON-JUDICIAL STAMP • ONE HUNDRED TAKA</text>' +
    '<text x="312" y="300" text-anchor="middle" font-family="' + F + '" font-size="12" font-weight="700" fill="' + C + '">একশত টাকা</text>' +
    '<text x="312" y="313" text-anchor="middle" font-family="sans-serif" font-size="6.5" fill="' + C + '" opacity=".75" letter-spacing="2">SAMPLE PREVIEW — NOT FOR PRINT</text></svg>';
}
// পাতা ভাগ: ১ম পাতায় উপরে ৪" (স্ট্যাম্প), পরের পাতায় ১"; নিচে ১", দুই পাশে ১"; ফন্ট সাইজ pt-এ
function agwPages(d, o) {
  o = o || {};
  const fs = Math.min(20, Math.max(8, agwOr(d.fontSize, 12)));
  const t1 = Math.round(agwOr(d.topIn, 4) * 96), t2 = Math.round(agwOr(d.topIn2, 1) * 96), BOT = 96, PH = 40;
  const blocks = agwBlocks(d, o.marks);
  const m = document.createElement('div');
  m.className = 'agw-txt'; m.style.cssText = 'position:absolute;left:-99999px;top:0;width:624px;font-size:' + fs + 'pt;';
  m.innerHTML = blocks.map(b => '<div class="agw-b">' + b + '</div>').join('');
  document.body.appendChild(m);
  const hs = [...m.children].map(c => c.offsetHeight + 10);
  document.body.removeChild(m);
  const pages = [[]]; let used = 0;
  const avail = i => 1344 - (i > 0 ? t2 + PH : t1) - BOT;
  blocks.forEach((b, i) => {
    let p = pages.length - 1;
    if (used + hs[i] > avail(p) && pages[p].length) { pages.push([]); p++; used = 0; }
    pages[p].push(b); used += hs[i];
  });
  const stamp = o.stamp ? '<div style="position:absolute;left:96px;top:' + Math.max(8, Math.round((t1 - 324) / 2)) + 'px;width:624px;height:324px;">' + agwStampSvg() + '</div>' : '';
  return pages.map((bl, i) =>
    '<div class="agw-page agw-txt" style="padding-top:' + (i ? t2 : t1) + 'px;font-size:' + fs + 'pt;">' + (i === 0 ? stamp : '') + (i > 0 ? '<div class="agw-ph">পাতা-' + agwBn(i + 1) + '</div>' : '') +
    bl.map(b => '<div class="agw-b">' + b + '</div>').join('') +
    (i < pages.length - 1 ? '<div class="agw-pf">চলমান পাতা-' + agwBn(i + 2) + '</div>' : '') + '</div>');
}
function agwPrintHtml(d) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + _esc((d.name || 'ভাড়াটিয়া') + ' - চুক্তিপত্র') + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700;800&family=Noto+Sans+Bengali:wght@400;700&display=swap" rel="stylesheet">' +
    '<style>@page{size:8.5in 14in;margin:0}html,body{margin:0;padding:0;background:#fff}' + AGW_CSS + '.agw-page{page-break-after:always;break-after:page;}.agw-page:last-child{page-break-after:auto;break-after:auto}</style></head><body>' +
    agwPages(d).join('') +
    '<scr' + 'ipt>(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(function(){setTimeout(function(){window.print();},500);});</scr' + 'ipt></body></html>';
}

// ── UI ──
function agwInit() {
  const root = document.getElementById('agwRoot'); if (!root) return;
  if (!_agw) _agw = agwBlank();
  if (!_agwBuilt) { agwBuild(root); _agwBuilt = true; }
  agwFillForm(); agwPreview(); agwList();
  FDB.getAll('agreementDocs').then(() => agwList()).catch(() => {});
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => agwPreview());
}
function agwBuild(root) {
  const inp = (k, label, extra, full) => '<div class="form-group"' + (full ? ' style="grid-column:1/-1;"' : '') + '><label class="form-label">' + label + '</label><input class="form-input" data-k="' + k + '" oninput="agwIn(this)" ' + (extra || '') + '></div>';
  const ta = (k, label, rows) => '<div class="form-group" style="grid-column:1/-1;"><label class="form-label">' + label + '</label><textarea class="form-input" rows="' + (rows || 3) + '" data-k="' + k + '" oninput="agwIn(this)"></textarea></div>';
  const card = (title, icon, body) => '<div class="stat-card" style="padding:18px;margin-bottom:14px;"><h3 style="font-weight:700;margin-bottom:12px;font-size:.92rem;"><i class="fas ' + icon + '" style="color:var(--accent);"></i> ' + title + '</h3>' + body + '</div>';
  root.innerHTML =
    '<div style="display:grid;grid-template-columns:minmax(320px,1fr) minmax(320px,1fr);gap:20px;align-items:start;" id="agwGrid">' +
    '<div>' +
    card('ভাড়াটিয়া (২য় পক্ষ)', 'fa-user', '<div class="form-grid"><div class="form-group" style="grid-column:1/-1;"><label class="form-label">ভাড়াটিয়া বাছুন (সব তথ্য নিজে বসবে)</label><select id="agwTenant" class="form-input form-select" onchange="agwPick()"></select></div>' +
      inp('name', 'নাম *') + inp('father', 'পিতার নাম') + inp('mobile', 'মোবাইল (WhatsApp)', 'inputmode="tel"') + inp('shop', 'দোকান নং') + inp('nid', 'জাতীয় পরিচয়পত্র নং') + inp('address', 'ঠিকানা', '', true) + '</div>') +
    card('চুক্তির মেয়াদ ও পাতা', 'fa-file-contract', '<div class="form-grid">' + inp('docTitle', 'চুক্তিপত্রের শিরোনাম', '', true) +
      '<div class="form-group"><label class="form-label">চুক্তি শুরু</label><input class="form-input agw-date" data-k="startDate"></div><div class="form-group"><label class="form-label">চুক্তি শেষ</label><input class="form-input agw-date" data-k="endDate"></div>' +
      inp('years', 'মেয়াদ (বছর) — তারিখ দিলে নিজে বসবে', 'type="number" step="any" min="0"') + '<div class="form-group"><label class="form-label">স্বাক্ষরের তারিখ</label><input class="form-input agw-date" data-k="signDate"></div>' +
      inp('topIn', '১ম পাতার উপরে ফাঁকা (ইঞ্চি) — স্ট্যাম্পের জন্য', 'type="number" step="0.25" min="0"') + inp('topIn2', 'পরের পাতাগুলোর উপরে ফাঁকা (ইঞ্চি)', 'type="number" step="0.25" min="0"') +
      '<div style="grid-column:1/-1;font-size:.74rem;color:var(--text-muted);">নিচে ১", বামে ১", ডানে ১" (ফিক্সড)। ফন্ট সাইজ প্রিভিউর উপরের ফন্ট বাটন থেকে বদলান।</div></div>') +
    card('১ম পক্ষ, ভূমিকা ও তফসিল', 'fa-pen-fancy', '<div class="form-grid">' + ta('landlordText', '১ম পক্ষ/জমিদারের পরিচয় (নাম, ঠিকানা)', 4) + ta('preamble', 'ভূমিকা', 5) + ta('closing', 'সমাপনী অনুচ্ছেদ', 5) + ta('schedule', 'দোকানের তফসিল (জেলা, থানা, মৌজা, হোল্ডিং, ঠিকানা)', 4) + '</div>') +
    card('শর্তাবলী', 'fa-list-ol', '<div id="agwTermList"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">' +
      '<button type="button" id="agwBtnFull" class="btn btn-outline btn-sm" onclick="agwToggle(\'agwTermsBox\',this)"><i class="fas fa-edit"></i> শর্ত এডিট (পূর্ণ লেখা)</button>' +
      '<button type="button" id="agwBtnVars" class="btn btn-outline btn-sm" onclick="agwToggle(\'agwVarBox\',this)"><i class="fas fa-edit"></i> শর্তের ভিতরের তথ্য এডিট</button></div>' +
      '<div id="agwTermsBox" style="display:none;margin-top:12px;"><div style="font-size:.74rem;color:var(--text-muted);margin-bottom:8px;">লিখার মধ্যে এই কোডগুলো বসানো যাবে — তথ্য বদলালে নিজে বদলে যাবে: <code>{{advance}} {{rent}} {{netRent}} {{deduction}} {{increase}} {{increaseMonth}} {{startDate}} {{endDate}} {{signDate}} {{period}} {{periodOf}} {{years}} {{notice}} {{dueDay}} {{business}} {{premise}} {{shop}} {{name}}</code></div><div id="agwTerms"></div><button type="button" class="btn btn-outline btn-sm" onclick="agwTermAdd()"><i class="fas fa-plus"></i> নতুন শর্ত</button></div>' +
      '<div id="agwVarBox" style="display:none;margin-top:12px;"><div style="font-size:.74rem;color:var(--text-muted);margin-bottom:8px;">প্রিভিউতে নীল বক্স দিয়ে মার্ক করা অংশগুলো এখান থেকে বদলায় (বক্সে ক্লিক করলেও এখানে চলে আসবে)।</div><div class="form-grid">' +
      inp('advance', 'অগ্রিম / জামানত (৳)', 'type="number" step="any"') + inp('rent', 'মাসিক মূল ভাড়া (৳)', 'type="number" step="any"') + inp('deduction', 'মাসিক কর্তন (৳)', 'type="number" step="any"') + inp('increase', 'প্রতি নতুন বছরে ভাড়া বৃদ্ধি (৳)', 'type="number" step="any"') +
      inp('increaseMonth', 'বৃদ্ধির মাস (লেখা)') + inp('dueDay', 'ভাড়া দেওয়ার শেষ তারিখ (মাসের)', 'type="number"') + inp('notice', 'নোটিশ (মাস)', 'type="number"') + inp('business', 'ব্যবসার ধরন') + inp('premise', 'দোকান/গ্যারেজ গৃহের নাম') + '</div></div>') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
    '<button type="button" id="agwSaveBtn" class="btn btn-primary" onclick="agwSave()" style="flex:1;justify-content:center;"><i class="fas fa-cloud-upload-alt"></i> সেভ করুন</button>' +
    '<button type="button" class="btn btn-outline" onclick="agwPrint()"><i class="fas fa-file-pdf"></i> প্রিন্ট / PDF</button>' +
    '<button type="button" class="btn btn-sm" style="background:#25d366;color:#fff;padding:9px 14px;" onclick="agwWhatsApp()"><i class="fab fa-whatsapp"></i> WhatsApp</button>' +
    '<button type="button" class="btn btn-ghost" onclick="agwNew()"><i class="fas fa-eraser"></i> নতুন</button></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="agwSaveDefaults()"><i class="fas fa-bookmark"></i> বর্তমান ১ম পক্ষ, ভূমিকা, শর্ত ও তফসিল ডিফল্ট হিসেবে রাখুন</button>' +
    '</div>' +
    '<div style="position:sticky;top:72px;"><div class="stat-card" style="padding:14px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;"><div style="font-weight:700;font-size:.9rem;"><i class="fas fa-eye" style="color:var(--accent);"></i> লাইভ প্রিভিউ (লিগ্যাল)</div>' +
    '<div style="display:flex;gap:4px;"><button type="button" id="agwTabN" class="btn btn-sm" onclick="agwSetView(\'normal\')">সাধারণ</button><button type="button" id="agwTabS" class="btn btn-sm" onclick="agwSetView(\'stamp\')">স্ট্যাম্প লুক</button></div></div>' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.78rem;margin-bottom:8px;"><span>ফন্ট</span><button type="button" class="btn btn-gray btn-sm" onclick="agwFont(-1)" title="ছোট">A−</button>' +
    '<input class="form-input" data-k="fontSize" type="number" step="0.5" min="8" max="20" oninput="agwIn(this)" style="width:66px;padding:4px 6px;text-align:center;"><button type="button" class="btn btn-gray btn-sm" onclick="agwFont(1)" title="বড়">A+</button><span>pt</span>' +
    '<label style="margin-left:auto;display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" id="agwMarks" checked onchange="agwToggleMarks(this.checked)"> এডিটযোগ্য তথ্য বক্স মার্ক</label></div>' +
    '<div id="agwPreview" style="max-height:80vh;overflow:auto;background:#e5e7eb;padding:10px;border-radius:8px;"></div></div></div>' +
    '</div>' +
    '<div class="stat-card" style="padding:20px;margin-top:20px;"><h3 style="font-weight:700;margin-bottom:6px;font-size:.95rem;"><i class="fas fa-cloud" style="color:var(--accent);"></i> সংরক্ষিত চুক্তিপত্র (Firebase)</h3><div id="agwList"></div></div>';
  if (window.matchMedia('(max-width: 900px)').matches) document.getElementById('agwGrid').style.gridTemplateColumns = '1fr';
  if (typeof flatpickr !== 'undefined') root.querySelectorAll('.agw-date').forEach(el => {
    flatpickr(el, { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: false, disableMobile: true,
      onChange: [(sel, str) => {
        const k = el.dataset.k; _agw[k] = str;
        if (k === 'endDate') { _agwEndManual = true; agwAutoYears(); }
        if (k === 'startDate') { if (_agwEndManual) agwAutoYears(); else agwAutoEnd(); }
        agwPreviewSoon();
      }] });
  });
  window.addEventListener('resize', () => agwPreviewSoon());
  agwSetView(_agwView, true);
}
function agwSetView(v, noRender) {
  _agwView = v;
  const n = document.getElementById('agwTabN'), s = document.getElementById('agwTabS');
  if (n) n.className = 'btn btn-sm ' + (v === 'normal' ? 'btn-primary' : 'btn-outline');
  if (s) s.className = 'btn btn-sm ' + (v === 'stamp' ? 'btn-primary' : 'btn-outline');
  if (!noRender) agwPreview();
}
function agwToggleMarks(on) { _agwMarks = !!on; agwPreview(); }
function agwFont(dl) {
  const v = Math.min(20, Math.max(8, agwOr(_agw.fontSize, 12) + dl));
  _agw.fontSize = v;
  const el = document.querySelector('#agwRoot [data-k="fontSize"]'); if (el) el.value = v;
  agwPreviewSoon();
}
function agwToggle(id, btn) {
  const box = document.getElementById(id); if (!box) return;
  const open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  if (btn) btn.className = 'btn btn-sm ' + (open ? 'btn-primary' : 'btn-outline');
}
function agwFocusVar(k) {
  const root = document.getElementById('agwRoot'); if (!root) return;
  k = ({ netRent: 'rent' })[k] || k;
  const el = root.querySelector('[data-k="' + k + '"]'); if (!el) return;
  const box = el.closest('#agwVarBox');
  if (box && box.style.display === 'none') agwToggle('agwVarBox', document.getElementById('agwBtnVars'));
  const f = (el._flatpickr && el._flatpickr.altInput) ? el._flatpickr.altInput : el;
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  f.style.transition = 'box-shadow .3s'; f.style.boxShadow = '0 0 0 3px #2563eb';
  setTimeout(() => { f.focus(); }, 300); setTimeout(() => { f.style.boxShadow = ''; }, 1800);
}
function agwFillForm() {
  const root = document.getElementById('agwRoot'); if (!root) return;
  root.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k, v = _agw[k] == null ? '' : _agw[k];
    if (el._flatpickr) el._flatpickr.setDate(v || null, false, 'Y-m-d'); else el.value = v;
  });
  const sel = document.getElementById('agwTenant');
  if (sel) { sel.innerHTML = '<option value="">-- ভাড়াটিয়া নির্বাচন করুন (বা নিচে নিজে লিখুন) --</option>' + (tenants || []).filter(t => !t.archived).map(t => '<option value="' + t.id + '"' + (t.id === _agw.tenantId ? ' selected' : '') + '>' + _esc(t.name) + ' - ' + _esc(t.shop) + '</option>').join(''); }
  agwTermsRender();
  const b = document.getElementById('agwSaveBtn'); if (b) b.innerHTML = _agw.id ? '<i class="fas fa-sync-alt"></i> আপডেট করুন' : '<i class="fas fa-cloud-upload-alt"></i> সেভ করুন';
}
function agwIn(el) {
  _agw[el.dataset.k] = el.value;
  if (el.dataset.k === 'years') { _agwEndManual = false; agwAutoEnd(); }
  agwPreviewSoon();
}
function agwAutoEnd() {
  if (_agwEndManual) return;
  const e = agwEnd(_agw); _agw.endDate = e;
  const el = document.querySelector('#agwRoot [data-k="endDate"]');
  if (el && el._flatpickr) el._flatpickr.setDate(e || null, false, 'Y-m-d');
}
function agwAutoYears() {
  const y = agwYearsFromDates(_agw); if (y == null) return;
  _agw.years = y;
  const el = document.querySelector('#agwRoot [data-k="years"]'); if (el) el.value = y;
}
function agwPick() {
  const tn = (tenants || []).find(t => t.id === document.getElementById('agwTenant').value);
  if (!tn) { _agw.tenantId = ''; return; }
  Object.assign(_agw, { tenantId: tn.id, name: tn.name || '', mobile: tn.mobile || '', shop: tn.shop || '', address: tn.address || _agw.address, nid: tn.nid || '', advance: tn.advance || '', rent: tn.rent || '',
    deduction: tn.monthlyDeduction || tn.deduction || '', increase: tn.annualIncrease || '', startDate: tn.startDate || _agw.startDate });
  _agwEndManual = false; agwAutoEnd();
  agwFillForm(); agwPreview();
}
function agwTermsRender() {
  const list = document.getElementById('agwTermList');
  if (list) list.innerHTML = '<div style="border:1px solid var(--border);border-radius:10px;padding:8px 10px;font-size:.78rem;">' + (_agw.terms || []).map((t, i) =>
    '<div style="padding:3px 0;border-bottom:1px dashed var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><b>' + agwBn(i + 1) + '।</b> ' + _esc(String(t).replace(/\{\{\w+\}\}/g, '…').slice(0, 90)) + '</div>').join('') + '</div>';
  const box = document.getElementById('agwTerms'); if (!box) return;
  box.innerHTML = (_agw.terms || []).map((t, i) =>
    '<div style="border:1px solid var(--border);border-radius:10px;padding:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><b style="font-size:.82rem;">শর্ত ' + agwBn(i + 1) + '</b>' +
    '<div style="display:flex;gap:4px;"><button type="button" class="btn btn-gray btn-sm" onclick="agwTermMove(' + i + ',-1)"><i class="fas fa-arrow-up"></i></button><button type="button" class="btn btn-gray btn-sm" onclick="agwTermMove(' + i + ',1)"><i class="fas fa-arrow-down"></i></button><button type="button" class="btn btn-danger btn-sm" onclick="agwTermDel(' + i + ')"><i class="fas fa-times"></i></button></div></div>' +
    '<textarea class="form-input" rows="4" oninput="agwTermSet(' + i + ',this.value)">' + _esc(t) + '</textarea></div>').join('');
}
function agwTermSet(i, v) { _agw.terms[i] = v; agwPreviewSoon(); }
function agwTermAdd() { _agw.terms.push(''); agwTermsRender(); agwPreviewSoon(); }
async function agwTermDel(i) { if (!await uiConfirm('এই শর্তটি মুছবেন?')) return; _agw.terms.splice(i, 1); agwTermsRender(); agwPreview(); }
function agwTermMove(i, d) { const j = i + d; if (j < 0 || j >= _agw.terms.length) return; const t = _agw.terms; [t[i], t[j]] = [t[j], t[i]]; agwTermsRender(); agwPreview(); }
function agwPreviewSoon() { clearTimeout(_agwTimer); _agwTimer = setTimeout(agwPreview, 350); }
function agwPreview() {
  const box = document.getElementById('agwPreview'); if (!box || !_agw) return;
  const pages = agwPages(_agw, { marks: _agwMarks, stamp: _agwView === 'stamp' }), s = Math.min(1, Math.max(0.3, (box.clientWidth - 24) / 816));
  box.innerHTML = pages.map(p => '<div style="width:' + (816 * s) + 'px;height:' + (1344 * s) + 'px;margin:0 auto 12px;box-shadow:0 2px 10px rgba(0,0,0,.25);"><div style="transform:scale(' + s + ');transform-origin:0 0;width:816px;height:1344px;">' + p + '</div></div>').join('') +
    '<div style="text-align:center;font-size:.74rem;color:#6b7280;">মোট ' + agwBn(pages.length) + ' পাতা' + (_agwView === 'stamp' ? ' • স্ট্যাম্প লুক শুধু প্রিভিউ, প্রিন্টে আসবে না' : '') + '</div>';
}
function agwNew() { _agw = agwBlank(); _agwEndManual = false; agwAutoEnd(); agwFillForm(); agwPreview(); }
async function agwSave() {
  if (!(_agw.name || '').trim()) { showToast('ভাড়াটিয়ার নাম দিন', 'error'); return; }
  const editing = !!_agw.id, id = editing ? _agw.id : 'AGD' + Date.now();
  const rec = Object.assign({}, _agw, { id, title: _agw.name.trim() + ' — চুক্তিপত্র', terms: (_agw.terms || []).slice(), updatedAt: new Date().toISOString() });
  if (!editing) rec.createdAt = new Date().toISOString();
  const ok = await FDB.save('agreementDocs', id, rec);
  _agw.id = id;
  addActivity((editing ? 'চুক্তিপত্র আপডেট: ' : 'চুক্তিপত্র সংরক্ষণ: ') + rec.title, 'file-signature', '#16a34a');
  showToast(ok ? (editing ? 'চুক্তিপত্র আপডেট হয়েছে ✅' : 'চুক্তিপত্র Firebase-এ সংরক্ষিত হয়েছে ✅') : 'শুধু এই ডিভাইসে সেভ হয়েছে (ইন্টারনেট/লগইন দেখুন)', ok ? 'success' : 'error');
  agwFillForm(); agwList();
}
function agwSaveDefaults() {
  settings.agwDefaults = { docTitle: _agw.docTitle, landlordText: _agw.landlordText, preamble: _agw.preamble, terms: _agw.terms.slice(), closing: _agw.closing, schedule: _agw.schedule,
    business: _agw.business, premise: _agw.premise, dueDay: _agw.dueDay, notice: _agw.notice, years: _agw.years, increaseMonth: _agw.increaseMonth, fontSize: _agw.fontSize, topIn: _agw.topIn, topIn2: _agw.topIn2 };
  FDB.saveSettings(settings);
  showToast('ডিফল্ট সেভ হয়েছে — নতুন চুক্তিপত্রে এগুলো আগে থেকে আসবে ✅');
}
const _agwAll = () => DB.get('agreementDocs').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
function agwList() {
  const box = document.getElementById('agwList'); if (!box) return;
  const list = _agwAll();
  box.innerHTML = list.length ? list.map(d =>
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);">' +
    '<div style="min-width:200px;"><div style="font-weight:700;"><i class="fas fa-file-signature" style="color:var(--accent);margin-right:6px;"></i>' + _esc(d.title || d.name) + '</div>' +
    '<div style="font-size:.76rem;color:var(--text-muted);">' + (d.shop ? 'দোকান ' + _esc(d.shop) + ' • ' : '') + 'মেয়াদ ' + fmtDate(d.startDate) + ' → ' + fmtDate(d.endDate) + '</div></div>' +
    '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
    '<button class="btn btn-primary btn-sm" onclick="agwView(\'' + d.id + '\')"><i class="fas fa-eye"></i> View</button>' +
    '<button class="btn btn-sm" style="background:#d97706;color:#fff;" onclick="agwEdit(\'' + d.id + '\')"><i class="fas fa-edit"></i> Edit</button>' +
    '<button class="btn btn-outline btn-sm" onclick="agwPrint(\'' + d.id + '\')"><i class="fas fa-file-pdf"></i> PDF</button>' +
    '<button class="btn btn-sm" style="background:#25d366;color:#fff;" onclick="agwWhatsApp(\'' + d.id + '\')"><i class="fab fa-whatsapp"></i></button>' +
    '<button class="btn btn-danger btn-sm" onclick="agwDelete(\'' + d.id + '\')"><i class="fas fa-trash"></i> Delete</button></div></div>').join('')
    : '<p style="text-align:center;color:var(--text-muted);padding:16px;font-size:.84rem;">এখনো কোনো চুক্তিপত্র সেভ করা নেই</p>';
}
function agwEdit(id) {
  const d = _agwAll().find(x => x.id === id); if (!d) return;
  _agw = Object.assign(agwBlank(), d, { terms: (d.terms || []).slice() }); _agwEndManual = true;
  agwFillForm(); agwPreview();
  document.getElementById('agwRoot').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function agwDelete(id) {
  const d = _agwAll().find(x => x.id === id);
  if (!await uiConfirm((d ? d.title : 'এই চুক্তিপত্র') + ' মুছে ফেলবেন?')) return;
  await FDB.delete('agreementDocs', id);
  if (_agw && _agw.id === id) { _agw.id = ''; agwFillForm(); }
  agwList(); showToast('চুক্তিপত্র মুছে ফেলা হয়েছে', 'error');
}
function agwView(id) {
  const d = _agwAll().find(x => x.id === id); if (!d) return;
  let m = document.getElementById('agwModal');
  if (!m) {
    m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'agwModal';
    m.innerHTML = '<div class="modal" style="max-width:900px;"><div class="modal-header"><h3 id="agwModalTitle"></h3><div style="display:flex;gap:6px;"><button class="btn btn-outline btn-sm" id="agwMPrint"><i class="fas fa-file-pdf"></i> প্রিন্ট / PDF</button><button class="btn btn-sm" style="background:#25d366;color:#fff;" id="agwMWa"><i class="fab fa-whatsapp"></i></button><button onclick="closeModal(\'agwModal\')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1.1rem;"><i class="fas fa-times"></i></button></div></div><div class="modal-body" id="agwModalBody" style="background:#e5e7eb;"></div></div>';
    document.body.appendChild(m);
  }
  document.getElementById('agwModalTitle').textContent = d.title || d.name;
  document.getElementById('agwMPrint').onclick = () => agwPrint(id);
  document.getElementById('agwMWa').onclick = () => agwWhatsApp(id);
  openModal('agwModal');
  const body = document.getElementById('agwModalBody'), s = Math.min(1, Math.max(0.3, (body.clientWidth - 44) / 816));
  body.innerHTML = agwPages(d).map(p => '<div style="width:' + (816 * s) + 'px;height:' + (1344 * s) + 'px;margin:0 auto 12px;box-shadow:0 2px 10px rgba(0,0,0,.25);"><div style="transform:scale(' + s + ');transform-origin:0 0;width:816px;height:1344px;">' + p + '</div></div>').join('');
}
function _agwDoc(id) { return id ? _agwAll().find(x => x.id === id) : _agw; }
function agwPrint(id) {
  const d = _agwDoc(id); if (!d) return;
  const w = window.open('', '_blank', 'width=950,height=800');
  if (!w) { showToast('Pop-up allow korun', 'warning'); return; }
  w.document.write(agwPrintHtml(d)); w.document.close();
}
async function agwWhatsApp(id) {
  const d = _agwDoc(id); if (!d) return;
  const mob = String(d.mobile || '').replace(/[^0-9]/g, '');
  const text = '📄 *' + (d.docTitle || 'চুক্তিপত্র') + ' - ' + (settings.mktName || '') + '*\n\nভাড়াটিয়া: ' + (d.name || '') + (d.shop ? '\nদোকান: ' + d.shop : '') + '\nমেয়াদ: ' + fmtDate(d.startDate) + ' থেকে ' + fmtDate(d.endDate) +
    '\nমাসিক ভাড়া: ' + money(_n(d.rent)) + '\nঅগ্রিম: ' + money(_n(d.advance)) + (_n(d.increase) ? '\nপ্রতি নতুন বছরে ভাড়া বৃদ্ধি: ' + money(_n(d.increase)) : '') + '\n\nধন্যবাদ।';
  const url = 'https://wa.me/' + (mob ? (mob.startsWith('88') ? mob : '88' + mob) : '') + '?text=' + encodeURIComponent(text);
  try {
    if (typeof html2canvas !== 'undefined' && navigator.share && navigator.canShare) {
      showToast('চুক্তিপত্রের ছবি তৈরি হচ্ছে...');
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;';
      host.innerHTML = agwPages(d).join(''); document.body.appendChild(host);
      const files = [];
      try {
        let i = 1;
        for (const pg of host.querySelectorAll('.agw-page')) {
          const c = await html2canvas(pg, { scale: 1.3, backgroundColor: '#fff', useCORS: true, logging: false });
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
          files.push(new File([blob], (d.name || 'agreement') + '_page' + (i++) + '.jpg', { type: 'image/jpeg' }));
        }
      } finally { document.body.removeChild(host); }
      if (navigator.canShare({ files })) { await navigator.share({ files, title: (d.name || '') + ' - চুক্তিপত্র', text }); return; }
    }
  } catch (e) { if (e && e.name === 'AbortError') return; console.warn(e); }
  window.open(url, '_blank');
}

// ============================================================
// ভাড়াটিয়ার জীবনচক্র: ভাড়াটিয়া মুছুন → "পুরাতন ভাড়াটিয়া" ফোল্ডার, এবং নবায়ন
// ============================================================
const _lfDigits = v => _bnDigits(String(v == null ? '' : v));
const _lfMoney = v => '৳' + _lfDigits((Number(v) || 0).toLocaleString('en-IN'));
const _lfFind = id => (tenants || []).find(x => x.id === id) || DB.get('archivedTenants').find(x => x.id === id) || null;
function _lfRemaining(tn) {   // অবশিষ্ট অগ্রিম (ভাড়াটিয়া তালিকার হিসাবের মতোই)
  const ded = tn.monthlyDeduction || tn.deduction || 0;
  const el = tn.startDate ? Math.floor((new Date() - new Date(tn.startDate)) / (1000 * 60 * 60 * 24 * 30)) : 0;
  return Math.max(0, (tn.advance || 0) - Math.min(Math.max(0, el) * ded, tn.advance || 0));
}
// ── প্রফেশনাল ভাড়াটিয়া তথ্যপত্র (একজনের / সবার) ──
const TNP_CSS = `
.tnp,.tnp *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.tnp{font-family:'Noto Sans Bengali','Hind Siliguri',Arial,sans-serif;color:#14291d;background:#fff;line-height:1.45;font-size:13px;}
.tnp-head{display:flex;align-items:center;gap:14px;padding-bottom:10px;border-bottom:3px solid #16a34a;position:relative;}
.tnp-head:after{content:'';position:absolute;left:0;bottom:-6px;width:100%;height:1px;background:#14532d;}
.tnp-logo{width:58px;height:58px;object-fit:contain;flex-shrink:0;}
.tnp-head h1{font-size:22px;line-height:1.25;color:#14532d;margin:0;font-weight:800;}
.tnp-sub{font-size:11.5px;color:#4b5d52;}
.tnp-doc{margin-left:auto;text-align:right;font-size:11px;color:#4b5d52;flex-shrink:0;}
.tnp-doc b{display:block;font-size:12.5px;color:#14532d;}
.tnp-qr{width:70px;flex-shrink:0;text-align:center;margin-left:6px;}.tnp-qr img{width:64px;height:64px;display:block;margin:0 auto;border:1px solid #bbf7d0;border-radius:6px;padding:2px;background:#fff;}.tnp-qr span{display:block;font-size:8.5px;color:#4b5d52;line-height:1.2;margin-top:2px;}
.tnp-title{display:flex;align-items:center;gap:12px;margin:20px 0 14px;}
.tnp-title:before,.tnp-title:after{content:'';flex:1;height:1px;background:linear-gradient(90deg,transparent,#16a34a);}
.tnp-title:after{background:linear-gradient(270deg,transparent,#16a34a);}
.tnp-title span{background:#14532d;color:#fff;font-weight:700;font-size:14.5px;padding:5px 22px;border-radius:999px;letter-spacing:.2px;}
.tnp-profile{display:flex;gap:18px;align-items:center;background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1px solid #bbf7d0;border-radius:16px;padding:14px 16px;}
.tnp-photo{width:104px;height:104px;border-radius:18px;object-fit:cover;border:3px solid #fff;box-shadow:0 2px 10px rgba(20,83,45,.25);flex-shrink:0;}
.tnp-photo.ph{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#14532d,#16a34a);color:#fff;font-size:42px;font-weight:800;}
.tnp-name{font-size:22px;font-weight:800;color:#14532d;line-height:1.25;}
.tnp-meta{font-size:12.5px;color:#3f5a48;margin-top:2px;}
.tnp-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
.tnp-chip{display:inline-block;padding:3px 11px;border-radius:999px;font-size:11.5px;font-weight:700;background:#fff;color:#14532d;border:1px solid #86efac;}
.tnp-chip.g{background:#16a34a;border-color:#16a34a;color:#fff;}.tnp-chip.y{background:#fef3c7;border-color:#fcd34d;color:#92400e;}.tnp-chip.r{background:#fee2e2;border-color:#fca5a5;color:#b91c1c;}.tnp-chip.n{background:#f3f4f6;border-color:#d1d5db;color:#4b5563;}
.tnp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;}
.tnp-card{border:1px solid #bbf7d0;border-radius:12px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;background:#fff;}
.tnp-card.full{grid-column:1/-1;margin-top:14px;}.tnp-grid .tnp-card.full{margin-top:0;}
.tnp-card h3{background:#14532d;color:#fff;font-size:12.5px;margin:0;padding:6px 12px;font-weight:700;display:flex;align-items:center;gap:6px;}
.tnp-card h3:before{content:'';width:6px;height:6px;border-radius:50%;background:#4ade80;}
.tnp-row{display:flex;justify-content:space-between;gap:10px;padding:6px 12px;border-bottom:1px solid #ecfdf5;font-size:12.5px;}
.tnp-row:nth-child(odd){background:#f7fef9;}.tnp-row:last-child{border-bottom:none;}
.tnp-row .k{color:#5b6f62;flex-shrink:0;}.tnp-row .v{font-weight:600;text-align:right;word-break:break-word;}
.tnp-nid{display:flex;gap:12px;padding:10px;}
.tnp-nid>div{flex:1;text-align:center;}
.tnp-nid .c{font-size:11.5px;font-weight:700;color:#14532d;margin-bottom:4px;}
.tnp-nid img{width:100%;max-height:185px;object-fit:contain;border:1px solid #bbf7d0;border-radius:8px;background:#fafafa;}
.tnp-sign{display:flex;justify-content:space-between;gap:30px;margin-top:54px;}
.tnp-sign>div{flex:1;text-align:center;font-size:12px;color:#14532d;}
.tnp-sign .ln{border-top:1.5px solid #14532d;padding-top:4px;margin-top:2px;}
.tnp-sign img{height:40px;display:block;margin:0 auto 2px;}
.tnp-foot{margin-top:16px;border-top:1px solid #bbf7d0;padding-top:6px;font-size:10.5px;color:#6b7c71;display:flex;justify-content:space-between;}
.tnp-stats{display:flex;gap:10px;margin-bottom:12px;}
.tnp-stat{flex:1;border:1px solid #bbf7d0;border-radius:12px;padding:8px 12px;background:linear-gradient(135deg,#f0fdf4,#fff);}
.tnp-stat b{display:block;font-size:16px;color:#14532d;}.tnp-stat span{font-size:11px;color:#5b6f62;}
.tnp-tbl{width:100%;border-collapse:collapse;font-size:11.5px;border:1px solid #bbf7d0;}
.tnp-tbl th{background:#14532d;color:#fff;padding:7px 6px;font-weight:700;text-align:left;font-size:11.5px;}
.tnp-tbl td{padding:6px;border-bottom:1px solid #d1fae5;vertical-align:middle;}
.tnp-tbl tr:nth-child(even) td{background:#f7fef9;}
.tnp-tbl .ph{width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;}
.tnp-tbl .phd{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#14532d,#16a34a);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;}
.tnp-tbl tfoot td{background:#dcfce7;font-weight:800;color:#14532d;border-top:2px solid #16a34a;}
.tnp-pb{page-break-before:always;break-before:page;}
`;
(function injectTnpCss() { if (document.getElementById('tnpCss')) return; const st = document.createElement('style'); st.id = 'tnpCss'; st.textContent = TNP_CSS; document.head.appendChild(st); })();
// ভাড়াটিয়ার যাচাই QR: receipts/{token} (kind:'tenant') — verify.html এ নাম, ঠিকানা, মোবাইল দেখায়
const _tnQrById = {}, _tnQrSig = {};
async function tnQrFor(tn) {
  if (!tn || typeof QRCode === 'undefined') return '';
  try {
    const cur = (DB.get('tenants') || []).find(x => x.id === tn.id) || (DB.get('archivedTenants') || []).find(x => x.id === tn.id) || {};
    tn.verifyToken = tn.verifyToken || cur.verifyToken || makeVerifyToken();
    if (cur.verifyToken !== tn.verifyToken) { try { await FDB.save('tenants', tn.id, { verifyToken: tn.verifyToken }); } catch (e) {} }
    const sig = [tn.name, tn.address, tn.mobile, tn.shop, tn.floor].join('|');
    if (FIREBASE_READY && db_fire && _tnQrSig[tn.id] !== sig) {
      const rec = { kind: 'tenant', token: tn.verifyToken, tenantId: tn.id, tenantName: tn.name || '', mktName: settings.mktName || '', mktAddress: settings.mktAddress || '', mktPhone: settings.mktPhone || '',
        name: tn.name || '', address: tn.address || '', mobile: tn.mobile || '', shop: tn.shop || '', floor: tn.floor || '', updatedAt: new Date().toISOString() };
      try { await Promise.race([db_fire.collection('receipts').doc(tn.verifyToken).set(rec), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000))]); _tnQrSig[tn.id] = sig; }
      catch (e) { console.warn('Tenant QR publish failed:', e); }
    }
    _tnQrById[tn.id] = await generateQRDataUrl(verifyUrlFor(tn.verifyToken));
  } catch (e) { console.warn(e); }
  return _tnQrById[tn.id] || '';
}
async function tnQrPrefetch(list) { for (const t of list) await tnQrFor(t); }
function _tnpHead(docTitle, docNo, qr) {
  const logo = new URL('assets/logo.png', location.href).href;
  return '<div class="tnp-head"><img class="tnp-logo" src="' + logo + '" alt="" onerror="this.style.display=\'none\'">' +
    '<div><h1>' + _esc(settings.mktName || '') + '</h1><div class="tnp-sub">' + _esc(settings.mktAddress || '') + '</div><div class="tnp-sub">ফোন : ' + _esc(settings.mktPhone || '') + '</div></div>' +
    '<div class="tnp-doc"><b>' + (docNo ? 'নং: ' + _esc(docNo) : '') + '</b>তারিখ: ' + fmtDate(new Date()) + '</div>' +
    (qr ? '<div class="tnp-qr"><img src="' + qr + '" alt="QR"><span>স্ক্যান করে যাচাই</span></div>' : '') + '</div>' +
    '<div class="tnp-title"><span>' + _esc(docTitle) + '</span></div>';
}
function _tnpRow(k, v) { return '<div class="tnp-row"><span class="k">' + k + '</span><span class="v">' + (v === '' || v == null ? '-' : v) + '</span></div>'; }
function _tnpStatus(tn) { const st = getAgreementStatus(tn); return { label: st.label, cls: st.cls === 'badge-green' ? 'g' : st.cls === 'badge-yellow' ? 'y' : st.cls === 'badge-red' ? 'r' : 'n' }; }
function tnDossierBody(tn, o) {
  o = o || {};
  const st = _tnpStatus(tn), now = new Date(), er = effectiveRent(tn, _BNM[now.getMonth()], now.getFullYear());
  const ded = tn.monthlyDeduction || tn.deduction || 0, rem = _lfRemaining(tn), vl = validityLabel(tn.startDate, tn.endDate);
  const photo = tn.photo ? '<img class="tnp-photo" src="' + tn.photo + '" alt="">' : '<div class="tnp-photo ph">' + _esc((tn.name || '?').charAt(0)) + '</div>';
  let h = '<div class="tnp">' + _tnpHead(o.title || 'ভাড়াটিয়ার তথ্য পত্র', tn.serial ? String(tn.serial).padStart(3, '0') : '', _tnQrById[tn.id]);
  if (o.rec) {
    const r = o.rec;
    h += '<div class="tnp-card" style="margin-bottom:12px;"><h3>নবায়নের বিবরণ</h3>' +
      _tnpRow('নবায়নের তারিখ', fmtDate(r.date)) +
      _tnpRow('নতুন চুক্তির মেয়াদ', fmtDate(r.newStart) + ' → ' + fmtDate(r.newEnd) + (validityLabel(r.newStart, r.newEnd) ? ' (' + validityLabel(r.newStart, r.newEnd) + ')' : '')) +
      _tnpRow('মাসিক ভাড়া', _lfMoney(r.newRent) + (r.oldRent != null && r.oldRent !== r.newRent ? ' (আগে ' + _lfMoney(r.oldRent) + ')' : '')) +
      _tnpRow('প্রতি নতুন বছরে ভাড়া বৃদ্ধি', r.increase ? _lfMoney(r.increase) : '-') +
      _tnpRow('পূর্বের অবশিষ্ট অগ্রিম', _lfMoney(r.oldAdvance)) + _tnpRow('এই নবায়নে নতুন অগ্রিম জমা', _lfMoney(r.extraAdvance)) +
      _tnpRow('মোট অগ্রিম', '<b style="color:#15803d;">' + _lfMoney(r.totalAdvance) + '</b>') + _tnpRow('মাসিক কর্তন', r.deduction ? _lfMoney(r.deduction) : '-') +
      (r.note ? _tnpRow('মন্তব্য', _esc(r.note)) : '') + '</div>';
  }
  h += '<div class="tnp-profile">' + photo + '<div style="flex:1;min-width:0;"><div class="tnp-name">' + _esc(tn.name) + '</div>' +
    '<div class="tnp-meta">📞 ' + _esc(tn.mobile || '-') + (tn.nid ? ' &nbsp;•&nbsp; এনআইডি: ' + _esc(tn.nid) : '') + '</div>' +
    '<div class="tnp-chips"><span class="tnp-chip g">দোকান ' + _esc(tn.shop || '-') + '</span><span class="tnp-chip">' + _esc(tn.floor || '-') + '</span><span class="tnp-chip ' + st.cls + '">' + _esc(tn.archived ? 'পুরাতন ভাড়াটিয়া' : st.label) + '</span></div></div></div>';
  h += '<div class="tnp-grid">' +
    '<div class="tnp-card"><h3>ব্যক্তিগত তথ্য</h3>' + _tnpRow('নাম', _esc(tn.name)) + _tnpRow('মোবাইল', _esc(tn.mobile)) + _tnpRow('এনআইডি নম্বর', _esc(tn.nid)) + _tnpRow('ঠিকানা', _esc(tn.address)) + _tnpRow('মন্তব্য', _esc(tn.notes)) + '</div>' +
    '<div class="tnp-card"><h3>দোকান ও ভাড়া</h3>' + _tnpRow('দোকান নং', _esc(tn.shop)) + _tnpRow('ফ্লোর', _esc(tn.floor)) + _tnpRow('নির্ধারিত ভাড়া', _lfMoney(tn.rent)) +
      _tnpRow('বর্তমান মাসিক ভাড়া', '<b style="color:#15803d;">' + _lfMoney(er) + '</b>') + _tnpRow('বার্ষিক ভাড়া বৃদ্ধি', tn.annualIncrease > 0 ? _lfMoney(tn.annualIncrease) : '-') + '</div>' +
    '<div class="tnp-card"><h3>চুক্তির মেয়াদ</h3>' + _tnpRow('চুক্তি শুরু', fmtDate(tn.startDate)) + _tnpRow('চুক্তি শেষ', fmtDate(tn.endDate)) + _tnpRow('মেয়াদ', vl) + _tnpRow('অবস্থা', _esc(tn.archived ? 'পুরাতন ভাড়াটিয়া' : st.label)) +
      (tn.archivedAt ? _tnpRow('পুরাতন তালিকায় সরানো', fmtDate(tn.archivedAt)) : '') + '</div>' +
    '<div class="tnp-card"><h3>অগ্রিম হিসাব</h3>' + _tnpRow('মোট অগ্রিম', _lfMoney(tn.advance)) + _tnpRow('মাসিক কর্তন', ded ? _lfMoney(ded) : '-') + _tnpRow('অবশিষ্ট অগ্রিম', '<b style="color:#15803d;">' + _lfMoney(rem) + '</b>') + '</div></div>';
  if (tn.nidFrontUrl || tn.nidBackUrl) {
    const nid = (src, cap) => src ? '<div><div class="c">' + cap + '</div><img src="' + src + '" alt=""></div>' : '';
    h += '<div class="tnp-card full" style="margin-top:12px;"><h3>জাতীয় পরিচয়পত্র (এনআইডি)</h3><div class="tnp-nid">' + nid(tn.nidFrontUrl, 'সামনের দিক') + nid(tn.nidBackUrl, 'পিছনের দিক') + '</div></div>';
  }
  if (o.agreements && o.agreements.length) {
    h += '<div class="tnp-card full" style="margin-top:12px;"><h3>আপলোডকৃত চুক্তিপত্র</h3>' +
      o.agreements.map(a => _tnpRow(_esc(a.fileName || 'চুক্তি'), (a.type === 'renewal' ? 'নবায়ন' : 'নতুন') + ' • ' + (fmtDate(a.startDate) || '-') + ' → ' + (fmtDate(a.endDate) || '-'))).join('') + '</div>';
    (o.agImages || []).forEach(x => { h += '<div class="tnp-pb" style="text-align:center;"><div class="c" style="font-weight:700;margin:6px 0;">' + _esc(x.name) + '</div><img src="' + x.src + '" style="max-width:100%;max-height:1000px;border:1px solid #bbf7d0;" alt=""></div>'; });
  }
  if (o.sign && sigOn()) {
    h += '<div class="tnp-sign"><div><div style="height:42px;"></div><div class="ln">ভাড়াটিয়ার স্বাক্ষর</div></div><div>' + ((typeof ownerSignature !== 'undefined' && ownerSignature) ? '<img src="' + ownerSignature + '" alt="">' : '<div style="height:42px;"></div>') + '<div class="ln">জমিদারের স্বাক্ষর</div></div></div>';
  }
  return h + '<div class="tnp-foot"><span>' + _esc(settings.mktName || '') + '</span><span>প্রিন্টের তারিখ: ' + fmtDate(new Date()) + '</span></div></div>';
}
// সব ভাড়াটিয়া: সারসংক্ষেপ টেবিল (+ ঐচ্ছিক প্রতিজনের বিস্তারিত পাতা)
function _tnAllList() { return (DB.get('tenants') || []).filter(t => !t.archived).sort((a, b) => String(a.shop || '').localeCompare(String(b.shop || ''), undefined, { numeric: true })); }
function tnAllBody(o) {
  o = o || {};
  const list = _tnAllList(), now = new Date(), money = _lfMoney;
  const rentOf = t => effectiveRent(t, _BNM[now.getMonth()], now.getFullYear());
  const totRent = list.reduce((a, t) => a + rentOf(t), 0), totAdv = list.reduce((a, t) => a + (t.advance || 0), 0), totRem = list.reduce((a, t) => a + _lfRemaining(t), 0);
  let h = '<div class="tnp">' + _tnpHead('সকল ভাড়াটিয়ার তথ্য', '') +
    '<div class="tnp-stats"><div class="tnp-stat"><b>' + _lfDigits(list.length) + ' জন</b><span>মোট ভাড়াটিয়া</span></div><div class="tnp-stat"><b>' + money(totRent) + '</b><span>মোট মাসিক ভাড়া</span></div><div class="tnp-stat"><b>' + money(totAdv) + '</b><span>মোট অগ্রিম</span></div></div>' +
    '<table class="tnp-tbl"><thead><tr><th>#</th><th>ছবি</th><th>ভাড়াটিয়া</th><th>দোকান</th><th style="text-align:right;">মাসিক ভাড়া</th><th style="text-align:right;">অগ্রিম / অবশিষ্ট</th><th>চুক্তির মেয়াদ</th><th>অবস্থা</th></tr></thead><tbody>' +
    list.map((t, i) => {
      const st = _tnpStatus(t);
      return '<tr><td>' + _lfDigits(i + 1) + '</td><td>' + (t.photo ? '<img class="ph" src="' + t.photo + '" alt="">' : '<div class="phd">' + _esc((t.name || '?').charAt(0)) + '</div>') + '</td>' +
        '<td><b>' + _esc(t.name) + '</b><div style="color:#5b6f62;font-size:10.5px;">' + _esc(t.mobile || '') + (t.nid ? ' • NID ' + _esc(t.nid) : '') + '</div></td>' +
        '<td><b>' + _esc(t.shop || '-') + '</b><div style="color:#5b6f62;font-size:10.5px;">' + _esc(t.floor || '') + '</div></td>' +
        '<td style="text-align:right;font-weight:700;">' + money(rentOf(t)) + '</td><td style="text-align:right;">' + money(t.advance) + '<div style="color:#15803d;font-size:10.5px;">অবশিষ্ট ' + money(_lfRemaining(t)) + '</div></td>' +
        '<td style="font-size:10.5px;">' + (fmtDate(t.startDate) || '-') + '<br>→ ' + (fmtDate(t.endDate) || '-') + '</td><td><span class="tnp-chip ' + st.cls + '" style="font-size:10px;padding:2px 8px;">' + _esc(st.label) + '</span></td></tr>';
    }).join('') + '</tbody><tfoot><tr><td colspan="4">মোট</td><td style="text-align:right;">' + money(totRent) + '</td><td style="text-align:right;">' + money(totAdv) + '<div style="font-size:10.5px;font-weight:600;">অবশিষ্ট ' + money(totRem) + '</div></td><td colspan="2"></td></tr></tfoot></table>' +
    '<div class="tnp-foot"><span>' + _esc(settings.mktName || '') + '</span><span>প্রিন্টের তারিখ: ' + fmtDate(now) + '</span></div></div>';
  if (o.details) list.forEach(t => { h += '<div class="tnp-pb">' + tnDossierBody(t, { title: 'ভাড়াটিয়ার তথ্য পত্র' }) + '</div>'; });
  return h;
}
let _tnAllDetails = false;
function tnAllView() {
  let m = document.getElementById('tnAllModal');
  if (!m) {
    m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'tnAllModal';
    m.innerHTML = '<div class="modal" style="max-width:980px;"><div class="modal-header"><h3><i class="fas fa-users" style="color:var(--accent);margin-right:6px;"></i> সকল ভাড়াটিয়ার তথ্য</h3><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
      '<label style="font-size:.78rem;display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="checkbox" id="tnAllDet" onchange="_tnAllDetails=this.checked;tnAllRender()"> প্রতিজনের বিস্তারিত পাতাসহ</label>' +
      '<button class="btn btn-primary btn-sm" onclick="tnAllPrint()"><i class="fas fa-print"></i> প্রিন্ট</button><button class="btn btn-primary btn-sm" onclick="tnAllWhatsApp()"><i class="fas fa-paper-plane"></i> WhatsApp পাঠান</button>' +
      '<button onclick="closeModal(\'tnAllModal\')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1.1rem;"><i class="fas fa-times"></i></button></div></div><div class="modal-body" id="tnAllBodyBox" style="background:#fff;max-height:75vh;overflow:auto;"></div></div>';
    document.body.appendChild(m);
  }
  tnAllRender(); openModal('tnAllModal');
}
async function tnAllRender() { if (_tnAllDetails) await tnQrPrefetch(_tnAllList()); const b = document.getElementById('tnAllBodyBox'); if (b) b.innerHTML = '<div id="tnAllShot">' + tnAllBody({ details: false }) + '</div>' + (_tnAllDetails ? tnAllBody({ details: true }).split('<div class="tnp-pb">').slice(1).map(x => '<div class="tnp-pb" style="margin-top:24px;border-top:2px dashed #bbf7d0;padding-top:14px;">' + x).join('') : ''); }
async function tnAllPrint() { if (_tnAllDetails) await tnQrPrefetch(_tnAllList()); lfPrintHtml(tnAllBody({ details: _tnAllDetails }), 'সকল ভাড়াটিয়া'); }
// ── WhatsApp-এ PDF / JPG পাঠানো (একজন বা সবার, বিস্তারিতসহ) ──
function lfWaNumber(mobile) {
  let d = String(mobile || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('880')) return d;
  if (d.startsWith('0')) return '88' + d;
  if (d.length === 10 && d.startsWith('1')) return '880' + d;
  return d.startsWith('88') ? d : '88' + d;
}
function lfWaChat(mobile) {   // ভাড়াটিয়ার সাথে সরাসরি WhatsApp চ্যাট
  const n = lfWaNumber(mobile);
  if (!n) { showToast('এই ভাড়াটিয়ার মোবাইল নম্বর নেই', 'warning'); return; }
  window.open('https://wa.me/' + n, '_blank');
}
function lfFormatDialog(o) {
  o = o || {};
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'ui-dlg-ov';
    ov.innerHTML = '<div class="ui-dlg" role="dialog" aria-modal="true"><div class="di" style="background:#dcfce7;color:#16a34a;"><i class="fab fa-whatsapp"></i></div><div class="dt"></div><div class="dm"></div>' +
      (o.details !== undefined ? '<label style="display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;font-size:.86rem;cursor:pointer;"><input type="checkbox" id="lfDet"> প্রতিজনের বিস্তারিত পাতাসহ</label>' : '') +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;"><div class="db" style="margin-top:0;"><button type="button" class="ok pdf"><i class="fas fa-file-pdf"></i> PDF</button><button type="button" class="ok jpg"><i class="fas fa-image"></i> JPG ছবি</button></div>' +
      (o.text ? '<button type="button" class="txt" style="padding:9px;border-radius:11px;font:inherit;font-weight:700;font-size:.84rem;cursor:pointer;border:1.5px solid var(--border);background:transparent;color:var(--text-primary);"><i class="fas fa-align-left"></i> শুধু লেখা পাঠান</button>' : '') +
      '<button type="button" class="no" style="padding:9px;border-radius:11px;font:inherit;font-size:.84rem;cursor:pointer;border:none;background:transparent;color:var(--text-muted);">বাতিল</button></div></div>';
    ov.querySelector('.dt').textContent = o.title || 'WhatsApp-এ কিভাবে পাঠাবেন?';
    ov.querySelector('.dm').textContent = o.msg || 'ফাইলের ধরন বেছে নিন';
    const cb = ov.querySelector('#lfDet'); if (cb) cb.checked = !!o.details;
    document.body.appendChild(ov);
    const done = v => { document.removeEventListener('keydown', key, true); ov.classList.remove('show'); setTimeout(() => ov.remove(), 220); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', key, true);
    const val = fmt => ({ fmt, details: cb ? cb.checked : false });
    ov.querySelector('.pdf').onclick = () => done(val('pdf')); ov.querySelector('.jpg').onclick = () => done(val('jpg'));
    const t = ov.querySelector('.txt'); if (t) t.onclick = () => done(val('text'));
    ov.querySelector('.no').onclick = () => done(null);
    ov.addEventListener('mousedown', e => { if (e.target === ov) done(null); });
    requestAnimationFrame(() => ov.classList.add('show'));
  });
}
// HTML ব্লকগুলো → A4 মাপের ক্যানভাস পাতা (লম্বা হলে ভেঙে)
async function lfCanvasPages(blocks) {
  const PW = 794, PH = 1123, pages = [];
  for (const html of blocks) {
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + PW + 'px;padding:28px;background:#fff;box-sizing:border-box;';
    host.innerHTML = html; document.body.appendChild(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await new Promise(r => setTimeout(r, 150));
      const c = await html2canvas(host, { scale: 2, backgroundColor: '#fff', useCORS: true, logging: false });
      const slice = Math.round(c.width * PH / PW);
      for (let y = 0; y < c.height; y += slice) {
        const h = Math.min(slice, c.height - y), s = document.createElement('canvas'); s.width = c.width; s.height = h;
        const ctx = s.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.width, s.height); ctx.drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
        pages.push(s);
      }
    } finally { document.body.removeChild(host); }
  }
  return pages;
}
async function lfMakeFiles(blocks, fmt, baseName) {
  const pages = await lfCanvasPages(blocks), safe = String(baseName || 'document').replace(/[\\/:*?"<>|]+/g, '_');
  if (fmt === 'pdf') {
    const J = window.jspdf && window.jspdf.jsPDF; if (!J) throw new Error('PDF লাইব্রেরি লোড হয়নি (ইন্টারনেট দেখুন)');
    const pdf = new J({ unit: 'mm', format: 'a4' });
    pages.forEach((c, i) => { if (i) pdf.addPage(); pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 210 * c.height / c.width); });
    return [new File([pdf.output('blob')], safe + '.pdf', { type: 'application/pdf' })];
  }
  const files = [];
  for (let i = 0; i < pages.length; i++) { const blob = await new Promise(r => pages[i].toBlob(r, 'image/jpeg', 0.92)); files.push(new File([blob], safe + (pages.length > 1 ? '_' + (i + 1) : '') + '.jpg', { type: 'image/jpeg' })); }
  return files;
}
async function lfShareFiles(files, o) {
  o = o || {};
  try { if (navigator.share && navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title: o.title || '', text: o.text || '' }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; console.warn(e); }
  // শেয়ার সম্ভব না (কম্পিউটার): ফাইল ডাউনলোড + WhatsApp খোলা — ফাইলটা চ্যাটে অ্যাটাচ করুন
  files.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }, i * 400));
  showToast('ফাইল ডাউনলোড হয়েছে — WhatsApp চ্যাটে অ্যাটাচ করে পাঠান', 'info');
  setTimeout(() => window.open('https://wa.me/' + (o.phone || '') + '?text=' + encodeURIComponent(o.text || ''), '_blank'), 900);
}
async function lfSendBlocks(blocks, fmt, o) {
  showSyncOverlay(true, 'ফাইল তৈরি হচ্ছে...');
  let files;
  try { files = await lfMakeFiles(blocks, fmt, o.name); }
  catch (e) { console.error(e); showToast('ফাইল তৈরি হয়নি: ' + (e.message || e), 'error'); return; }
  finally { showSyncOverlay(false); }
  await lfShareFiles(files, o);
}
// একজন ভাড়াটিয়া → PDF/JPG
async function tnSendWhatsApp(id) {
  const tn = (tenants || []).find(x => x.id === id); if (!tn) return;
  const r = await lfFormatDialog({ title: tn.name + ' — তথ্যপত্র পাঠান', msg: 'কোন ফরম্যাটে WhatsApp-এ পাঠাবেন?' }); if (!r) return;
  await tnQrFor(tn);
  await lfSendBlocks([tnDossierBody(tn, { sign: true, title: 'ভাড়াটিয়ার তথ্য পত্র' })], r.fmt, { name: 'ভাড়াটিয়া_' + tn.name, phone: lfWaNumber(tn.mobile), title: tn.name + ' - তথ্যপত্র', text: '📋 ' + tn.name + ' — ভাড়াটিয়ার তথ্যপত্র (' + (settings.mktName || '') + ')' });
}
// সব ভাড়াটিয়া → PDF/JPG (বিস্তারিতসহ বা ছাড়া) বা শুধু লেখা
async function tnAllWhatsApp() {
  const list = _tnAllList(), now = new Date();
  const r = await lfFormatDialog({ title: 'সকল ভাড়াটিয়া — WhatsApp', msg: 'ফরম্যাট বেছে নিন', details: _tnAllDetails, text: true }); if (!r) return;
  if (r.fmt === 'text') {
    const text = '📋 *ভাড়াটিয়া তালিকা — ' + (settings.mktName || '') + '*\nমোট: ' + list.length + ' জন\n\n' +
      list.map((t, i) => (i + 1) + '. ' + t.name + ' — দোকান ' + (t.shop || '-') + ' — ভাড়া ' + _lfMoney(effectiveRent(t, _BNM[now.getMonth()], now.getFullYear())) + ' — ' + (t.mobile || '')).join('\n') + '\n\nধন্যবাদ।';
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); return;
  }
  const blocks = [tnAllBody({ details: false })];
  if (r.details) await tnQrPrefetch(list);
  if (r.details) list.forEach(t => blocks.push(tnDossierBody(t, { title: 'ভাড়াটিয়ার তথ্য পত্র' })));
  await lfSendBlocks(blocks, r.fmt, { name: 'সকল_ভাড়াটিয়া' + (r.details ? '_বিস্তারিত' : ''), title: 'সকল ভাড়াটিয়া', text: '📋 ভাড়াটিয়া তালিকা — ' + (settings.mktName || '') + ' (' + list.length + ' জন)' });
}

function lfPrintHtml(body, title) {
  const w = window.open('', '_blank', 'width=900,height=800');
  if (!w) { showToast('Pop-up allow korun', 'warning'); return; }
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + _esc(title) + '</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>'+TNP_CSS+'body{margin:10mm;}@page{size:A4;margin:8mm}@media print{body{margin:4mm}}</style></head><body>' + body +
    '<scr' + 'ipt>(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(function(){setTimeout(function(){window.print();},600);});</scr' + 'ipt></body></html>');
  w.document.close();
}
async function _lfAgImages(list) {
  const out = [];
  for (const a of list) {
    if (a.fileType && a.fileType !== 'application/pdf') {
      try { const src = await loadAgreementDataUrl(a.id, a.chunks || 1); if (src) out.push({ name: a.fileName || 'চুক্তি', src }); } catch (e) {}
    }
  }
  return out;
}

// ── ১. ভাড়াটিয়া মুছুন → পুরাতন ভাড়াটিয়া ──
async function _archiveCore(tenantId) {
  const tn = tenants.find(x => x.id === tenantId); if (!tn) return null;
  const data = { ...tn, archived: true, archivedAt: new Date().toISOString() };
  await FDB.save('tenants', tenantId, data);
  await FDB.save('archivedTenants', tenantId, data);
  // দোকান আবার খালি (যদি আর কেউ না থাকে)
  tenants = await FDB.getAll('tenants');
  shops = DB.get('shops'); await syncShopStatus(tn.shop);
  return data;
}
async function archiveTenant(tenantId) {   // ছাড়ার আবেদন থেকেও এটাই চলে
  return tenantMoveToOld(tenantId);
}
async function tenantMoveToOld(tenantId) {
  const tn = tenants.find(x => x.id === tenantId); if (!tn) return;
  if (!await uiConfirm('"' + tn.name + '" কে ভাড়াটিয়া সেকশন থেকে মুছে "পুরাতন ভাড়াটিয়া"-তে সরাবেন?\n\nতার সব তথ্য, ছবি ও আপলোডকৃত চুক্তিপত্র পুরাতন ভাড়াটিয়া ফোল্ডারে সেভ থাকবে। দোকানটি খালি হয়ে যাবে।')) return;
  showSyncOverlay(true, 'পুরাতন ভাড়াটিয়ায় সরানো হচ্ছে...');
  try {
    await _archiveCore(tenantId);
    addActivity(tn.name + ' পুরাতন ভাড়াটিয়ায় সরানো হয়েছে', 'archive', '#6b7280');
    showToast(tn.name + ' পুরাতন ভাড়াটিয়ায় সরানো হয়েছে ✅ (সব তথ্য সংরক্ষিত)');
  } finally { showSyncOverlay(false); }
  renderAgreements(); if (typeof renderTenants === 'function') renderTenants(); if (typeof renderShops === 'function') renderShops(); if (typeof updateNotifications === 'function') updateNotifications();
  if (document.getElementById('agreementTabLeave') && document.getElementById('agreementTabLeave').style.display !== 'none') renderLeaveRequests();
}
const _oldOpen = {};
async function renderArchivedTenants() {
  const el = document.getElementById('archivedTenantList'); if (!el) return;
  let list = [];
  try {
    if (FIREBASE_READY) { const snap = await db_fire.collection('archivedTenants').get(); list = snap.docs.map(d => ({ id: d.id, ...d.data() })); }
    else list = JSON.parse(localStorage.getItem('archivedTenants') || '[]');
  } catch (e) { list = JSON.parse(localStorage.getItem('archivedTenants') || '[]'); }
  list.sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  if (!list.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:.83rem;text-align:center;padding:20px;">কোনো পুরাতন ভাড়াটিয়া নেই</p>'; return; }
  el.innerHTML = list.map(t => {
    const open = !!_oldOpen[t.id];
    const ph = t.photo ? '<img src="' + t.photo + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">' : '<div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#14532d,#16a34a);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;">' + _esc((t.name || '?').charAt(0)) + '</div>';
    return '<div style="border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden;">' +
      '<div onclick="oldFolderToggle(\'' + t.id + '\')" style="display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;background:var(--bg-primary);">' +
      '<i class="fas fa-folder' + (open ? '-open' : '') + '" style="color:#d97706;font-size:1.3rem;"></i>' + ph +
      '<div style="flex:1;min-width:0;"><div style="font-weight:700;">' + _esc(t.name) + '</div><div style="font-size:.76rem;color:var(--text-muted);">দোকান ' + _esc(t.shop) + ' • ' + _esc(t.mobile) + ' • সরানো: ' + fmtDate(t.archivedAt) + '</div></div>' +
      '<i class="fas fa-chevron-' + (open ? 'up' : 'down') + '" style="color:var(--text-muted);"></i></div>' +
      (open ? '<div id="oldBody_' + t.id + '" style="padding:14px;border-top:1px solid var(--border);"><p style="color:var(--text-muted);font-size:.82rem;">লোড হচ্ছে...</p></div>' : '') + '</div>';
  }).join('');
  Object.keys(_oldOpen).filter(id => _oldOpen[id]).forEach(id => { const t = list.find(x => x.id === id); if (t) oldFolderFill(t); });
}
function oldFolderToggle(id) { _oldOpen[id] = !_oldOpen[id]; renderArchivedTenants(); }
async function oldFolderFill(t) {
  const box = document.getElementById('oldBody_' + t.id); if (!box) return;
  const ags = await getAgreementList(t.id);
  const nid = (src, cap) => src ? '<div style="flex:1;min-width:150px;text-align:center;"><div style="font-size:.74rem;color:var(--text-muted);margin-bottom:3px;">' + cap + '</div><img src="' + src + '" style="width:100%;max-height:150px;object-fit:contain;border:1px solid var(--border);border-radius:6px;"></div>' : '';
  const info = [['নাম', t.name], ['মোবাইল', t.mobile], ['এনআইডি', t.nid], ['দোকান / ফ্লোর', (t.shop || '-') + ' / ' + (t.floor || '-')], ['ঠিকানা', t.address], ['মাসিক ভাড়া', _lfMoney(t.rent)], ['অগ্রিম', _lfMoney(t.advance)], ['চুক্তি', fmtDate(t.startDate) + ' → ' + fmtDate(t.endDate)], ['মন্তব্য', t.notes]]
    .map(r => '<div style="display:flex;gap:8px;padding:3px 0;font-size:.82rem;"><span style="min-width:110px;color:var(--text-muted);">' + r[0] + '</span><span style="font-weight:600;">' + _esc(r[1] == null || r[1] === '' ? '-' : r[1]) + '</span></div>').join('');
  box.innerHTML = info +
    ((t.nidFrontUrl || t.nidBackUrl) ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;">' + nid(t.nidFrontUrl, 'এনআইডি — সামনে') + nid(t.nidBackUrl, 'এনআইডি — পিছনে') + '</div>' : '') +
    '<div style="font-weight:700;font-size:.84rem;margin:12px 0 6px;"><i class="fas fa-file-contract" style="color:var(--accent);"></i> আপলোডকৃত চুক্তিপত্র (' + _lfDigits(ags.length) + ')</div>' +
    (ags.length ? ags.map(a => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;"><div style="font-size:.8rem;"><i class="fas fa-' + (a.fileType === 'application/pdf' ? 'file-pdf' : 'image') + '" style="color:' + (a.fileType === 'application/pdf' ? '#dc2626' : '#2563eb') + ';margin-right:6px;"></i><b>' + _esc(a.fileName || 'চুক্তি') + '</b><div style="font-size:.72rem;color:var(--text-muted);">' + (a.type === 'renewal' ? 'নবায়ন' : 'নতুন') + ' • ' + (fmtDate(a.startDate) || '-') + ' → ' + (fmtDate(a.endDate) || '-') + '</div></div>' +
      '<div style="display:flex;gap:5px;"><button class="btn btn-primary btn-sm" onclick="oldViewAgreement(\'' + a.id + '\',' + (a.chunks || 1) + ',\'' + (a.fileType || '') + '\')"><i class="fas fa-eye"></i> দেখুন</button>' +
      '<button class="btn btn-outline btn-sm" onclick="downloadAgreementFile(\'' + a.id + '\',' + (a.chunks || 1) + ',\'' + encodeURIComponent(a.fileName || 'agreement') + '\')"><i class="fas fa-download"></i></button></div></div>').join('')
      : '<p style="font-size:.78rem;color:var(--text-muted);">কোনো চুক্তিপত্র আপলোড করা ছিল না</p>') +
    '<div id="oldPrev_' + t.id + '"></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><button class="btn btn-primary btn-sm" onclick="oldTenantPrint(\'' + t.id + '\')"><i class="fas fa-print"></i> প্রিন্ট</button>' +
    '<button class="btn btn-danger btn-sm" onclick="oldTenantForever(\'' + t.id + '\')"><i class="fas fa-trash"></i> Forever delete</button></div>';
}
async function oldViewAgreement(agId, chunks, fileType) {
  // ফাইল দেখার এরিয়া: পুরাতন ফোল্ডারের নিচে
  const dataUrl = await loadAgreementDataUrl(agId, chunks);
  if (!dataUrl) { showToast('ফাইল পাওয়া যায়নি', 'error'); return; }
  if (fileType === 'application/pdf') { const url = URL.createObjectURL(await (await fetch(dataUrl)).blob()); window.open(url, '_blank'); }
  else { const w = window.open('', '_blank'); if (w) { w.document.write('<img src="' + dataUrl + '" style="max-width:100%">'); w.document.close(); } }
}
async function oldTenantPrint(id) {
  const t = _lfFind(id); if (!t) return;
  const ags = await getAgreementList(id);
  const imgs = await _lfAgImages(ags);
  await tnQrFor(t);
  lfPrintHtml(tnDossierBody(t, { title: 'পুরাতন ভাড়াটিয়ার তথ্য', agreements: ags, agImages: imgs }), 'পুরাতন ভাড়াটিয়া - ' + (t.name || ''));
}
async function _lfDeleteAgreementCore(a, tenantId) {
  if (FIREBASE_READY) {
    try {
      const ref = db_fire.collection('agreements').doc(a.id), snap = await ref.collection('chunks').get();
      const batch = db_fire.batch(); snap.docs.forEach(d => batch.delete(d.ref)); await batch.commit();
    } catch (e) { console.warn(e); }
  }
  await FDB.delete('agreements', a.id);
  try { localStorage.removeItem('agfile_' + a.id); } catch (e) {}
}
async function oldTenantForever(id) {
  const t = _lfFind(id); if (!t) return;
  if (!await uiConfirm('"' + t.name + '" কে চিরতরে মুছে ফেলবেন?\n\nতার সব তথ্য, ছবি, এনআইডি ও আপলোডকৃত সব চুক্তিপত্র স্থায়ীভাবে মুছে যাবে — আর ফেরত আনা যাবে না।\n(আগের ভাড়ার রসিদ/হিসাব মুছবে না।)')) return;
  if (!await uiConfirm('শেষবার নিশ্চিত করুন: "' + t.name + '" চিরতরে মুছে ফেলা হবে।')) return;
  showSyncOverlay(true, 'চিরতরে মুছে ফেলা হচ্ছে...');
  try {
    const ags = await getAgreementList(id);
    for (const a of ags) await _lfDeleteAgreementCore(a, id);
    try { localStorage.removeItem('agHistory_' + id); } catch (e) {}
    await FDB.delete('archivedTenants', id);
    await FDB.delete('tenants', id);
    tenants = await FDB.getAll('tenants');
    delete _oldOpen[id];
    addActivity('চিরতরে মুছে ফেলা হয়েছে: ' + t.name, 'trash', '#dc2626');
    showToast('চিরতরে মুছে ফেলা হয়েছে', 'error');
  } catch (e) { console.error(e); showToast('মুছতে সমস্যা: ' + (e.message || e), 'error'); }
  finally { showSyncOverlay(false); }
  renderArchivedTenants();
}

// ── ২. নবায়ন ──
let _rn = null, _rnEndManual = false;
function _rnEl(id) { return document.getElementById(id); }
function _rnEnsureModal() {
  if (_rnEl('renewModal')) return;
  const m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'renewModal';
  const f = (id, label, extra) => '<div class="form-group"><label class="form-label">' + label + '</label><input id="' + id + '" class="form-input" ' + (extra || '') + '></div>';
  m.innerHTML = '<div class="modal" style="max-width:560px;"><div class="modal-header"><h3><i class="fas fa-sync" style="color:var(--accent);margin-right:6px;"></i> চুক্তি নবায়ন</h3><button onclick="closeModal(\'renewModal\')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1.1rem;"><i class="fas fa-times"></i></button></div>' +
    '<div class="modal-body"><div id="rnWho" style="font-weight:700;margin-bottom:10px;"></div><div class="form-grid">' +
    f('rnStart', 'নবায়ন শুরু', 'type="date" onchange="rnRecalc()"') +
    '<div class="form-group"><label class="form-label">মেয়াদ</label><select id="rnValidity" class="form-input form-select" onchange="rnRecalc()"><option value="6">৬ মাস</option><option value="12">১ বছর</option><option value="24" selected>২ বছর</option><option value="36">৩ বছর</option><option value="60">৫ বছর</option><option value="custom">নিজে তারিখ দিন</option></select></div>' +
    f('rnEnd', 'নবায়ন শেষ', 'type="date" onchange="rnEndEdited()"') + f('rnRent', 'নতুন মাসিক ভাড়া (৳)', 'type="number" step="any" oninput="rnSum()"') +
    f('rnIncrease', 'প্রতি নতুন বছরে ভাড়া বৃদ্ধি (৳)', 'type="number" step="any"') + f('rnExtra', 'নতুন অগ্রিম জমা (৳)', 'type="number" step="any" oninput="rnSum()"') +
    f('rnDeduct', 'মাসিক কর্তন (৳)', 'type="number" step="any"') +
    '<div class="form-group" style="grid-column:1/-1;"><label class="form-label">মন্তব্য</label><textarea id="rnNote" class="form-input" rows="2"></textarea></div></div>' +
    '<div id="rnSumBox" style="background:var(--bg-primary);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:.82rem;"></div></div>' +
    '<div class="modal-footer"><button onclick="closeModal(\'renewModal\')" class="btn btn-ghost">বাতিল</button><button onclick="rnSave()" class="btn btn-primary"><i class="fas fa-check"></i> নবায়ন সম্পন্ন করুন</button></div></div>';
  document.body.appendChild(m);
  if (typeof flatpickr !== 'undefined') ['rnStart', 'rnEnd'].forEach(id => flatpickr(_rnEl(id), { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd/m/Y', allowInput: false, disableMobile: true, onChange: [() => { if (id === 'rnEnd') rnEndEdited(); else rnRecalc(); }] }));
}
function _rnSet(id, v) { const el = _rnEl(id); if (!el) return; if (el._flatpickr) el._flatpickr.setDate(v || null, false, 'Y-m-d'); else el.value = v; }
function openRenewal(tenantId) {
  const tn = tenants.find(x => x.id === tenantId); if (!tn) return;
  _rnEnsureModal(); _rn = tn.id; _rnEndManual = false;
  _rnEl('rnWho').textContent = tn.name + ' — দোকান ' + (tn.shop || '');
  // পুরনো মেয়াদ শেষের পরের দিন; শেষ না থাকলে/অনেক আগে হলে আজ
  let start = isoLocal(new Date());
  if (tn.endDate) { const d = new Date(tn.endDate + 'T00:00:00'); d.setDate(d.getDate() + 1); if (!isNaN(d)) start = isoLocal(d); }
  _rnSet('rnStart', start);
  _rnEl('rnValidity').value = '24';
  const nowRent = effectiveRent(tn, _BNM[new Date().getMonth()], new Date().getFullYear());
  _rnEl('rnRent').value = nowRent || tn.rent || ''; _rnEl('rnIncrease').value = tn.annualIncrease || '';
  _rnEl('rnExtra').value = ''; _rnEl('rnDeduct').value = tn.monthlyDeduction || tn.deduction || ''; _rnEl('rnNote').value = '';
  rnRecalc(); openModal('renewModal');
}
function rnRecalc() {
  const sel = _rnEl('rnValidity'); if (!sel) return;
  if (sel.value !== 'custom') {
    const s = _rnEl('rnStart').value; if (s) { const d = new Date(s + 'T00:00:00'); d.setMonth(d.getMonth() + parseInt(sel.value, 10)); d.setDate(d.getDate() - 1); _rnSet('rnEnd', isoLocal(d)); }
  }
  rnSum();
}
function rnEndEdited() { const v = _rnEl('rnValidity'); if (v) v.value = 'custom'; rnSum(); }
function rnSum() {
  const tn = tenants.find(x => x.id === _rn); if (!tn) return;
  const rem = _lfRemaining(tn), extra = parseFloat(_rnEl('rnExtra').value) || 0;
  _rnEl('rnSumBox').innerHTML = 'বর্তমান অবশিষ্ট অগ্রিম: <b>' + _lfMoney(rem) + '</b> + নতুন জমা <b>' + _lfMoney(extra) + '</b> = মোট অগ্রিম <b>' + _lfMoney(rem + extra) + '</b><br>মেয়াদ: <b>' + (validityLabel(_rnEl('rnStart').value, _rnEl('rnEnd').value) || '-') + '</b>';
}
async function rnSave() {
  const tn = tenants.find(x => x.id === _rn); if (!tn) return;
  const newStart = _rnEl('rnStart').value, newEnd = _rnEl('rnEnd').value, newRent = parseFloat(_rnEl('rnRent').value) || 0;
  if (!newStart || !newEnd || newEnd < newStart) { showToast('নবায়নের শুরু ও শেষ তারিখ ঠিক করে দিন', 'error'); return; }
  if (!newRent) { showToast('নতুন মাসিক ভাড়া দিন', 'error'); return; }
  const oldAdvance = _lfRemaining(tn), extra = parseFloat(_rnEl('rnExtra').value) || 0, ded = parseFloat(_rnEl('rnDeduct').value) || 0;
  const rec = { id: 'RN' + Date.now(), date: isoLocal(new Date()), oldStart: tn.startDate || '', oldEnd: tn.endDate || '', oldRent: tn.rent || 0, newStart, newEnd, newRent,
    increase: parseFloat(_rnEl('rnIncrease').value) || 0, oldAdvance, extraAdvance: extra, totalAdvance: oldAdvance + extra, deduction: ded, note: _rnEl('rnNote').value.trim() };
  showSyncOverlay(true, 'নবায়ন সংরক্ষণ হচ্ছে...');
  try {
    await FDB.save('tenants', tn.id, { startDate: newStart, endDate: newEnd, rent: newRent, annualIncrease: rec.increase, advance: rec.totalAdvance, monthlyDeduction: ded, deduction: ded, renewedAt: new Date().toISOString(), renewals: (tn.renewals || []).concat([rec]) });
    tenants = await FDB.getAll('tenants');
    addActivity('চুক্তি নবায়ন: ' + tn.name, 'sync', '#2563eb');
  } catch (e) { console.error(e); showToast('নবায়ন সংরক্ষণে সমস্যা: ' + (e.message || e), 'error'); showSyncOverlay(false); return; }
  showSyncOverlay(false);
  closeModal('renewModal'); renderAgreements(); if (typeof renderTenants === 'function') renderTenants(); if (typeof updateNotifications === 'function') updateNotifications();
  showToast('চুক্তি নবায়ন হয়েছে ✅');
  rnShow(tn.id, rec.id);
}
// নবায়নের সারসংক্ষেপ: প্রিন্ট + WhatsApp
function rnShow(tenantId, recId) {
  const tn = tenants.find(x => x.id === tenantId); if (!tn) return;
  const recs = tn.renewals || [], rec = recs.find(r => r.id === recId) || recs[recs.length - 1]; if (!rec) { showToast('নবায়নের তথ্য নেই', 'error'); return; }
  let m = _rnEl('renewShowModal');
  if (!m) {
    m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'renewShowModal';
    m.innerHTML = '<div class="modal" style="max-width:760px;"><div class="modal-header"><h3 id="rsTitle"></h3><div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-primary btn-sm" id="rsPrint"><i class="fas fa-print"></i> প্রিন্ট</button><button class="btn btn-sm" style="background:#25d366;color:#fff;" id="rsWa"><i class="fab fa-whatsapp"></i> WhatsApp</button><button class="btn btn-outline btn-sm" id="rsUp"><i class="fas fa-upload"></i> চুক্তিপত্র আপলোড</button><button onclick="closeModal(\'renewShowModal\')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1.1rem;"><i class="fas fa-times"></i></button></div></div><div class="modal-body" id="rsBody" style="background:#fff;"></div></div>';
    document.body.appendChild(m);
  }
  _rnEl('rsTitle').textContent = 'নবায়ন — ' + tn.name;
  _rnEl('rsBody').innerHTML = tnDossierBody(tn, { title: 'চুক্তি নবায়ন তথ্য', rec });
  tnQrFor(tn).then(() => { const b = _rnEl('rsBody'); if (b && _rnEl('renewShowModal').classList.contains('open')) b.innerHTML = tnDossierBody(tn, { title: 'চুক্তি নবায়ন তথ্য', rec }); });
  _rnEl('rsPrint').onclick = async () => { await tnQrFor(tn); lfPrintHtml(tnDossierBody(tn, { title: 'চুক্তি নবায়ন তথ্য', rec }), 'নবায়ন - ' + tn.name); };
  _rnEl('rsWa').onclick = () => rnWhatsApp(tn.id, rec.id);
  _rnEl('rsUp').onclick = () => { closeModal('renewShowModal'); openAgreementUpload(tn.id); const t = _rnEl('agUploadType'); if (t) t.value = 'renewal'; _rnSetUpload(rec); };
  openModal('renewShowModal');
}
function _rnSetUpload(rec) {
  const v = _rnEl('agValidity'); if (v) v.value = 'custom';
  const s = _rnEl('agStartDate'), e = _rnEl('agEndDate'); if (s) s.value = rec.newStart; if (e) e.value = rec.newEnd;
}
function rnLatest(tenantId) { rnShow(tenantId); }
async function rnWhatsApp(tenantId, recId) {
  const tn = tenants.find(x => x.id === tenantId); if (!tn) return;
  const rec = (tn.renewals || []).find(r => r.id === recId) || (tn.renewals || []).slice(-1)[0]; if (!rec) return;
  const mob = String(tn.mobile || '').replace(/[^0-9]/g, '');
  const text = '📋 *চুক্তি নবায়ন — ' + (settings.mktName || '') + '*\n\nনাম: ' + tn.name + '\nদোকান: ' + (tn.shop || '') + '\nনবায়ন মেয়াদ: ' + fmtDate(rec.newStart) + ' থেকে ' + fmtDate(rec.newEnd) + (validityLabel(rec.newStart, rec.newEnd) ? ' (' + validityLabel(rec.newStart, rec.newEnd) + ')' : '') +
    '\nমাসিক ভাড়া: ' + _lfMoney(rec.newRent) + (rec.increase ? '\nপ্রতি নতুন বছরে বৃদ্ধি: ' + _lfMoney(rec.increase) : '') + '\nনতুন অগ্রিম জমা: ' + _lfMoney(rec.extraAdvance) + '\nমোট অগ্রিম: ' + _lfMoney(rec.totalAdvance) + '\n\nধন্যবাদ।';
  const url = 'https://wa.me/' + (mob ? (mob.startsWith('88') ? mob : '88' + mob) : '') + '?text=' + encodeURIComponent(text);
  try {
    if (typeof html2canvas !== 'undefined' && navigator.share && navigator.canShare) {
      showToast('ছবি তৈরি হচ্ছে...');
      await tnQrFor(tn);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;width:760px;background:#fff;';
      host.innerHTML = tnDossierBody(tn, { title: 'চুক্তি নবায়ন তথ্য', rec }); document.body.appendChild(host);
      let file;
      try { const c = await html2canvas(host, { scale: 1.5, backgroundColor: '#fff', useCORS: true, logging: false }); const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); file = new File([blob], 'renewal_' + (tn.name || '') + '.jpg', { type: 'image/jpeg' }); }
      finally { document.body.removeChild(host); }
      if (file && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'চুক্তি নবায়ন - ' + tn.name, text }); return; }
    }
  } catch (e) { if (e && e.name === 'AbortError') return; console.warn(e); }
  window.open(url, '_blank');
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  if (typeof buildLogin === 'function') buildLogin();
  initDatePickers();
  startAuthWatcher();
});
document.addEventListener('keydown', e=>{
  if (e.key==='Enter'&&document.getElementById('loginPage').style.display!=='none') doLogin();
  if (e.ctrlKey&&e.key==='n') { e.preventDefault(); showPage('rentCollection'); openRentModal(); }
});