/* =================================================================
   GUTS POS SYSTEM - LOGIC FRONTEND (FULL REPAIR)
   ================================================================= */

// --- PENTING: PASTE URL WEB APP ANDA DI SINI ---
const API_URL = "https://script.google.com/macros/s/AKfycbwTppW9MbmNya1OiYJFVZjj4TertTzrGoe4KuuTegb0M5I2WJy5SIIDJJT8MC8xVjDIRw/exec"; 

// --- GLOBAL VARIABLES ---
let currentUser = null;
let currentShift = null; 
let masterData = { produk: [], karyawan: [], promo: [], coa: [] };
let orders = []; 
let activeOrderId = null; 
let orderCounter = 1; 
let journalItems = []; 
let voidDataTemp = null;

// --- HELPER FUNCTIONS ---
function getLocalDate() { const now = new Date(); const offset = now.getTimezoneOffset(); const local = new Date(now.getTime() - (offset*60*1000)); return local.toISOString().split('T')[0]; }
function formatDateIndo(dateStr) { const d = new Date(dateStr); return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
function formatDateSimple(dateStr) { const d = new Date(dateStr); return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; }
function fmtRp(n) { return new Intl.NumberFormat('id-ID').format(n); }
function cleanNum(str) { return parseInt(String(str).replace(/[^0-9-]/g, '')) || 0; }
function formatInputRupiah(el) {
    let val = el.value.replace(/[^0-9]/g, '');
    if (val === '') { el.value = ''; return; }

    el.value = new Intl.NumberFormat('id-ID').format(parseInt(val));
}

function getSelectedBranch() { 
    if (currentUser && currentUser.Branch_Access !== 'HO') return currentUser.Branch_Access; 
    const sel = document.getElementById('admin-branch-select'); 
    return sel ? sel.value : 'HO'; 
}

function refreshAllViews() { 
    const activeMenu = document.querySelector('.menu-item.active'); 
    if(activeMenu) activeMenu.click(); 
}

function setStatus(state) {
    const el = document.getElementById('sync-status');
    if(!el) return;
    
    if(state === 'saving') {
        el.style.color = 'var(--accent)'; 
        el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Menyimpan...</span>';
    } else if(state === 'error' || state === 'offline') {
        el.style.color = 'var(--red)';
        el.innerHTML = '<i class="fas fa-wifi"></i> <span>OFFLINE / Gagal</span>';
    } else {
        el.style.color = 'var(--green)';
        el.innerHTML = '<i class="fas fa-check-circle"></i> <span>Ready</span>';
    }
}

// --- INITIALIZATION ---
window.onload = () => {
    // 1. Cek Offline/Online Status
    if(!navigator.onLine) setStatus('offline');
    
    window.addEventListener('offline', () => setStatus('offline'));
    
    // --- PERUBAHAN DI SINI ---
    window.addEventListener('online', () => {
        setStatus('saved');     // Ubah indikator jadi hijau
        processOfflineQueue();  // Kirim data yang nyangkut di memori HP
    });
    // -------------------------

    // Cek antrian juga saat pertama kali aplikasi dibuka (siapa tahu ada sisa kemarin)
    processOfflineQueue();

    // 2. Cek Login User
    const saved = localStorage.getItem('guts_user');
    if(saved) { 
        try { 
            currentUser = JSON.parse(saved); 
            performLoginCheck(); 
        } catch(e) { localStorage.clear(); } 
    }

    // 3. Load Local Data (Cart)
    const savedCount = localStorage.getItem('guts_order_counter'); 
    if(savedCount) orderCounter = parseInt(savedCount);
    
    const savedOrders = localStorage.getItem('guts_orders');
    if(savedOrders) { 
        try { 
            orders = JSON.parse(savedOrders); 
            if(orders.length > 0 && !activeOrderId) activeOrderId = orders[0].id; 
        } catch(e){ orders=[]; } 
    }
    
    checkBlankState(); 
    if(activeOrderId) loadActiveOrder(); 

    // 4. Clock Tick
    setInterval(() => { 
        const el = document.getElementById('time-in-display'); 
        if(el) el.innerText = new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}); 
    }, 1000);
};

// --- AUTH & SHIFT ---
async function performLogin() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const btn = document.getElementById('btn-login');
    
    if(!u || !p) return alert("Isi Username & Password!");

    btn.innerText = "Checking..."; btn.disabled = true;

    try {
        const req = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "login", payload: { username: u, password: p } })
        });
        const res = await req.json();

        if (res.status) { 
            currentUser = res.data; 
            localStorage.setItem('guts_user', JSON.stringify(currentUser)); 
            performLoginCheck();
        } else alert(res.message);
    } catch(e){ alert("Err: " + e); } 
    btn.innerText = "LOGIN"; btn.disabled = false;
}

/* --- LOGIN CHECK: LOCAL + SERVER RESTORE --- */
async function performLoginCheck() {
    // 1. Cek Local Storage (Cara Lama)
    const savedShift = localStorage.getItem('guts_shift_' + currentUser.Username);
    if(savedShift) {
        currentShift = JSON.parse(savedShift);
        showDashboard();
        return;
    }

    const btn = document.getElementById('btn-login');
    if(btn) btn.innerText = "Checking Session...";

    try {
        const req = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ 
                action: "check_open_shift", 
                payload: { user: currentUser.Username } 
            })
        });
        const res = await req.json();
        
        if(res.status) {
            currentShift = { 
                id: res.data.shiftId, 
                startBal: res.data.startBal, 
                startTime: res.data.startTime 
            };
            localStorage.setItem('guts_shift_' + currentUser.Username, JSON.stringify(currentShift));
            
            alert("Sesi Shift dipulihkan dari server.");
            showDashboard();
        } else {
            document.getElementById('login-page').classList.add('hidden');
            document.getElementById('modal-open-shift').classList.remove('hidden');
        }
    } catch(e) {
        alert("Gagal cek sesi server (Offline). Silakan Buka Toko manual.");
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('modal-open-shift').classList.remove('hidden');
    }
    
    if(btn) btn.innerText = "LOGIN";
}

async function processOpenShift() {
    const bal = cleanNum(document.getElementById('shift-start-bal').value);
    if(!bal && bal !== 0) return alert("Isi saldo awal!");
    setStatus('saving');
    try {
        const req = await fetch(API_URL, {
            method: "POST", 
            body: JSON.stringify({ action: "open_shift", payload: { branch: getSelectedBranch(), user: currentUser.Username, startBal: bal }})
        });
        const res = await req.json();
        if(res.status) {
            setStatus('saved');
            currentShift = { id: res.data.shiftId, startBal: bal, startTime: new Date().getTime() };
            localStorage.setItem('guts_shift_' + currentUser.Username, JSON.stringify(currentShift));
            document.getElementById('modal-open-shift').classList.add('hidden');
            showDashboard();
        } else { setStatus('error'); alert(res.message); }
    } catch(e) { setStatus('error'); alert(e); }
}

async function prepareCloseShift() {
    if(!currentShift) { logout(); return; }
    document.getElementById('loading-overlay').classList.remove('hidden');
    try {
        const req = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "get_monthly_rekap", payload: {branch: getSelectedBranch(), date: getLocalDate()} }) });
        const res = await req.json();
        const start = currentShift.startBal;
        const todayData = res.data.rekap.find(r => r.date === getLocalDate()) || { cashIn: 0, pettyUsage: 0 };
        const sysCalc = start + todayData.cashIn - todayData.pettyUsage;
        
        document.getElementById('disp-start-bal').innerText = fmtRp(start);
        document.getElementById('disp-cash-in').innerText = fmtRp(todayData.cashIn);
        document.getElementById('disp-cash-out').innerText = fmtRp(todayData.pettyUsage);
        document.getElementById('disp-sys-calc').innerText = fmtRp(sysCalc);
        document.getElementById('modal-close-shift').dataset.sys = sysCalc;
        document.getElementById('modal-close-shift').classList.remove('hidden');
    } catch(e) { alert("Gagal hitung shift: " + e); }
    document.getElementById('loading-overlay').classList.add('hidden');
}

async function processCloseShift() {
    const endBal = cleanNum(document.getElementById('shift-end-bal').value);
    const sysCalc = parseFloat(document.getElementById('modal-close-shift').dataset.sys);
    if(confirm(`Saldo Cash hari ini: ${fmtRp(endBal)}\nSelisih: ${fmtRp(endBal - sysCalc)}\n\nReport hari ini sudah sesuai?`)) {
         setStatus('saving');
         try {
            await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "close_shift", payload: { shiftId: currentShift.id, endBal: endBal, systemCalc: sysCalc }}) });
            setStatus('saved'); logout();
        } catch(e) { setStatus('error'); alert(e); }
    }
}

