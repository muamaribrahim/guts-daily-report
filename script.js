const API_URL = "https://script.google.com/macros/s/AKfycbwTppW9MbmNya1OiYJFVZjj4TertTzrGoe4KuuTegb0M5I2WJy5SIIDJJT8MC8xVjDIRw/exec"; 

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

window.onload = () => {
    if(!navigator.onLine) setStatus('offline');
    window.addEventListener('offline', () => setStatus('offline'));
    window.addEventListener('online', () => {
        setStatus('saved');
        processOfflineQueue();
    });

    processOfflineQueue();

    if ('wakeLock' in navigator) {
        let wakeLock = null;
        const requestWakeLock = async () => {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Screen Wake Lock active (Layar dikunci agar tetap nyala)');
                
                document.addEventListener('visibilitychange', async () => {
                    if (wakeLock !== null && document.visibilityState === 'visible') {
                        wakeLock = await navigator.wakeLock.request('screen');
                    }
                });
            } catch (err) {
                console.log('Gagal mengunci layar (Fitur tidak didukung browser ini):', err.message);
            }
        };
        requestWakeLock();
    }

    const isJustLogout = localStorage.getItem('guts_is_logout');
    const savedUser = localStorage.getItem('guts_user');
    
    if(savedUser) { 
        if (isJustLogout) {
            console.log("Status: User habis logout manual. Stay di login page.");
            
            localStorage.removeItem('guts_is_logout');
            
        } else {
            try { 
                currentUser = JSON.parse(savedUser); 
                performLoginCheck();
            } catch(e) { 
                console.error("Data user corrupt.");
                localStorage.removeItem('guts_user'); 
            } 
        }
    }

    const savedCount = localStorage.getItem('guts_order_counter'); 
    if(savedCount) orderCounter = parseInt(savedCount);
    
    const savedOrders = localStorage.getItem('guts_orders');
    if(savedOrders) { 
        try { 
            orders = JSON.parse(savedOrders); 
            if(orders.length > 0 && !activeOrderId) activeOrderId = orders[0].id; 
        } catch(e){ 
            orders = []; 
        } 
    }
    
    checkBlankState();
    if(activeOrderId) loadActiveOrder();

    setInterval(() => { 
        const el = document.getElementById('time-in-display'); 
        if(el) el.innerText = new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'}); 
    }, 1000);
};

async function performLogin() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const btn = document.getElementById('btn-login');
    
    if(!u || !p) return alert("Isi Username & Password!");

    btn.innerText = "Verifying..."; btn.disabled = true;

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
        } else {
            alert(res.message);
        }
    } catch(e){ 
        console.log("Login Online Gagal. Mencoba Login Offline...");
        
        const cachedUserStr = localStorage.getItem('guts_user');
        
        if (cachedUserStr) {
            const cachedUser = JSON.parse(cachedUserStr);
            
            if (u === cachedUser.Username) {
                currentUser = cachedUser;
                alert("Login Mode Offline Berhasil.");
                performLoginCheck();
            } else {
                alert("Offline: Username tidak cocok dengan data terakhir di HP ini.");
            }
        } else {
            alert("Gagal Login (Offline). Anda harus Online untuk login pertama kali.");
        }
    } 
    btn.innerText = "LOGIN"; btn.disabled = false;
}

