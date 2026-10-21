/**
 * ISU Motorcycle Parking Slot Monitoring System
 * Modern Web App Architecture
 * Isabela State University - San Mariano Campus
 */
(()=>{
'use strict';

const root = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
let csrf = window.APP_CSRF || '';
let isAdmin = false;
let adminName = 'Administrator';
let slots = [];
let stats = {};
let records = [];
let page = 'home';
let poller = null;
let stream = null;
let selectedSlot = null;
let currentStudentFilter = 'all';

// Helper: Escape HTML string
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

// Helper: Render Lucide SVG Icon
const icon = (name, size = 18, extraClass = '') =>
  `<i data-lucide="${name}" width="${size}" height="${size}" class="${extraClass}"></i>`;

function updateIcons() {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

// Detect user's phone or device model name for reference tag
function getDeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Samsung|SM-[A-Z0-9]+/i.test(ua)) {
    const m = ua.match(/SM-[A-Z0-9]+/i);
    return m ? ('Samsung-' + m[0]) : 'Samsung';
  }
  if (/Redmi|POCO|Xiaomi/i.test(ua)) {
    const m = ua.match(/(Redmi[0-9a-zA-Z-]*|POCO[0-9a-zA-Z-]*|Xiaomi[0-9a-zA-Z-]*)/i);
    return m ? m[0] : 'Xiaomi';
  }
  if (/OPPO|CPH[0-9]+/i.test(ua)) {
    const m = ua.match(/CPH[0-9]+/i);
    return m ? ('Oppo-' + m[0]) : 'Oppo';
  }
  if (/vivo|V[0-9]{4}/i.test(ua)) {
    const m = ua.match(/V[0-9]{4}/i);
    return m ? ('Vivo-' + m[0]) : 'Vivo';
  }
  if (/Realme|RMX[0-9]+/i.test(ua)) {
    const m = ua.match(/RMX[0-9]+/i);
    return m ? ('Realme-' + m[0]) : 'Realme';
  }
  if (/Pixel/i.test(ua)) return 'Pixel';
  if (/Android/i.test(ua)) {
    const m = ua.match(/\(([^)]+)\)/);
    if (m && m[1]) {
      const parts = m[1].split(';').map(s => s.trim());
      const model = parts.find(p => !p.startsWith('Linux') && !p.startsWith('Android') && !p.startsWith('U;') && !p.startsWith('wv'));
      if (model) {
        const clean = model.replace(/Build\/.*$/, '').trim().replace(/[^a-zA-Z0-9-]/g, '');
        if (clean.length >= 2) return clean.slice(0, 16);
      }
    }
    return 'Android';
  }
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Phone';
}