function logout() { 
    localStorage.removeItem('guts_shift_' + (currentUser ? currentUser.Username : ''));
    localStorage.removeItem('guts_user');
    localStorage.clear(); location.reload(); 
}

function showDashboard() {
    document.getElementById('login-page').classList.add('hidden'); 
    document.getElementById('dashboard-container').classList.remove('hidden');
    document.getElementById('user-display').innerText = currentUser.Username; 
    document.getElementById('branch-badge').innerText = currentUser.Branch_Access || 'HO';
    if(currentUser.Branch_Access === 'HO') document.getElementById('admin-branch-container').classList.remove('hidden');
    
    updateSidebarAddress();
    syncOrderCounter();
    loadMaster(); 
    renderOrderTabs(); 
    if(orders.length === 0) loadDailyDashboard();
}

/* --- FUNGSI UPDATE ALAMAT SIDEBAR --- */
function updateSidebarAddress() {
    const branch = getSelectedBranch(); // Ambil cabang yang aktif
    const el = document.getElementById('user-address-display');
    
    if (!el) return;

    let addr = "";

    // Logika Alamat (Sama persis dengan Receipt)
    if (branch === 'Cimahi') {
        addr = "Jl. Jend. H. Amir Machmud No.654, Cimahi<br>Kec. Cimahi Tengah, Kota Cimahi";
    } else {
        // Default (Leuwigajah / HO)
        addr = "Jl. Kerkof No.23, Leuwigajah<br>Kec. Cimahi Selatan, Kota Cimahi";
    }

    el.innerHTML = addr; // Gunakan innerHTML agar <br> terbaca sebagai enter
}

// --- DATA MASTER & DROPDOWNS ---
async function loadMaster() {
    const CACHE_KEY = 'guts_master_cache';
    try { 
        // 1. Coba Tarik Data Online
        const req = await fetch(API_URL, {method: "POST", body: JSON.stringify({action: "get_master_data", payload: {}})}); 
        const res = await req.json(); 
        if(res.status){ 
            masterData = res.data; 
            // SIMPAN KE MEMORI (Untuk cadangan kalau offline)
            localStorage.setItem(CACHE_KEY, JSON.stringify(masterData));
            initDropdowns(); 
        } 
    } catch(e){ 
        console.log("Offline Mode: Mengambil Data lokal...");
        // 2. Jika Gagal (Offline)
        const cached = localStorage.getItem(CACHE_KEY);
        if(cached) {
            masterData = JSON.parse(cached);
            initDropdowns();
            // Beri tahu user pakai data lama
            const sel = document.getElementById('sync-status');
            if(sel) { sel.style.color = 'orange'; sel.innerText = 'Offline Mode (Data lokal)'; }
        } else {
            alert("Gagal memuat database & tidak ada data lokal (offline).");
        }
    }
}

function initDropdowns() {
    // 1. Reset HTML
    const svc = document.getElementById('service-dropdown');
    const sty = document.getElementById('stylist-dropdown');
    const prd = document.getElementById('product-dropdown');
    const sel = document.getElementById('seller-dropdown');
    const stk = document.getElementById('restock-sku');
    const abs = document.getElementById('absen-nama');
    
    // 2. Build Options
    let hSvc = '<option value="">-- Pilih Jasa --</option>';
    let hPrd = '<option value="">-- Pilih Produk --</option>';
    let hStk = '<option value="">-- Pilih Barang --</option>';
    let hSty = '<option value="">-- Pilih Kapster --</option>';
    let hAbs = '<option value="">-- Pilih Nama --</option>';

    if(masterData.produk) {
        masterData.produk.forEach(p => {
            const pr = parseInt(String(p.Harga_Jual).replace(/[^0-9]/g, '')) || 0;
            if(p.Tipe === 'SERVICE') {
                hSvc += `<option value="${p.SKU}" data-price="${pr}">${p.Nama_Item} - ${fmtRp(pr)}</option>`;
            } else { 
                hPrd += `<option value="${p.SKU}" data-price="${pr}">${p.Nama_Item} - ${fmtRp(pr)}</option>`; 
                hStk += `<option value="${p.SKU}">${p.Nama_Item}</option>`; 
            }
        });
    }

    if(masterData.karyawan) {
        masterData.karyawan.filter(k => k.Status === 'ACTIVE').forEach(k => { 
            hSty += `<option value="${k.ID}">${k.Nama}</option>`; 
            const s = k.Shift || 'PAGI';
            hAbs += `<option value="${k.Nama}" data-shift="${s}">${k.Nama}</option>`;
        });
    }
    
    // 3. Populate
    if(svc) svc.innerHTML = hSvc;
    if(sty) sty.innerHTML = hSty;
    if(prd) prd.innerHTML = hPrd;
    if(sel) sel.innerHTML = hSty; // Seller = Karyawan
    if(stk) stk.innerHTML = hStk;
    if(abs) abs.innerHTML = hAbs;
}

// --- NAVIGATION ---
function switchMenu(menuId) {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active')); 
    const menus = document.querySelectorAll('.menu-item');
    menus.forEach(m => { if(m.getAttribute('onclick').includes(menuId)) m.classList.add('active'); });

    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden')); 
    document.getElementById('view-' + menuId).classList.remove('hidden');
    
    if(menuId !== 'absen') stopCamera();
    
    if(menuId !== 'ops') document.getElementById('journal-history-tbody').innerHTML = '';
    if(menuId === 'stock') renderStockView(); 
    if(menuId === 'rekap') loadMonthlyRecap(); 
    if(menuId === 'ops') initJournalView(); 
    if(menuId === 'pos') { renderOrderTabs(); checkBlankState(); }
    if(menuId === 'kapster') {
        const now = new Date(); 
        if(!document.getElementById('kapster-start-date').value) document.getElementById('kapster-start-date').value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        if(!document.getElementById('kapster-end-date').value) document.getElementById('kapster-end-date').value = getLocalDate();
        loadKapsterReport();
    }
}

// --- POS SYSTEM ---
function addNewOrderTab() { 
    if(activeOrderId) saveCurrentState(); 
    
    const currentCount = orderCounter++;
    const LOCAL_KEY = 'guts_last_counter_' + getLocalDate();
    localStorage.setItem(LOCAL_KEY, orderCounter);
    
    const newId = Date.now(); 
    const now = new Date(); 
    
    orders.push({
        id: newId, 
        displayLabel: "Order " + currentCount, 
        cart: [], 
        custName: "", wa: "", type: "WALK-IN", 
        timeIn: now.getHours().toString().padStart(2,'0') + ":" + now.getMinutes().toString().padStart(2,'0'), 
        note: "",
        // Inisialisasi Dropdown Kosong untuk Order Baru
        savedStylist: "", 
        savedService: "", 
        savedSeller: "", 
        savedProduct: ""
    }); 
    
    activeOrderId = newId; 
    saveOrdersToLocal(); renderOrderTabs(); checkBlankState(); 
    
    // Load halaman kosong ini ke layar
    loadActiveOrder(); 
}

function saveCurrentState() { 
    if(!activeOrderId) return; 
    const o = orders.find(x => x.id === activeOrderId); 
    if(o){ 
        // Simpan Input Teks
        o.custName = document.getElementById('cust-name').value; 
        o.wa = document.getElementById('cust-wa').value; 
        o.type = document.getElementById('visit-type').value; 
        o.note = document.getElementById('order-note').value; 
        
        o.savedStylist = document.getElementById('stylist-dropdown').value;
        o.savedService = document.getElementById('service-dropdown').value;
        o.savedSeller  = document.getElementById('seller-dropdown').value;
        o.savedProduct = document.getElementById('product-dropdown').value;
    } 
    saveOrdersToLocal(); renderOrderTabs(); 
}

function switchOrderTab(id) { saveCurrentState(); activeOrderId = id; renderOrderTabs(); loadActiveOrder(); }

