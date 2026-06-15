// --- Supabase Config & Client Initialization ---
const supabaseUrl = 'https://zohvjmhozxvolaewcyzm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvaHZqbWhvenh2b2xhZXdjeXptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MDYyMTUsImV4cCI6MjA5NzA4MjIxNX0.3podQZ8gyr_fLqABRa16T87PZ7WSsP7X-sBwtkVDI-A';
const _supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// --- State Cache ---
let PROVIDER_ID = 'linkfire'; 
let USER_ROLE = 'client'; 
let PROVIDER_DISPLAY_NAME = 'LinkFire';
let realtimeChannel = null;

let state = {
    schedules: [],
    capacities: {},
    reasons: [
        'Sem conexão',
        'Lentidão',
        'LED LOS vermelho',
        'Troca de equipamento',
        'Rompimento de cabo',
        'Instalação',
        'Manutenção preventiva'
    ],
    statuses: [
        { name: 'Confirmado', color: '#2e7d32' },
        { name: 'Em contato', color: '#0288d1' },
        { name: 'Agendado/Sem confirmação', color: '#ed6c02' },
        { name: 'Reagendar', color: '#8e24aa' },
        { name: 'Realizado', color: '#4caf50' },
        { name: 'Cancelado', color: '#d32f2f' }
    ],
    defaultMorning: 5,
    defaultAfternoon: 5,
    retentionDays: 0,
    hqName: '',
    hqLat: -1.3780,
    hqLng: -48.3720
};

let activeDate = '';
let daysList = [];
let currentActiveDropdownId = null;

let shiftFilters = {
    morning: 'all',
    afternoon: 'all'
};

// --- Super Admin State ---
let adminSelectedProvider = '';

// --- Auth Observers ---
_supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        handleUserSession(session);
    } else {
        showView('view-login');
    }
});

function handleUserSession(session) {
    const email = session.user.email;
    const metadata = session.user.user_metadata || {};
    
    if (metadata.role === 'super-admin' || email === 'admin@gavisp.com.br') {
        USER_ROLE = 'super-admin';
        showView('view-super-admin');
        initSuperAdmin();
    } else {
        USER_ROLE = 'client';
        PROVIDER_ID = metadata.provider_id || 'linkfire';
        PROVIDER_DISPLAY_NAME = metadata.provider_name || 'LinkFire';
        
        showView('view-client-dashboard');
        initClientDashboard();
    }
}

function showView(viewId) {
    document.getElementById('view-login').style.display = 'none';
    document.getElementById('view-client-dashboard').style.display = 'none';
    document.getElementById('view-super-admin').style.display = 'none';
    
    document.getElementById(viewId).style.display = viewId === 'view-login' ? 'flex' : 'block';
}

// --- App Initialization ---
window.onload = () => {
    setupAuthEventListeners();
};

function setupAuthEventListeners() {
    document.getElementById('form-login').onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        const { error } = await _supabase.auth.signInWithPassword({ email, password });
        if (error) {
            alert('Falha no Login: ' + error.message);
        }
    };
    
    document.getElementById('btn-logout-client').onclick = () => _supabase.auth.signOut();
    document.getElementById('btn-logout-admin').onclick = () => _supabase.auth.signOut();
}

// --- Client Dashboard Logic ---
async function initClientDashboard() {
    generateDaysList();
    
    const today = new Date();
    activeDate = daysList[0]?.dateStr || getFormattedDate(today);
    
    setupClientEventListeners();
    
    await loadSettings();
    await loadSchedules();
    await loadCapacities();
    
    renderAll();
    setupRealtimeSubscriptions();
    lucide.createIcons();
}

function setupRealtimeSubscriptions() {
    if (realtimeChannel) {
        _supabase.removeChannel(realtimeChannel);
    }
    
    realtimeChannel = _supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `provider_id=eq.${PROVIDER_ID}` }, async () => {
            await loadSchedules();
            renderAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'capacities', filter: `provider_id=eq.${PROVIDER_ID}` }, async () => {
            await loadCapacities();
            renderAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `provider_id=eq.${PROVIDER_ID}` }, async () => {
            await loadSettings();
            renderAll();
        })
        .subscribe();
}

// --- Supabase Client Loaders ---