// Toast notification
function toast(message, duration = 3000) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// Robust API Client with auto CSRF recovery (fixes Image 2 session expiry bug)
async function api(action, options = {}) {
  const headers = options.headers || {};
  headers['X-CSRF-Token'] = csrf;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const parts = action.split('&');
  const endpoint = parts.shift();
  const query = parts.length ? '&' + parts.join('&') : '';
  const url = `api/index.php?action=${encodeURIComponent(endpoint)}${query}`;

  let res;
  try {
    res = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  } catch (err) {
    throw new Error('Unable to connect to parking server. Check Apache and MySQL.');
  }

  if (action.startsWith('photo') || action === 'export') {
    return res;
  }

  const data = await res.json().catch(() => ({}));
  if (data.token) csrf = data.token;

  // Handle 419 Session Token Expired automatically:
  if (res.status === 419 && !options._retried) {
    options._retried = true;
    try {
      const sess = await fetch('api/index.php?action=csrf', { credentials: 'same-origin' }).then(r => r.json());
      if (sess.token) csrf = sess.token;
      options.headers = options.headers || {};
      options.headers['X-CSRF-Token'] = csrf;
      return await api(action, options);
    } catch (e) {
      throw new Error(data.error || 'Session expired. Please try again.');
    }
  }

  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// Polling and live sync
async function refresh(isManual = false) {
  try {
    const [slotsData, statsData] = await Promise.all([api('slots'), api('stats')]);
    slots = slotsData.slots || [];
    stats = statsData || {};
    if (slotsData.admin && !isAdmin) {
      isAdmin = true;
      adminName = 'Administrator';
    }

    if (page === 'student') {
      renderStudent();
    } else if (isAdmin && page !== 'home' && page !== 'login') {
      renderAdmin();
    } else if (page === 'home') {
      updateHomeAvailability();
    }

    if (isManual) toast('Data refreshed with live server.');
  } catch (err) {
    // Show connection error only if not already displayed
    if (!root.innerHTML.includes('setup-card')) {
      root.innerHTML = `
        <div class="welcome-v2">
          <div class="login-card" style="text-align:center;">
            <img class="brand-logo" src="assets/images/isu-logo.png" alt="ISU Logo" style="margin:0 auto 12px;">
            <p class="eyebrow">SERVER STATUS</p>
            <h2>Unable to connect</h2>
            <p class="muted">${esc(err.message)} Verify Apache and MySQL services in XAMPP.</p>
            <button class="button primary full" onclick="location.reload()">
              ${icon('refresh-cw', 16)} Retry Connection
            </button>
          </div>
        </div>
      `;
      updateIcons();
    }
  }
}

function startPolling() {
  clearInterval(poller);
  poller = setInterval(() => {
    if (page !== 'login') refresh();
  }, 7000);
}

const statusLabels = {
  available: 'Available',
  occupied: 'Occupied',
  reserved: 'Reserved',
  pending: 'In Review',
  restricted: 'Restricted'
};

// --------------------------------------------------------------------------
// 1. HOME / PORTAL SELECTION
// --------------------------------------------------------------------------
function home() {
  page = 'home';
  const avail = stats.available ?? '...';
  const total = stats.total ?? '20';

  root.innerHTML = `
    <main class="welcome-v2">
      <div class="welcome-wrap">
        <div style="margin-bottom: 30px;">
          <img class="brand-logo-large" src="assets/images/isu-logo.png" alt="ISU Seal">
          <p class="eyebrow" style="color:#a7f3d0;">ISABELA STATE UNIVERSITY <span>·</span> SAN MARIANO CAMPUS</p>
          <h1 style="color:#ffffff; font-size:clamp(30px, 4.5vw, 44px); margin-bottom:8px;">
            Motorcycle Parking<br><span style="color:#6ee7b7;">Slot Monitoring System</span>
          </h1>
          <p style="color:rgba(255,255,255,0.85); font-size:15px; max-width:540px; margin: 0 auto;">
            Live campus motorcycle parking app. Check open stalls, park your bike, and submit photo verification.
          </p>
        </div>

        <div class="role-grid">
          <!-- Student Access Card -->
          <article class="role-card">
            <div class="row between" style="margin-bottom:14px;">
              <div style="width:44px; height:44px; border-radius:12px; background:#ecfdf3; color:#166534; display:grid; place-items:center;">
                ${icon('bike', 24)}
              </div>
              <span class="badge available">STUDENT PORTAL</span>
            </div>
            <h2>Student Access</h2>
            <p>Check live parking slots, park your vehicle, and submit a quick photo verification.</p>
            <button class="button primary" id="student-go" style="margin-top:auto;">
              Open Student Portal ${icon('arrow-right', 16)}
            </button>
          </article>

          <!-- Admin Portal Card -->
          <article class="role-card">
            <div class="row between" style="margin-bottom:14px;">
              <div style="width:44px; height:44px; border-radius:12px; background:#eff6ff; color:#1e40af; display:grid; place-items:center;">
                ${icon('shield-check', 24)}
              </div>
              <span class="badge" style="background:#eff6ff; color:#1e40af; border-color:#bfdbfe;">ADMINISTRATION</span>
            </div>
            <h2>Admin Console</h2>
            <p>Review submitted vehicle photos, verify stalls, manage slot layouts, and access parking history logs.</p>
            <button class="button ghost" id="admin-go" style="margin-top:auto;">
              ${isAdmin ? 'Open Admin Console' : 'Sign in as Admin'} ${icon('arrow-right', 16)}
            </button>
          </article>
        </div>

        <p class="muted" style="color:rgba(255,255,255,0.7); font-size:12px; margin-top:24px;">
          🔒 Completely anonymous student verification. No student ID, names, or plate numbers collected.
        </p>
      </div>
    </main>
  `;

  document.querySelector('#student-go').onclick = () => {
    page = 'student';
    renderStudent();
  };

  document.querySelector('#admin-go').onclick = () => {
    if (isAdmin) {
      page = 'dashboard';
      renderAdmin();
    } else {
      login();
    }
  };

  updateIcons();
}

function updateHomeAvailability() {}

// --------------------------------------------------------------------------
// 2. STUDENT WEB APP (DASHBOARD & INTERACTIVE WORKSPACE)
// --------------------------------------------------------------------------
function renderStudent() {
  page = 'student';
  const total = Number(stats.total || slots.length || 20);
  const avail = Number(stats.available || 0);
  const occ = Number(stats.occupied || 0);
  const resCount = Number(stats.reserved || 0);
  const pctAvail = total > 0 ? Math.round((avail / total) * 100) : 0;

  // Check if current device has an active parked slot or active reservation
  let mySlot = null;
  try { mySlot = JSON.parse(localStorage.getItem('isu_my_slot') || 'null'); } catch(e){}
  let myRes = null;
  try { myRes = JSON.parse(localStorage.getItem('isu_my_reservation') || 'null'); } catch(e){}

  let activeBannerHtml = '';
  if (mySlot) {
    const curSlot = slots.find(s => +s.id === +mySlot.slotId);
    if (curSlot && curSlot.status === 'occupied') {
      activeBannerHtml = `
        <div class="active-parking-banner" id="my-parking-banner">
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="active-bike-pulse">${icon('bike', 22)}</div>
            <div>
              <strong style="font-size:14.5px; color:#14532d;">Kasalukuyang nakaparada ang iyong sasakyan sa Slot ${esc(mySlot.slotNumber)} (Occupied)</strong>
              <p style="margin:2px 0 0; font-size:12.5px; color:#166534;">Naka-park at verified na ang iyong vehicle. Kapag aalis ka na, i-tap ang Leave button upang bakantehin ang slot para sa iba.</p>
            </div>
          </div>
          <button class="button danger small" id="banner-exit-btn">
            ${icon('log-out', 16)} Leave Slot ${esc(mySlot.slotNumber)}
          </button>
        </div>
      `;
    } else if (curSlot && curSlot.status === 'available') {
      localStorage.removeItem('isu_my_slot');
    }
  } else if (myRes) {
    const resSlot = slots.find(s => +s.id === +myRes.slotId);
    if (!resSlot || resSlot.status !== 'reserved') {
      localStorage.removeItem('isu_my_reservation');
    }
  }

  root.innerHTML = `
    <!-- Web App Header -->
    <header class="app-header">
      <div class="app-header-left">
        <div class="brand">
          <img class="brand-logo" src="assets/images/isu-logo.png" alt="ISU Seal">
          <div class="brand-text">
            <span class="brand-title">ISU Motorcycle Parking</span>
            <small class="brand-sub">San Mariano Campus</small>
          </div>
        </div>
      </div>

      <div class="app-header-right">
        <button class="button ghost small" id="student-exit-btn" style="font-weight:700;">
          ${icon('log-out', 15)} Exit
        </button>
      </div>
    </header>

    <!-- Student App Workspace Grid -->
    <div class="app-container">
      <!-- Left Sidebar Control Panel -->
      <aside class="app-sidebar-panel">
        <!-- Live Capacity Card -->
        <div class="app-card capacity-card">
          <h3>Live Vehicle Slot Status</h3>
          <div class="capacity-number-row">
            <span class="capacity-number">${avail}</span>
            <span class="capacity-total">/ ${total} Available Slots</span>
          </div>
          <div style="font-size:12px; color:#a7f3d0; margin-bottom:4px;">
            ${pctAvail}% Free Capacity Right Now
          </div>

          <div class="capacity-progress-track">
            <div class="capacity-progress-fill" style="width: ${pctAvail}%;"></div>
          </div>

          <div class="capacity-metrics-grid">
            <div class="capacity-metric-pill">
              <span>Occupied</span>
              <strong>${occ}</strong>
            </div>
            <div class="capacity-metric-pill">
              <span>Reserved</span>
              <strong>${resCount}</strong>
            </div>
            <div class="capacity-metric-pill">
              <span>Total Slots</span>
              <strong>${total}</strong>
            </div>
          </div>
        </div>

        <!-- 3-Step Parking Guide -->
        <div class="app-card">
          <h3 style="margin-bottom:10px; display:flex; align-items:center; gap:8px;">
            ${icon('help-circle', 18)} How to Park, Reserve & Leave
          </h3>
          <ul class="steps-list">
            <li class="step-item">
              <span class="step-num">1</span>
              <div class="step-text">
                <strong>Find an open slot</strong>
                <p>Piliin ang bakanteng berdeng slot sa mapa para sa iyong sasakyan.</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-num">2</span>
              <div class="step-text">
                <strong>Park Now or Reserve</strong>
                <p>Maaari kang mag-park agad gamit ang photo check-in, o i-reserve ang pwesto bago dumating sa campus!</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-num">3</span>
              <div class="step-text">
                <strong>Tap Leave when exiting</strong>
                <p>Kapag aalis ka na, i-tap ang iyong slot at pindutin ang Leave para magamit muli ng iba!</p>
              </div>
            </li>
          </ul>
        </div>

        <div style="padding:12px; background:var(--bg-surface-subtle); border-radius:var(--radius-md); font-size:12px; color:var(--text-muted); border:1px solid var(--border-light);">
          🔒 Instant check-in & reservation system. Ligtas na nakaimbak para sa maayos na pamamahala ng campus parking.
        </div>
      </aside>

      <!-- Main Interactive Parking Workspace -->
      <main class="app-workspace">
        ${activeBannerHtml}

        <div class="workspace-toolbar">
          <div class="toolbar-title">
            <h2>Campus Vehicle Parking (Zone A)</h2>
            <p class="muted">Piliin ang berdeng slot para mag-park o mag-reserve, o i-tap ang occupied slot kung aalis na.</p>
          </div>

          <!-- Filter Pills -->
          <div class="filter-pills" id="student-filters">
            <button class="filter-pill ${currentStudentFilter === 'all' ? 'active' : ''}" data-filter="all">
              All Slots (${slots.length})
            </button>
            <button class="filter-pill ${currentStudentFilter === 'available' ? 'active' : ''}" data-filter="available">
              Available (${avail})
            </button>
            <button class="filter-pill ${currentStudentFilter === 'occupied' ? 'active' : ''}" data-filter="occupied">
              Occupied (${occ})
            </button>
            <button class="filter-pill ${currentStudentFilter === 'reserved' ? 'active' : ''}" data-filter="reserved">
              Reserved (${resCount})
            </button>
          </div>
        </div>

        <!-- Legend -->
        <div class="legend-row">
          <span class="legend-item"><i class="legend-dot" style="background:var(--slot-avail-indicator)"></i> Available (${avail})</span>
          <span class="legend-item"><i class="legend-dot" style="background:var(--slot-occ-indicator)"></i> Occupied (${occ})</span>
          <span class="legend-item"><i class="legend-dot" style="background:#3b82f6;"></i> Reserved (${resCount})</span>
          <span class="legend-item"><i class="legend-dot" style="background:var(--slot-dis-indicator)"></i> Restricted (${Number(stats.restricted || 0)})</span>
        </div>

        <!-- Parking Grid -->
        <div id="student-map-container">
          ${renderMapGrid(false, currentStudentFilter)}
        </div>
      </main>
    </div>
  `;

  // Attach filter handlers
  root.querySelectorAll('#student-filters .filter-pill').forEach(btn => {
    btn.onclick = () => {
      currentStudentFilter = btn.dataset.filter;
      document.querySelectorAll('#student-filters .filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector('#student-map-container').innerHTML = renderMapGrid(false, currentStudentFilter);
      wireStudentSlots();
      updateIcons();
    };
  });

  const studentExitBtn = document.querySelector('#student-exit-btn');
  if (studentExitBtn) studentExitBtn.onclick = home;

  wireStudentSlots();
  updateIcons();
}

function renderMapGrid(admin = false, filter = 'all') {
  if (!slots.length) {
    return '<div class="empty">No vehicle parking slots configured in the database yet.</div>';
  }

  let filtered = [...slots];
  if (filter === 'available') filtered = filtered.filter(s => s.status === 'available' && s.is_enabled);
  else if (filter === 'occupied') filtered = filtered.filter(s => s.status === 'occupied' && s.is_enabled);
  else if (filter === 'reserved') filtered = filtered.filter(s => s.status === 'reserved' && s.is_enabled);

  const maxCol = Math.max(1, ...slots.map(x => +x.column_position || 1));
  const ordered = filtered.sort((a, b) => +a.row_position - +b.row_position || +a.column_position - +b.column_position);

  return `
    <div class="parking-bay-grid" style="grid-template-columns: repeat(${maxCol}, minmax(84px, 1fr));">
      ${ordered.map(s => {
        const isAvail = s.status === 'available' && s.is_enabled;
        const isOcc = s.status === 'occupied' && s.is_enabled;
        const isRes = s.status === 'reserved' && s.is_enabled;
        const statusClass = s.is_enabled ? ` ${s.status}` : ' disabled';
        const label = s.is_enabled ? statusLabels[s.status] || s.status : 'Disabled';
        
        let iconName = 'bike';
        if (s.status === 'reserved') iconName = 'bookmark';
        else if (s.status === 'pending') iconName = 'clock-3';
        else if (s.status === 'restricted' || !s.is_enabled) iconName = 'ban';

        return `
          <button style="grid-column:${Number(s.column_position)}; grid-row:${Number(s.row_position)};"
            class="slot${statusClass}${admin ? ' slot-admin' : ''}"
            ${isAvail && !admin ? `data-select="${s.id}" data-slot-num="${esc(s.slot_number)}"` : ''}
            ${isOcc && !admin ? `data-occupied="${s.id}" data-slot-num="${esc(s.slot_number)}"` : ''}
            ${isRes && !admin ? `data-reserved="${s.id}" data-slot-num="${esc(s.slot_number)}"` : ''}
            ${!isAvail && !isOcc && !isRes && !admin ? `data-blocked="${esc(s.slot_number)}" data-status="${s.status}"` : ''}
            ${admin ? `data-slot="${s.id}"` : ''}
            aria-label="Slot ${esc(s.slot_number)}: ${esc(label)}"
            title="${isOcc && !admin ? 'Tap to confirm departure' : (isRes && !admin ? 'Reserved vehicle slot' : 'Slot ' + esc(s.slot_number) + ' - ' + esc(label))}">
            ${icon(iconName, 22)}
            <b>${esc(s.slot_number)}</b>
            <small>${esc(label)}</small>
            ${isOcc && !admin ? `<span style="font-size:9.5px; color:#991b1b; font-weight:800; margin-top:2px; letter-spacing:0.02em;">TAP TO LEAVE</span>` : ''}
            ${isRes && !admin ? `<span style="font-size:9.5px; color:#1d4ed8; font-weight:800; margin-top:2px; letter-spacing:0.02em;">RESERVED</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function wireStudentSlots() {
  // When student taps an available slot: show choice modal (Park Now or Reserve)
  root.querySelectorAll('[data-select]').forEach(btn => {
    btn.onclick = () => openSlotChoiceModal(+btn.dataset.select, btn.dataset.slotNum);
  });

  // When student clicks occupied slot on map to leave
  root.querySelectorAll('[data-occupied]').forEach(btn => {
    btn.onclick = () => confirmStudentExit(+btn.dataset.occupied, btn.dataset.slotNum);
  });

  // When student clicks reserved slot on map
  root.querySelectorAll('[data-reserved]').forEach(btn => {
    btn.onclick = () => {
      const slotId = +btn.dataset.reserved;
      const slotNum = btn.dataset.slotNum;
      let myRes = null;
      try { myRes = JSON.parse(localStorage.getItem('isu_my_reservation') || 'null'); } catch(e){}
      if (myRes && +myRes.slotId === slotId) {
        confirmClaimOrCancelRes(slotId, slotNum);
      } else {
        toast(`Naka-reserve na ang Slot ${slotNum} para sa ibang estudyante.`);
      }
    };
  });

  const bannerExitBtn = document.querySelector('#banner-exit-btn');
  if (bannerExitBtn) {
    let mySlot = null;
    try { mySlot = JSON.parse(localStorage.getItem('isu_my_slot') || 'null'); } catch(e){}
    if (mySlot) {
      bannerExitBtn.onclick = () => confirmStudentExit(+mySlot.slotId, mySlot.slotNumber);
    }
  }

  root.querySelectorAll('[data-blocked]').forEach(btn => {
    btn.onclick = () => {
      const num = btn.dataset.blocked;
      toast(`Vehicle slot ${num} ay restricted mula sa student parking.`);
    };
  });
}

function openSlotChoiceModal(slotId, slotNumber) {
  const m = showModal(`
    <div class="modal-title">
      <div>
        <p class="eyebrow" style="color:var(--isu-primary);">PUMILI NG SERBISYO</p>
        <h2>Vehicle Slot ${esc(slotNumber)}</h2>
      </div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button>
    </div>

    <p class="muted">
      Available ang slot na ito. Piliin kung nais mong pumarada na agad o pansamantalang i-reserve ang pwesto:
    </p>

    <div class="choice-action-cards">
      <!-- Option 1: Park Now -->
      <div class="choice-action-card primary-choice" id="choice-park-now">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="width:38px; height:38px; border-radius:10px; background:#dcfce7; color:#166534; display:grid; place-items:center;">
            ${icon('camera', 20)}
          </div>
          <span class="badge available">Agad-agad</span>
        </div>
        <strong style="color:#14532d; font-size:15px; margin-top:8px;">1. Mag-park Na</strong>
        <p style="font-size:12.5px; color:#166534; margin:0; line-height:1.4;">
          Nandito ka na sa campus? I-snap ang photo ng nakaparadang motor at magiging Occupied agad ang pwesto.
        </p>
        <button class="button success small" style="margin-top:auto; pointer-events:none;">
          ${icon('camera', 15)} Snap Photo & Park
        </button>
      </div>

      <!-- Option 2: Reserve Slot -->
      <div class="choice-action-card reserve-choice" id="choice-reserve-slot">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="width:38px; height:38px; border-radius:10px; background:#dbeafe; color:#1d4ed8; display:grid; place-items:center;">
            ${icon('bookmark', 20)}
          </div>
          <span class="badge reserved">I-hold ang Slot</span>
        </div>
        <strong style="color:#1e40af; font-size:15px; margin-top:8px;">2. I-reserve ang Slot</strong>
        <p style="font-size:12.5px; color:#1e3a8a; margin:0; line-height:1.4;">
          Paparating ka pa lang sa campus? I-reserve ang slot na ito para walang ibang makakuha bago ka dumating.
        </p>
        <button class="button primary small" style="margin-top:auto; pointer-events:none; background:#2563eb; border-color:#2563eb;">
          ${icon('bookmark', 15)} Reserve Space
        </button>
      </div>
    </div>
  `);

  m.querySelector('#choice-park-now').onclick = () => {
    m.remove();
    openCamera(slotId);
  };

  m.querySelector('#choice-reserve-slot').onclick = () => {
    m.remove();
    executeReserveSlot(slotId, slotNumber);
  };
}

async function executeReserveSlot(slotId, slotNumber) {
  try {
    const res = await api('reserve', {
      method: 'POST',
      body: JSON.stringify({ slot_id: slotId, device_name: getDeviceName() })
    });
    localStorage.setItem('isu_my_reservation', JSON.stringify({
      slotId: slotId,
      slotNumber: slotNumber,
      reference: res.reference || ''
    }));
    toast(res.message || `Slot ${slotNumber} reserved successfully!`);
    refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function cancelReservation(slotId, slotNumber) {
  try {
    const res = await api('cancel-reservation', {
      method: 'POST',
      body: JSON.stringify({ slot_id: slotId })
    });
    localStorage.removeItem('isu_my_reservation');
    toast(res.message || `Nakansela ang reserbasyon sa Slot ${slotNumber}.`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

function confirmClaimOrCancelRes(slotId, slotNumber) {
  const m = showModal(`
    <div class="modal-title">
      <div>
        <p class="eyebrow" style="color:#2563eb;">IYONG RESERBASYON</p>
        <h2>Vehicle Slot ${esc(slotNumber)} · Reserved</h2>
      </div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button>
    </div>

    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:var(--radius-md); padding:16px; margin:14px 0;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px; height:40px; border-radius:50%; background:#dbeafe; color:#2563eb; display:grid; place-items:center; flex-shrink:0;">
          ${icon('bookmark', 20)}
        </div>
        <div>
          <strong style="color:#1e40af; font-size:14px;">Naka-reserve sa iyo ang Slot ${esc(slotNumber)}.</strong>
          <p style="margin:4px 0 0; font-size:12.5px; color:#1e3a8a; line-height:1.5;">
            Nandito ka na ba sa pwesto? Kumuha ng photo check-in upang maging Occupied na ito, o kanselahin kung hindi mo na gagamitin.
          </p>
        </div>
      </div>
    </div>

    <div class="modal-actions-responsive">
      <button class="button ghost" id="modal-cancel-res-btn" style="color:#dc2626; border-color:#fca5a5;">
        ${icon('x', 15)} Kanselahin ang Reserbasyon
      </button>
      <button class="button success" id="modal-claim-res-btn">
        ${icon('camera', 16)} I-park & Check-in Na
      </button>
    </div>
  `);

  m.querySelector('#modal-claim-res-btn').onclick = () => {
    m.remove();
    openCamera(slotId);
  };
  m.querySelector('#modal-cancel-res-btn').onclick = () => {
    m.remove();
    cancelReservation(slotId, slotNumber);
  };
}

function confirmStudentExit(slotId, slotNumber) {
  const m = showModal(`
    <div class="modal-title">
      <div>
        <p class="eyebrow" style="color:#dc2626;">KUMPIRMASYON SA PAG-ALIS NG VEHICLE</p>
        <h2>Vehicle Slot ${esc(slotNumber)} · Occupied</h2>
      </div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x', 20)}</button>
    </div>

    <div style="background:#fef2f2; border:1px solid #fee2e2; border-radius:var(--radius-md); padding:16px; margin:14px 0;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px; height:40px; border-radius:50%; background:#fee2e2; color:#dc2626; display:grid; place-items:center; flex-shrink:0;">
          ${icon('log-out', 20)}
        </div>
        <div>
          <strong style="color:#991b1b; font-size:14px;">Aalis na ba ang iyong sasakyan sa Slot ${esc(slotNumber)}?</strong>
          <p style="margin:4px 0 0; font-size:12.5px; color:#b91c1c; line-height:1.5;">
            Kapag kinumpirma mong aalis ka na, magiging <strong>Available (berde)</strong> na muli ang vehicle slot na ito sa mapa upang magamit ng susunod na rider.
          </p>
        </div>
      </div>
    </div>

    <div class="modal-actions-responsive">
      <button class="button ghost" data-close>
        Cancel
      </button>
      <button class="button danger" id="confirm-exit-btn">
        ${icon('log-out', 16)} Leave
      </button>
    </div>
  `);

  const confirmBtn = m.querySelector('#confirm-exit-btn');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `${icon('refresh-cw', 16, 'spin')} Leaving slot…`;
      updateIcons();
      try {
        const res = await api('student-exit', {
          method: 'POST',
          body: JSON.stringify({ slot_id: slotId })
        });
        localStorage.removeItem('isu_my_slot');
        m.remove();
        toast(res.message || `Vehicle slot ${slotNumber} is now available. Ingat sa biyahe!`);
        refresh();
      } catch (err) {
        toast(err.message);
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${icon('log-out', 16)} Leave`;
        updateIcons();
      }
    };
  }
}