function loadActiveOrder() { 
    const o = orders.find(x => x.id === activeOrderId); 
    if(!o) return; 
    
    // 1. Load Input Teks
    document.getElementById('cust-name').value = o.custName || ""; 
    document.getElementById('cust-wa').value = o.wa || ""; 
    document.getElementById('visit-type').value = o.type || "WALK-IN"; 
    document.getElementById('order-note').value = o.note || ""; 
    
    document.getElementById('stylist-dropdown').value = o.savedStylist || "";
    document.getElementById('service-dropdown').value = o.savedService || "";
    document.getElementById('seller-dropdown').value  = o.savedSeller || "";
    document.getElementById('product-dropdown').value = o.savedProduct || "";

    renderCart(); 
}

function closeOrderTab(id, e) { 
    e.stopPropagation(); 
    if(confirm("Tutup Tab ini? Data hilang.")) { 
        orders = orders.filter(x => x.id !== id); 
        activeOrderId = orders.length ? orders[0].id : null; 
        saveOrdersToLocal(); renderOrderTabs(); 
        if(activeOrderId) loadActiveOrder(); 
        checkBlankState(); 
    } 
}

function renderOrderTabs() { 
    const c = document.getElementById('order-tabs-list'); 
    let html = ''; 
    orders.forEach(o => { 
        html += `<div class="order-tab ${o.id === activeOrderId ? 'active' : ''}" onclick="switchOrderTab(${o.id})"><span>${o.displayLabel}</span><span class="close-tab" onclick="closeOrderTab(${o.id},event)">x</span></div>`; 
    }); 
    c.innerHTML = html; 
}

function saveOrdersToLocal() { localStorage.setItem('guts_orders', JSON.stringify(orders)); localStorage.setItem('guts_order_counter', orderCounter.toString()); }

function checkBlankState() { 
    const ws = document.getElementById('pos-workspace');
    const bl = document.getElementById('pos-blank-state'); 
    if(orders.length === 0){ 
        // Mode Kosong (Tidak ada tab)
        ws.classList.add('hidden'); 
        bl.classList.remove('hidden'); 
        loadDailyDashboard(); 
        renderCart(); 
    } 
    else { 
        // Mode Ada Order
        ws.classList.remove('hidden'); 
        bl.classList.add('hidden'); 
    } 
}

function addItemFromService() { 
    const elService = document.getElementById('service-dropdown');
    const elStylist = document.getElementById('stylist-dropdown');

    const sku = elService.value;
    const sty = elStylist.value; 
    
    if(!sku || !sty) return alert("Pilih Jasa & Kapster"); 
    
    const opt = document.querySelector(`#service-dropdown option[value="${sku}"]`);
    const k = masterData.karyawan.find(x => x.ID === sty); 
    
    addToCart({
        SKU: sku, 
        Nama_Item: opt.text.split(' - ')[0], 
        Harga_Jual: opt.getAttribute('data-price'), 
        Tipe: 'SERVICE'
    }, k.ID, k.Nama); 

    elService.value = "";
    elStylist.value = ""; 
}

function addItemFromProduct() { 
    const elProduct = document.getElementById('product-dropdown');
    const elSeller = document.getElementById('seller-dropdown');

    const sku = elProduct.value;
    const sel = elSeller.value; 
    
    if(!sku) return alert("Pilih Produk"); 
    
    const p = masterData.produk.find(x => x.SKU === sku); 
    let sN = "-", sI = ""; 
    
    if(sel){ 
        const k = masterData.karyawan.find(x => x.ID === sel); 
        if(k){ sN = k.Nama; sI = k.ID; } 
    } 
    
    addToCart({
        SKU: p.SKU, 
        Nama_Item: p.Nama_Item, 
        Harga_Jual: p.Harga_Jual, 
        Harga_Dasar: p.Harga_Dasar, 
        Pemilik: p.Pemilik, 
        Tipe: 'GOODS'
    }, sI, sN); 

    elProduct.value = "";
    elSeller.value = "";
}

function addToCart(item, styId, styName) { 
    if(!activeOrderId) return alert("Buat Order Baru!"); 
    const o = orders.find(x => x.id === activeOrderId); 
    const exist = o.cart.find(c => c.sku === item.SKU && c.stylistId === styId); 
    if(exist) exist.qty++; 
    else o.cart.push({sku: item.SKU, name: item.Nama_Item, price: Number(item.Harga_Jual), hpp: Number(item.Harga_Dasar)||0, owner: item.Pemilik||"SENDIRI", qty: 1, type: item.Tipe, stylistId: styId, stylistName: styName, discMode: '0', discVal: 0}); 
    saveOrdersToLocal(); renderCart(); 
}

// --- FUNGSI RENDER CART YANG DIPERBAIKI ---
function renderCart() { 
    const tb = document.getElementById('cart-items');
    if(!activeOrderId) {
        tb.innerHTML = ''; // Hapus daftar item
        document.getElementById('val-gross').innerText = '0'; 
        document.getElementById('val-discount').innerText = '0'; 
        document.getElementById('val-total').innerText = '0'; 
        return;
    }
    const o = orders.find(x => x.id === activeOrderId);  
    let tG = 0, tD = 0, html = ''; 
    let pOpt = `<option value="0">0</option><option value="manual">Manual</option>`; 
    if (masterData && masterData.promo && masterData.promo.length > 0) {
        masterData.promo.forEach(p => {
            const isActive = String(p.Aktif).toUpperCase() === 'TRUE' || p.Aktif === true;
            if (isActive) {
                pOpt += `<option value="${p.Kode}">${p.Kode}</option>`;
            }
        });
    } 

    o.cart.forEach((it, i) => {
        let nDisc = 0; 
        if(it.discMode === 'manual') nDisc = it.discVal; 
        else if(it.discMode !== '0' && it.discMode !== 0) { 
            const p = masterData.promo.find(x => x.Kode === it.discMode); 
            if(p) nDisc = p.Tipe === 'PERSEN' ? it.price * parseFloat(p.Nilai) : parseFloat(p.Nilai); 
        } 
        tG += it.price * it.qty; tD += nDisc * it.qty; it.discPerItem = (nDisc / it.qty) || 0; 

        html += `
        <tr>
            <td style="padding:10px;"><b>${it.name}</b><br><small style="color:#aaa;">${it.stylistName}</small></td>
            <td style="vertical-align:top; padding-top:10px;">
                <div style="display:flex; align-items:center; gap:5px;">
                   <button onclick="updQty(${i},-1)" class="btn-xs">-</button> ${it.qty} <button onclick="updQty(${i},1)" class="btn-xs">+</button>
                </div>
            </td>
            <td style="vertical-align:top; padding-top:10px;">
                <select onchange="updDisc(${i},this.value)" style="width:100%; padding:5px; font-size:0.8em; background:#333; border:1px solid #555;">
                    ${pOpt.replace(`value="${it.discMode}"`, `value="${it.discMode}" selected`)}
                </select>
                ${it.discMode === 'manual' ? `<div style="font-size:0.7em; color:var(--accent); margin-top:2px;">Rp ${fmtRp(it.discVal)}</div>` : ''}
            </td>
            <td style="text-align:right; vertical-align:top; padding-top:10px; font-weight:bold;">
                ${fmtRp((it.price * it.qty) - (nDisc * it.qty))}
                <div onclick="updQty(${i},-999)" style="color:var(--red); font-size:0.7em; cursor:pointer; margin-top:5px;">Hapus</div>
            </td>
        </tr>`;
    }); 
    
    tb.innerHTML = html; 
    document.getElementById('val-gross').innerText = fmtRp(tG); 
    document.getElementById('val-discount').innerText = fmtRp(tD); 
    document.getElementById('val-total').innerText = fmtRp(tG - tD); 
}

function updQty(i, v) { const o = orders.find(x => x.id === activeOrderId); o.cart[i].qty += v; if(o.cart[i].qty <= 0) o.cart.splice(i, 1); saveOrdersToLocal(); renderCart(); }
function updDisc(i, v) { const o = orders.find(x => x.id === activeOrderId); if(v === 'manual'){ const x = prompt("Disc Rp:"); if(x) o.cart[i].discVal = cleanNum(x); } o.cart[i].discMode = v; saveOrdersToLocal(); renderCart(); }