async function loadSettings() {
    const { data, error } = await _supabase
        .from('settings')
        .select('value')
        .eq('provider_id', PROVIDER_ID)
        .maybeSingle();
        
    if (error) {
        console.error('Erro ao buscar configurações no Supabase:', error);
        return;
    }
    
    if (data && data.value) {
        state.reasons = data.value.reasons || state.reasons;
        state.statuses = data.value.statuses || state.statuses;
        state.defaultMorning = data.value.defaultMorning || state.defaultMorning;
        state.defaultAfternoon = data.value.defaultAfternoon || state.defaultAfternoon;
        state.retentionDays = data.value.retentionDays || 0;
        state.hqName = data.value.hqName || '';
        state.hqLat = data.value.hqLat || state.hqLat;
        state.hqLng = data.value.hqLng || state.hqLng;
        
        renderHeaderLogo();
        
        if (window.updateHQ) {
            window.updateHQ(state.hqLat, state.hqLng, state.hqName || PROVIDER_DISPLAY_NAME);
        }
        
        runDataRetention();
    } else {
        await saveSettingsToDb();
    }
}

function renderHeaderLogo() {
    const brandContainer = document.getElementById('brand-logo-container');
    brandContainer.innerHTML = `
        <div class="brand-text">
            <h1 id="header-brand-name">${PROVIDER_DISPLAY_NAME}</h1>
            <span class="brand-sub">Fibra Óptica</span>
        </div>
    `;
}

async function loadSchedules() {
    const { data, error } = await _supabase
        .from('schedules')
        .select('*')
        .eq('provider_id', PROVIDER_ID);
        
    if (error) {
        console.error('Erro ao carregar agendamentos do Supabase:', error);
        return;
    }
    
    if (data) {
        state.schedules = data.map(item => ({
            id: item.id,
            dateStr: item.date_str,
            shift: item.shift,
            protocol: item.protocol,
            vehicle: item.vehicle,
            name: item.name,
            phone: item.phone,
            reason: item.reason,
            status: item.status,
            mapLink: item.map_link,
            notes: item.notes
        }));
    }
}

async function loadCapacities() {
    const { data, error } = await _supabase
        .from('capacities')
        .select('*')
        .eq('provider_id', PROVIDER_ID);
        
    if (error) {
        console.error('Erro ao carregar capacidades do Supabase:', error);
        return;
    }
    
    if (data) {
        state.capacities = {};
        data.forEach(item => {
            state.capacities[`${item.date_str}_${item.shift}`] = item.total_slots;
        });
    }
}

// --- Date Utilities ---
function getFormattedDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function generateDaysList() {
    daysList = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let current = new Date(today);
    let count = 0;
    
    while (count < 14) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek !== 0) {
            const dateStr = getFormattedDate(current);
            const label = current.getDate().toString().padStart(2, '0') + '/' + String(current.getMonth() + 1).padStart(2, '0');
            const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
            const isPast = new Date(current) < new Date(today);
            
            daysList.push({ dateStr, label, weekDay: weekdays[dayOfWeek], isPast });
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
}

// --- Address Geocoding (Nominatim API) ---
async function geocodeAddress(address) {
    if (!address) return null;
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
        const response = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
        }
    } catch (err) {
        console.error('Erro na geocodificação:', err);
    }
    return null;
}

// --- Dynamic Backup to Supabase Storage before Purging ---
async function runDataRetention() {
    if (!state.retentionDays || state.retentionDays <= 0) return;
    
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - state.retentionDays);
    const limitDateStr = getFormattedDate(limitDate);
    
    const { data: toDelete, error: fetchErr } = await _supabase
        .from('schedules')
        .select('*')
        .eq('provider_id', PROVIDER_ID)
        .eq('status', 'Realizado')
        .lte('date_str', limitDateStr);
        
    if (fetchErr || !toDelete || toDelete.length === 0) return;
    
    let csvText = '\uFEFF';
    csvText += 'Protocolo;Data;Turno;Cliente;Telefone;Veículo;Motivo;Status;Link Localização;Observações\n';
    toDelete.forEach(s => {
        const row = [
            s.protocol,
            s.date_str,
            s.shift,
            s.name.replace(/;/g, ','),
            s.phone.replace(/;/g, ','),
            s.vehicle,
            s.reason.replace(/;/g, ','),
            s.status,
            s.map_link || '',
            (s.notes || '').replace(/;/g, ',').replace(/\n/g, ' ')
        ];
        csvText += row.join(';') + '\n';
    });
    
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const filename = `purges/${PROVIDER_ID}/backup_historico_${getFormattedDate(new Date())}_${Date.now()}.csv`;
    
    const { error: uploadErr } = await _supabase
        .storage
        .from('backups')
        .upload(filename, blob, { contentType: 'text/csv', upsert: true });
        
    if (uploadErr) {
        console.error('Erro ao enviar backup histórico para o Storage:', uploadErr);
    }
    
    const { error: delErr } = await _supabase
        .from('schedules')
        .delete()
        .eq('provider_id', PROVIDER_ID)
        .eq('status', 'Realizado')
        .lte('date_str', limitDateStr);
        
    if (delErr) {
        console.error('Erro ao excluir histórico expirado:', delErr);
    } else {
        await loadSchedules();
        renderAll();
    }
}

