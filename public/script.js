// Smart Parking System - Frontend Controller & Real-Time Sync

let currentTab = 1;
let pollingInterval = null;
let currentUser = null;
let authToken = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTheme();
  initTabSystem();
  
  // Initial immediate fetch
  fetchParkingStatus();
  
  // Start high-frequency polling every 1.5 seconds
  pollingInterval = setInterval(() => {
    fetchParkingStatus();
    if (currentTab === 2) fetchSlotsData();
    if (currentTab === 3) fetchReservationsData();
  }, 1500);
});

// -------------------------------------------------------------
// AUTHENTICATION & SESSION
// -------------------------------------------------------------
function initAuth() {
  authToken = localStorage.getItem('parking_token');
  const userJson = localStorage.getItem('parking_user');

  if (!authToken || !userJson) {
    window.location.href = 'index.html';
    return;
  }

  try {
    currentUser = JSON.parse(userJson);
    const userDisplay = document.getElementById('userNameHeader');
    if (userDisplay && currentUser) {
      userDisplay.textContent = currentUser.name || currentUser.email;
    }
  } catch (e) {
    handleLogout();
  }
}

function handleLogout() {
  localStorage.removeItem('parking_token');
  localStorage.removeItem('parking_user');
  window.location.href = 'index.html';
}

// -------------------------------------------------------------
// THEME (LIGHT / DARK) SYSTEM
// -------------------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem('parking_theme') || 'dark';
  applyTheme(savedTheme);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const newTheme = isDark ? 'light' : 'dark';
  applyTheme(newTheme);
  localStorage.setItem('parking_theme', newTheme);
}

function applyTheme(theme) {
  const root = document.documentElement;
  const icon = document.getElementById('themeToggleIcon');

  if (theme === 'light') {
    root.classList.remove('dark');
    if (icon) {
      icon.className = 'fa-solid fa-sun text-amber-500';
    }
  } else {
    root.classList.add('dark');
    if (icon) {
      icon.className = 'fa-solid fa-moon text-brand-300';
    }
  }
}

// -------------------------------------------------------------
// NAVIGATION TABS
// -------------------------------------------------------------
function initTabSystem() {
  switchDashboardTab(1);
}

function switchDashboardTab(tabNum) {
  currentTab = tabNum;

  // Toggle Tab Contents
  for (let i = 1; i <= 3; i++) {
    const content = document.getElementById(`tabContent${i}`);
    const btn = document.getElementById(`tabBtn${i}`);
    
    if (i === tabNum) {
      content.classList.remove('hidden');
      btn.className = "tab-btn active-tab py-3 px-4 sm:px-6 font-bold text-sm sm:text-base border-b-2 border-brand-500 text-brand-300 flex items-center gap-2.5 transition-all";
    } else {
      content.classList.add('hidden');
      btn.className = "tab-btn py-3 px-4 sm:px-6 font-medium text-sm sm:text-base border-b-2 border-transparent text-slate-400 hover:text-brand-300 flex items-center gap-2.5 transition-all";
    }
  }

  // Load specific tab data on switch
  if (tabNum === 2) {
    fetchSlotsData();
  } else if (tabNum === 3) {
    fetchReservationsData();
  }
}

// -------------------------------------------------------------
// REAL-TIME STATUS POLLING (TAB 1)
// -------------------------------------------------------------
async function fetchParkingStatus() {
  try {
    const res = await fetch('/api/parking/status');
    if (!res.ok) throw new Error('Status fetch failed');
    const data = await res.json();

    updateEspStatus(data.espOnline);
    updateKpiCards(data);
    updateSlotDisplays(data.slots);

    const syncEl = document.getElementById('lastSyncTime');
    if (syncEl) {
      const now = new Date();
      syncEl.textContent = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    }
  } catch (err) {
    console.error('Error fetching parking status:', err);
    updateEspStatus(false);
  }
}