async function checkout(m) {
    const o = orders.find(x => x.id === activeOrderId); if(!o || !o.cart.length) return alert("Cart Kosong");
    const t = cleanNum(document.getElementById('val-total').innerText), d = cleanNum(document.getElementById('val-discount').innerText);
    let cIn = 0, tips = 0, change = 0;
    
    if(m === 'CASH'){ 
        const p = prompt(`Tagihan: ${fmtRp(t)}\n\nMasukkan Uang Tunai:`); if(p === null) return; 
        cIn = cleanNum(p); if(cIn < t) return alert(`Kurang: ${fmtRp(t - cIn)}`); 
        let rawChange = cIn - t; 
        const ti = prompt(`Kembalian: ${fmtRp(rawChange)}\n\nMasukkan TIPS (0 jika tidak ada):`, "0"); if(ti === null) return; 
        tips = cleanNum(ti); change = rawChange - tips; if(change < 0) return alert("Tips > Kembalian");
    } else { 
        const p = prompt(`Total Tagihan: ${fmtRp(t)}\n\nMasukkan Total yang dibayar via QRIS:`); if(p === null) return; 
        cIn = cleanNum(p); if(cIn < t) return alert("Kurang!"); 
        tips = cIn - t; change = 0; if(tips > 0){ if(!confirm(`Kelebihan ${fmtRp(tips)} dianggap TIPS?`)) return; }
    }
    
    setStatus('saving'); document.getElementById('loading-overlay').classList.remove('hidden');
    try {
        const payloadData = { header: {branchId: getSelectedBranch(), tanggal: getLocalDate(), jamIn: o.timeIn, jamOut: new Date().getHours().toString().padStart(2,'0') + ":" + new Date().getMinutes().toString().padStart(2,'0'), customer: o.custName || "Guest", wa: o.wa, visitType: o.type, total: t + d, grandTotal: t, discount: d, tips: tips, method: m, cashIn: cIn, change: change, note: o.note}, items: o.cart };
        const req = await fetch(API_URL, {method: "POST", body: JSON.stringify({action: "save_transaksi", payload: payloadData})}); 
        const res = await req.json();
        
        if(res.status) { 
            setStatus('saved'); payloadData.header.id = res.data.newID; 
            if(confirm("Transaksi berhasil! Cetak Struk?")) printReceipt(payloadData); else alert("Data disimpan!");
            orders = orders.filter(x => x.id !== activeOrderId); 
            activeOrderId = orders.length ? orders[0].id : null; 
            saveOrdersToLocal(); renderOrderTabs(); checkBlankState(); loadMaster(); 
            if(activeOrderId) loadActiveOrder();
        } else { 
            setStatus('error'); alert(res.message); 
        }
    } catch(e){ setStatus('error'); alert(e); } 
    document.getElementById('loading-overlay').classList.add('hidden');
}

// --- DASHBOARD & REKAP ---
async function loadDailyDashboard() {
    const tb = document.getElementById('daily-dashboard-tbody');
    const CACHE_KEY = 'guts_daily_cache_' + getSelectedBranch(); 
    if(tb.innerHTML.trim() === "") tb.innerHTML = '<tr><td colspan="5" align="center">Loading...</td></tr>';
    document.getElementById('blank-date-display').innerText = formatDateIndo(getLocalDate());

    try {
        const antiCacheURL = API_URL + "?t=" + new Date().getTime();
        const req = await fetch(antiCacheURL, {
            method: "POST",
            body: JSON.stringify({ action: "get_daily_detail", payload: { branch: getSelectedBranch(), date: getLocalDate() } })
        });
        const res = await req.json();
        if (res.status) {
            renderDailyTable(res.data);
            updateDailyStats(res.data); 

            localStorage.setItem(CACHE_KEY, JSON.stringify(res.data));
        } else tb.innerHTML = '<tr><td colspan="5" align="center">Belum ada transaksi</td></tr>';
    } catch (e) {
        const cachedData = localStorage.getItem(CACHE_KEY);
        if (cachedData) {
            renderDailyTable(JSON.parse(cachedData));
            updateDailyStats(data);
            tb.innerHTML += `<tr><td colspan="5" align="center" style="background:#330000; color:#ffaaaa;">⚠️ OFFLINE MODE</td></tr>`;
        } else tb.innerHTML = `<tr><td colspan="5" align="center">Gagal Koneksi & No Cache</td></tr>`;
    }
}

function updateDailyStats(dataList) {
    if (!dataList) return;

    // 1. Filter Data Bersih
    const validTrx = dataList.filter(x => x.status !== 'VOIDED' && !x.id.startsWith('VOID'));

    // 2. Hitung Customer Real
    const totalCust = validTrx.length;

    // 3. Hitung Omzet Real (Net Sales)
    const totalOmzet = validTrx.reduce((acc, curr) => acc + (parseFloat(curr.net) || 0), 0);

    const elCust = document.getElementById('val-total-cust-today');
    const elOmzet = document.getElementById('val-total-omzet-today');

    if (elCust) elCust.innerText = totalCust;
    if (elOmzet) elOmzet.innerText = fmtRp(totalOmzet);

    console.log(`Stats Updated: ${totalCust} Cust, ${fmtRp(totalOmzet)} Omzet (Clean from Void)`);
}

function renderDailyTable(dataList) {
    const tb = document.getElementById('daily-dashboard-tbody');
    if(!dataList || !dataList.length) { tb.innerHTML = '<tr><td colspan="5" align="center">Belum ada transaksi</td></tr>'; return; }
    
    let html = '';
    dataList.forEach(r => {
        // Cek Status Void
        const isVoid = r.status === 'VOIDED';
        const isReversal = r.id.startsWith('VOID');

        // Style: Jika Void, warna merah & dicoret
        const rowStyle = isVoid ? "text-decoration: line-through; color: #777;" : 
                         (isReversal ? "color: #777; font-style: italic;" : "cursor:pointer");

        let summ = "?", k = "-";
        try { const p = JSON.parse(r.itemsRaw); summ = p[0].name + (p.length > 1 ? "..." : ""); k = p[0].stylistName; } catch(e){}
        const fullData = encodeURIComponent(JSON.stringify(r));
        
        let jamTampil = String(r.jamOut).replace('.', ':');

        html += `<tr onclick="${isVoid || isReversal ? '' : `showTrxDetail('${fullData}')`}" style="${rowStyle}">
                    <td>${jamTampil}</td> 
                    <td>${k}</td>
                    <td><b>${summ}</b> ${isVoid ? '(BATAL)' : ''} ${isReversal ? '(REVERSAL)' : ''}</td>
                    <td>${r.method}</td>
                    <td align="right">${fmtRp(r.net)}</td>
                 </tr>`;
    });
    tb.innerHTML = html;
}

function showTrxDetail(encodedData) {
    const r = JSON.parse(decodeURIComponent(encodedData));
    document.getElementById('trx-detail-modal').classList.remove('hidden'); 
    document.getElementById('modal-trx-id').innerText = r.id;
    
    // CEK STATUS: Apakah ini transaksi BATAL atau HASIL BATAL?
    const isVoided = (r.status === 'VOIDED');      // Transaksi asli yang sudah dibatalkan
    const isVoidResult = r.id.includes('VOID');    // Transaksi minus (hasil pembatalan)
    
    const b = document.getElementById('modal-trx-body'); 
    let html = ''; 
    
    // Render Items
    let items = []; 
    try { items = JSON.parse(r.itemsRaw); items.forEach(i => { html += `<div class="detail-item"><div><b>${i.name}</b> x${i.qty}<br><small>${i.stylistName}</small></div><div align="right">${fmtRp(i.price * i.qty)}</div></div>`; }); } catch(e){}
    
    // Render Total
    html += `<div style="margin-top:15px; border-top:1px solid #444; padding-top:10px;">
                <div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>${fmtRp(r.gross)}</span></div>
                <div style="display:flex; justify-content:space-between; color:var(--red);"><span>Diskon:</span><span>${fmtRp(r.disc)}</span></div>
                <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.1em; margin-top:5px;"><span>GRAND TOTAL:</span><span>${fmtRp(r.net)}</span></div>
             </div>`;
    
    // LOGIKA TOMBOL (PENTING)
    if (isVoided) {
        // Jika sudah divoid, tampilkan status merah, matikan semua tombol
        html += `<div style="margin-top:20px; background:rgba(231, 76, 60, 0.2); border:1px solid var(--red); color:var(--red); text-align:center; padding:10px; font-weight:bold; border-radius:4px;">
                    Transaksi sudah dibatalkan. (Void)
                 </div>`;
    } else if (isVoidResult) {
        // Jika ini adalah struk minus (bukti void), matikan tombol juga
        html += `<div style="margin-top:20px; background:#333; color:#aaa; text-align:center; padding:10px; border-radius:4px; font-style:italic;">
                    Pembatalan Transaksi (Reversal)
                 </div>`;
    } else {
        // Jika Transaksi Normal & Aktif -> Tampilkan Tombol
        html += `<button onclick="reprintOldTrx('${encodedData}')" style="width:100%; background:var(--accent); color:black; border:none; padding:10px; margin-top:15px; font-weight:bold; border-radius:4px; cursor:pointer;">
                    <i class="fas fa-print"></i> Cetak Ulang Receipt
                 </button>`;
                 
        html += `<button onclick="requestVoid('${r.id}', ${r.gross}, ${r.net}, ${r.disc}, ${r.tips}, '${r.method}', '${r.tanggal}')" style="width:100%; background:var(--red); color:white; border:none; padding:10px; margin-top:5px; font-weight:bold; border-radius:4px; cursor:pointer;">
                    <i class="fas fa-ban"></i> Void / Batalkan Transaksi
                 </button>`;
    }

    b.innerHTML = html;
}