async function performLoginCheck() {
    const savedShift = localStorage.getItem('guts_shift_' + currentUser.Username);
    if(savedShift) {
        console.log("Offline Login: Menggunakan sesi lokal.");
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
            alert("Sesi dipulihkan dari server.");
            showDashboard();
        } else {
            document.getElementById('login-page').classList.add('hidden');
            document.getElementById('modal-open-shift').classList.remove('hidden');
        }
    } catch(e) {
        console.log("Gagal konek server (Offline). Cek data lokal...");
        const hasMasterData = localStorage.getItem('guts_master_cache');
        
        if (hasMasterData) {
            alert("Mode Offline Aktif. Data akan disinkronkan nanti.");
            document.getElementById('login-page').classList.add('hidden');
            document.getElementById('modal-open-shift').classList.remove('hidden');
        } else {
            alert("Anda sedang Offline & belum ada data tersimpan. Harap online untuk login pertama kali.");
        }
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

/* --- REVISI: LOGOUT AMAN (OFFLINE FRIENDLY) --- */
function logout() { 
    if(currentUser && currentUser.Username) {
        localStorage.removeItem('guts_shift_' + currentUser.Username);
    }
    localStorage.setItem('guts_is_logout', 'true');
    location.reload(); 
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

function updateSidebarAddress() {
    const branch = getSelectedBranch()
    const el = document.getElementById('user-address-display');
    
    if (!el) return;

    let addr = "";

    if (branch === 'Cimahi') {
        addr = "Jl. Jend. H. Amir Machmud No.654, Cimahi<br>Kec. Cimahi Tengah, Kota Cimahi";
    } else {
        addr = "Jl. Kerkof No.23, Leuwigajah<br>Kec. Cimahi Selatan, Kota Cimahi";
    }

    el.innerHTML = addr; // Gunakan innerHTML agar <br> terbaca sebagai enter
}

async function loadMaster() {
    const CACHE_KEY = 'guts_master_cache';
    try { 
        const req = await fetch(API_URL, {method: "POST", body: JSON.stringify({action: "get_master_data", payload: {}})}); 
        const res = await req.json(); 
        if(res.status){ 
            masterData = res.data; 
            localStorage.setItem(CACHE_KEY, JSON.stringify(masterData));
            initDropdowns(); 
        } 
    } catch(e){ 
        console.log("Offline Mode: Mengambil Data lokal...");
        const cached = localStorage.getItem(CACHE_KEY);
        if(cached) {
            masterData = JSON.parse(cached);
            initDropdowns();
            const sel = document.getElementById('sync-status');
            if(sel) { sel.style.color = 'orange'; sel.innerText = 'Offline Mode (Data lokal)'; }
        } else {
            alert("Gagal memuat database & tidak ada data lokal (offline).");
        }
    }
}

function initDropdowns() {
    const svc = document.getElementById('service-dropdown');
    const sty = document.getElementById('stylist-dropdown');
    const prd = document.getElementById('product-dropdown');
    const sel = document.getElementById('seller-dropdown');
    const stk = document.getElementById('restock-sku');
    const abs = document.getElementById('absen-nama');
    
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
    
    if(svc) svc.innerHTML = hSvc;
    if(sty) sty.innerHTML = hSty;
    if(prd) prd.innerHTML = hPrd;
    if(sel) sel.innerHTML = hSty;
    if(stk) stk.innerHTML = hStk;
    if(abs) abs.innerHTML = hAbs;
}

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

        savedStylist: "", 
        savedService: "", 
        savedSeller: "", 
        savedProduct: ""
    }); 
    
    activeOrderId = newId; 
    saveOrdersToLocal(); renderOrderTabs(); checkBlankState(); 
    
    loadActiveOrder(); 
}