function updateEspStatus(isOnline) {
  const badge = document.getElementById('espStatusBadge');
  const dot = document.getElementById('espStatusDot');
  const text = document.getElementById('espStatusText');

  const badgeMob = document.getElementById('espStatusBadgeMobile');
  const textMob = document.getElementById('espStatusTextMobile');

  if (isOnline) {
    const onlineClasses = "inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-all duration-300 bg-emerald-950/40 border-emerald-500/40 text-emerald-300";
    if (badge) badge.className = onlineClasses;
    if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 pulse-active shadow-sm shadow-emerald-400/50";
    if (text) text.textContent = "ESP8266 STATUS: ONLINE";

    if (badgeMob) badgeMob.className = "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border bg-emerald-950/40 border-emerald-500/40 text-emerald-300";
    if (textMob) textMob.textContent = "ESP8266: ONLINE";
  } else {
    const offlineClasses = "inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-all duration-300 bg-red-950/40 border-red-500/40 text-red-300";
    if (badge) badge.className = offlineClasses;
    if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-red-500 pulse-active";
    if (text) text.textContent = "ESP8266 STATUS: OFFLINE";

    if (badgeMob) badgeMob.className = "inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border bg-red-950/40 border-red-500/40 text-red-300";
    if (textMob) textMob.textContent = "ESP8266: OFFLINE";
  }
}

function updateKpiCards(data) {
  document.getElementById('kpiTotalSlots').textContent = data.totalSlots ?? 2;
  document.getElementById('kpiAvailableSlots').textContent = data.availableSlots ?? 0;
  document.getElementById('kpiReservedSlots').textContent = data.reservedSlots ?? 0;
  document.getElementById('kpiOccupiedSlots').textContent = data.occupiedSlots ?? 0;
}

function updateSlotDisplays(slots) {
  if (!slots) return;

  renderSingleSlot(1, slots.slot1);
  renderSingleSlot(2, slots.slot2);
}