function closeModal(){ document.getElementById('trx-detail-modal').classList.add('hidden'); }

// Fungsi untuk memproses data lama agar bisa masuk ke fungsi printReceipt yang sudah ada
function reprintOldTrx(encodedData) {
    const r = JSON.parse(decodeURIComponent(encodedData));
    
    // Mapping data dari database agar sesuai format struk
    const trxData = {
        header: {
            branchId: r.branchId,
            tanggal: r.tanggal, // Format YYYY-MM-DD
            jamOut: r.jamOut,
            id: r.id,
            total: r.gross,
            grandTotal: r.net,
            discount: r.disc,
            tips: r.tips,
            method: r.method,
            cashIn: r.cashIn,
            change: r.change,
            note: "Cetak Ulang (Copy)" // Penanda di struk
        },
        items: []
    };

    try {
        trxData.items = JSON.parse(r.itemsRaw);
    } catch (e) {
        alert("Data item rusak, tidak bisa dicetak.");
        return;
    }

    printReceipt(trxData);
}

// --- VOID & PRINT ---
function requestVoid(id, gross, net, disc, tips, method, tanggal) {
    voidDataTemp = { oldId: id, gross, net, disc, tips, method, tanggal, branch: getSelectedBranch() };
    document.getElementById('trx-detail-modal').classList.add('hidden');
    document.getElementById('modal-void-auth').classList.remove('hidden'); 
    document.getElementById('void-admin-pass').value = '';
}
async function executeVoid() {
    const pass = document.getElementById('void-admin-pass').value; if(!pass) return alert("Masukkan password!");
    setStatus('saving'); document.getElementById('loading-overlay').classList.remove('hidden');
    try {
        const req = await fetch(API_URL, {method: "POST", body: JSON.stringify({action: "void_transaksi", payload: { ...voidDataTemp, adminPass: pass }})});
        const res = await req.json();
        if(res.status) { setStatus('saved'); alert("VOID BERHASIL"); location.reload(); } else { setStatus('error'); alert("Gagal: " + res.message); }
    } catch(e) { setStatus('error'); alert("Error: " + e); } 
    document.getElementById('loading-overlay').classList.add('hidden');
}

function printReceipt(trxData) {
    const branch = getSelectedBranch(); 
    let branchName = "", addr1 = "", addr2 = "";
    
    // 1. Tentukan Header Cabang
    if (branch === 'Leuwigajah' || (branch === 'HO' && trxData.header.branchId === 'Leuwigajah')) { 
        branchName = "CABANG LEUWIGAJAH"; 
        addr1 = "Jl. Kerkof No.23, Leuwigajah"; 
        addr2 = "Kec. Cimahi Selatan, Kota Cimahi, Jawa Barat 40532"; 
    } else { 
        branchName = "CABANG CIMAHI"; 
        addr1 = "Jl. Jend. H. Amir Machmud No.654, Cimahi"; 
        addr2 = "Kec. Cimahi Tengah, Kota Cimahi, Jawa Barat 40535"; 
    }
    
    const fullDate = formatDateSimple(trxData.header.tanggal) + " " + trxData.header.jamOut;
    // Ambil nama kapster unik
    const kapsterList = [...new Set(trxData.items.map(i => i.stylistName))].join(", ");

    // 2. Render Item Belanjaan ke HTML
    let itemsHtml = '';
    trxData.items.forEach(item => { 
        itemsHtml += `
        <div style="margin-bottom: 5px;">
            <div style="font-weight:bold;">${item.name}</div>
            <div style="display: flex; justify-content: space-between;">
                <span>${item.qty} x ${fmtRp(item.price)}</span>
                <span>${fmtRp(item.price * item.qty)}</span>
            </div>
        </div>`; 
    });

    // 3. Susun Struk Baru (Menggantikan HTML lama yang dihapus)
    const strukHTML = `
        <div style="width: 58mm; font-size: 9pt; line-height: 1.3; color:black;">
            
            <div style="text-align: center; margin-bottom: 5px;">
                <b style="font-size: 11pt; display:block;">GUTS BARBER AND SHOP</b>
                <span style="display:block; font-weight:bold; margin-top:2px;">${branchName}</span>
                <span style="display:block; font-size: 6pt; margin-top:2px; white-space:nowrap; overflow:hidden;">${addr1}</span>
                <span style="display:block; font-size: 6pt; white-space:nowrap; overflow:hidden;">${addr2}</span>
            </div>

            <div style="border-top: 1px dashed black; margin: 5px 0;"></div>

            <table style="width: 100%; font-size: 9pt; border-collapse: collapse;">
                <tr><td style="width: 55px; vertical-align:top;">Kapster</td><td style="width: 10px; vertical-align:top;">:</td><td style="vertical-align:top;">${kapsterList}</td></tr>
                <tr><td style="vertical-align:top;">Waktu</td><td style="vertical-align:top;">:</td><td style="vertical-align:top;">${fullDate}</td></tr>
                <tr><td style="vertical-align:top;">ID Trx</td><td style="vertical-align:top;">:</td><td style="vertical-align:top; word-break: break-all;">${trxData.header.id || "TRX-NEW"}</td></tr>
            </table>

            <div style="border-top: 1px dashed black; margin: 5px 0;"></div>

            <div style="text-align: left;">
                ${itemsHtml}
            </div>

            <div style="border-top: 1px dashed black; margin: 5px 0;"></div>

            <div style="display: flex; justify-content: space-between;"><span>Subtotal:</span><span>${fmtRp(trxData.header.total)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Diskon:</span><span>${fmtRp(trxData.header.discount)}</span></div>

            <div style="border-top: 1px solid black; margin: 5px 0;"></div>

            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 11pt; margin: 3px 0;">
                <span>GRAND TOTAL:</span><span>${fmtRp(trxData.header.grandTotal)}</span>
            </div>
            
            <div style="display: flex; justify-content: space-between;"><span>Bayar (${trxData.header.method || "CASH"}):</span><span>${fmtRp(trxData.header.cashIn)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Tips:</span><span>${fmtRp(trxData.header.tips || 0)}</span></div>
            <div style="display: flex; justify-content: space-between;"><span>Kembali:</span><span>${fmtRp(trxData.header.change)}</span></div>

            <div style="border-top: 1px solid black; margin: 5px 0;"></div>

            <div style="text-align: center; font-size: 8pt;">
                Follow IG <b style="font-size:8pt;">@gutsbarberandshop</b><br>
                Booking via WhatsApp: <b style="font-size:8pt;">089666949289</b><br><br>
                Terima Kasih atas kunjungan anda.
            </div>
        </div>
    `;

    // 4. Inject ke Container Print
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = strukHTML; // <--- Ini yang menggantikan elemen lama
    printArea.style.display = 'block'; 
    
    setTimeout(() => { 
        window.print(); 
        setTimeout(() => { printArea.style.display = 'none'; }, 1000);
    }, 500);
}