// --- CSV Exporter ---
function exportSchedulesToCSV() {
    if (state.schedules.length === 0) {
        alert('Nenhum agendamento encontrado para exportar.');
        return;
    }
    
    let csvContent = '\uFEFF';
    csvContent += 'Protocolo;Data;Turno;Cliente;Telefone;Veículo;Motivo;Status;Link Localização;Observações\n';
    
    state.schedules.forEach(s => {
        const row = [
            s.protocol,
            s.dateStr,
            s.shift === 'morning' ? 'Manhã' : 'Tarde',
            s.name.replace(/;/g, ','),
            s.phone.replace(/;/g, ','),
            s.vehicle === 'car' ? 'Carro' : 'Moto',
            s.reason.replace(/;/g, ','),
            s.status.replace(/;/g, ','),
            s.mapLink || '',
            (s.notes || '').replace(/;/g, ',').replace(/\n/g, ' ')
        ];
        csvContent += row.join(';') + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `agendamentos_${PROVIDER_ID}_${getFormattedDate(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- Toggle Form Location Fields ---
window.toggleLocFields = function() {
    const isLink = document.getElementById('loc-type-link').checked;
    if (isLink) {
        document.getElementById('loc-link-group').style.display = 'block';
        document.getElementById('loc-address-group').style.display = 'none';
    } else {
        document.getElementById('loc-link-group').style.display = 'none';
        document.getElementById('loc-address-group').style.display = 'block';
    }
};

// --- Render Operations ---
function renderAll() {
    renderStats();
    renderDaysSlider();
    renderShifts();
}

function renderStats() {
    const todayStr = getFormattedDate(new Date());
    const todaySchedules = state.schedules.filter(s => s.dateStr === todayStr);
    const completedToday = todaySchedules.filter(s => s.status === 'Realizado').length;
    
    document.getElementById('today-total-schedules').textContent = todaySchedules.length;
    document.getElementById('today-completed-schedules').textContent = completedToday;
}

function renderDaysSlider() {
    const container = document.getElementById('days-nav-container');
    container.innerHTML = '';
    
    daysList.forEach(day => {
        const schedsCount = state.schedules.filter(s => s.dateStr === day.dateStr).length;
        
        const btn = document.createElement('button');
        btn.className = `day-tab ${day.dateStr === activeDate ? 'active' : ''}`;
        btn.onclick = () => {
            activeDate = day.dateStr;
            renderAll();
        };
        
        btn.innerHTML = `
            <span class="day-week">${day.weekDay}</span>
            <span class="day-num">${day.label.split('/')[0]}</span>
            <span class="day-badge">${schedsCount}</span>
        `;
        container.appendChild(btn);
    });
}

function renderShifts() {
    const dayInfo = daysList.find(d => d.dateStr === activeDate);
    const isPast = dayInfo ? dayInfo.isPast : false;
    
    const dateTitleEl = document.getElementById('current-selected-date-title');
    if (dayInfo) {
        const parts = dayInfo.dateStr.split('-');
        dateTitleEl.innerHTML = `${dayInfo.weekDay}, ${parts[2]}/${parts[1]}/${parts[0]} ${isPast ? '<span class="read-only-badge" style="background:#6B6661; color:#fff; font-size:0.7rem; padding:2px 8px; border-radius:10px; margin-left:10px; font-weight:700">HISTÓRICO</span>' : ''}`;
    }
    
    const daySchedules = state.schedules.filter(s => s.dateStr === activeDate);
    const totalSchedules = daySchedules.length;
    const completedSchedules = daySchedules.filter(s => s.status === 'Realizado').length;
    
    document.getElementById('summary-total').textContent = `${totalSchedules} visita${totalSchedules !== 1 ? 's' : ''}`;
    document.getElementById('summary-completed').textContent = `${completedSchedules} realizada${completedSchedules !== 1 ? 's' : ''}`;
    
    renderSingleShift('morning', isPast);
    renderSingleShift('afternoon', isPast);
    
    lucide.createIcons();
}

function renderSingleShift(shift, isReadOnly) {
    const container = document.getElementById(`${shift}-schedules-list`);
    container.innerHTML = '';
    
    const daySchedules = state.schedules.filter(s => s.dateStr === activeDate && s.shift === shift);
    
    const capKey = `${activeDate}_${shift}`;
    if (state.capacities[capKey] === undefined) {
        state.capacities[capKey] = shift === 'morning' ? state.defaultMorning : state.defaultAfternoon;
    }
    const totalCap = state.capacities[capKey];
    const scheduledCount = daySchedules.length;
    const availableSlots = Math.max(0, totalCap - scheduledCount);
    
    document.getElementById(`${shift}-capacity-count`).textContent = totalCap;
    
    const badgeEl = document.getElementById(`${shift}-capacity-badge`);
    if (availableSlots > 1) {
        badgeEl.textContent = `${availableSlots} vagas`;
        badgeEl.className = 'badge-vagas green';
    } else if (availableSlots === 1) {
        badgeEl.textContent = 'Última vaga';
        badgeEl.className = 'badge-vagas yellow';
    } else {
        badgeEl.textContent = 'Lotado';
        badgeEl.className = 'badge-vagas red';
    }
    
    const vehiclesPresent = [...new Set(daySchedules.map(s => s.vehicle))];
    const presenceEl = document.getElementById(`${shift}-vehicle-presence`);
    presenceEl.innerHTML = '';
    vehiclesPresent.forEach(v => {
        const iconSpan = document.createElement('span');
        iconSpan.textContent = v === 'car' ? '🚗' : '🏍️';
        presenceEl.appendChild(iconSpan);
    });
    
    const capButtons = document.querySelectorAll(`.btn-cap-adjust[data-shift="${shift}"]`);
    capButtons.forEach(btn => {
        btn.style.display = isReadOnly ? 'none' : 'flex';
    });
    
    const currentFilter = shiftFilters[shift];
    const filteredSchedules = daySchedules.filter(s => {
        if (currentFilter === 'all') return true;
        return s.vehicle === currentFilter;
    });
    
    if (filteredSchedules.length === 0) {
        container.innerHTML = `<div class="empty-shift-schedules" style="text-align:center; padding:30px 10px; color:var(--text-secondary); font-size:0.8rem; font-style:italic;">Nenhum agendamento para este turno</div>`;
    } else {
        filteredSchedules.forEach(sched => {
            const card = document.createElement('div');
            card.className = `schedule-card ${sched.status === 'Realizado' ? 'completed' : ''}`;
            
            const statusConfig = state.statuses.find(st => st.name === sched.status);
            const statusColor = statusConfig ? statusConfig.color : '#ccc';
            card.style.borderLeftColor = statusColor;
            
            const mapLinkHtml = sched.mapLink 
                ? `<a href="${sched.mapLink}" target="_blank" class="card-location"><i data-lucide="map-pin" style="width:14px;height:14px;color:#D85A30;"></i> Localização</a>`
                : `<span class="card-location missing"><i data-lucide="map-pin-off" style="width:14px;height:14px;"></i> Sem localização definida</span>`;
                
            const actionButtonsHtml = isReadOnly 
                ? '' 
                : `
                    <div class="card-actions">
                        <button class="btn-card-action btn-complete" onclick="toggleComplete('${sched.id}')" title="Marcar como Realizado">
                            <i data-lucide="${sched.status === 'Realizado' ? 'rotate-ccw' : 'check-circle'}"></i>
                        </button>
                        <button class="btn-card-action btn-edit" onclick="openEditModal('${sched.id}')" title="Editar agendamento">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button class="btn-card-action btn-delete" onclick="deleteSchedule('${sched.id}')" title="Excluir agendamento">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                `;
                
            card.innerHTML = `
                <div class="card-top">
                    <span class="card-protocol">${sched.protocol}</span>
                    <div class="card-badges">
                        <span class="badge-reason">${sched.reason}</span>
                        <span class="badge-status" style="background:${statusColor}" onclick="toggleStatusDropdown(event, '${sched.id}')">${sched.status}</span>
                        <div class="status-dropdown-container" id="dropdown-${sched.id}">
                            ${state.statuses.map(st => `
                                <div class="status-dropdown-item" onclick="quickChangeStatus('${sched.id}', '${st.name}')">
                                    <span class="status-color-dot" style="background:${st.color}"></span>
                                    <span>${st.name}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div class="card-middle">
                    <span class="card-vehicle-icon">${sched.vehicle === 'car' ? '🚗' : '🏍️'}</span>
                    <div class="card-client-info">
                        <span class="client-name">${sched.name}</span>
                        <a href="tel:${sched.phone}" class="client-phone"><i data-lucide="phone" style="width:10px;height:10px;display:inline-block;vertical-align:middle;margin-right:2px;"></i>${sched.phone}</a>
                    </div>
                </div>
                ${sched.notes ? `<div class="card-notes">${sched.notes}</div>` : ''}
                <div class="card-bottom">
                    ${mapLinkHtml}
                    ${actionButtonsHtml}
                </div>
            `;
            container.appendChild(card);
        });
    }
    
    const footerButtons = document.querySelectorAll(`#shift-${shift} .btn-add-schedule`);
    footerButtons.forEach(btn => {
        btn.style.display = isReadOnly ? 'none' : 'flex';
    });
}

function toggleStatusDropdown(event, id) {
    event.stopPropagation();
    if (currentActiveDropdownId && currentActiveDropdownId !== id) {
        const otherDd = document.getElementById(`dropdown-${currentActiveDropdownId}`);
        if (otherDd) otherDd.style.display = 'none';
    }
    const dropdown = document.getElementById(`dropdown-${id}`);
    if (dropdown) {
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
        currentActiveDropdownId = isOpen ? null : id;
    }
}

async function adjustCapacity(shift, type) {
    const capKey = `${activeDate}_${shift}`;
    let currentVal = state.capacities[capKey] === undefined ? (shift === 'morning' ? state.defaultMorning : state.defaultAfternoon) : state.capacities[capKey];
    const newVal = type === 'inc' ? currentVal + 1 : Math.max(1, currentVal - 1);
    
    state.capacities[capKey] = newVal;
    renderAll();
    
    await _supabase.from('capacities').upsert({
        provider_id: PROVIDER_ID,
        date_str: activeDate,
        shift: shift,
        total_slots: newVal
    }, { onConflict: 'provider_id,date_str,shift' });
}

async function quickChangeStatus(id, newStatus) {
    const sched = state.schedules.find(s => s.id === id);
    if (sched) {
        sched.status = newStatus;
        renderAll();
        await _supabase.from('schedules').update({ status: newStatus }).eq('id', id);
    }
}

async function toggleComplete(id) {
    const sched = state.schedules.find(s => s.id === id);
    if (sched) {
        const nextStatus = sched.status === 'Realizado' ? 'Confirmado' : 'Realizado';
        sched.status = nextStatus;
        renderAll();
        await _supabase.from('schedules').update({ status: nextStatus }).eq('id', id);
    }
}

async function deleteSchedule(id) {
    if (confirm('Tem certeza que deseja excluir este agendamento?')) {
        state.schedules = state.schedules.filter(s => s.id !== id);
        renderAll();
        await _supabase.from('schedules').delete().eq('id', id);
    }
}

// --- Schedule Modals ---
const scheduleModal = document.getElementById('modal-schedule');

function openAddModal(shift) {
    const todayInfo = daysList.find(d => d.dateStr === activeDate);
    if (todayInfo && todayInfo.isPast) return;
    
    document.getElementById('form-schedule').reset();
    document.getElementById('modal-schedule-title').textContent = 'Novo Agendamento';
    document.getElementById('field-id').value = '';
    document.getElementById('field-date').value = activeDate;
    document.getElementById('field-shift').value = shift;
    
    const num = Math.floor(100000 + Math.random() * 900000);
    document.getElementById('field-protocol').value = `LF-${num}`;
    
    document.getElementById('loc-type-link').checked = true;
    toggleLocFields();
    populateFormOptions();
    scheduleModal.classList.add('open');
}

function openEditModal(id) {
    const sched = state.schedules.find(s => s.id === id);
    if (!sched) return;
    
    document.getElementById('modal-schedule-title').textContent = 'Editar Agendamento';
    document.getElementById('field-id').value = sched.id;
    document.getElementById('field-date').value = sched.dateStr;
    document.getElementById('field-shift').value = sched.shift;
    document.getElementById('field-protocol').value = sched.protocol;
    document.getElementById('field-name').value = sched.name;
    document.getElementById('field-phone').value = sched.phone;
    document.getElementById('field-notes').value = sched.notes || '';
    
    const isManualAddress = sched.mapLink && sched.mapLink.includes('maps.google.com/?q=');
    if (isManualAddress) {
        document.getElementById('loc-type-address').checked = true;
        document.getElementById('field-address').value = '';
        document.getElementById('field-map-link').value = '';
    } else {
        document.getElementById('loc-type-link').checked = true;
        document.getElementById('field-map-link').value = sched.mapLink || '';
        document.getElementById('field-address').value = '';
    }
    toggleLocFields();
    
    const radios = document.getElementsByName('vehicle');
    radios.forEach(r => { r.checked = r.value === sched.vehicle; });
    
    populateFormOptions(sched.reason, sched.status);
    scheduleModal.classList.add('open');
}

function closeScheduleModal() {
    scheduleModal.classList.remove('open');
}

function populateFormOptions(selectedReason = '', selectedStatus = '') {
    const reasonSel = document.getElementById('field-reason');
    reasonSel.innerHTML = '';
    state.reasons.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        if (r === selectedReason) opt.selected = true;
        reasonSel.appendChild(opt);
    });
    
    const statusSel = document.getElementById('field-status');
    statusSel.innerHTML = '';
    state.statuses.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name; opt.textContent = s.name;
        if (s.name === selectedStatus) opt.selected = true;
        statusSel.appendChild(opt);
    });
}