function renderSingleSlot(slotNum, slot) {
  if (!slot) return;

  const status = slot.status.toLowerCase(); // 'available', 'reserved', 'occupied'
  const isVehicle = slot.vehicleDetected;
  const isReserved = slot.reserved;

  // --- Visual Bay Graphic in Parking Area ---
  const bayGraphic = document.getElementById(`bayGraphic${slotNum}`);
  const bayIcon = document.getElementById(`bayVehicleIcon${slotNum}`);
  const bayStatus = document.getElementById(`bayVisualStatus${slotNum}`);

  if (bayGraphic && bayIcon && bayStatus) {
    if (status === 'available') {
      bayGraphic.className = "relative rounded-2xl p-5 border-2 transition-all duration-300 flex flex-col items-center justify-between min-h-[260px] bg-slate-900/60 border-emerald-500/50 shadow-lg shadow-emerald-500/10";
      bayIcon.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-2 transition-all duration-300 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
      bayIcon.innerHTML = `<i class="fa-solid fa-square-parking"></i>`;
      bayStatus.className = "text-sm font-extrabold tracking-wider text-emerald-400";
      bayStatus.innerHTML = `🟢 FREE`;
    } else if (status === 'reserved') {
      bayGraphic.className = "relative rounded-2xl p-5 border-2 transition-all duration-300 flex flex-col items-center justify-between min-h-[260px] bg-slate-900/60 border-amber-500/50 shadow-lg shadow-amber-500/10";
      bayIcon.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-2 transition-all duration-300 bg-amber-500/15 text-amber-400 border border-amber-500/30";
      bayIcon.innerHTML = `<i class="fa-solid fa-clock"></i>`;
      bayStatus.className = "text-sm font-extrabold tracking-wider text-amber-400";
      bayStatus.innerHTML = `🟡 RESERVED`;
    } else {
      // Occupied
      bayGraphic.className = "relative rounded-2xl p-5 border-2 transition-all duration-300 flex flex-col items-center justify-between min-h-[260px] bg-slate-900/60 border-rose-500/50 shadow-lg shadow-rose-500/10";
      bayIcon.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-2 transition-all duration-300 bg-rose-500/15 text-rose-400 border border-rose-500/30";
      bayIcon.innerHTML = `<i class="fa-solid fa-car-side"></i>`;
      bayStatus.className = "text-sm font-extrabold tracking-wider text-rose-400";
      bayStatus.innerHTML = `🔴 OCCUPIED`;
    }
  }

  // --- Interactive Control Card ---
  const slotCard = document.getElementById(`slotCard${slotNum}`);
  const slotBadge = document.getElementById(`slotBadge${slotNum}`);
  const slotVehicle = document.getElementById(`slotVehicle${slotNum}`);
  const slotLed = document.getElementById(`slotLed${slotNum}`);
  const actionContainer = document.getElementById(`slotActionContainer${slotNum}`);

  // Vehicle sensor display
  if (slotVehicle) {
    if (isVehicle) {
      slotVehicle.className = "font-bold text-rose-400 flex items-center gap-1";
      slotVehicle.innerHTML = `<i class="fa-solid fa-car"></i> Detected`;
    } else {
      slotVehicle.className = "font-bold text-emerald-400 flex items-center gap-1";
      slotVehicle.innerHTML = `<i class="fa-solid fa-check"></i> Not Detected`;
    }
  }

  // LED status display
  if (slotLed) {
    const isLedOn = slot.ledStatus === 'ON';
    slotLed.className = isLedOn ? "font-bold text-amber-400 flex items-center gap-1" : "font-bold text-slate-400 flex items-center gap-1";
    slotLed.innerHTML = isLedOn 
      ? `<i class="fa-solid fa-lightbulb text-amber-400"></i> ON` 
      : `<i class="fa-regular fa-lightbulb"></i> OFF`;
  }

  // Status Badge and Action Button
  if (status === 'available') {
    if (slotCard) slotCard.className = "glass-card rounded-2xl p-6 border-t-4 slot-available transition-all";
    if (slotBadge) {
      slotBadge.className = "badge-available px-3.5 py-1 rounded-full text-xs font-extrabold tracking-wider";
      slotBadge.textContent = "🟢 AVAILABLE";
    }
    if (actionContainer) {
      actionContainer.innerHTML = `
        <button onclick="handleReserveSlot(${slotNum})"
          class="w-full py-3 px-4 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-brand-600 via-brand-500 to-purple-600 hover:from-brand-500 hover:to-purple-500 shadow-lg shadow-brand-600/30 transform hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
          <i class="fa-solid fa-calendar-check"></i>
          <span>RESERVE SLOT ${slotNum}</span>
        </button>
      `;
    }
  } else if (status === 'reserved') {
    if (slotCard) slotCard.className = "glass-card rounded-2xl p-6 border-t-4 slot-reserved transition-all";
    if (slotBadge) {
      slotBadge.className = "badge-reserved px-3.5 py-1 rounded-full text-xs font-extrabold tracking-wider";
      slotBadge.textContent = "🟡 RESERVED";
    }
    if (actionContainer) {
      actionContainer.innerHTML = `
        <button onclick="handleCancelSlot(${slotNum})"
          class="w-full py-3 px-4 rounded-xl font-bold text-sm text-amber-200 bg-amber-950/60 hover:bg-amber-900/70 border border-amber-500/40 shadow-lg shadow-amber-950/30 transform hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2">
          <i class="fa-solid fa-ban"></i>
          <span>CANCEL RESERVATION (SLOT ${slotNum})</span>
        </button>
      `;
    }
  } else {
    // Occupied
    if (slotCard) slotCard.className = "glass-card rounded-2xl p-6 border-t-4 slot-occupied transition-all";
    if (slotBadge) {
      slotBadge.className = "badge-occupied px-3.5 py-1 rounded-full text-xs font-extrabold tracking-wider";
      slotBadge.textContent = "🔴 OCCUPIED";
    }
    if (actionContainer) {
      actionContainer.innerHTML = `
        <button disabled
          class="w-full py-3 px-4 rounded-xl font-bold text-sm text-slate-400 bg-slate-800/40 border border-slate-700/50 cursor-not-allowed flex items-center justify-center gap-2 opacity-75">
          <i class="fa-solid fa-lock"></i>
          <span>NOT AVAILABLE (OCCUPIED)</span>
        </button>
      `;
    }
  }
}