// --- JURNAL, STOCK, KAPSTER ---
function initJournalView() { 
    document.getElementById('journal-date').value = getLocalDate(); journalItems = []; renderJournalRows(); 
    loadJournalHistory(); 
}
function addJournalRow() { journalItems.push({ket: "", akun: "", debit: 0, kredit: 0}); renderJournalRows(); }
function renderJournalRows() {
    const tb = document.getElementById('journal-input-rows'); 
    let html = '';

    journalItems.forEach((it, i) => {
        html += `
        <tr>
            <td>
                <input type="text" value="${it.ket}" placeholder="Deskripsi" onchange="journalItems[${i}].ket=this.value">
            </td>
            
            <td style="overflow:visible;"> 
                <div class="search-wrapper">
                    <input type="text" class="input-akun" value="${it.akun}" placeholder="Pilih kode dan nama akun" 
                           onkeyup="searchAkun(this,${i})" onfocus="searchAkun(this,${i})" autocomplete="off">
                    <div id="res-${i}" class="search-results hidden"></div>
                </div>
            </td>
            
            <td>
                <input type="text" value="${it.debit > 0 ? fmtRpNoRp(it.debit) : ''}" 
                       placeholder="0"
                       onkeyup="formatInputRupiah(this)"
                       onchange="journalItems[${i}].debit=cleanNum(this.value); calcJ()">
            </td>
            
            <td>
                <input type="text" value="${it.kredit > 0 ? fmtRpNoRp(it.kredit) : ''}" 
                       placeholder="0"
                       onkeyup="formatInputRupiah(this)"
                       onchange="journalItems[${i}].kredit=cleanNum(this.value); calcJ()">
            </td>
            
            <td>
                <button onclick="journalItems.splice(${i},1);renderJournalRows()" class="btn-xs" style="background:var(--red);">x</button>
            </td>
        </tr>`;
    }); 
    
    tb.innerHTML = html; 
    calcJ();
}

// Helper kecil untuk menampilkan angka di input saat render ulang (tanpa Rp)
function fmtRpNoRp(n) { return new Intl.NumberFormat('id-ID').format(n); }

function searchAkun(el, i) {
    const q = el.value.toLowerCase(); 
    const d = document.getElementById(`res-${i}`); 
    d.innerHTML = '';
    
    // Filter dari Master Data COA
    // Menampilkan maksimal 10 hasil agar tidak terlalu panjang
    const m = masterData.coa.filter(c => c.Kode_Akun.includes(q) || c.Nama_Akun.toLowerCase().includes(q));
    
    if (m.length) { 
        d.classList.remove('hidden'); 
        m.forEach(c => { 
            const x = document.createElement('div'); 
            x.className = 'search-item'; 
            // Tampilan: Kode (Tebal) - Nama Akun
            x.innerHTML = `<span style="font-weight:bold; color:var(--accent)">${c.Kode_Akun}</span> - ${c.Nama_Akun}`; 
            
            // Saat dipilih
            x.onclick = () => { 
                journalItems[i].akun = `${c.Kode_Akun} - ${c.Nama_Akun}`; 
                renderJournalRows(); // Render ulang agar input terisi dan dropdown hilang
            }; 
            d.appendChild(x); 
        }); 
    } else { 
        // Jika tidak ada hasil tapi user mengetik, beri info
        if(q.length > 0) {
            d.classList.remove('hidden');
            d.innerHTML = '<div class="search-item" style="color:#777; cursor:default;">Tidak ditemukan</div>';
        } else {
            d.classList.add('hidden'); 
        }
    }
}

// Event Listener Global: Klik di luar untuk menutup dropdown
document.addEventListener('click', function(e) { 
    if (!e.target.classList.contains('input-akun')) {
        document.querySelectorAll('.search-results').forEach(el => el.classList.add('hidden')); 
    }
});

function calcJ() { let d = 0, k = 0; journalItems.forEach(i => {d += i.debit; k += i.kredit}); document.getElementById('total-debit').innerText = fmtRp(d); document.getElementById('total-kredit').innerText = fmtRp(k); document.getElementById('balance-status').innerText = d === k && d >= 0 ? "Balance" : "Tidak Balance"; }

async function saveComplexJournal() {
    const cat = document.getElementById('journal-category').value, date = document.getElementById('journal-date').value;
    let items = []; for(let i of journalItems){ const c = i.akun.split(' - ')[0]; const n = masterData.coa.find(x => String(x.Kode_Akun) === c); if(!n) return alert("Akun salah"); items.push({category: cat, debit: i.debit, kredit: i.kredit, akun: c, namaAkun: n.Nama_Akun, ket: i.ket}); }
    if(document.getElementById('balance-status').innerText !== "Balance") return alert("Tidak Balance!");
    setStatus('saving'); document.getElementById('loading-overlay').classList.remove('hidden');
    try{ await fetch(API_URL, {method: "POST", body: JSON.stringify({action: "save_general_journal", payload: {branch: getSelectedBranch(), date: date, category: cat, items: items}})}); setStatus('saved'); alert("Jurnal berhasil disimpan!"); journalItems = []; renderJournalRows(); loadJournalHistory(); } catch(e){ setStatus('error'); alert(e); } 
    document.getElementById('loading-overlay').classList.add('hidden');
}

async function loadJournalHistory() {
    const tb = document.getElementById('journal-history-tbody'); 
    tb.innerHTML = '<tr><td colspan="6" align="center"><i class="fas fa-spinner fa-spin"></i> Loading Data...</td></tr>';
    
    const startDate = document.getElementById('history-start-date').value;
    const endDate = document.getElementById('history-end-date').value;

    try { 
        const req = await fetch(API_URL, {
            method: "POST", 
            body: JSON.stringify({
                action: "get_journal_history", 
                payload: { 
                    branch: getSelectedBranch(), 
                    category: document.getElementById('journal-category').value,
                    startDate: startDate, // Kirim Tanggal Awal
                    endDate: endDate      // Kirim Tanggal Akhir
                }
            })
        }); 
        
        const res = await req.json(); 
        let html = ''; 
        let lastRef = ''; 

        if(res.data.length){ 
            res.data.forEach(r => { 
                let rowClass = "";
                let spacer = "";
                
                if (r.ref !== lastRef) {
                    if(lastRef !== '') {
                        spacer = `<tr style="height:15px; border:none;"><td colspan="6" style="border:none;"></td></tr>`;
                    }
                    rowClass = "journal-group-start"; 
                    lastRef = r.ref;
                }

                html += spacer + `
                <tr class="${rowClass}">
                    <td>${formatDateSimple(r.date)}</td>
                    <td style="font-family:monospace; color:#aaa;">${r.ref}</td>
                    <td><b>${r.akun}</b> - ${r.namaAkun}</td>
                    <td style="text-align:left; color:${r.debit>0?'var(--green)':'#555'}">${r.debit>0?fmtRp(r.debit):'-'}</td>
                    <td style="text-align:left; color:${r.debit>0?'#555':'var(--red)'}">${r.kredit>0?fmtRp(r.kredit):'-'}</td>
                    <td style="font-size:0.9em;">${r.ket}</td>
                </tr>`; 
            }); 
            tb.innerHTML = html; 
        } else { 
            tb.innerHTML = '<tr><td colspan="6" align="center" style="padding:20px;">Tidak ada data pada periode ini.</td></tr>'; 
        } 
    } catch (e) { 
        tb.innerHTML = `<tr><td colspan="6">Error: ${e}</td></tr>`; 
    }
}

async function loadMonthlyRecap() {
    const d = document.getElementById('rekap-monthly-tbody'); d.innerHTML = '<tr><td colspan="7">Loading...</td></tr>'; 
    try { const req = await fetch(API_URL, { method: "POST", body: JSON.stringify({action: "get_monthly_rekap", payload: {branch: getSelectedBranch(), date: getLocalDate()} }) }); const res = await req.json(); 
        document.getElementById('val-start-petty').innerText = fmtRp(res.data.startBalance); document.getElementById('val-refill').innerText = fmtRp(res.data.refillNeeded); document.getElementById('val-curr-petty').innerText = fmtRp(res.data.currentBalance);
        let html = ''; if(res.data.rekap.length){ res.data.rekap.forEach(r => { html += `<tr><td>${r.date}</td><td style="color:var(--green)">${fmtRp(r.cashIn)}</td><td style="color:#3498db">${fmtRp(r.qrisIn)}</td><td style="color:var(--red)">${fmtRp(r.pettyUsage)}</td><td style="font-weight:bold">${fmtRp(r.saldoCash)}</td><td>${r.cust}</td><td>${r.promo}</td></tr>`; }); d.innerHTML = html; } else d.innerHTML = '<tr><td colspan="7" align="center">Data Kosong</td></tr>';
    } catch (e) { d.innerHTML = `<tr><td colspan="7">${e}</td></tr>`; }
}