async function saveSchedule(e) {
    e.preventDefault();
    const id = document.getElementById('field-id').value;
    const dateStr = document.getElementById('field-date').value;
    const shift = document.getElementById('field-shift').value;
    const protocol = document.getElementById('field-protocol').value;
    const name = document.getElementById('field-name').value;
    const phone = document.getElementById('field-phone').value;
    const reason = document.getElementById('field-reason').value;
    const status = document.getElementById('field-status').value;
    const notes = document.getElementById('field-notes').value;
    
    let vehicle = 'car';
    const radios = document.getElementsByName('vehicle');
    radios.forEach(r => { if (r.checked) vehicle = r.value; });
    
    const locType = document.querySelector('input[name="loc-type"]:checked').value;
    let mapLink = '';
    closeScheduleModal();
    
    if (locType === 'link') {
        mapLink = document.getElementById('field-map-link').value;
    } else {
        const address = document.getElementById('field-address').value;
        if (address) {
            const coords = await geocodeAddress(address);
            if (coords) {
                mapLink = `https://maps.google.com/?q=${coords.lat},${coords.lng}`;
            } else {
                alert('Aviso: Não conseguimos encontrar o endereço. Salvo sem coordenadas.');
            }
        }
    }
    
    const payload = {
        provider_id: PROVIDER_ID,
        date_str: dateStr,
        shift: shift,
        protocol: protocol,
        name: name,
        phone: phone,
        reason: reason,
        status: status,
        map_link: mapLink || null,
        notes: notes || null,
        vehicle: vehicle
    };
    
    if (id) {
        const index = state.schedules.findIndex(s => s.id === id);
        if (index !== -1) {
            state.schedules[index] = { id, ...payload, dateStr };
            renderAll();
        }
        await _supabase.from('schedules').update(payload).eq('id', id);
    } else {
        const tempId = 'sched-' + Date.now();
        state.schedules.push({ id: tempId, ...payload, dateStr });
        renderAll();
        await _supabase.from('schedules').insert(payload);
    }
    await loadSchedules();
    renderAll();
}

