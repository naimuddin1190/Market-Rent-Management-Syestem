
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
let db_fire = null, storage_fire = null;
let FIREBASE_READY = false;
let _realtimeUnsubs = [];

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db_fire      = firebase.firestore();
    storage_fire = firebase.storage();
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
      snap => { const d = snap.docs.map(x=>({id:x.id,...x.data()})); localStorage.setItem(col, JSON.stringify(d)); setter(d); },
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
      localStorage.setItem(col, JSON.stringify(d));
      return d;
    } catch(e) { return JSON.parse(localStorage.getItem(col)||'[]'); }
  },
  save: async (col, id, data) => {
    const all = JSON.parse(localStorage.getItem(col)||'[]');
    const idx = all.findIndex(x=>x.id===id);
    const rec = {...data, id};
    if (idx>=0) all[idx]=rec; else all.push(rec);
    localStorage.setItem(col, JSON.stringify(all));
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
    localStorage.setItem(col, JSON.stringify(all.filter(x=>x.id!==id)));
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
function doLogin() {
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  if (u === 'admin' && p === 'admin123') {
    currentUser = u;
    localStorage.setItem('currentUser', u);
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    init();
  } else { showToast('ভুল ব্যবহারকারীর নাম বা পাসওয়ার্ড', 'error'); }
}
function doLogout() {
  if (confirm('লগআউট করতে চান?')) { localStorage.removeItem('currentUser'); location.reload(); }
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
  // Load owner signature
  if (!ownerSignature && settings.ownerSignatureUrl) ownerSignature = settings.ownerSignatureUrl;
}

function setDateDisplay() {
  const now = new Date();
  const el = document.getElementById('dashDate');
  if (el) el.textContent = now.toLocaleDateString('bn-BD', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const rDate = document.getElementById('rDate');
  if (rDate) rDate.value = now.toISOString().split('T')[0];
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
  ['mktName','mktAddress','mktPhone','mktOwner','mktHolding'].forEach(id => {
    const el = document.getElementById(id);
    if (el && settings[id]) el.value = settings[id];
  });
}

async function saveSettings() {
  settings.mktName    = document.getElementById('mktName').value;
  settings.mktAddress = document.getElementById('mktAddress').value;
  settings.mktPhone   = document.getElementById('mktPhone').value;
  settings.mktOwner   = document.getElementById('mktOwner').value;
  settings.mktHolding = document.getElementById('mktHolding').value;
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
  if (window.innerWidth < 768) {
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
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('mobileOverlay');
  if (window.innerWidth < 768) {
    sb.classList.toggle('mobile-open');
    ov.classList.toggle('show');
  }
}

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
  document.getElementById('tStartDate').value = now.toISOString().split('T')[0];
  const end = new Date(now); end.setFullYear(end.getFullYear()+1);
  document.getElementById('tEndDate').value = end.toISOString().split('T')[0];

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
  compressImage(file, 400, 400, 0.8).then(b64 => {
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

  // Upload photo to Firebase Storage (organized path)
  if (photoUrl && photoUrl.startsWith('data:') && FIREBASE_READY) {
    showSyncStatus('প্রোফাইল ছবি আপলোড হচ্ছে...');
    photoUrl = await uploadToStorage('tenants/'+tenantId+'/profile/photo.jpg', photoUrl);
  }

  // NID Front
  const nidFrontRaw = (document.getElementById('nidFrontData')||{}).value||'';
  let nidFrontUrl = nidFrontRaw;
  if (nidFrontRaw && nidFrontRaw.startsWith('data:') && FIREBASE_READY) {
    showSyncStatus('NID সামনের ছবি আপলোড হচ্ছে...');
    nidFrontUrl = await uploadToStorage('tenants/'+tenantId+'/nid/front/nid_front.jpg', nidFrontRaw);
  }

  // NID Back
  const nidBackRaw = (document.getElementById('nidBackData')||{}).value||'';
  let nidBackUrl = nidBackRaw;
  if (nidBackRaw && nidBackRaw.startsWith('data:') && FIREBASE_READY) {
    showSyncStatus('NID পিছনের ছবি আপলোড হচ্ছে...');
    nidBackUrl = await uploadToStorage('tenants/'+tenantId+'/nid/back/nid_back.jpg', nidBackRaw);
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

  const recentPays = tenantPays.slice(-5).reverse().map(p=>
    '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">'+
    '<span>'+p.month+' '+(p.year||'')+'</span><span>৳'+(p.paid||0).toLocaleString()+'</span>'+
    '<span class="badge '+(p.status==='paid'?'badge-green':p.status==='partial'?'badge-yellow':'badge-red')+'">'+
    (p.status==='paid'?'পরিশোধিত':p.status==='partial'?'আংশিক':'বাকি')+'</span></div>'
  ).join('') || '<p style="color:var(--text-muted);font-size:0.83rem;padding:10px 0;">কোনো পেমেন্ট নেই</p>';

  document.getElementById('tenantViewContent').innerHTML =
    '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">'+
    '<div style="text-align:center;flex-shrink:0;">'+photoHtml+
    '<span class="badge '+st.cls+'" style="margin-top:8px;display:block;">'+st.label+'</span>'+nidHtml+'</div>'+
    '<div style="flex:1;min-width:200px;">'+
    '<h2 style="font-size:1.2rem;font-weight:700;">'+tn.name+'</h2>'+
    '<p style="color:var(--text-muted);font-size:0.83rem;margin-bottom:10px;">'+tn.mobile+(tn.nid?' • NID: '+tn.nid:'')+'</p>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.83rem;">'+
    '<div><b>দোকান:</b> '+tn.shop+'</div><div><b>ফ্লোর:</b> '+tn.floor+'</div>'+
    '<div><b>মাসিক ভাড়া:</b> ৳'+(tn.rent||0).toLocaleString()+'</div>'+
    '<div><b>অগ্রিম:</b> ৳'+(tn.advance||0).toLocaleString()+'</div>'+
    '<div><b>মাসিক কর্তন:</b> ৳'+deduction.toLocaleString()+'</div>'+
    '<div><b>অবশিষ্ট অগ্রিম:</b> <span style="color:var(--accent);font-weight:700;">৳'+remaining.toLocaleString()+'</span></div>'+
    '<div><b>চুক্তি শুরু:</b> '+(tn.startDate||'-')+'</div><div><b>চুক্তি শেষ:</b> '+(tn.endDate||'-')+'</div>'+
    '<div><b>মোট পরিশোধিত:</b> ৳'+totalPaid.toLocaleString()+'</div>'+
    '<div><b>মোট বাকি:</b> <span style="color:#dc2626;">৳'+totalDue.toLocaleString()+'</span></div>'+
    '</div>'+(tn.address?'<p style="margin-top:8px;font-size:0.82rem;"><b>ঠিকানা:</b> '+tn.address+'</p>':'')+
    '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;">'+
    '<button onclick="closeModal(\'tenantViewModal\');openTenantModal(\''+tn.id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-edit"></i> সম্পাদনা</button>'+
    '<a href="tel:'+tn.mobile+'" class="btn btn-gray btn-sm"><i class="fas fa-phone"></i> কল</a>'+
    '<a href="https://wa.me/88'+(tn.mobile||'').replace(/[^0-9]/g,'')+'" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;"><i class="fab fa-whatsapp"></i></a>'+
    '</div></div></div>'+
    '<hr style="margin:16px 0;border-color:var(--border);">'+
    '<h4 style="font-weight:700;margin-bottom:10px;font-size:0.9rem;">সাম্প্রতিক পেমেন্ট</h4>'+recentPays;
  openModal('tenantViewModal');
}

function viewNID(tenantId) {
  const tn = tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  let html = '<h3 style="margin-bottom:16px;font-weight:700;">'+tn.name+' — এনআইডি</h3>';
  if (tn.nidFrontUrl) html += '<div style="margin-bottom:12px;"><p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:6px;">সামনের দিক:</p><img src="'+tn.nidFrontUrl+'" style="max-width:100%;border-radius:8px;border:2px solid var(--border);"></div>';
  if (tn.nidBackUrl)  html += '<div><p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:6px;">পিছনের দিক:</p><img src="'+tn.nidBackUrl+'" style="max-width:100%;border-radius:8px;border:2px solid var(--border);"></div>';
  if (!tn.nidFrontUrl && !tn.nidBackUrl) html += '<p style="color:var(--text-muted);">কোনো NID ছবি আপলোড করা হয়নি।</p>';
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
      '<button onclick="deleteTenant(\''+tn.id+'\')" class="btn btn-danger btn-sm" title="মুছুন"><i class="fas fa-trash"></i></button>'+
      '</div></td></tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">কোনো ভাড়াটিয়া পাওয়া যায়নি</td></tr>';
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
  document.getElementById('rDate').value = new Date().toISOString().split('T')[0];
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

function calcDue() {
  const rent = parseFloat(document.getElementById('rMonthlyRent').value)||0;
  const paid = parseFloat(document.getElementById('rPaid').value)||0;
  document.getElementById('rDue').value = Math.max(0, rent-paid);
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
    '<button onclick="deletePayment(\''+p.id+'\')" class="btn btn-danger btn-sm"><i class="fas fa-trash"></i></button>'+
    '</div></td></tr>'
  ).join('') || '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted);">কোনো পেমেন্ট নেই</td></tr>';
}

async function deletePayment(id) {
  if (!confirm('এই রসিদ মুছে ফেলতে চান?')) return;
  await FDB.delete('payments', id);
  payments = await FDB.getAll('payments');
  renderPayments(); showToast('রসিদ মুছে ফেলা হয়েছে','error');
}

// ============================================================
// SLIP GENERATION — Enhanced with QR + Bengali Font + Both Copies
// ============================================================
function generateQRDataUrl(p) {
  return new Promise(resolve => {
    try {
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
      document.body.appendChild(container);
      const qrData = JSON.stringify({
        slip: p.tenantSlipNo||p.slipNo,
        tenant: p.tenantName,
        tenantId: p.tenantId,
        shop: p.shop,
        month: p.month+' '+(p.year||''),
        date: p.date,
        paid: p.paid,
        status: p.status
      });
      const qr = new QRCode(container, {
        text: qrData, width: 80, height: 80,
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

async function viewSlip(paymentId) {
  const p = payments.find(x=>x.id===paymentId);
  if (!p) return;
  currentSlipPayment = p;
  // Generate QR
  const qrSrc = typeof QRCode !== 'undefined' ? await generateQRDataUrl(p) : '';
  const qrHtml = qrSrc
    ? '<div class="qr-container"><img src="'+qrSrc+'" width="80" height="80" alt="QR"><div style="font-size:0.68rem;color:#6b7280;margin-top:4px;text-align:center;">স্ক্যান করুন</div></div>'
    : '';

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
    '<div style="margin-left:auto;font-size:0.78rem;color:#166534;">তারিখঃ <span class="slip-field">'+formatBnDate(p.date)+'</span></div></div>'+
    '<div class="slip-decorative" style="margin-bottom:10px;height:4px;"></div>'+
    // Fields
    '<div style="font-size:0.85rem;color:#14532d;line-height:2.2;font-family:\'Noto Sans Bengali\',sans-serif;">'+
    '<div style="display:flex;align-items:baseline;gap:6px;"><span style="white-space:nowrap;min-width:180px;">অস্থায়ী ভাড়াটিয়ার নাম ঃ</span><span class="slip-field" style="flex:1;font-weight:700;font-size:0.95rem;">'+p.tenantName+'</span></div>'+
    '<div style="display:flex;align-items:baseline;gap:6px;"><span style="white-space:nowrap;min-width:180px;">দোকান নং ঃ</span><span class="slip-field" style="font-weight:700;">'+p.shop+'</span></div>'+
    '<div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;"><span style="white-space:nowrap;min-width:180px;">মাসের নাম ঃ</span><span class="slip-field" style="font-weight:700;">'+p.month+' '+(p.year||'')+'</span><span style="white-space:nowrap;margin-left:auto;">মাসিক ভাড়া ঃ</span><span class="slip-field" style="font-weight:700;">৳'+(p.rent||0).toLocaleString()+'</span><span>টাকা</span></div>'+
    '<div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;"><span style="min-width:80px;">পরিশোধিত ঃ</span><span class="slip-field" style="font-weight:800;font-size:1.05rem;color:#14532d;">৳'+(p.paid||0).toLocaleString()+'</span><span>টাকা</span>'+dueHtml+'</div>'+
    (p.collector?'<div><span>সংগ্রহকারী ঃ </span><span class="slip-field">'+p.collector+'</span></div>':'')+
    (p.notes?'<div style="font-size:0.78rem;color:#4b5563;">মন্তব্য ঃ '+p.notes+'</div>':'')+
    '</div>'+
    // Signatures + QR
    '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;padding-top:10px;border-top:1px dashed #86efac;">'+
    '<div style="text-align:center;font-size:0.78rem;color:#14532d;"><div style="border-bottom:1.5px solid #16a34a;width:110px;height:36px;margin-bottom:4px;"></div><div>ভাড়াটিয়ার স্বাক্ষর</div></div>'+
    (qrHtml||'')+
    '<div style="text-align:center;font-size:0.78rem;color:#14532d;">'+ownerSig+'<div>জমিদারের স্বাক্ষর</div></div></div>'+
    '<div class="slip-decorative" style="margin-top:10px;"></div>'+
    '</div>';
}

function formatBnDate(dateStr) {
  if (!dateStr) return '...........';
  try { return new Date(dateStr).toLocaleDateString('bn-BD',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  catch(e) { return dateStr; }
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
    const canvas = await html2canvas(el, {scale:2, backgroundColor:'#fff', useCORS:true, logging:false});
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
    const canvas = await html2canvas(el, {scale:2, backgroundColor:'#fff', useCORS:true, logging:false});
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
    const canvas = await html2canvas(tenantCopy, {scale:2, backgroundColor:'#fff', useCORS:true, logging:false});
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

function sendWhatsApp() {
  if (!currentSlipPayment) return;
  const p = currentSlipPayment;
  const tn = tenants.find(x=>x.id===p.tenantId);
  if (!tn?.mobile) { showToast('ভাড়াটিয়ার মোবাইল নম্বর নেই','error'); return; }
  const msg = encodeURIComponent('📋 *ভাড়া রশিদ - '+settings.mktName+'*\n\nরসিদ নং: '+p.tenantSlipNo+'\nনাম: '+p.tenantName+'\nদোকান: '+p.shop+'\nমাস: '+p.month+' '+p.year+'\nভাড়া: ৳'+p.rent+'\nপরিশোধিত: ৳'+p.paid+'\nবাকি: ৳'+p.due+'\nতারিখ: '+p.date+'\n\nধন্যবাদ।');
  window.open('https://wa.me/88'+tn.mobile.replace(/[^0-9]/g,'')+'?text='+msg,'_blank');
}

// ── Monthly Bundle Print ─────────────────────────────────────
function printAllMonthReceipts() {
  const monthF = document.getElementById('rcMonthFilter')?.value||'';
  const list   = payments.filter(p=>!monthF||(p.month+' '+p.year)===monthF);
  if (!list.length) { showToast('প্রিন্ট করার মতো কোনো রসিদ নেই','warning'); return; }
  showToast(list.length+'টি রসিদ প্রিন্ট হচ্ছে...');
  let allHtml = '';
  list.forEach(p => {
    allHtml += '<div style="page-break-after:always;">'+
      generateSlipCopy(p,settings,'owner','')+
      '<div style="text-align:center;padding:4px;font-size:.7rem;color:#aaa;">✂ কাটুন</div>'+
      generateSlipCopy(p,settings,'tenant','')+'</div>';
  });
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
      '<td style="font-size:.8rem;">'+(p.date||'')+'</td>'+
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
  downloadFile('payment_history_'+new Date().toISOString().split('T')[0]+'.json', data, 'application/json');
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
      '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">শুরু: '+(tn.startDate||'-')+' → শেষ: '+(tn.endDate||'-')+'</div>'+
      '<div style="background:var(--border);border-radius:4px;height:5px;margin-bottom:6px;overflow:hidden;"><div style="height:100%;background:'+bc+';width:'+pct+'%;border-radius:4px;transition:width 0.5s;"></div></div>'+
      (st.days!==null&&st.days>=0?'<div style="font-size:0.75rem;color:var(--text-muted);">'+pct+'% সম্পন্ন • '+st.days+' দিন অবশিষ্ট</div>':'')+
      '<div style="display:flex;gap:5px;margin-top:10px;flex-wrap:wrap;">'+
      '<button onclick="openTenantModal(\''+tn.id+'\')" class="btn btn-outline btn-sm"><i class="fas fa-sync"></i> নবায়ন</button>'+
      '<button onclick="openLeaveRequest(\''+tn.id+'\')" class="btn btn-warning btn-sm"><i class="fas fa-door-open"></i> ছাড়ার আবেদন</button>'+
      '<button onclick="openAgreementUpload(\''+tn.id+'\')" class="btn btn-ghost btn-sm"><i class="fas fa-file-pdf"></i> চুক্তি</button>'+
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
  const today=new Date().toISOString().split('T')[0];
  document.getElementById('leaveReqDate').value = today;
  const exit=new Date(); exit.setMonth(exit.getMonth()+3);
  document.getElementById('leaveExitDate').value = exit.toISOString().split('T')[0];
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
    const msg=encodeURIComponent('📋 *ছেড়ে দেওয়ার আবেদন নিশ্চিতকরণ*\n\nনাম: '+tn.name+'\nদোকান: '+tn.shop+'\nআবেদন তারিখ: '+reqDate+'\nপ্রস্থান তারিখ: '+exitDate+'\nনোটিশ সময়: '+days+' দিন\n\nধন্যবাদ।');
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
      '<div><div style="font-weight:700;font-size:.9rem;">'+r.tenantName+'</div><div style="font-size:.75rem;color:var(--text-muted);">'+r.shop+' • আবেদন: '+r.reqDate+'</div></div>'+
      '<div style="display:flex;gap:4px;"><span class="badge '+(daysLeft>0?'badge-yellow':'badge-red')+'">'+(daysLeft>0?daysLeft+' দিন বাকি':'মেয়াদ শেষ')+'</span>'+
      '<span class="badge '+statusCls+'">'+statusLabel+'</span></div></div>'+
      '<div style="font-size:.82rem;margin-bottom:10px;">প্রস্থান: <strong>'+r.exitDate+'</strong>'+(r.reason?' — '+r.reason:'')+'</div>'+
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
      '<td style="font-size:.78rem;">'+(t.archivedAt||'').split('T')[0]+'</td>'+
      '<td><button onclick="viewArchivedTenant(\''+t.id+'\')" class="btn btn-gray btn-sm"><i class="fas fa-eye"></i> দেখুন</button></td></tr>'
    ).join('')+'</tbody></table></div>';
}

function viewArchivedTenant(id) {
  const list = JSON.parse(localStorage.getItem('archivedTenants')||'[]');
  const tn = list.find(x=>x.id===id);
  if (!tn) return;
  alert(JSON.stringify({name:tn.name,shop:tn.shop,rent:tn.rent,advance:tn.advance,nid:tn.nid,mobile:tn.mobile,archivedAt:tn.archivedAt},null,2));
}

// ── Agreement Upload ─────────────────────────────────────────
function openAgreementUpload(tenantId) {
  const tn=tenants.find(x=>x.id===tenantId);
  if (!tn) return;
  document.getElementById('agUploadTenantId').value   = tenantId;
  document.getElementById('agUploadTenantName').value = tn.name+' — '+tn.shop;
  document.getElementById('agUploadNote').value       = '';
  document.getElementById('agFilePreview').innerHTML  = '<i class="fas fa-file-pdf" style="color:#dc2626;font-size:2rem;display:block;margin-bottom:8px;"></i><span style="font-size:.82rem;color:var(--text-muted);">ক্লিক করে PDF/ছবি বেছে নিন</span>';
  const now=new Date(); document.getElementById('agStartDate').value=now.toISOString().split('T')[0];
  const end=new Date(now); end.setFullYear(end.getFullYear()+1);
  document.getElementById('agEndDate').value=end.toISOString().split('T')[0];
  openModal('agreementUploadModal');
}

function previewAgreementFile(input) {
  const file=input.files[0]; if(!file) return;
  const p=document.getElementById('agFilePreview');
  if (file.type==='application/pdf') { p.innerHTML='<i class="fas fa-file-pdf" style="color:#dc2626;font-size:2rem;display:block;margin-bottom:4px;"></i><span style="font-size:.85rem;font-weight:600;">'+file.name+'</span>'; }
  else { const r=new FileReader(); r.onload=e=>{p.innerHTML='<img src="'+e.target.result+'" style="max-height:100px;border-radius:6px;">';}; r.readAsDataURL(file); }
}

async function saveAgreementUpload() {
  const tenantId=document.getElementById('agUploadTenantId').value;
  const type=document.getElementById('agUploadType').value;
  const note=document.getElementById('agUploadNote').value;
  const startDate=document.getElementById('agStartDate').value;
  const endDate=document.getElementById('agEndDate').value;
  const fileInput=document.getElementById('agFile');
  const tn=tenants.find(x=>x.id===tenantId);
  if (!tn||!fileInput.files[0]) { showToast('ফাইল নির্বাচন করুন','error'); return; }
  showSyncOverlay(true,'চুক্তিপত্র আপলোড হচ্ছে...');
  const file=fileInput.files[0];
  let fileUrl='';
  if (FIREBASE_READY) {
    fileUrl=await uploadFileToStorage('agreements/'+tenantId+'/'+(type==='renewal'?'renewal_':'new_')+Date.now()+'_'+file.name, file)||'';
  }
  if (!fileUrl) {
    const reader=new FileReader();
    reader.onload=e=>{ fileUrl=e.target.result; };
    reader.readAsDataURL(file);
    await new Promise(r=>setTimeout(r,500));
    if (!fileUrl) fileUrl = URL.createObjectURL(file);
  }

  // Agreement history (never overwrite)
  const agKey = 'agHistory_'+tenantId;
  const hist = JSON.parse(localStorage.getItem(agKey)||'[]');
  const agRecord={id:'AG'+Date.now(), tenantId, tenantName:tn.name, type, fileUrl, note, fileName:file.name, startDate, endDate, uploadedAt:new Date().toISOString()};
  hist.push(agRecord);
  localStorage.setItem(agKey, JSON.stringify(hist));

  await FDB.save('agreements', agRecord.id, agRecord);
  // Update tenant dates for renewal
  if (type==='renewal' && startDate && endDate) {
    await FDB.save('tenants', tenantId, {startDate, endDate, renewedAt:new Date().toISOString()});
    tenants=await FDB.getAll('tenants');
  }
  showSyncOverlay(false);
  closeModal('agreementUploadModal');
  addActivity('চুক্তিপত্র আপলোড: '+tn.name,'file-contract','#16a34a');
  showToast('চুক্তিপত্র সংরক্ষণ হয়েছে ✅');
  // WhatsApp agreement notification
  if (tn.mobile) {
    const msg=encodeURIComponent('📋 *চুক্তি '+(type==='renewal'?'নবায়ন':'তৈরি')+'*\n\nভাড়াটিয়া: '+tn.name+'\nদোকান: '+tn.shop+'\nশুরু: '+startDate+'\nশেষ: '+endDate+'\n\nধন্যবাদ।');
    setTimeout(()=>window.open('https://wa.me/88'+tn.mobile.replace(/[^0-9]/g,'')+'?text='+msg,'_blank'),500);
  }
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
    '<div style="flex:1;"><div style="font-size:0.83rem;">'+a.text+'</div><div style="font-size:0.74rem;color:var(--text-muted);">'+new Date(a.time).toLocaleString('bn-BD',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'})+'</div></div></div>'
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
  const b=document.getElementById('notifBadge'); if(b) b.style.display=notifs.length?'block':'none';
  const clrs={danger:'#dc2626',warning:'#d97706',info:'#2563eb'};
  document.getElementById('notifList').innerHTML=notifs.slice(0,10).map(n=>
    '<div class="notification-item unread"><div style="display:flex;align-items:center;gap:8px;">'+
    '<i class="fas fa-'+n.icon+'" style="color:'+clrs[n.type]+';font-size:0.8rem;"></i>'+
    '<span style="font-size:0.82rem;">'+n.text+'</span></div></div>'
  ).join('')||'<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.83rem;">কোনো নোটিফিকেশন নেই</div>';
}

function toggleNotifPanel() {
  const p=document.getElementById('notifPanel');
  p.style.display=p.style.display==='block'?'none':'block';
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
  downloadFile('hcm_backup_v2_'+new Date().toISOString().split('T')[0]+'.json', JSON.stringify(backup,null,2),'application/json');
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
    {id:'T1',name:'মোঃ রফিকুল ইসলাম', mobile:'01712345678',nid:'1234567890',shop:'A-01',floor:'নিচতলা',rent:8000,advance:50000,monthlyDeduction:5000,deduction:5000,address:'পাহাড়তলী, চট্টগ্রাম',startDate:'2023-01-01',endDate:e1.toISOString().split('T')[0],serial:1,photo:'',archived:false},
    {id:'T2',name:'মোছাঃ সালমা বেগম',  mobile:'01898765432',nid:'9876543210',shop:'A-02',floor:'নিচতলা',rent:7000,advance:40000,monthlyDeduction:4000,deduction:4000,address:'নাসিরাবাদ, চট্টগ্রাম',startDate:'2022-06-01',endDate:e2.toISOString().split('T')[0],serial:2,photo:'',archived:false},
    {id:'T3',name:'মোঃ আব্দুল করিম',   mobile:'01611234567',nid:'5678901234',shop:'B-01',floor:'২য় তলা',rent:5000,advance:30000,monthlyDeduction:3000,deduction:3000,address:'বায়েজিদ, চট্টগ্রাম',  startDate:'2023-06-01',endDate:e3.toISOString().split('T')[0],serial:3,photo:'',archived:false},
    {id:'T4',name:'মোঃ জাহাঙ্গীর আলম', mobile:'01511234567',nid:'3456789012',shop:'C-01',floor:'৩য় তলা',rent:4000,advance:20000,monthlyDeduction:2000,deduction:2000,address:'চকবাজার, চট্টগ্রাম', startDate:'2023-03-01',endDate:e3.toISOString().split('T')[0],serial:4,photo:'',archived:false},
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
  compressImage(file, 800, 600, 0.85).then(b64=>{
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
// KEYBOARD SHORTCUTS
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  const user=localStorage.getItem('currentUser');
  if (user) {
    currentUser=user;
    document.getElementById('loginPage').style.display='none';
    document.getElementById('mainApp').style.display='block';
    init();
  } else {
    document.getElementById('loginPage').style.display='flex';
    document.getElementById('mainApp').style.display='none';
  }
});
document.addEventListener('keydown', e=>{
  if (e.key==='Enter'&&document.getElementById('loginPage').style.display!=='none') doLogin();
  if (e.ctrlKey&&e.key==='n') { e.preventDefault(); showPage('rentCollection'); openRentModal(); }
});