function renderStockView() {
    const tb = document.getElementById('stock-tbody'); let html = ''; const br = getSelectedBranch();
    masterData.produk.forEach(p => { if(p.Tipe !== 'SERVICE'){ let sDisp = ""; if(br === 'Cimahi') sDisp = cleanNum(p.Stok_Cimahi); else if(br === 'Leuwigajah') sDisp = cleanNum(p.Stok_Leuwigajah); else sDisp = `C: ${cleanNum(p.Stok_Cimahi)} | L: ${cleanNum(p.Stok_Leuwigajah)}`; html += `<tr><td>${p.SKU}</td><td>${p.Nama_Item}</td><td>${p.Kategori}</td><td>${sDisp}</td></tr>`; } }); tb.innerHTML = html;
}
async function processRestock() { 
    const s = document.getElementById('restock-sku').value, q = document.getElementById('restock-qty').value; if(!s || !q) return; 
    setStatus('saving'); try{ await fetch(API_URL, {method: "POST", body: JSON.stringify({action: "restock_item", payload: {branch: getSelectedBranch(), sku: s, qty: q}})}); setStatus('saved'); alert("OK"); loadMaster().then(renderStockView); } catch(e){ setStatus('error'); } 
}

async function refreshStock() {
    const btn = document.querySelector('#view-stock .content-header button');
    const originalText = btn.innerHTML;
    
    // Ubah tombol jadi loading
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    btn.disabled = true;
    
    try {
        // 1. Tarik Data Terbaru dari Server
        await loadMaster(); 
        
        // 2. Render Ulang Tabel
        renderStockView(); 
        
        // Notifikasi visual (opsional)
        // btn.style.background = "var(--green)";
        // setTimeout(() => btn.style.background = "var(--accent)", 1000);
        
    } catch (e) {
        alert("Gagal refresh stok: " + e);
    }
    
    // Kembalikan tombol seperti semula
    btn.innerHTML = originalText;
    btn.disabled = false;
}

/* =================================================================
   UPDATE: KAPSTER REPORT (GRID VIEW PREMIUM - RANK SORTED)
   ================================================================= */