// -------------------------------------------------------------
// TAB 2: PARKING SLOT MANAGEMENT TABLE
// -------------------------------------------------------------
async function fetchSlotsData() {
  try {
    const res = await fetch('/api/parking/slots');
    if (!res.ok) throw new Error('Failed to fetch slot table');
    const data = await res.json();
    renderSlotsTable(data.slots);
  } catch (err) {
    console.error('Error in fetchSlotsData:', err);
  }
}

function renderSlotsTable(slots) {
  const tbody = document.getElementById('slotsTableBody');
  if (!tbody || !slots) return;

  if (slots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No slot data available.</td></tr>`;
    return;
  }

  tbody.innerHTML = slots.map(slot => {
    let statusClass = "badge-available";
    let statusIcon = "🟢";

    if (slot.rawStatus === 'reserved') {
      statusClass = "badge-reserved";
      statusIcon = "🟡";
    } else if (slot.rawStatus === 'occupied') {
      statusClass = "badge-occupied";
      statusIcon = "🔴";
    }

    const ledBadge = slot.led === 'ON'
      ? `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1.5"><i class="fa-solid fa-lightbulb text-[10px]"></i> ON</span>`
      : `<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1.5"><i class="fa-regular fa-lightbulb text-[10px]"></i> OFF</span>`;

    const vehicleBadge = slot.vehicle === 'Yes'
      ? `<span class="text-rose-400 font-bold inline-flex items-center gap-1"><i class="fa-solid fa-car"></i> Yes</span>`
      : `<span class="text-emerald-400 font-medium inline-flex items-center gap-1"><i class="fa-solid fa-check"></i> No</span>`;

    const reservedBadge = slot.reserved === 'Yes'
      ? `<span class="text-amber-400 font-bold inline-flex items-center gap-1"><i class="fa-solid fa-calendar-check"></i> Yes</span>`
      : `<span class="text-slate-400 font-medium">No</span>`;

    return `
      <tr class="hover:bg-brand-900/20 transition-colors">
        <td class="py-4 px-6 font-mono text-xs text-brand-300">${slot.slotNumber}</td>
        <td class="py-4 px-6 font-bold text-white">${slot.slotName}</td>
        <td class="py-4 px-6">
          <span class="${statusClass} px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5">
            ${statusIcon} ${slot.status}
          </span>
        </td>
        <td class="py-4 px-6">${reservedBadge}</td>
        <td class="py-4 px-6">${vehicleBadge}</td>
        <td class="py-4 px-6">${ledBadge}</td>
        <td class="py-4 px-6 text-xs text-slate-300 font-mono">${slot.updatedAt || 'N/A'}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// TAB 3: RESERVATION MANAGEMENT TABLE
// -------------------------------------------------------------
async function fetchReservationsData() {
  try {
    const res = await fetch('/api/parking/reservations');
    if (!res.ok) throw new Error('Failed to fetch reservations');
    const data = await res.json();
    renderReservationsTable(data.reservations);
  } catch (err) {
    console.error('Error in fetchReservationsData:', err);
  }
}

function renderReservationsTable(reservations) {
  const tbody = document.getElementById('reservationsTableBody');
  if (!tbody || !reservations) return;

  if (reservations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">No reservations recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = reservations.map(r => {
    const isActive = r.rawStatus === 'active';
    const statusBadge = isActive
      ? `<span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1.5"><i class="fa-solid fa-clock"></i> ACTIVE</span>`
      : `<span class="px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 inline-flex items-center gap-1.5"><i class="fa-solid fa-ban"></i> CANCELLED</span>`;

    const actionBtn = isActive
      ? `<button onclick="handleCancelSlot(${r.slotNumber})" class="py-1.5 px-3 rounded-lg bg-red-950/50 hover:bg-red-900/60 border border-red-500/30 text-red-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 mx-auto transition-all">
          <i class="fa-solid fa-xmark"></i> Cancel
        </button>`
      : `<span class="text-xs text-slate-500 italic">No Action</span>`;

    return `
      <tr class="hover:bg-brand-900/20 transition-colors">
        <td class="py-4 px-6 font-mono text-xs text-brand-300">${r.index}</td>
        <td class="py-4 px-6 font-bold text-white">${r.slotName}</td>
        <td class="py-4 px-6">
          <div class="font-medium text-white">${r.userName}</div>
          <div class="text-[11px] text-slate-400">${r.userEmail}</div>
        </td>
        <td class="py-4 px-6">${statusBadge}</td>
        <td class="py-4 px-6 text-xs text-slate-200 font-mono">${r.date}</td>
        <td class="py-4 px-6 text-xs text-slate-200 font-mono">${r.time}</td>
        <td class="py-4 px-6 text-center">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// USER ACTIONS: RESERVE & CANCEL
// -------------------------------------------------------------
async function handleReserveSlot(slotNum) {
  try {
    const res = await fetch('/api/parking/reserve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ slot: slotNum })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`Slot ${slotNum} Reserved Successfully!`, 'success');
      // Immediate refresh
      fetchParkingStatus();
      if (currentTab === 2) fetchSlotsData();
      if (currentTab === 3) fetchReservationsData();
    } else {
      showToast(data.message || `Could not reserve Slot ${slotNum}`, 'error');
    }
  } catch (err) {
    showToast('Network error while requesting reservation.', 'error');
  }
}

async function handleCancelSlot(slotNum) {
  try {
    const res = await fetch('/api/parking/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ slot: slotNum })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`Reservation for Slot ${slotNum} Cancelled.`, 'info');
      // Immediate refresh
      fetchParkingStatus();
      if (currentTab === 2) fetchSlotsData();
      if (currentTab === 3) fetchReservationsData();
    } else {
      showToast(data.message || `Failed to cancel reservation for Slot ${slotNum}`, 'error');
    }
  } catch (err) {
    showToast('Network error while cancelling reservation.', 'error');
  }
}

// -------------------------------------------------------------
// TOAST NOTIFICATION POPUPS
// -------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  let bgClass = "bg-brand-950/90 border-brand-500 text-white";
  let icon = "fa-circle-info text-brand-400";

  if (type === 'success') {
    bgClass = "bg-emerald-950/95 border-emerald-500 text-emerald-100 shadow-emerald-950/50";
    icon = "fa-circle-check text-emerald-400";
  } else if (type === 'error') {
    bgClass = "bg-rose-950/95 border-rose-500 text-rose-100 shadow-rose-950/50";
    icon = "fa-triangle-exclamation text-rose-400";
  } else if (type === 'info') {
    bgClass = "bg-amber-950/95 border-amber-500 text-amber-100 shadow-amber-950/50";
    icon = "fa-circle-info text-amber-400";
  }

  toast.className = `p-4 rounded-2xl border shadow-2xl backdrop-blur-xl flex items-center gap-3 text-sm font-semibold pointer-events-auto transform translate-y-2 opacity-0 transition-all duration-300 ${bgClass}`;
  toast.innerHTML = `<i class="fa-solid ${icon} text-lg"></i><span>${message}</span>`;

  container.appendChild(toast);

  // Trigger enter animation
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  // Auto remove after 3.5 seconds
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