// --- Settings Modals ---
const settingsModal = document.getElementById('modal-settings');

function openSettingsModal() {
    document.getElementById('settings-default-morning').value = state.defaultMorning;
    document.getElementById('settings-default-afternoon').value = state.defaultAfternoon;
    document.getElementById('settings-retention-days').value = state.retentionDays;
    
    document.getElementById('settings-hq-name').value = state.hqName;
    document.getElementById('settings-hq-lat').value = state.hqLat;
    document.getElementById('settings-hq-lng').value = state.hqLng;
    
    renderSettingsReasons();
    renderSettingsStatuses();
    settingsModal.classList.add('open');
}

function closeSettingsModal() {
    settingsModal.classList.remove('open');
}

function renderSettingsReasons() {
    const list = document.getElementById('settings-reasons-list');
    list.innerHTML = '';
    state.reasons.forEach((r, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${r}</span><button class="btn-card-action btn-delete" onclick="deleteReason(${idx})"><i data-lucide="trash-2"></i></button>`;
        list.appendChild(li);
    });
    lucide.createIcons({ props: { style: 'width: 14px; height: 14px' } });
}

function renderSettingsStatuses() {
    const list = document.getElementById('settings-statuses-list');
    list.innerHTML = '';
    state.statuses.forEach((s, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="settings-item-label"><span class="status-color-dot" style="background:${s.color}"></span>${s.name}</span><button class="btn-card-action btn-delete" onclick="deleteStatus(${idx})"><i data-lucide="trash-2"></i></button>`;
        list.appendChild(li);
    });
    lucide.createIcons({ props: { style: 'width: 14px; height: 14px' } });
}