async function loadKapsterReport() {
    const container = document.getElementById('kapster-report-container'); 
    container.className = 'kapster-grid';

    container.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:50px; color:#aaa;">
            <i class="fas fa-magic fa-spin fa-3x" style="color:var(--accent); margin-bottom:20px;"></i>
            <h3 style="font-weight:300;">Memuat data performa...</h3>
        </div>`;
    
    try { 
        const req = await fetch(API_URL, { 
            method: "POST", 
            body: JSON.stringify({
                action: "get_kapster_report", 
                payload: {
                    branch: getSelectedBranch(), 
                    startDate: document.getElementById('kapster-start-date').value, 
                    endDate: document.getElementById('kapster-end-date').value
                }
            }) 
        }); 
        const res = await req.json(); 
        
        let html = ''; 
        if (res.data.length) { 
            
            // 1. SORTING (Tetap ranking kinerja tertinggi di kiri)
            res.data.sort((a, b) => (b.totalCust + b.prodQty) - (a.totalCust + a.prodQty));

            // 2. RENDER CARD
            res.data.forEach((k, index) => { 
                const rank = index + 1;
                
                let rankClass = (rank === 1) ? 'rank-1' : '';
                let profileDisplay = '';
                
                // 1. Siapkan Icon Cadangan (Default)
                const fallbackIcon = (rank === 1) 
                    ? `<i class="fas fa-crown fa-3x" style="color:#f1c40f; filter:drop-shadow(0 0 5px gold);"></i>`
                    : `<i class="fas fa-user-circle fa-3x" style="color:#555;"></i>`;

                // 2. Cek apakah ada link foto yang valid (diawali http)
                if (k.foto && k.foto.startsWith('http')) {
                    profileDisplay = `
                    <div class="profile-wrapper" style="width:60px; height:60px;">
                        <img src="${k.foto}" 
                             style="width:100%; height:100%; border-radius:50%; object-fit:cover; border:2px solid var(--accent); background:#333;"
                             onerror="this.style.display='none'; this.parentElement.innerHTML='${fallbackIcon.replace(/"/g, "'")}';">
                    </div>`;
                } else {
                    profileDisplay = `<div class="profile-wrapper" style="width:60px; height:60px; display:flex; align-items:center; justify-content:center;">${fallbackIcon}</div>`;
                }

                const jasaList = k.svcDet.length ? k.svcDet.map(x => `<div class="detail-row">${x}</div>`).join('') : '<div style="opacity:0.4; font-style:italic">- Kosong -</div>';
                const prodList = k.prodDet.length ? k.prodDet.map(x => `<div class="detail-row">${x}</div>`).join('') : '<div style="opacity:0.4; font-style:italic">- Kosong -</div>';

                let footerHtml = (k.lateFreq > 0) 
                    ? `<div style="color:#e74c3c;"><i class="fas fa-exclamation-circle"></i> Telat ${k.lateFreq}x (Total denda: ${fmtRp(k.lateFine)})</div>`
                    : `<div style="color:#2ecc71;"><i class="fas fa-check-circle"></i> Presensi Sempurna</div>`;

                html += `
                <div class="kapster-card ${rankClass}">
                    
                    <div class="card-header" style="height:90px;"> <div style="flex:1;">
                            <div class="k-name">${k.nama}</div>
                            <div class="k-badge" style="color:#aaa; font-style:italic; margin-top:5px;">
                                ${k.role.toUpperCase()}
                            </div>
                        </div>
                        
                        <div style="margin-left:10px;">
                            ${profileDisplay}
                        </div>
                    </div>

                    <div class="card-stats">
                        <div class="stat-block stat-blue">
                            <i class="fas fa-users sb-icon"></i>
                            <div class="sb-val">${k.totalCust}</div>
                            <div class="sb-label">Total Customer</div>
                        </div>
                        <div class="stat-block stat-yellow">
                            <i class="fas fa-box-open sb-icon"></i>
                            <div class="sb-val">${k.prodQty}</div>
                            <div class="sb-label">Products Sold</div>
                        </div>
                    </div>

                    <div class="booking-row">
                        <i class="fas fa-calendar-alt"></i>
                        <span class="booking-val">${k.bookingQty}x</span>
                        <span>Booked</span>
                    </div>

                    <div class="card-details">
                        <div class="detail-box">
                            <h5>Rincian Jasa</h5>
                            <div class="detail-scroll custom-scroll">${jasaList}</div>
                        </div>
                        <div class="detail-box">
                            <h5>Rincian Produk</h5>
                            <div class="detail-scroll custom-scroll">${prodList}</div>
                        </div>
                    </div>

                    <div class="card-footer">
                        ${footerHtml}
                    </div>

                </div>`; 
            }); 
            container.innerHTML = html; 
        } else {
            container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px; background:#1a1a1a; border-radius:12px; border:1px dashed #444; color:#666;">Data Kosong</div>';
        }
    } catch (e) { 
        container.innerHTML = `<div style="grid-column:1/-1; color:var(--red); text-align:center; padding:20px;">Error: ${e}</div>`; 
    }
}

// --- PRESENSI (CAM & SHIFT) - UPDATED ---
function autoSelectShift() {
    const selName = document.getElementById('absen-nama'); 
    const selShift = document.getElementById('absen-shift');
    if(!selName || !selShift) return;
    const userShift = selName.options[selName.selectedIndex].getAttribute('data-shift'); 
    selShift.value = userShift || "";
    if(currentUser && currentUser.Branch_Access === 'HO') { 
        selShift.disabled = false; selShift.style.cursor = 'pointer'; 
    } else { 
        selShift.disabled = true; selShift.style.cursor = 'not-allowed'; 
    }
}

let streamKamera = null; 
let fotoAbsenBase64 = null;

async function startCamera() {
    const video = document.getElementById('camera-feed');
    const placeholder = document.getElementById('camera-placeholder'); // <--- FIX: Ambil elemen placeholder
    
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert("Browser tidak support kamera!");
    
    try { 
        streamKamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }); 
        video.srcObject = streamKamera; 
        
        // UPDATE UI: Tampilkan Video, Sembunyikan Placeholder
        video.style.display = 'block';              // Munculkan Video
        placeholder.style.display = 'none';         // <--- FIX: Sembunyikan Tulisan "Kamera Mati"
        document.getElementById('camera-result').style.display = 'none'; // Sembunyikan hasil foto lama
        
        // UPDATE BUTTONS
        document.getElementById('btn-start-cam').style.display = 'none'; 
        document.getElementById('btn-snap').style.display = 'block'; 
        document.getElementById('btn-retake').style.display = 'none';
        document.getElementById('btn-submit-absen').style.display = 'none';

    } catch(e) { alert("Gagal akses kamera: " + e); }
}

function stopCamera() { 
    if(streamKamera) { 
        streamKamera.getTracks().forEach(track => track.stop()); 
        streamKamera = null; 
    }
}

function takeSnapshot() {
    const video = document.getElementById('camera-feed'); 
    const canvas = document.getElementById('camera-canvas'); 
    const img = document.getElementById('camera-result');
    const placeholder = document.getElementById('camera-placeholder');

    if(!streamKamera) return;
    
    // Ambil Gambar
    canvas.width = 640; canvas.height = 480; 
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    fotoAbsenBase64 = canvas.toDataURL('image/jpeg', 0.5); 
    
    // Tampilkan Hasil Foto
    img.src = fotoAbsenBase64; 
    img.style.display = 'block'; 
    video.style.display = 'none'; 
    placeholder.style.display = 'none'; // Pastikan placeholder tetap sembunyi
    
    // Update Button
    document.getElementById('btn-snap').style.display = 'none'; 
    document.getElementById('btn-retake').style.display = 'block'; 
    document.getElementById('btn-submit-absen').style.display = 'block'; 
    
    stopCamera(); // Matikan stream agar hemat baterai/RAM
}

function resetCamera() { 
    fotoAbsenBase64 = null; 
    // UI Reset ditangani oleh startCamera()
    startCamera(); 
}

async function submitAbsensi() {
    const nama = document.getElementById('absen-nama').value;
    const shift = document.getElementById('absen-shift').value;
    const btnSubmit = document.getElementById('btn-submit-absen');

    if(!nama || !fotoAbsenBase64) return alert("Data/Foto kurang!");
    
    // 1. Kunci Tombol & Nyalakan Loading
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Mengirim...";
    setStatus('saving'); 
    document.getElementById('loading-overlay').classList.remove('hidden'); // LOADING ON

    const payloadData = { 
        nama: nama, 
        shift: shift, 
        tanggal: getLocalDate(), 
        foto: fotoAbsenBase64 
    };
    
    try {
        // Coba kirim data
        const req = await fetch(API_URL, { 
            method: "POST", 
            body: JSON.stringify({ action: "save_absensi", payload: payloadData }) 
        });

        // Cek jika server error (HTML return)
        const contentType = req.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Server Error (Backend Crash). Cek Deployment!");
        }

        const res = await req.json();
        
        if(res.status) { 
            // SUKSES ONLINE
            handleAbsenSuccess(res.data.status, res.data);
        } else { 
            // DITOLAK SERVER (Misal: Duplikat)
            setStatus('saved'); 
            alert(res.message); 
            resetUiAbsen();
        }

    } catch(e) { 
        console.error("Absen Error:", e);

        // Jika Server Crash (Bukan Sinyal), Beri Tahu User
        if(e.message.includes("Server Error")) {
            alert("Terjadi Kesalahan di Server (Backend). Hubungi Admin.");
            resetUiAbsen();
        } else {
            // OFFLINE MODE (Sinyal Hilang)
            console.log("Offline Mode Active. Simpan data di local storage...");
            let queue = JSON.parse(localStorage.getItem('guts_absen_queue') || "[]");
            queue.push(payloadData);
            localStorage.setItem('guts_absen_queue', JSON.stringify(queue));
            
            setStatus('offline'); 
            alert("OFFLINE MODE: Data tersimpan di perangkat & akan dikirim nanti.");
            handleAbsenSuccess("PENDING (OFFLINE)", null);
        }

    } finally {
        // --- BAGIAN INI PASTI JALAN (SUKSES/GAGAL/ERROR) ---
        // 1. Matikan Loading Overlay
        document.getElementById('loading-overlay').classList.add('hidden'); 
        
        // 2. Kembalikan Tombol (Jaga-jaga jika UI tidak reset)
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fas fa-paper-plane"></i> KIRIM PRESENSI';
    }
}

// UPDATE: Menambahkan parameter 'data' (opsional) untuk menangani detail denda
function handleAbsenSuccess(statusMsg, data = null) {
    setStatus('saved');
    
    let pesan = `Presensi Berhasil!\nStatus: ${statusMsg}`;
    
    // Hanya tampilkan detail denda JIKA data tersedia (Mode Online)
    // Jika Offline (data == null), bagian ini dilewati agar tidak error
    if (data && data.denda > 0) {
        pesan += `\n\nTerlambat: ${data.late} Menit`;
        pesan += `\nDenda: Rp ${fmtRp(data.denda)}`;
    }
    
    alert(pesan);
    resetUiAbsen();
    switchMenu('pos');
}

function resetUiAbsen() {
    document.getElementById('absen-nama').value = ""; 
    document.getElementById('camera-result').style.display = 'none';
    document.getElementById('camera-placeholder').style.display = 'flex';
    document.getElementById('btn-start-cam').style.display = 'block';
    document.getElementById('btn-retake').style.display = 'none';
    document.getElementById('btn-submit-absen').style.display = 'none';
    
    const btn = document.getElementById('btn-submit-absen');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> KIRIM PRESENSI';
}

async function syncOrderCounter() {
    const LOCAL_KEY = 'guts_last_counter_' + getLocalDate(); 
    
    try {
        // 1. Coba Tanya Server (Mode Online)
        const req = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "get_today_counter",
                payload: { 
                    branch: getSelectedBranch(), 
                    date: getLocalDate() 
                }
            })
        });
        const res = await req.json();
        
        if(res.status) {
            // ONLINE: Update counter dari data real database
            orderCounter = res.data.nextIndex;
            localStorage.setItem(LOCAL_KEY, orderCounter);
            console.log("Counter synced (Online): Start from " + orderCounter);
        }
    } catch(e) {
        // 2. OFFLINE / GAGAL: Cek Memori Terakhir
        console.log("Offline Mode: Mengambil counter dari memori...");
        const savedCount = localStorage.getItem(LOCAL_KEY);
        if (savedCount) {
            orderCounter = parseInt(savedCount); 
        } else {
            orderCounter = 1;
        }
    }
}

/* =================================================================
   OFFLINE SYNC MANAGER (PENGIRIMAN DATA TERTUNDA)
   ================================================================= */
async function processOfflineQueue() {
    // 1. Cek apakah ada data tertunda
    const rawQueue = localStorage.getItem('guts_absen_queue');
    if (!rawQueue) return;

    let queue = JSON.parse(rawQueue);
    if (queue.length === 0) return;

    // Jika ada data, beri notifikasi visual kecil
    setStatus('saving');
    const notif = document.createElement('div');
    notif.id = 'sync-notif';
    notif.style.cssText = "position:fixed; bottom:20px; right:20px; background:#f39c12; color:black; padding:10px 20px; border-radius:50px; z-index:9999; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.3);";
    notif.innerHTML = `<i class="fas fa-sync fa-spin"></i> Mengirim ${queue.length} data offline...`;
    document.body.appendChild(notif);

    // 2. Loop dan Kirim Satu per Satu
    // Kita gunakan array baru untuk menyimpan yang GAGAL dikirim (agar dicoba lagi nanti)
    let failedQueue = [];

    for (let item of queue) {
        try {
            const req = await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify({ action: "save_absensi", payload: item })
            });
            const res = await req.json();
            
            if (!res.status) {
                // Jika ditolak server (misal duplikat), anggap selesai (jangan kirim ulang)
                console.log("Sync ditolak server:", res.message);
            } else {
                console.log("Sync Sukses:", item.nama);
            }
        } catch (e) {
            // Jika masih error koneksi, simpan lagi untuk percobaan berikutnya
            failedQueue.push(item);
            console.log("Sync Gagal (Masih Offline):", item.nama);
        }
    }

    // 3. Update LocalStorage
    if (failedQueue.length > 0) {
        localStorage.setItem('guts_absen_queue', JSON.stringify(failedQueue));
        notif.style.background = "var(--red)";
        notif.style.color = "white";
        notif.innerHTML = `<i class="fas fa-wifi"></i> Koneksi putus lagi. Sisa ${failedQueue.length} data.`;
    } else {
        localStorage.removeItem('guts_absen_queue'); // Bersih
        notif.style.background = "var(--green)";
        notif.style.color = "white";
        notif.innerHTML = `<i class="fas fa-check"></i> Semua data offline terkirim!`;
    }

    setStatus('saved');
    
    // Hilangkan notifikasi setelah 3 detik
    setTimeout(() => { if(notif) notif.remove(); }, 3000);
}