function saveCurrentState() { 
    if(!activeOrderId) return; 
    const o = orders.find(x => x.id === activeOrderId); 
    if(o){ 
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
        ws.classList.add('hidden'); 
        bl.classList.remove('hidden'); 
        loadDailyDashboard(); 
        renderCart(); 
    } 
    else { 
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

function renderCart() { 
    const tb = document.getElementById('cart-items');
    if(!activeOrderId) {
        tb.innerHTML = '';
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
    const o = orders.find(x => x.id === activeOrderId); 
    if(!o || !o.cart.length) return alert("Cart Kosong");

    const t = cleanNum(document.getElementById('val-total').innerText);
    const d = cleanNum(document.getElementById('val-discount').innerText);
    let cIn = 0, tips = 0, change = 0;
    
    if(m === 'CASH'){ 
        const p = prompt(`Tagihan: ${fmtRp(t)}\n\nMasukkan Uang Tunai:`); 
        if(p === null) return; 
        cIn = cleanNum(p); 
        if(cIn < t) return alert(`Kurang: ${fmtRp(t - cIn)}`); 
        
        let rawChange = cIn - t; 
        const ti = prompt(`Kembalian: ${fmtRp(rawChange)}\n\nMasukkan TIPS (0 jika tidak ada):`, "0"); 
        if(ti === null) return; 
        tips = cleanNum(ti); 
        change = rawChange - tips; 
        if(change < 0) return alert("Tips tidak boleh lebih besar dari kembalian!");
    } else { 
        const p = prompt(`Total Tagihan: ${fmtRp(t)}\n\nMasukkan Total yang dibayar via QRIS:`); 
        if(p === null) return; 
        cIn = cleanNum(p); 
        if(cIn < t) return alert("Pembayaran Kurang!"); 
        
        tips = cIn - t; 
        change = 0; 
        if(tips > 0){ 
            if(!confirm(`Kelebihan ${fmtRp(tips)} dianggap TIPS?`)) return; 
        }
    }
    
    const payloadData = { 
        header: {
            branchId: getSelectedBranch(), 
            tanggal: getLocalDate(), 
            jamIn: o.timeIn, 
            jamOut: new Date().getHours().toString().padStart(2,'0') + ":" + new Date().getMinutes().toString().padStart(2,'0'), 
            customer: o.custName || "Guest", 
            wa: o.wa, 
            visitType: o.type, 
            total: t + d, 
            grandTotal: t, 
            discount: d, 
            tips: tips, 
            method: m, 
            cashIn: cIn, 
            change: change, 
            note: o.note,
            offlineId: "OFF-" + new Date().getTime() 
        }, 
        items: o.cart 
    };

    setStatus('saving'); 
    document.getElementById('loading-overlay').classList.remove('hidden');

    try {
        const req = await fetch(API_URL, {
            method: "POST", 
            body: JSON.stringify({action: "save_transaksi", payload: payloadData})
        }); 
        const res = await req.json();
        
        if(res.status) { 
            setStatus('saved'); 
            payloadData.header.id = res.data.newID;
            finalizeTransaction(payloadData, true);
        } else { 
            throw new Error(res.message); 
        }

    } catch(e) { 
        console.log("Offline Checkout: Menyimpan ke antrian...");
        
        try {
            let queue = JSON.parse(localStorage.getItem('guts_trx_queue') || "[]");
            
            if (queue.length > 50) {
                alert("MEMORI PENUH! Harap Online dulu untuk sinkronisasi data sebelum lanjut.");
                document.getElementById('loading-overlay').classList.add('hidden');
                return;
            }

            queue.push(payloadData);
            localStorage.setItem('guts_trx_queue', JSON.stringify(queue));
            
            setStatus('offline');
            alert("OFFLINE MODE: Transaksi disimpan di HP. Data akan terkirim otomatis saat Online.");
            
            payloadData.header.id = payloadData.header.offlineId;
            finalizeTransaction(payloadData, false);

        } catch (errStorage) {
            alert("GAGAL SIMPAN OFFLINE: Memori Browser Penuh! Hapus history atau segera online.");
        }
    } 
    document.getElementById('loading-overlay').classList.add('hidden');
}

function finalizeTransaction(data, isOnline) {
    if(confirm("Transaksi Berhasil! Cetak Struk?")) printReceipt(data);
    
    orders = orders.filter(x => x.id !== activeOrderId); 
    activeOrderId = orders.length ? orders[0].id : null; 
    
    saveOrdersToLocal(); 
    renderOrderTabs(); 
    checkBlankState(); 
    
    if(isOnline) loadMaster(); 
    
    if(activeOrderId) loadActiveOrder();
}

async function loadDailyDashboard() {
    const tb = document.getElementById('daily-dashboard-tbody');
    const CACHE_KEY = 'guts_daily_cache_' + getSelectedBranch(); 
    
    const elDate = document.getElementById('blank-date-display');
    if(elDate) elDate.innerText = formatDateIndo(getLocalDate());
    
    if(tb.innerHTML.trim() === "") tb.innerHTML = '<tr><td colspan="5" align="center">Loading...</td></tr>';

    let serverData = [];

    try {
        const antiCacheURL = API_URL + "?t=" + new Date().getTime();
        const req = await fetch(antiCacheURL, {
            method: "POST",
            body: JSON.stringify({ action: "get_daily_detail", payload: { branch: getSelectedBranch(), date: getLocalDate() } })
        });
        const res = await req.json();
        
        if (res.status) {
            serverData = res.data;
            localStorage.setItem(CACHE_KEY, JSON.stringify(serverData));
        }
    } catch (e) {
        console.log("Gagal ambil data server, load cache lokal...");
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) serverData = JSON.parse(cached);
    }

    const rawQueue = localStorage.getItem('guts_trx_queue');
    let offlineData = [];
    
    if (rawQueue) {
        const queue = JSON.parse(rawQueue);
        offlineData = queue.map(q => ({
            id: q.header.offlineId,
            jamOut: q.header.jamOut,
            itemsRaw: JSON.stringify(q.items),
            method: q.header.method,
            net: q.header.grandTotal,
            stylistName: "HP (Offline)",
            status: 'PENDING_UPLOAD'
        }));
    }

    const combinedData = [...offlineData, ...serverData];

    if (combinedData.length > 0) {
        renderDailyTable(combinedData);
        
        if(typeof updateDailyStats === 'function') updateDailyStats(combinedData);
    } else {
        tb.innerHTML = '<tr><td colspan="5" align="center">Belum ada transaksi hari ini</td></tr>';
        if(typeof updateDailyStats === 'function') updateDailyStats([]);
    }
}

function updateDailyStats(dataList) {
    if (!dataList) return;

    const validTrx = dataList.filter(x => x.status !== 'VOIDED' && !x.id.startsWith('VOID'));
    const totalCust = validTrx.length;
    const totalOmzet = validTrx.reduce((acc, curr) => acc + (parseFloat(curr.net) || 0), 0);
    const elCust = document.getElementById('val-total-cust-today');
    const elOmzet = document.getElementById('val-total-omzet-today');

    if (elCust) elCust.innerText = totalCust;
    if (elOmzet) elOmzet.innerText = fmtRp(totalOmzet);

    console.log(`Stats Updated: ${totalCust} Cust, ${fmtRp(totalOmzet)} Omzet (Clean from Void)`);
}

function renderDailyTable(dataList) {
    const tb = document.getElementById('daily-dashboard-tbody');
    if(!dataList || !dataList.length) { 
        tb.innerHTML = '<tr><td colspan="5" align="center">Belum ada transaksi</td></tr>'; 
        return; 
    }
    
    let html = '';
    dataList.forEach(r => {
        const isVoid = r.status === 'VOIDED';
        const isReversal = String(r.id).startsWith('VOID');
        const isOffline = r.status === 'PENDING_UPLOAD';

        let rowStyle = "cursor:pointer; border-bottom: 1px solid #eee;";
        let statusIcon = "";

        if (isVoid) {
            rowStyle += "text-decoration: line-through; color: #999;";
        } else if (isReversal) {
            rowStyle += "color: #777; font-style: italic;";
        } else if (isOffline) {
            rowStyle += "background: rgba(243, 156, 18, 0.1); border-left: 4px solid #f39c12;";
            statusIcon = `<i class="fas fa-clock" style="color: #f39c12; margin-right:5px;" title="Menunggu Koneksi Internet"></i>`;
        }

        let summ = "?", k = r.stylistName || "-";
        try { 
            const p = (typeof r.itemsRaw === 'string') ? JSON.parse(r.itemsRaw) : r.itemsRaw;
            if(p && p.length > 0) {
                summ = p[0].name + (p.length > 1 ? " (+"+(p.length-1)+" items)" : ""); 
                if(!k || k==='-') k = p[0].stylistName;
            }
        } catch(e){ console.error(e); }
        
        const fullData = encodeURIComponent(JSON.stringify(r));
        let jamTampil = String(r.jamOut).replace('.', ':');
        
        html += `<tr onclick="${(isVoid || isReversal || isOffline) ? '' : `showTrxDetail('${fullData}')`}" style="${rowStyle}">
                    <td style="padding: 12px 8px;">${statusIcon} ${jamTampil}</td> 
                    <td style="padding: 12px 8px;">${k}</td>
                    <td style="padding: 12px 8px;"><b>${summ}</b> ${isVoid ? '(BATAL)' : ''} ${isReversal ? '(REV)' : ''}</td>
                    <td style="padding: 12px 8px;">${r.method}</td>
                    <td style="padding: 12px 8px;" align="right">${fmtRp(r.net)}</td>
                 </tr>`;
    });
    tb.innerHTML = html;
}

function showTrxDetail(encodedData) {
    const r = JSON.parse(decodeURIComponent(encodedData));
    document.getElementById('trx-detail-modal').classList.remove('hidden'); 
    document.getElementById('modal-trx-id').innerText = r.id;
    
    const isVoided = (r.status === 'VOIDED');
    const isVoidResult = r.id.includes('VOID');
    
    const b = document.getElementById('modal-trx-body'); 
    let html = ''; 
    
    let items = []; 
    try { items = JSON.parse(r.itemsRaw); items.forEach(i => { html += `<div class="detail-item"><div><b>${i.name}</b> x${i.qty}<br><small>${i.stylistName}</small></div><div align="right">${fmtRp(i.price * i.qty)}</div></div>`; }); } catch(e){}
    
    html += `<div style="margin-top:15px; border-top:1px solid #444; padding-top:10px;">
                <div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>${fmtRp(r.gross)}</span></div>
                <div style="display:flex; justify-content:space-between; color:var(--red);"><span>Diskon:</span><span>${fmtRp(r.disc)}</span></div>
                <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:1.1em; margin-top:5px;"><span>GRAND TOTAL:</span><span>${fmtRp(r.net)}</span></div>
             </div>`;
    
    if (isVoided) {
        html += `<div style="margin-top:20px; background:rgba(231, 76, 60, 0.2); border:1px solid var(--red); color:var(--red); text-align:center; padding:10px; font-weight:bold; border-radius:4px;">
                    Transaksi sudah dibatalkan. (Void)
                 </div>`;
    } else if (isVoidResult) {
        html += `<div style="margin-top:20px; background:#333; color:#aaa; text-align:center; padding:10px; border-radius:4px; font-style:italic;">
                    Pembatalan Transaksi (Reversal)
                 </div>`;
    } else {
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

function reprintOldTrx(encodedData) {
    const r = JSON.parse(decodeURIComponent(encodedData));
    const trxData = {
        header: {
            branchId: r.branchId,
            tanggal: r.tanggal,
            jamOut: r.jamOut,
            id: r.id,
            total: r.gross,
            grandTotal: r.net,
            discount: r.disc,
            tips: r.tips,
            method: r.method,
            cashIn: r.cashIn,
            change: r.change,
            note: "Cetak Ulang (Copy)"
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
    const kapsterList = [...new Set(trxData.items.map(i => i.stylistName))].join(", ");

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

    const printArea = document.getElementById('print-area');
    printArea.innerHTML = strukHTML;
    printArea.style.display = 'block'; 
    
    setTimeout(() => { 
        window.print(); 
        setTimeout(() => { printArea.style.display = 'none'; }, 1000);
    }, 500);
}

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

function fmtRpNoRp(n) { return new Intl.NumberFormat('id-ID').format(n); }

function searchAkun(el, i) {
    const q = el.value.toLowerCase(); 
    const d = document.getElementById(`res-${i}`); 
    d.innerHTML = '';
    
    const m = masterData.coa.filter(c => c.Kode_Akun.includes(q) || c.Nama_Akun.toLowerCase().includes(q));
    
    if (m.length) { 
        d.classList.remove('hidden'); 
        m.forEach(c => { 
            const x = document.createElement('div'); 
            x.className = 'search-item'; 
            x.innerHTML = `<span style="font-weight:bold; color:var(--accent)">${c.Kode_Akun}</span> - ${c.Nama_Akun}`; 
            
            x.onclick = () => { 
                journalItems[i].akun = `${c.Kode_Akun} - ${c.Nama_Akun}`; 
                renderJournalRows();
            }; 
            d.appendChild(x); 
        }); 
    } else { 
        if(q.length > 0) {
            d.classList.remove('hidden');
            d.innerHTML = '<div class="search-item" style="color:#777; cursor:default;">Tidak ditemukan</div>';
        } else {
            d.classList.add('hidden'); 
        }
    }
}

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
                    startDate: startDate,
                    endDate: endDate
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
    
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    btn.disabled = true;
    
    try {
        await loadMaster(); 
        
        renderStockView(); 
        
    } catch (e) {
        alert("Gagal refresh stok: " + e);
    }
    
    btn.innerHTML = originalText;
    btn.disabled = false;
}

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
            
            res.data.sort((a, b) => (b.totalCust + b.prodQty) - (a.totalCust + a.prodQty));

            res.data.forEach((k, index) => { 
                const rank = index + 1;
                
                let rankClass = (rank === 1) ? 'rank-1' : '';
                let profileDisplay = '';
                
                const fallbackIcon = (rank === 1) 
                    ? `<i class="fas fa-crown fa-3x" style="color:#f1c40f; filter:drop-shadow(0 0 5px gold);"></i>`
                    : `<i class="fas fa-user-circle fa-3x" style="color:#555;"></i>`;

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
    const placeholder = document.getElementById('camera-placeholder');
    
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return alert("Browser tidak support kamera!");
    
    try { 
        streamKamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } }); 
        video.srcObject = streamKamera; 
        
        video.style.display = 'block';
        placeholder.style.display = 'none';
        document.getElementById('camera-result').style.display = 'none';
        
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
    
    canvas.width = 640; canvas.height = 480; 
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    fotoAbsenBase64 = canvas.toDataURL('image/jpeg', 0.5); 
    
    img.src = fotoAbsenBase64; 
    img.style.display = 'block'; 
    video.style.display = 'none'; 
    placeholder.style.display = 'none';
    
    document.getElementById('btn-snap').style.display = 'none'; 
    document.getElementById('btn-retake').style.display = 'block'; 
    document.getElementById('btn-submit-absen').style.display = 'block'; 
    
    stopCamera();
}

function resetCamera() { 
    fotoAbsenBase64 = null; 
    startCamera(); 
}

async function submitAbsensi() {
    const nama = document.getElementById('absen-nama').value;
    const shift = document.getElementById('absen-shift').value;
    const btnSubmit = document.getElementById('btn-submit-absen');

    if(!nama || !fotoAbsenBase64) return alert("Data/Foto kurang!");
    
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Mengirim...";
    setStatus('saving'); 
    document.getElementById('loading-overlay').classList.remove('hidden');

    const payloadData = { 
        nama: nama, 
        shift: shift, 
        tanggal: getLocalDate(), 
        foto: fotoAbsenBase64 
    };
    
    try {
        const req = await fetch(API_URL, { 
            method: "POST", 
            body: JSON.stringify({ action: "save_absensi", payload: payloadData }) 
        });

        const contentType = req.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Server Error (Backend Crash). Cek Deployment!");
        }

        const res = await req.json();
        
        if(res.status) { 
            handleAbsenSuccess(res.data.status, res.data);
        } else { 
            setStatus('saved'); 
            alert(res.message); 
            resetUiAbsen();
        }

    } catch(e) { 
        console.error("Absen Error:", e);

        if(e.message.includes("Server Error")) {
            alert("Terjadi Kesalahan di Server (Backend). Hubungi Admin.");
            resetUiAbsen();
        } else {
            console.log("Offline Mode Active. Simpan data di local storage...");
            let queue = JSON.parse(localStorage.getItem('guts_absen_queue') || "[]");
            queue.push(payloadData);
            localStorage.setItem('guts_absen_queue', JSON.stringify(queue));
            
            setStatus('offline'); 
            alert("OFFLINE MODE: Data tersimpan di perangkat & akan dikirim nanti.");
            handleAbsenSuccess("PENDING (OFFLINE)", null);
        }

    } finally {
        document.getElementById('loading-overlay').classList.add('hidden'); 
        
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fas fa-paper-plane"></i> KIRIM PRESENSI';
    }
}

function handleAbsenSuccess(statusMsg, data = null) {
    setStatus('saved');
    
    let pesan = `Presensi Berhasil!\nStatus: ${statusMsg}`;
    
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
            orderCounter = res.data.nextIndex;
            localStorage.setItem(LOCAL_KEY, orderCounter);
            console.log("Counter synced (Online): Start from " + orderCounter);
        }
    } catch(e) {
        console.log("Offline Mode: Mengambil counter dari memori...");
        const savedCount = localStorage.getItem(LOCAL_KEY);
        if (savedCount) {
            orderCounter = parseInt(savedCount); 
        } else {
            orderCounter = 1;
        }
    }
}

async function processOfflineQueue() {
    const rawAbsen = localStorage.getItem('guts_absen_queue');
    const rawTrx = localStorage.getItem('guts_trx_queue');
    
    if (!rawAbsen && !rawTrx) return;

    setStatus('saving');

    let absenQueue = JSON.parse(rawAbsen || "[]");
    let pendingAbsen = [];

    if (absenQueue.length > 0) {
        console.log(`Syncing ${absenQueue.length} data absen...`);
        for (let item of absenQueue) {
            try {
                await fetch(API_URL, {
                    method: "POST",
                    body: JSON.stringify({ action: "save_absensi", payload: item })
                });
            } catch (e) {
                pendingAbsen.push(item);
            }
        }
        if (pendingAbsen.length > 0) localStorage.setItem('guts_absen_queue', JSON.stringify(pendingAbsen));
        else localStorage.removeItem('guts_absen_queue');
    }

    let trxQueue = JSON.parse(rawTrx || "[]");
    let pendingTrx = [];

    if (trxQueue.length > 0) {
        console.log(`Syncing ${trxQueue.length} transaksi...`);
        
        const notif = document.createElement('div');
        notif.id = 'sync-notif';
        notif.style.cssText = "position:fixed; bottom:20px; right:20px; background:#e67e22; color:white; padding:10px 20px; border-radius:50px; z-index:9999; font-weight:bold; box-shadow:0 4px 10px rgba(0,0,0,0.3); transition:all 0.3s;";
        notif.innerHTML = `<i class="fas fa-sync fa-spin"></i> Mengirim ${trxQueue.length} Transaksi Offline...`;
        document.body.appendChild(notif);

        for (let item of trxQueue) {
            try {
                const req = await fetch(API_URL, {
                    method: "POST",
                    body: JSON.stringify({ action: "save_transaksi", payload: item })
                });
                const res = await req.json();
                
                if (!res.status) console.warn("Transaksi ditolak server:", res.message);
                
            } catch (e) {
                pendingTrx.push(item);
                console.error("Sync Trx Gagal (Net Error):", e);
            }
        }

        if (pendingTrx.length > 0) {
            localStorage.setItem('guts_trx_queue', JSON.stringify(pendingTrx));
            
            notif.style.background = "var(--red)";
            notif.innerHTML = `<i class="fas fa-wifi"></i> Gagal kirim sebagian. Sisa ${pendingTrx.length} data.`;
        } else {
            localStorage.removeItem('guts_trx_queue');
            
            notif.style.background = "var(--green)";
            notif.innerHTML = `<i class="fas fa-check"></i> Semua Transaksi Terkirim!`;
            
            loadDailyDashboard();
        }

        setTimeout(() => { if(notif) notif.remove(); }, 3000);
    }

    setStatus('saved');
}

function hardResetApp() {
    if(confirm("PERINGATAN: Ini akan menghapus semua data yang belum tersimpan (Antrian Offline, Login, Cache) dan mereload aplikasi.\n\nGunakan hanya jika aplikasi error/macet parah.\n\nLanjutkan?")) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
            for(let registration of registrations) { registration.unregister(); } 
        });
        
        localStorage.clear();
        window.location.reload(true);
    }
}