function deleteReason(idx) { state.reasons.splice(idx, 1); renderSettingsReasons(); }
function deleteStatus(idx) { state.statuses.splice(idx, 1); renderSettingsStatuses(); }
function addReason() {
    const input = document.getElementById('new-reason-input');
    const val = input.value.trim();
    if (val && !state.reasons.includes(val)) {
        state.reasons.push(val); input.value = ''; renderSettingsReasons();
    }
}
function addStatus() {
    const input = document.getElementById('new-status-input');
    const colorInput = document.getElementById('new-status-color');
    const val = input.value.trim();
    if (val && !state.statuses.some(s => s.name.toLowerCase() === val.toLowerCase())) {
        state.statuses.push({ name: val, color: colorInput.value });
        input.value = ''; renderSettingsStatuses();
    }
}

async function saveSettings() {
    state.defaultMorning = parseInt(document.getElementById('settings-default-morning').value, 10) || 5;
    state.defaultAfternoon = parseInt(document.getElementById('settings-default-afternoon').value, 10) || 5;
    state.retentionDays = parseInt(document.getElementById('settings-retention-days').value, 10) || 0;
    state.hqName = document.getElementById('settings-hq-name').value || '';
    state.hqLat = parseFloat(document.getElementById('settings-hq-lat').value) || state.hqLat;
    state.hqLng = parseFloat(document.getElementById('settings-hq-lng').value) || state.hqLng;
    
    closeSettingsModal();
    
    if (window.updateHQ) {
        window.updateHQ(state.hqLat, state.hqLng, state.hqName || PROVIDER_DISPLAY_NAME);
    }
    await saveSettingsToDb();
    renderHeaderLogo();
    renderAll();
    runDataRetention();
}