// --------------------------------------------------------------------------
// 3. CAMERA & PHOTO VERIFICATION MODAL
// --------------------------------------------------------------------------
function stopCamera() {
  if (stream) {
    try {
      stream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    stream = null;
  }
}

async function openCamera(slotId) {
  selectedSlot = slots.find(s => +s.id === slotId);
  if (!selectedSlot) return;

  let fileBlob = null;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true">
      <div class="modal-title">
        <div>
          <p class="eyebrow">VERIFY VEHICLE</p>
          <h2>Vehicle Slot ${esc(selectedSlot.slot_number)}</h2>
        </div>
        <button class="icon-btn" id="close-modal" aria-label="Close modal">${icon('x', 20)}</button>
      </div>

      <p class="muted">
        Capture your vehicle parked inside slot <strong>${esc(selectedSlot.slot_number)}</strong>.
      </p>

      <div class="camera-box" id="camera-box" style="position:relative; overflow:hidden;">
        <span style="font-size:13px; color:#94a3b8;">Starting camera viewfinder…</span>
      </div>

      <div class="row wrap" style="gap:10px; margin-top:12px;">
        <button class="button primary" id="capture" type="button">
          ${icon('camera', 18)} Snap Photo
        </button>
        <label class="button ghost" for="fallback-file">
          ${icon('image', 18)} Choose from Device
        </label>
        <input id="fallback-file" type="file" accept="image/*" capture="environment" style="position:absolute; opacity:0; pointer-events:none; width:1px; height:1px;">
      </div>

      <div class="row" style="margin-top:16px; justify-content:flex-end; gap:10px;">
        <button class="button ghost" id="retake" hidden type="button">
          ${icon('refresh-cw', 14)} Retake
        </button>
        <button class="button success" id="submit-photo" disabled type="button">
          ${icon('check', 16)} Submit Verification
        </button>
      </div>

      <p class="muted" style="margin:14px 0 0; font-size:11.5px;">
        🔒 Stored securely in campus private storage. Visible only to verified staff.
      </p>
    </section>
  `;

  document.body.append(modal);
  updateIcons();

  const box = modal.querySelector('#camera-box');
  const cap = modal.querySelector('#capture');
  const submit = modal.querySelector('#submit-photo');
  const retakeBtn = modal.querySelector('#retake');
  const uploadLabel = modal.querySelector('label[for=fallback-file]');
  const fallbackFile = modal.querySelector('#fallback-file');

  const close = () => {
    stopCamera();
    modal.remove();
  };

  modal.querySelector('#close-modal').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };

  const handlePreview = blob => {
    fileBlob = blob;
    stopCamera();
    const url = URL.createObjectURL(blob);
    box.innerHTML = `<img src="${url}" alt="Preview" style="width:100%; height:100%; object-fit:contain; border-radius:var(--radius-md);">`;
    cap.hidden = true;
    uploadLabel.hidden = true;
    retakeBtn.hidden = false;
    submit.disabled = false;
    updateIcons();
  };

  // Foolproof Snap Photo: triggers live video frame if available, or native camera file picker
  const triggerCapture = () => {
    const video = box.querySelector('video');
    if (video && video.videoWidth > 0 && !video.paused) {
      try {
        const c = document.createElement('canvas');
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(video, 0, 0, c.width, c.height);
        c.toBlob(blob => {
          if (blob) {
            handlePreview(blob);
          } else {
            fallbackFile.click();
          }
        }, 'image/jpeg', 0.90);
        return;
      } catch (err) {
        console.warn('Canvas video capture failed, falling back to file picker:', err);
      }
    }
    // If live video is not ready or failed, immediately open native camera
    fallbackFile.click();
  };

  cap.onclick = triggerCapture;

  function showCameraUnavailable() {
    box.innerHTML = `
      <div style="padding:28px 16px; text-align:center; color:#94a3b8; cursor:pointer;" id="box-prompt">
        <div style="width:52px; height:52px; border-radius:50%; background:rgba(255,255,255,0.08); display:grid; place-items:center; margin:0 auto 10px; color:#34d399;">
          ${icon('camera', 26)}
        </div>
        <strong style="display:block; color:#fff; font-size:14.5px; margin-bottom:4px;">I-tap dito o ang Snap Photo</strong>
        <p style="font-size:12px; margin:0; color:#cbd5e1;">Kumuha ng litrato gamit ang camera o pumili mula sa device.</p>
      </div>
    `;
    const prompt = box.querySelector('#box-prompt');
    if (prompt) prompt.onclick = () => fallbackFile.click();
    updateIcons();
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraUnavailable();
      return;
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Camera timeout')), 3500)
    );

    try {
      const getStreamPromise = navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      stream = await Promise.race([getStreamPromise, timeoutPromise]);

      box.innerHTML = `
        <video autoplay playsinline muted style="width:100%; height:100%; object-fit:cover;"></video>
        <div class="camera-target-crosshair" style="position:absolute; inset:0; pointer-events:none; border:2px dashed rgba(255,255,255,0.4); margin:18px; border-radius:12px;"></div>
      `;
      const video = box.querySelector('video');
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play().catch(() => {});
      };
      // Clicking the live viewfinder also snaps the photo
      box.style.cursor = 'pointer';
      box.onclick = e => {
        if (box.querySelector('video')) triggerCapture();
      };
    } catch (err) {
      showCameraUnavailable();
    }
  };

  startCamera();

  const handleFileChosen = file => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast('Photo must be 8 MB or smaller.');
      return;
    }
    handlePreview(file);
  };

  fallbackFile.onchange = e => {
    const file = e.target.files && e.target.files[0];
    handleFileChosen(file);
  };
  fallbackFile.oninput = e => {
    const file = e.target.files && e.target.files[0];
    handleFileChosen(file);
  };

  retakeBtn.onclick = () => {
    fileBlob = null;
    submit.disabled = true;
    retakeBtn.hidden = true;
    cap.hidden = false;
    uploadLabel.hidden = false;
    fallbackFile.value = '';
    startCamera();
  };

  submit.onclick = async () => {
    if (!fileBlob) return;
    submit.disabled = true;
    submit.innerHTML = `${icon('refresh-cw', 16, 'spin')} Submitting…`;
    updateIcons();

    const body = new FormData();
    body.append('slot_id', String(slotId));
    body.append('photo', fileBlob, 'motorcycle.jpg');
    body.append('device_name', getDeviceName());

    try {
      const res = await api('submit', { method: 'POST', body });
      try {
        localStorage.removeItem('isu_my_reservation');
        localStorage.setItem('isu_my_slot', JSON.stringify({
          slotId: slotId,
          slotNumber: selectedSlot.slot_number,
          reference: res.reference || ''
        }));
      } catch (e) {}
      close();
      toast(res.message || 'Parking photo submitted!');
      refresh();
    } catch (err) {
      toast(err.message);
      submit.disabled = false;
      submit.innerHTML = `${icon('check', 16)} Submit Verification`;
      updateIcons();
    }
  };
}

// --------------------------------------------------------------------------
// 4. ADMIN SIGN-IN (FIXED IMAGE 2 TOKEN EXPIRY & AUTOFILL STYLING)
// --------------------------------------------------------------------------
function login() {
  page = 'login';
  root.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <img class="brand-logo" src="assets/images/isu-logo.png" alt="ISU Logo">
        <div>
          ISU Motorcycle Parking
          <small>Administration Portal</small>
        </div>
      </div>
      <button class="button ghost small" id="back-home">
        ${icon('arrow-left', 15)} Home
      </button>
    </header>

    <main style="padding: 24px;">
      <section class="login-card">
        <div style="width:48px; height:48px; border-radius:12px; background:#ecfdf3; color:#166534; display:grid; place-items:center; margin-bottom:16px;">
          ${icon('shield-check', 26)}
        </div>
        <p class="eyebrow">ADMINISTRATIVE CONSOLE</p>
        <h2>Welcome Back</h2>
        <p class="muted">Sign in with your staff account to review photos and manage vehicle slots.</p>

        <form id="login-form">
          <label class="field">
            Username
            <input name="username" required autocomplete="username" maxlength="80" placeholder="e.g. isuadmin" autofocus>
          </label>

          <label class="field">
            Password
            <div class="row" style="position:relative;">
              <input id="password" type="password" name="password" required autocomplete="current-password" placeholder="Enter password">
              <button type="button" class="icon-btn" id="show-pass" aria-label="Toggle password" style="position:absolute; right:6px;">
                ${icon('eye', 17)}
              </button>
            </div>
          </label>

          <p id="login-error" class="notice error" hidden></p>

          <button class="button primary full" id="login-submit-btn" style="margin-top:8px;">
            Sign In to Console ${icon('arrow-right', 16)}
          </button>
        </form>

        <p class="muted" style="margin-top:20px; font-size:11.5px; text-align:center;">
          🔒 Protected session with active CSRF handshake.
        </p>
      </section>
    </main>
  `;

  document.querySelector('#back-home').onclick = home;

  const passInput = document.querySelector('#password');
  const toggleBtn = document.querySelector('#show-pass');
  toggleBtn.onclick = () => {
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    toggleBtn.innerHTML = icon(isPass ? 'eye-off' : 'eye', 17);
    updateIcons();
  };

  // Pre-fetch fresh CSRF token when opening login (prevents Image 2 error completely)
  api('csrf').then(d => { if (d.token) csrf = d.token; }).catch(() => {});

  document.querySelector('#login-form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector('#login-submit-btn');
    const errBox = document.querySelector('#login-error');

    errBox.hidden = true;
    btn.disabled = true;
    btn.innerHTML = `${icon('refresh-cw', 16, 'spin')} Signing in…`;
    updateIcons();

    // Ensure CSRF token is 100% active before submitting
    try {
      const sess = await fetch('api/index.php?action=csrf', { credentials: 'same-origin' }).then(r => r.json());
      if (sess.token) csrf = sess.token;
    } catch (e) {}

    const f = new FormData(form);
    try {
      const data = await api('login', {
        method: 'POST',
        body: JSON.stringify({
          username: f.get('username'),
          password: f.get('password')
        })
      });
      csrf = data.token;
      isAdmin = true;
      adminName = data.name || 'Administrator';
      page = 'dashboard';
      toast(`Signed in as ${adminName}`);
      refresh();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      btn.disabled = false;
      btn.innerHTML = `Sign In to Console ${icon('arrow-right', 16)}`;
      updateIcons();
    }
  };

  updateIcons();
}

// --------------------------------------------------------------------------
// 5. ADMIN WEB APP (ORGANIZED CONSOLE & WORKSPACE)
// --------------------------------------------------------------------------
const adminTabs = [
  ['dashboard', 'layout-dashboard', 'Dashboard'],
  ['map', 'map', 'Parking Map'],
  ['slots', 'grid-3x3', 'Slot Setup'],
  ['history', 'history', 'History & Audit'],
  ['settings', 'settings-2', 'Settings']
];

function adminShell(content, title) {
  root.innerHTML = `
    <!-- Web App Header -->
    <header class="app-header">
      <div class="app-header-left">
        <div class="brand">
          <img class="brand-logo" src="assets/images/isu-logo.png" alt="ISU Logo">
          <div class="brand-text">
            <span class="brand-title">ISU Motorcycle Parking</span>
            <small class="brand-sub">Admin Console</small>
          </div>
        </div>
      </div>

      <div class="app-header-right">
        <button class="button ghost small" id="admin-exit-btn" style="color:#ef4444; border-color:#fca5a5; font-weight:700;">
          ${icon('log-out', 15)} Exit
        </button>
      </div>
    </header>

    <!-- Admin Shell Layout -->
    <div class="admin-shell">
      <!-- Fixed Sidebar (Desktop) / Bottom Nav Bar (Mobile) -->
      <aside class="admin-sidebar">
        <nav class="admin-nav">
          ${adminTabs.map(([key, ic, lbl]) => `
            <button class="${page === key ? 'active' : ''}" data-nav="${key}">
              ${icon(ic, 22)}
              <span>${lbl}</span>
            </button>
          `).join('')}
        </nav>

        <div class="admin-bottom-card">
          <div style="font-size:12px; color:#cbd5e1;">
            <div>Signed in as:</div>
            <strong style="color:#fff; font-size:13.5px;">${esc(adminName)}</strong>
          </div>
          <button id="admin-logout" class="button ghost small" style="color:#fff; border-color:rgba(255,255,255,0.2); background:rgba(255,255,255,0.08);">
            ${icon('log-out', 15)} Sign Out
          </button>
        </div>
      </aside>

      <!-- Main Admin Content Area -->
      <main class="admin-main-viewport">
        <div class="admin-top-bar">
          <div>
            <p class="eyebrow">ADMIN CONSOLE</p>
            <h1>${title}</h1>
          </div>
        </div>

        ${content}
      </main>
    </div>
  `;

  // Attach nav handlers
  root.querySelectorAll('[data-nav]').forEach(btn => {
    btn.onclick = () => {
      page = btn.dataset.nav;
      renderAdmin();
    };
  });

  const exitBtn = document.querySelector('#admin-exit-btn');
  if (exitBtn) exitBtn.onclick = logout;
  const desktopLogout = document.querySelector('#admin-logout');
  if (desktopLogout) desktopLogout.onclick = logout;

  updateIcons();
}

async function loadRecords(status = '') {
  try {
    const data = await api('records' + (status ? '&status=' + status : ''));
    records = data.records || [];
    return records;
  } catch (err) {
    toast(err.message);
    return [];
  }
}

function adminStatsBar() {
  return `
    <div class="admin-stats-grid">
      <div class="stat-box">
        <div class="stat-box-top">
          <span>Total Vehicle Slots</span>
          ${icon('grid-3x3', 18)}
        </div>
        <strong>${Number(stats.total || 0)}</strong>
      </div>

      <div class="stat-box">
        <div class="stat-box-top" style="color:var(--isu-primary-hover);">
          <span>Available Slots</span>
          ${icon('circle-check', 18)}
        </div>
        <strong style="color:#166534;">${Number(stats.available || 0)}</strong>
      </div>

      <div class="stat-box">
        <div class="stat-box-top">
          <span>Occupied</span>
          ${icon('bike', 18)}
        </div>
        <strong style="color:#dc2626;">${Number(stats.occupied || 0)}</strong>
      </div>

      <div class="stat-box">
        <div class="stat-box-top" style="color:#2563eb;">
          <span>Reserved</span>
          ${icon('bookmark', 18)}
        </div>
        <strong style="color:#2563eb;">${Number(stats.reserved || 0)}</strong>
      </div>
    </div>
  `;
}

async function renderAdmin() {
  if (!isAdmin) {
    login();
    return;
  }

  const titles = {
    dashboard: 'System Overview',
    map: 'Interactive Parking Map',
    slots: 'Slot Management & Setup',
    history: 'History & Audit Logs',
    settings: 'System & Security Settings'
  };

  const currentTitle = titles[page] || 'Dashboard';

  if (page === 'dashboard' || page === 'history') await loadRecords();

  let bodyHtml = '';

  // 1. DASHBOARD
  if (page === 'dashboard') {
    const recentRecords = records.slice(0, 5);

    bodyHtml = `
      ${adminStatsBar()}

      <!-- Campus Live Map Section -->
      <section class="app-card" style="margin-bottom:20px;">
        <div class="row between" style="margin-bottom:14px;">
          <div>
            <h2>Campus Parking Map</h2>
            <p class="muted">Click any vehicle slot to inspect its details, status, or active photo.</p>
          </div>
          <button class="button ghost small" data-nav="map">
            Full Map View ${icon('maximize-2', 14)}
          </button>
        </div>
        ${renderMapGrid(true)}
      </section>

      <!-- Recent Parking Activity -->
      <section class="app-card">
        <div class="row between" style="margin-bottom:14px;">
          <div>
            <h2>Recent Parking Records</h2>
            <p class="muted">Latest parked vehicles and active check-ins across campus.</p>
          </div>
          <button class="button soft small" data-nav="history">
            View All History ${icon('arrow-right', 14)}
          </button>
        </div>

        ${historyTable(recentRecords)}
      </section>
    `;
  }

  // 2. PARKING MAP
  else if (page === 'map') {
    bodyHtml = `
      ${adminStatsBar()}
      <section class="app-card">
        <div class="row between" style="margin-bottom:16px;">
          <div>
            <h2>Interactive Vehicle Map</h2>
            <p class="muted">Click any vehicle slot to inspect photos or log vehicle departures.</p>
          </div>
        </div>
        ${renderMapGrid(true)}
      </section>
    `;
  }

  // 3. HISTORY & AUDIT
  else if (page === 'history') {
    bodyHtml = `
      <section class="app-card">
        <div class="row between" style="margin-bottom:16px; flex-wrap:wrap; gap:12px;">
          <div>
            <h2>Vehicle Parking Records & History</h2>
            <p class="muted">Searchable audit trail of vehicle check-ins, reservations, and departures.</p>
          </div>
          <a class="button soft small" href="api/index.php?action=export">
            ${icon('download', 15)} Export CSV
          </a>
        </div>

        <div style="margin-bottom:16px;">
          <input id="history-search" class="inline-input" placeholder="Search by reference code or slot (e.g. P-01)…" style="max-width:360px;">
        </div>

        ${historyTable(records)}
      </section>
    `;
  }

  // 4. SLOT MANAGEMENT (SIDE-BY-SIDE AUTOMATIC & MANUAL ADDING)
  else if (page === 'slots') {
    // Automatically calculate next slot code and next logical row/column coordinates
    const nums = slots.map(s => {
      const m = String(s.slot_number).match(/\d+/);
      return m ? parseInt(m[0], 10) : 0;
    });
    const maxNum = nums.length ? Math.max(...nums) : 0;
    const nextLabel = 'P-' + String(maxNum + 1).padStart(2, '0');

    let nextRow = 1, nextCol = 1;
    if (slots.length > 0) {
      const maxRow = Math.max(1, ...slots.map(s => +s.row_position || 1));
      const slotsInMaxRow = slots.filter(s => +s.row_position === maxRow);
      const maxColInRow = Math.max(1, ...slotsInMaxRow.map(s => +s.column_position || 1));
      if (maxColInRow >= 5) {
        nextRow = maxRow + 1;
        nextCol = 1;
      } else {
        nextRow = maxRow;
        nextCol = maxColInRow + 1;
      }
    }

    bodyHtml = `
      <!-- Educational Guide: How to Add Vehicle Slot -->
      <section class="add-bay-helper">
        <h3>${icon('help-circle', 20)} Paano Magdagdag ng Bagong Vehicle Slot?</h3>
        <p>
          Ang campus parking grid ay binubuo ng <strong>Row (Hilera mula itaas pababa)</strong> at <strong>Column (Pwesto mula kaliwa pakanan)</strong>.
        </p>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:12px; margin-top:12px;">
          <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #bbf7d0;">
            <strong style="color:#14532d;">1. Vehicle Slot Code (Pangalan):</strong>
            <div style="font-size:12px; color:#475569; margin-top:2px;">Ang code na nakapaskil sa parking slot tulad ng <code>P-24</code>.</div>
          </div>
          <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #bbf7d0;">
            <strong style="color:#14532d;">2. Row (Hilera Pababa):</strong>
            <div style="font-size:12px; color:#475569; margin-top:2px;">Linya ng paradahan (Row 1 hanggang Row 5+).</div>
          </div>
          <div style="background:#fff; padding:10px 12px; border-radius:8px; border:1px solid #bbf7d0;">
            <strong style="color:#14532d;">3. Column (Pwesto Pahalang):</strong>
            <div style="font-size:12px; color:#475569; margin-top:2px;">Pwesto mula kaliwa pakanan (karaniwang 1 hanggang 5 slots bawat hilera).</div>
          </div>
        </div>
      </section>

      <!-- Side-by-side: Automatic Adding & Manual Adding -->
      <div class="add-slots-split-grid">
        <!-- Left: Automatic Adding Card with Admin Custom Name Input Box -->
        <section class="app-card" style="background:linear-gradient(145deg, #f0fdf4, #ffffff); border:1.5px solid #86efac; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <span class="badge available" style="margin-bottom:6px;">REKOMENDADONG SUSUNOD NA VEHICLE SLOT</span>
            <h2 style="margin:2px 0 6px;">Awtomatikong Pagdagdag (Auto-Place)</h2>
            <p class="muted" style="margin-bottom:14px;">
              Awtomatikong kinalkula ng system ang susunod na coordinate sa grid. Maaari mong ilagay o baguhin ang pangalan ng slot sa box sa ibaba:
            </p>

            <label class="field" style="margin-bottom:12px;">
              Pangalan / Code ng Slot (Admin Input)
              <div style="display:flex; gap:8px;">
                <input class="inline-input" id="quick-slot-label" value="${nextLabel}" placeholder="Hal. P-24" style="font-weight:700; font-size:15px; color:#166534;" required>
                <button class="button success" id="quick-add-btn" data-row="${nextRow}" data-col="${nextCol}" style="flex-shrink:0;">
                  ${icon('zap', 18)} Idagdag Na
                </button>
              </div>
            </label>
          </div>

          <div style="background:#fff; border:1px solid #bbf7d0; border-radius:var(--radius-md); padding:10px 14px; font-size:12.5px; color:#14532d; display:flex; align-items:center; justify-content:space-between; margin-top:10px;">
            <span>Awtomatikong Grid Coordinates:</span>
            <strong>Row ${nextRow} · Column ${nextCol}</strong>
          </div>
        </section>

        <!-- Right: Manual Adding Form -->
        <section class="app-card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <h2 style="margin-bottom:4px;">Manual na Pagdagdag ng Slot</h2>
            <p class="muted" style="margin-bottom:14px;">Maaari mong itakda ang sarili mong slot code at eksaktong Row at Column position.</p>

            <form id="add-slot-form" style="display:grid; grid-template-columns: 2fr 1fr 1fr; gap:10px;">
              <label class="field" style="margin:0;">
                Slot Label
                <input class="inline-input" id="new-slot-label" name="slot_number" value="${nextLabel}" placeholder="Hal. P-24" required>
              </label>

              <label class="field" style="margin:0;">
                Row (1-100)
                <input class="inline-input" id="new-slot-row" name="row" type="number" min="1" max="100" value="${nextRow}" required>
              </label>

              <label class="field" style="margin:0;">
                Column (1-5)
                <input class="inline-input" id="new-slot-col" name="column" type="number" min="1" max="100" value="${nextCol}" required>
              </label>

              <div style="grid-column: 1 / -1; margin-top:6px;">
                <button class="button primary full" style="height:42px;">
                  ${icon('plus', 18)} Idagdag Manual
                </button>
              </div>
            </form>
          </div>

          <div class="placement-preview-box" style="margin-top:10px; padding:10px 14px;">
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:12px;">
              <span>Placement: Row <span id="preview-row">${nextRow}</span>, Col <span id="preview-col">${nextCol}</span></span>
              <span class="badge available" id="placement-status">Pwesto ay Bakante</span>
            </div>
          </div>
        </section>
      </div>

      <!-- Existing Slots List -->
      <section class="app-card">
        <div class="row between" style="margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div>
            <h2 style="margin:0 0 4px;">Kasalukuyang mga Vehicle Parking Slots (${slots.length})</h2>
            <p class="muted" style="margin:0;">Maaari mong baguhin ang row/column coordinates o i-restrict/disable/i-delete ang mga vehicle slot.</p>
          </div>
          <div>
            ${slots.length > 0 ? `
              <button class="button danger small" id="delete-all-slots-btn" style="background:#dc2626; border-color:#dc2626; color:#fff; display:inline-flex; align-items:center; gap:6px;">
                ${icon('trash-2', 15)} Burahin Lahat (${slots.length})
              </button>
            ` : ''}
          </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; margin-top:16px;">
          ${slots.map(s => `
            <div style="border:1px solid var(--border-light); border-radius:var(--radius-md); padding:14px; background:#fff; box-shadow:var(--shadow-xs);">
              <div class="row between">
                <strong style="font-size:16px; font-family:'Manrope',sans-serif;">${esc(s.slot_number)}</strong>
                <span class="badge ${s.status}">${esc(s.is_enabled ? statusLabels[s.status] || s.status : 'Disabled')}</span>
              </div>

              <div style="display:grid; grid-template-columns: 2fr 1fr 1fr; gap:6px; margin-top:12px;">
                <label style="font-size:10px; color:var(--text-muted); font-weight:700;">
                  LABEL
                  <input class="inline-input" data-label="${s.id}" value="${esc(s.slot_number)}" style="padding:6px 8px; font-weight:700; margin-top:2px;">
                </label>
                <label style="font-size:10px; color:var(--text-muted); font-weight:700;">
                  ROW
                  <input class="inline-input" data-row="${s.id}" type="number" min="1" value="${+s.row_position}" style="padding:6px 8px; margin-top:2px;">
                </label>
                <label style="font-size:10px; color:var(--text-muted); font-weight:700;">
                  COL
                  <input class="inline-input" data-col="${s.id}" type="number" min="1" value="${+s.column_position}" style="padding:6px 8px; margin-top:2px;">
                </label>
              </div>

              <div class="row wrap" style="margin-top:12px; gap:6px;">
                <button class="button soft small" data-save-slot="${s.id}">
                  ${icon('check', 14)} I-save
                </button>
                ${s.status === 'occupied' || s.status === 'reserved' ? `
                  <button class="button success small" data-slot-op="release" data-id="${s.id}" data-slot-num="${esc(s.slot_number)}" title="Gawing Available ang slot">
                    ${icon('check-circle', 14)} I-available
                  </button>
                ` : ''}
                ${s.is_enabled ? `
                  <button class="button ghost small" data-slot-op="${s.status === 'restricted' ? 'unrestrict' : 'restrict'}" data-id="${s.id}">
                    ${s.status === 'restricted' ? 'Unrestrict' : 'Restrict'}
                  </button>
                  <button class="button ghost small" data-slot-op="disable" data-id="${s.id}">
                    Disable
                  </button>
                ` : `
                  <button class="button success small" data-slot-op="enable" data-id="${s.id}">
                    Enable
                  </button>
                `}
                <button class="button ghost small" data-slot-op="delete" data-id="${s.id}" data-slot-num="${esc(s.slot_number)}" style="color:#b91c1c; border-color:#fca5a5;" title="Burahin ang slot na ito">
                  ${icon('trash-2', 14)} I-delete
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  // 5. SETTINGS (INCLUDES CHANGE ADMIN PASSWORD)
  else if (page === 'settings') {
    bodyHtml = `
      <section class="app-card">
        <p class="eyebrow">SYSTEM & SECURITY</p>
        <h2>Operational Parameters</h2>
        <p class="muted">Anonymous student privacy by design. Images are stored securely on the private host filesystem.</p>

        <div class="notice info" style="margin-top:16px;">
          ${icon('info', 20)}
          <div>
            <strong>Zero Personal Data Collection.</strong>
            This application complies with student privacy by storing no student names, phone numbers, or license plates.
          </div>
        </div>
      </section>

      <!-- Change Admin Password Card -->
      <section class="app-card" style="margin-top:20px; max-width:540px;">
        <p class="eyebrow" style="color:var(--isu-primary);">ADMIN SECURITY</p>
        <h2 style="margin:2px 0 6px;">Palitan ang Admin Password</h2>
        <p class="muted" style="margin-bottom:16px;">
          Baguhin ang iyong password upang mapanatiling ligtas at protektado ang Admin Console.
        </p>

        <form id="change-pass-form">
          <label class="field">
            Kasalukuyang Password (Current Password)
            <div class="row" style="position:relative;">
              <input id="current-pass" type="password" required autocomplete="current-password" placeholder="Ilagay ang lumang password">
              <button type="button" class="icon-btn toggle-eye" data-target="current-pass" aria-label="Toggle password" style="position:absolute; right:6px;">
                ${icon('eye', 17)}
              </button>
            </div>
          </label>

          <label class="field">
            Bagong Password (New Password)
            <div class="row" style="position:relative;">
              <input id="new-pass" type="password" required minlength="6" autocomplete="new-password" placeholder="Hindi bababa sa 6 characters">
              <button type="button" class="icon-btn toggle-eye" data-target="new-pass" aria-label="Toggle password" style="position:absolute; right:6px;">
                ${icon('eye', 17)}
              </button>
            </div>
          </label>

          <label class="field">
            Kumpirmahin ang Bagong Password
            <div class="row" style="position:relative;">
              <input id="confirm-pass" type="password" required minlength="6" autocomplete="new-password" placeholder="Ulitin ang bagong password">
              <button type="button" class="icon-btn toggle-eye" data-target="confirm-pass" aria-label="Toggle password" style="position:absolute; right:6px;">
                ${icon('eye', 17)}
              </button>
            </div>
          </label>

          <p id="change-pass-error" class="notice error" hidden></p>
          <p id="change-pass-success" class="notice success" hidden></p>

          <button class="button primary" id="change-pass-btn" style="margin-top:10px;">
            ${icon('key', 16)} I-save ang Bagong Password
          </button>
        </form>
      </section>
    `;
  }

  adminShell(bodyHtml, currentTitle);
  wireAdminEvents();
  updateIcons();
}

function formatDayTitle(dStr) {
  if (!dStr || dStr === 'Walang Petsa') return 'Iba Pang Tala (Other Dates)';
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dStr === today) return 'Ngayong Araw (Today)';
  if (dStr === yest) return 'Kahapon (Yesterday)';
  try {
    const d = new Date(dStr + 'T00:00:00');
    return d.toLocaleDateString('fil-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  } catch(e) {
    return dStr;
  }
}

function historyTable(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty">Walang parking history records na nakatala sa ngayon.</div>';
  }

  // Group records by day (YYYY-MM-DD)
  const groups = {};
  for (const r of rows) {
    const rawDate = r.submitted_at || r.approved_at || '';
    const dayKey = rawDate.slice(0, 10) || 'Walang Petsa';
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(r);
  }

  // Sort days descending (newest day first)
  const sortedDays = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  return sortedDays.map(dayKey => {
    const dayRows = groups[dayKey];
    return `
      <section class="history-day-section" style="margin-bottom:24px;">
        <div class="history-day-header" style="display:flex; align-items:center; justify-content:space-between; background:linear-gradient(135deg, #f0fdf4, #f8fafc); border:1px solid #bbf7d0; border-radius:var(--radius-md); padding:10px 14px; margin-bottom:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:32px; height:32px; border-radius:8px; background:#dcfce7; color:#166534; display:grid; place-items:center;">
              ${icon('calendar', 18)}
            </div>
            <div>
              <strong style="color:#14532d; font-size:14px; display:block;">${esc(formatDayTitle(dayKey))}</strong>
              <small style="color:#64748b; font-size:11.5px;">Petsa: ${esc(dayKey)}</small>
            </div>
          </div>
          <span class="badge available" style="font-weight:700;">
            ${dayRows.length} ${dayRows.length === 1 ? 'Record' : 'Records'}
          </span>
        </div>

        <div class="table-wrap">
          <table class="history-day-table">
            <thead>
              <tr>
                <th>Reference (Phone/Device)</th>
                <th>Vehicle Slot</th>
                <th>Status</th>
                <th>IN</th>
                <th>OUT</th>
                <th>Photo</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${dayRows.map(r => {
                const isActive = (r.submission_status === 'approved' || r.submission_status === 'reserved') && !r.exited_at;
                const timeIn = r.approved_at || r.submitted_at || '—';
                const timeOut = r.exited_at || '—';
                return `
                  <tr data-search="${esc((r.reference_number + ' ' + r.slot_number + ' ' + r.submission_status + ' ' + dayKey).toLowerCase())}">
                    <td><strong>${esc(r.reference_number)}</strong></td>
                    <td><b>${esc(r.slot_number)}</b></td>
                    <td><span class="badge ${esc(r.submission_status)}">${esc(r.submission_status)}</span></td>
                    <td style="color:#166534; font-weight:600;">${esc(timeIn)}</td>
                    <td style="color:${r.exited_at ? '#dc2626' : '#94a3b8'}; font-weight:${r.exited_at ? '600' : '400'};">${esc(timeOut)}</td>
                    <td>
                      <button class="button ghost small" data-photo="${r.id}" title="Tingnan ang photo">
                        ${icon('image', 14)} View
                      </button>
                    </td>
                    <td>
                      ${isActive ? `
                        <button class="button success small" data-free-slot="${r.parking_slot_id}" data-slot-num="${esc(r.slot_number)}" style="padding:4px 8px; font-size:11.5px;" title="Gawing Available ang slot na ito">
                          ${icon('check-circle', 13)} I-available
                        </button>
                      ` : `
                        <span style="font-size:12px; color:#94a3b8;">Tapos na</span>
                      `}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join('');
}

function wireAdminEvents() {
  root.querySelectorAll('[data-slot]').forEach(b => {
    b.onclick = () => slotDetails(+b.dataset.slot);
  });

  root.querySelectorAll('[data-record]').forEach(b => {
    b.onclick = () => recordModal(+b.dataset.record);
  });

  root.querySelectorAll('[data-photo]').forEach(b => {
    b.onclick = () => photoModal(+b.dataset.photo);
  });

  const search = document.querySelector('#history-search');
  if (search) {
    search.oninput = () => {
      const q = search.value.toLowerCase();
      document.querySelectorAll('.history-day-section').forEach(sec => {
        let matchCount = 0;
        sec.querySelectorAll('tbody tr').forEach(tr => {
          const match = tr.dataset.search.includes(q);
          tr.hidden = !match;
          if (match) matchCount++;
        });
        sec.hidden = (matchCount === 0);
      });
    };
  }

  // Quick Action to free slot directly from history table
  root.querySelectorAll('[data-free-slot]').forEach(b => {
    b.onclick = async () => {
      const slotId = b.dataset.freeSlot;
      const slotNum = b.dataset.slotNum || '';
      if (!confirm(`Gawing Available ang Vehicle Slot "${slotNum}"? (Mababalik ito sa bakante para sa iba)`)) return;
      b.disabled = true;
      try {
        await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: 'release', id: slotId }) });
        toast(`Vehicle slot ${slotNum} is now Available.`);
        refresh();
      } catch (err) {
        toast(err.message);
        b.disabled = false;
      }
    };
  });

  const quickAddBtn = document.querySelector('#quick-add-btn');
  if (quickAddBtn) {
    quickAddBtn.onclick = async () => {
      const numInput = document.querySelector('#quick-slot-label');
      const slotNum = numInput ? numInput.value.trim() : '';
      if (!slotNum) {
        toast('Maglagay ng pangalan o label para sa bagong slot.');
        return;
      }
      const r = +quickAddBtn.dataset.row || 1;
      const c = +quickAddBtn.dataset.col || 1;
      quickAddBtn.disabled = true;
      quickAddBtn.innerHTML = `${icon('refresh-cw', 16, 'spin')} Adding slot…`;
      updateIcons();
      try {
        await api('slots-admin', {
          method: 'POST',
          body: JSON.stringify({ op: 'add', slot_number: slotNum, row: r, column: c })
        });
        toast(`Vehicle slot ${slotNum} added successfully at Row ${r}, Col ${c}!`);
        refresh();
      } catch (err) {
        toast(err.message);
        quickAddBtn.disabled = false;
        quickAddBtn.innerHTML = `${icon('zap', 18)} Subukan Muli`;
        updateIcons();
      }
    };
  }

  // Live placement checker on input changes
  const rowIn = document.querySelector('#new-slot-row');
  const colIn = document.querySelector('#new-slot-col');
  const statusBadge = document.querySelector('#placement-status');
  const pRow = document.querySelector('#preview-row');
  const pCol = document.querySelector('#preview-col');

  function checkPlacement() {
    if (!rowIn || !colIn || !statusBadge) return;
    const r = parseInt(rowIn.value, 10);
    const c = parseInt(colIn.value, 10);
    if (pRow) pRow.textContent = r || '?';
    if (pCol) pCol.textContent = c || '?';

    const existing = slots.find(s => +s.row_position === r && +s.column_position === c);
    if (existing) {
      statusBadge.className = 'badge rejected';
      statusBadge.textContent = `May nakapwesto na: ${existing.slot_number}`;
    } else {
      statusBadge.className = 'badge available';
      statusBadge.textContent = 'Pwesto ay Bakante';
    }
  }

  if (rowIn && colIn) {
    rowIn.oninput = checkPlacement;
    colIn.oninput = checkPlacement;
  }

  const addForm = document.querySelector('#add-slot-form');
  if (addForm) {
    addForm.onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(addForm));
      try {
        await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: 'add', ...d }) });
        toast(`Vehicle slot ${d.slot_number} added.`);
        refresh();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  root.querySelectorAll('[data-save-slot]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.saveSlot;
      const num = document.querySelector(`[data-label="${id}"]`).value;
      const row = document.querySelector(`[data-row="${id}"]`).value;
      const col = document.querySelector(`[data-col="${id}"]`).value;
      try {
        await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: 'update', id, slot_number: num, row, column: col }) });
        toast(`Vehicle slot ${num} saved.`);
        refresh();
      } catch (err) {
        toast(err.message);
      }
    };
  });

  root.querySelectorAll('[data-slot-op]').forEach(b => {
    b.onclick = async () => {
      const op = b.dataset.slotOp;
      const slotNum = b.dataset.slotNum || '';
      if (op === 'delete') {
        if (!confirm(`Sigurado ka bang nais mong burahin ang Vehicle Slot "${slotNum}"?`)) return;
      } else if (op === 'release') {
        if (!confirm(`Gawing Available ang Vehicle Slot "${slotNum}"? (Mababalik ito sa bakante para magamit muli)`)) return;
      }
      try {
        await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: op, id: b.dataset.id }) });
        toast(op === 'delete' ? 'Nai-delete na ang slot.' : (op === 'release' ? `Vehicle slot ${slotNum} is now Available.` : 'Slot status updated.'));
        refresh();
      } catch (err) {
        toast(err.message);
      }
    };
  });

  // Delete All Slots button
  const delAllBtn = document.querySelector('#delete-all-slots-btn');
  if (delAllBtn) {
    delAllBtn.onclick = async () => {
      if (!confirm(`BABALA: Sigurado ka bang nais mong burahin ang LAHAT ng ${slots.length} parking slots? Hindi na ito maibabalik.`)) return;
      delAllBtn.disabled = true;
      delAllBtn.innerHTML = `${icon('refresh-cw', 15, 'spin')} Binubura…`;
      updateIcons();
      try {
        await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: 'delete_all' }) });
        toast('Lahat ng parking slots ay matagumpay na nabura.');
        refresh();
      } catch (err) {
        toast(err.message);
        delAllBtn.disabled = false;
        delAllBtn.innerHTML = `${icon('trash-2', 15)} Burahin Lahat (${slots.length})`;
        updateIcons();
      }
    };
  }

  // Change Admin Password Form
  const changePassForm = document.querySelector('#change-pass-form');
  if (changePassForm) {
    changePassForm.querySelectorAll('.toggle-eye').forEach(btn => {
      btn.onclick = () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        btn.innerHTML = icon(isPass ? 'eye-off' : 'eye', 17);
        updateIcons();
      };
    });

    changePassForm.onsubmit = async e => {
      e.preventDefault();
      const currPass = document.querySelector('#current-pass').value;
      const newPass = document.querySelector('#new-pass').value;
      const confPass = document.querySelector('#confirm-pass').value;
      const errBox = document.querySelector('#change-pass-error');
      const succBox = document.querySelector('#change-pass-success');
      const submitBtn = document.querySelector('#change-pass-btn');

      errBox.hidden = true;
      succBox.hidden = true;

      if (newPass.length < 6) {
        errBox.textContent = 'Ang bagong password ay dapat mayroong hindi bababa sa 6 characters.';
        errBox.hidden = false;
        return;
      }

      if (newPass !== confPass) {
        errBox.textContent = 'Hindi magkatugma ang bagong password at ang kumpirmasyon nito.';
        errBox.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = `${icon('refresh-cw', 16, 'spin')} Sine-save ang password…`;
      updateIcons();

      try {
        const res = await api('change-password', {
          method: 'POST',
          body: JSON.stringify({ current_password: currPass, new_password: newPass })
        });
        succBox.textContent = res.message || 'Matagumpay na nabago ang iyong admin password!';
        succBox.hidden = false;
        changePassForm.reset();
        toast('Password updated successfully!');
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${icon('key', 16)} I-save ang Bagong Password`;
        updateIcons();
      }
    };
  }
}

// --------------------------------------------------------------------------
// 6. ADMIN MODAL DIALOGS
// --------------------------------------------------------------------------
function showModal(content, wide = false) {
  const m = document.createElement('div');
  m.className = 'modal-backdrop';
  m.innerHTML = `<section class="modal ${wide ? 'wide' : ''}">${content}</section>`;
  document.body.append(m);
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => m.remove());
  m.onclick = e => { if (e.target === m) m.remove(); };
  updateIcons();
  return m;
}

async function photoModal(recordId) {
  const res = await api('photo&record_id=' + recordId);
  if (!res.ok) {
    toast(res.status === 401 ? 'Please sign in again.' : 'Photo unavailable.');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);

  showModal(`
    <div class="modal-title">
      <h2>Submitted Photo Preview</h2>
      <button class="icon-btn" data-close>${icon('x', 20)}</button>
    </div>
    <img class="photo-preview" src="${url}" alt="Motorcycle photo">
  `, true);
}

async function slotDetails(id) {
  const slot = slots.find(s => +s.id === id);
  if (!slot) return;

  if (slot.status === 'available' || slot.status === 'restricted') {
    showModal(`
      <div class="modal-title">
        <h2>Vehicle Slot ${esc(slot.slot_number)}</h2>
        <button class="icon-btn" data-close>${icon('x', 20)}</button>
      </div>
      <p><span class="badge ${slot.status}">${esc(statusLabels[slot.status] || 'Disabled')}</span></p>
      <p class="muted">
        ${slot.status === 'available' ? 'Bakante at handang gamitin ang slot na ito.' : 'Restricted mula sa student parking ang slot na ito.'}
      </p>
    `);
    return;
  }

  if (slot.status === 'reserved') {
    const allRecords = await loadRecords();
    const r = allRecords.find(x => +x.parking_slot_id === id && x.submission_status === 'reserved' && !x.exited_at);
    const m = showModal(`
      <div class="modal-title">
        <div>
          <p class="eyebrow" style="color:#2563eb;">RESERVED VEHICLE SLOT</p>
          <h2>Vehicle Slot ${esc(slot.slot_number)}</h2>
        </div>
        <button class="icon-btn" data-close>${icon('x', 20)}</button>
      </div>
      <div style="margin:14px 0; background:#eff6ff; border:1px solid #bfdbfe; border-radius:var(--radius-md); padding:12px 14px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span class="badge reserved">Naka-reserve</span>
          ${r ? `<span style="font-size:12px; color:#1e40af; font-weight:700;">Ref: ${esc(r.reference_number)}</span>` : ''}
        </div>
        <p style="margin:6px 0 0; font-size:12.5px; color:#1e3a8a;">
          ${r ? `Oras: <strong>${esc(r.submitted_at)}</strong><br>` : ''}
          Naka-hold ang slot na ito. Kung hindi sumipot o lumampas na ang oras ng estudyante, maaari mo itong gawing <strong>Available</strong> muli upang magamit ng iba.
        </p>
      </div>
      <button class="button success full" id="admin-free-res-btn" style="margin-top:10px;">
        ${icon('check-circle', 16)} I-available ang Slot (Kanselahin ang Reserve)
      </button>
    `);
    const fBtn = m.querySelector('#admin-free-res-btn');
    if (fBtn) {
      fBtn.onclick = async () => {
        if (!confirm(`Kanselahin ang reserbasyon at gawing Available ang Vehicle Slot "${slot.slot_number}"?`)) return;
        fBtn.disabled = true;
        try {
          await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: 'release', id: slot.id }) });
          m.remove();
          toast(`Vehicle slot ${slot.slot_number} is now Available.`);
          refresh();
        } catch(e) {
          toast(e.message);
          fBtn.disabled = false;
        }
      };
    }
    return;
  }

  const allRecords = await loadRecords();
  const r = allRecords.find(x => +x.parking_slot_id === id && (
    (slot.status === 'pending' && x.submission_status === 'pending') ||
    (slot.status === 'occupied' && x.submission_status === 'approved' && !x.exited_at)
  ));

  if (r) {
    recordModal(+r.id);
  } else {
    const m = showModal(`
      <div class="modal-title">
        <div>
          <p class="eyebrow" style="color:#dc2626;">OCCUPIED VEHICLE SLOT</p>
          <h2>Vehicle Slot ${esc(slot.slot_number)}</h2>
        </div>
        <button class="icon-btn" data-close>${icon('x', 20)}</button>
      </div>
      <p class="muted">
        Naka-occupy ang slot na ito. Kung umalis na ang motor at hindi na-leave, maaari mo itong i-release upang maging Available muli.
      </p>
      <button class="button success full" id="admin-force-free-btn" style="margin-top:14px;">
        ${icon('check-circle', 16)} I-available ang Slot (Umalis na ang Motor)
      </button>
    `);
    const fBtn = m.querySelector('#admin-force-free-btn');
    if (fBtn) {
      fBtn.onclick = async () => {
        fBtn.disabled = true;
        try {
          await api('slots-admin', { method: 'POST', body: JSON.stringify({ op: 'release', id: slot.id }) });
          m.remove();
          toast(`Vehicle slot ${slot.slot_number} is now Available.`);
          refresh();
        } catch(e) {
          toast(e.message);
          fBtn.disabled = false;
        }
      };
    }
  }
}

async function recordModal(id) {
  const all = records.length ? records : await loadRecords();
  const r = all.find(x => +x.id === id);
  if (!r) return toast('Record not found.');

  const isPending = r.submission_status === 'pending';
  const isApproved = r.submission_status === 'approved';

  const m = showModal(`
    <div class="modal-title">
      <div>
        <p class="eyebrow">REF: ${esc(r.reference_number)}</p>
        <h2>Vehicle Slot ${esc(r.slot_number)}</h2>
      </div>
      <button class="icon-btn" data-close>${icon('x', 20)}</button>
    </div>

    <div id="record-photo-box" class="camera-box">
      <span style="color:#94a3b8;">Loading private photo…</span>
    </div>

    <div class="row between" style="margin-bottom:12px;">
      <span class="muted">Submitted: <strong>${esc(r.submitted_at)}</strong></span>
      <span class="badge ${esc(r.submission_status)}">${esc(r.submission_status)}</span>
    </div>

    ${isPending ? `
      <label class="field" style="margin-top:14px;">
        Optional Rejection Reason:
        <div class="reason-chips">
          <span class="reason-chip" data-val="Blurry or unreadable photo">Blurry photo</span>
          <span class="reason-chip" data-val="Parked outside slot lines">Outside lines</span>
          <span class="reason-chip" data-val="No vehicle visible in stall">No vehicle</span>
          <span class="reason-chip" data-val="Wrong slot selected">Wrong slot</span>
        </div>
        <textarea id="reject-reason" rows="2" maxlength="500" placeholder="Reason for rejection…"></textarea>
      </label>

      <div class="row" style="justify-content:flex-end; gap:10px; margin-top:14px;">
        <button class="button danger" id="reject-btn">
          ${icon('x', 16)} Reject
        </button>
        <button class="button success" id="approve-btn">
          ${icon('check', 16)} Approve & Mark Occupied
        </button>
      </div>
    ` : isApproved ? `
      <div class="notice info">
        Oras ng Check-in (IN): <strong>${esc(r.approved_at || r.submitted_at || '')}</strong>
      </div>
      <button class="button success full" id="exit-btn" style="margin-top:12px;">
        ${icon('check-circle', 16)} I-mark bilang Available (Umalis na ang Motor / Free Slot)
      </button>
    ` : `
      <div class="notice ${r.submission_status === 'rejected' ? 'error' : 'info'}">
        ${r.submission_status === 'rejected' ? 'Reason: ' + esc(r.rejection_reason || 'Not specified') : 'Completed ' + esc(r.exited_at || '')}
      </div>
    `}
  `, true);

  m.querySelectorAll('.reason-chip').forEach(chip => {
    chip.onclick = () => {
      const txt = m.querySelector('#reject-reason');
      if (txt) txt.value = chip.dataset.val;
    };
  });

  const res = await api('photo&record_id=' + id);
  if (res.ok) {
    const photoUrl = URL.createObjectURL(await res.blob());
    const box = m.querySelector('#record-photo-box');
    box.innerHTML = `<img class="photo-preview" src="${photoUrl}" alt="Vehicle Photo" style="cursor:zoom-in;">`;
    box.querySelector('img').onclick = () => window.open(photoUrl, '_blank', 'noopener');
  } else {
    m.querySelector('#record-photo-box').innerHTML = '<div style="padding:20px; color:#ef4444;">Photo unavailable.</div>';
  }

  const verify = async decision => {
    const reason = m.querySelector('#reject-reason')?.value || '';
    if (decision === 'reject' && !confirm('Reject this submission and return slot to available?')) return;
    try {
      await api('verify', {
        method: 'POST',
        body: JSON.stringify({ record_id: id, decision, reason })
      });
      m.remove();
      toast(decision === 'approve' ? 'Submission approved.' : 'Submission rejected.');
      refresh();
    } catch (err) {
      toast(err.message);
    }
  };

  const aBtn = m.querySelector('#approve-btn');
  const rBtn = m.querySelector('#reject-btn');
  const eBtn = m.querySelector('#exit-btn');

  if (aBtn) aBtn.onclick = () => verify('approve');
  if (rBtn) rBtn.onclick = () => verify('reject');
  if (eBtn) {
    eBtn.onclick = async () => {
      if (!confirm(`Confirm that vehicle in slot ${r.slot_number} has exited?`)) return;
      try {
        await api('exit', { method: 'POST', body: JSON.stringify({ record_id: id }) });
        m.remove();
        toast('Departure logged. Vehicle slot is now available.');
        refresh();
      } catch (err) {
        toast(err.message);
      }
    };
  }
}

// --------------------------------------------------------------------------
// 7. AUTH LOGOUT & INITIALIZATION
// --------------------------------------------------------------------------
async function logout() {
  try {
    await api('logout', { method: 'POST', body: '{}' });
  } catch (err) {}
  isAdmin = false;
  adminName = '';
  home();
  toast('Signed out successfully.');
}

async function init() {
  try {
    const sess = await api('csrf');
    csrf = sess.token;
    isAdmin = sess.admin;
    if (isAdmin) adminName = 'Administrator';
    home();
    await refresh();
    startPolling();
  } catch (err) {
    home();
    setTimeout(refresh, 500);
  }
}

// --------------------------------------------------------------------------
// 8. PROGRESSIVE WEB APP (PWA) INSTALLATION FOR ANDROID PHONES
// --------------------------------------------------------------------------
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const banner = document.getElementById('pwa-install-banner');
  if (banner && !sessionStorage.getItem('isu_pwa_dismissed')) {
    banner.style.display = 'flex';
  }

  document.querySelectorAll('.pwa-install-btn').forEach(b => {
    b.style.display = 'inline-flex';
  });
});

window.addEventListener('appinstalled', () => {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'none';
  document.querySelectorAll('.pwa-install-btn').forEach(b => {
    b.style.display = 'none';
  });
  deferredPrompt = null;
  toast('ISU Parking App is successfully installed!');
});

function triggerPwaInstall() {
  if (deferredPrompt) {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choiceResult => {
      if (choiceResult.outcome === 'accepted') {
        toast('Salamat! Ini-install na ang ISU Parking App sa iyong phone.');
      }
      deferredPrompt = null;
    });
  } else {
    toast('Para i-install: Pindutin ang menu (⋮) sa Chrome/browser at piliin ang "Install app" o "Add to Home screen".');
  }
}

const pwaInstallAction = document.getElementById('pwa-install-action');
if (pwaInstallAction) {
  pwaInstallAction.onclick = triggerPwaInstall;
}

const pwaCloseAction = document.getElementById('pwa-close-action');
if (pwaCloseAction) {
  pwaCloseAction.onclick = () => {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
    sessionStorage.setItem('isu_pwa_dismissed', '1');
  };
}

window.addEventListener('beforeunload', stopCamera);
init();

})();