async function saveSettingsToDb() {
    const payload = {
        defaultMorning: state.defaultMorning,
        defaultAfternoon: state.defaultAfternoon,
        reasons: state.reasons,
        statuses: state.statuses,
        retentionDays: state.retentionDays,
        hqName: state.hqName,
        hqLat: state.hqLat,
        hqLng: state.hqLng
    };
    await _supabase.from('settings').upsert({ provider_id: PROVIDER_ID, value: payload }, { onConflict: 'provider_id' });
}

function setupClientEventListeners() {
    document.querySelectorAll('.btn-cap-adjust').forEach(btn => {
        btn.onclick = () => { adjustCapacity(btn.dataset.shift, btn.classList.contains('inc') ? 'inc' : 'dec'); };
    });
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            const shift = btn.dataset.shift;
            document.querySelectorAll(`.filter-btn[data-shift="${shift}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            shiftFilters[shift] = btn.dataset.filter;
            renderSingleShift(shift, daysList.find(d => d.dateStr === activeDate)?.isPast);
        };
    });
    
    // Bind click to dynamic buttons using delegated-like direct loops, but ensure it works on re-renders by calling setupClientEventListeners
    document.querySelectorAll('.btn-add-schedule').forEach(btn => {
        btn.onclick = () => { openAddModal(btn.dataset.shift); };
    });
    
    document.getElementById('btn-close-schedule-modal').onclick = closeScheduleModal;
    document.getElementById('btn-cancel-schedule').onclick = closeScheduleModal;
    document.getElementById('btn-open-settings').onclick = openSettingsModal;
    document.getElementById('btn-close-settings-modal').onclick = closeSettingsModal;
    
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.section).classList.add('active');
        };
    });
    
    document.getElementById('btn-add-reason').onclick = addReason;
    document.getElementById('btn-add-status').onclick = addStatus;
    document.getElementById('btn-save-settings').onclick = saveSettings;
    document.getElementById('form-schedule').onsubmit = saveSchedule;
    document.getElementById('btn-export-csv').onclick = exportSchedulesToCSV;
    document.getElementById('loc-type-link').onchange = toggleLocFields;
    document.getElementById('loc-type-address').onchange = toggleLocFields;
    
    document.getElementById('btn-hq-current-location').onclick = () => {
        if (!navigator.geolocation) {
            alert('Geolocalização não suportada no seu navegador.');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                document.getElementById('settings-hq-lat').value = pos.coords.latitude.toFixed(6);
                document.getElementById('settings-hq-lng').value = pos.coords.longitude.toFixed(6);
                alert('Localização obtida com sucesso via GPS do dispositivo!');
            },
            (err) => {
                console.error(err);
                alert('Erro ao buscar GPS. Verifique se concedeu permissão de localização ao navegador para este site (ícone de cadeado na barra de endereços).');
            },
            { enableHighAccuracy: true }
        );
    };
    
    document.getElementById('slider-prev').onclick = () => { document.getElementById('days-nav-container').scrollLeft -= 150; };
    document.getElementById('slider-next').onclick = () => { document.getElementById('days-nav-container').scrollLeft += 150; };
}

// --- Super Admin Control Panel Functions ---

async function initSuperAdmin() {
    const { data: providersList, error } = await _supabase
        .from('settings')
        .select('provider_id, value');
        
    if (error || !providersList) {
        console.error('Erro ao buscar provedores para Super-Admin:', error);
        return;
    }
    
    const { data: scheds, error: scErr } = await _supabase.from('schedules').select('id');
    const totalSchedules = scErr ? 0 : (scheds ? scheds.length : 0);
    
    document.getElementById('admin-stat-clients').textContent = providersList.length;
    document.getElementById('admin-stat-schedules').textContent = totalSchedules;
    
    const listContainer = document.getElementById('admin-provider-list');
    listContainer.innerHTML = '';
    
    providersList.forEach(p => {
        const item = document.createElement('div');
        item.className = 'provider-item';
        const name = (p.value && p.value.hqName) || p.provider_id;
        
        item.innerHTML = `
            <div>
                <h5>${name}</h5>
                <span class="sub">${p.provider_id}</span>
            </div>
            <span class="badge-active-status active">Ativo</span>
        `;
        
        item.onclick = () => {
            document.querySelectorAll('.provider-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            selectAdminProvider(p.provider_id, name);
        };
        
        listContainer.appendChild(item);
    });
}

async function selectAdminProvider(providerId, providerName) {
    adminSelectedProvider = providerId;
    
    document.getElementById('admin-no-selection').style.display = 'none';
    document.getElementById('admin-backup-explorer').style.display = 'block';
    document.getElementById('admin-selected-provider-title').textContent = `Backups — ${providerName}`;
    
    const { data: files, error } = await _supabase
        .storage
        .from('backups')
        .list(`purges/${providerId}`);
        
    const listContainer = document.getElementById('admin-backup-list');
    listContainer.innerHTML = '';
    
    if (error || !files || files.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:20px; font-style:italic; color:var(--text-secondary);">Nenhum arquivo de backup encontrado no storage</div>`;
        return;
    }
    
    files.forEach(file => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="settings-item-label">
                <i data-lucide="file-text" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px;"></i>
                ${file.name}
            </span>
            <button class="btn btn-secondary btn-sm" onclick="downloadAdminBackup('${providerId}', '${file.name}')" style="padding: 4px 8px; font-size: 0.75rem;">
                Baixar CSV
            </button>
        `;
        listContainer.appendChild(li);
    });
    lucide.createIcons();
}

async function downloadAdminBackup(providerId, fileName) {
    const { data, error } = await _supabase
        .storage
        .from('backups')
        .createSignedUrl(`purges/${providerId}/${fileName}`, 60);
        
    if (error || !data) {
        alert('Erro ao gerar link de download: ' + (error ? error.message : 'Falha'));
        return;
    }
    window.open(data.signedUrl, '_blank');
}
