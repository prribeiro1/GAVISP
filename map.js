// --- LinkFire Map & Routing Module ---

// HQ Location - Customizable starting point
let HQ = {
    lat: -1.3780,
    lng: -48.3720,
    name: 'Sede LinkFire'
};

function updateHQ(lat, lng, name) {
    HQ.lat = parseFloat(lat) || -1.3780;
    HQ.lng = parseFloat(lng) || -48.3720;
    HQ.name = name || 'Sede Base';
    if (leafletMap) {
        leafletMap.setView([HQ.lat, HQ.lng]);
    }
}

let leafletMap = null;
let markersGroup = null;
let routePolyline = null;
let activeRoutePoints = []; // Holds current optimized coordinates

// Initialize Map Modal handlers
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-close-route-modal').onclick = closeRouteModal;
    
    // Bind click events to the shift footer route buttons
    document.querySelectorAll('.btn-view-route').forEach(btn => {
        btn.onclick = () => {
            const shift = btn.dataset.shift;
            openRouteModal(shift);
        };
    });
});

function initMap() {
    if (leafletMap) return; // Already initialized
    
    // Start Leaflet centered on Ananindeua/PA
    leafletMap = L.map('map').setView([HQ.lat, HQ.lng], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(leafletMap);
    
    markersGroup = L.layerGroup().addTo(leafletMap);
}

// Extract Lat/Lng from Google Maps link
// Fallback to deterministic generation within Ananindeua if no coordinates exist in url
function parseMapLink(link, saltIndex) {
    if (!link) return null;
    
    // Match coordinates like @-1.3653158,-48.3846175 or q=-1.3653158,-48.3846175 or !3d-1.3653158!4d-48.3846175
    const regexAt = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const regexQ = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
    const regexBang = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
    
    let match = link.match(regexAt) || link.match(regexQ) || link.match(regexBang);
    
    if (match) {
        return {
            lat: parseFloat(match[1]),
            lng: parseFloat(match[2]),
            derived: false
        };
    }
    
    // If it's a short link or address, generate deterministic coordinate to avoid CORS block on fetch
    let hash = 0;
    for (let i = 0; i < link.length; i++) {
        hash = link.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Bounding Box centered around the custom HQ coordinate
    const latMin = HQ.lat - 0.03;
    const latMax = HQ.lat + 0.03;
    const lngMin = HQ.lng - 0.04;
    const lngMax = HQ.lng + 0.04;
    
    const latRange = latMax - latMin;
    const lngRange = lngMax - lngMin;
    
    // Seed using saltIndex and hash
    const seed1 = Math.abs(hash + saltIndex * 77) % 1000 / 1000;
    const seed2 = Math.abs((hash >> 3) + saltIndex * 93) % 1000 / 1000;
    
    const lat = latMin + seed1 * latRange;
    const lng = lngMin + seed2 * lngRange;
    
    return {
        lat,
        lng,
        derived: true
    };
}

// Nearest Neighbor Algorithm for TSP
function optimizeRouteSequence(points) {
    if (points.length === 0) return [];
    
    let unvisited = [...points];
    let current = { ...HQ };
    let sequence = [];
    
    while (unvisited.length > 0) {
        let nearestIdx = -1;
        let minDistance = Infinity;
        
        for (let i = 0; i < unvisited.length; i++) {
            const dist = getDistance(current, unvisited[i]);
            if (dist < minDistance) {
                minDistance = dist;
                nearestIdx = i;
            }
        }
        
        const nextPoint = unvisited.splice(nearestIdx, 1)[0];
        sequence.push(nextPoint);
        current = nextPoint;
    }
    
    return sequence;
}

// Straight line distance
function getDistance(p1, p2) {
    const dy = p1.lat - p2.lat;
    const dx = p1.lng - p2.lng;
    return Math.sqrt(dx * dx + dy * dy);
}

// Open modal and compute route
function openRouteModal(shift) {
    const modal = document.getElementById('modal-route');
    modal.classList.add('open');
    
    // Ensure Leaflet is loaded and sizes updated
    setTimeout(() => {
        initMap();
        leafletMap.invalidateSize();
        calculateAndRenderRoute(shift);
    }, 100);
}

function closeRouteModal() {
    document.getElementById('modal-route').classList.remove('open');
}

function calculateAndRenderRoute(shift) {
    // Reset Map Layers
    markersGroup.clearLayers();
    if (routePolyline) {
        leafletMap.removeLayer(routePolyline);
        routePolyline = null;
    }
    
    const daySchedules = state.schedules.filter(s => s.dateStr === activeDate && s.shift === shift);
    
    // Sort schedules with coordinates
    let locPoints = [];
    let unlocatedSchedules = [];
    
    daySchedules.forEach((s, idx) => {
        if (s.mapLink) {
            const coords = parseMapLink(s.mapLink, idx);
            if (coords) {
                locPoints.push({
                    ...coords,
                    scheduleId: s.id,
                    name: s.name,
                    protocol: s.protocol,
                    reason: s.reason,
                    notes: s.notes || 'Sem observações'
                });
                return;
            }
        }
        unlocatedSchedules.push(s);
    });
    
    // Calculate TSP
    const optimizedPoints = optimizeRouteSequence(locPoints);
    activeRoutePoints = optimizedPoints;
    
    // Update Stats UI
    document.getElementById('route-total-visits').textContent = daySchedules.length;
    document.getElementById('route-located-visits').textContent = optimizedPoints.length;
    document.getElementById('modal-route-title').textContent = `Roteirização — Turno da ${shift === 'morning' ? 'Manhã' : 'Tarde'}`;
    document.getElementById('modal-route-subtitle').textContent = `Otimizando trajeto a partir da base técnica: ${HQ.name}`;
    
    // Render Sidebar Sequence
    const listEl = document.getElementById('route-sequence-list');
    listEl.innerHTML = '';
    
    // 1. Add HQ to List
    const hqEl = document.createElement('div');
    hqEl.className = 'sequence-item';
    hqEl.style.borderLeft = '4px solid var(--primary)';
    hqEl.innerHTML = `
        <span class="seq-num" style="background:#1C1A17">🏠</span>
        <div class="seq-details">
            <span class="seq-title">${HQ.name}</span>
            <span class="seq-sub">Ponto de Partida Técnico</span>
        </div>
    `;
    listEl.appendChild(hqEl);
    
    // 2. Add Optimized points
    optimizedPoints.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'sequence-item';
        item.innerHTML = `
            <span class="seq-num">${idx + 1}º</span>
            <div class="seq-details">
                <span class="seq-title">${p.name} (${p.protocol})</span>
                <span class="seq-sub">${p.reason} ${p.derived ? '(Localização Estimada)' : ''}</span>
            </div>
        `;
        listEl.appendChild(item);
    });
    
    // 3. Add Unlocated points at end
    unlocatedSchedules.forEach(s => {
        const item = document.createElement('div');
        item.className = 'sequence-item';
        item.style.opacity = '0.6';
        item.innerHTML = `
            <span class="seq-num unlocated"><i data-lucide="map-pin-off" style="width:12px;height:12px"></i></span>
            <div class="seq-details">
                <span class="seq-title">${s.name} (${s.protocol})</span>
                <span class="seq-sub">${s.reason} — Sem Localização</span>
            </div>
        `;
        listEl.appendChild(item);
    });
    
    lucide.createIcons({ props: { style: 'width: 12px; height: 12px; display: inline-block' } });
    
    // Render Map Elements
    // Add Marker for HQ
    const hqIcon = L.divIcon({
        className: 'hq-marker',
        html: `<div style="background:var(--text-primary);color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:3px solid var(--border-color);box-shadow:var(--shadow-md)">🏠</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    L.marker([HQ.lat, HQ.lng], { icon: hqIcon })
        .addTo(markersGroup)
        .bindPopup(`<b>${HQ.name}</b><br>Base Operacional`);
        
    // Add Markers for points
    optimizedPoints.forEach((p, idx) => {
        const markerIcon = L.divIcon({
            className: 'route-marker',
            html: `<div style="background:var(--primary);color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid white;box-shadow:var(--shadow-sm)">${idx + 1}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });
        
        L.marker([p.lat, p.lng], { icon: markerIcon })
            .addTo(markersGroup)
            .bindPopup(`
                <b>${idx + 1}º - ${p.name} (${p.protocol})</b><br>
                <b>Motivo:</b> ${p.reason}<br>
                <b>Obs:</b> ${p.notes}
            `);
    });
    
    // Draw OSRM route or fallback straight lines
    if (optimizedPoints.length > 0) {
        fetchOSRMRoute(optimizedPoints);
    } else {
        // No points, fit map to HQ
        leafletMap.setView([HQ.lat, HQ.lng], 13);
    }
}

// Call OSRM API to get route path
function fetchOSRMRoute(points) {
    const routeCoords = [HQ, ...points];
    const coordString = routeCoords.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
    
    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const routeGeo = data.routes[0].geometry;
                const pathCoordinates = routeGeo.coordinates.map(c => [c[1], c[0]]); // Swap to Lat/Lng
                
                routePolyline = L.polyline(pathCoordinates, {
                    color: 'var(--primary)',
                    weight: 5,
                    opacity: 0.85,
                    dashArray: '1, 5'
                }).addTo(leafletMap);
                
                // Fit bounds
                const bounds = L.latLngBounds([HQ, ...points].map(p => [p.lat, p.lng]));
                leafletMap.fitBounds(bounds, { padding: [40, 40] });
            } else {
                throw new Error('OSRM Route failed');
            }
        })
        .catch(err => {
            console.warn('Erro ao carregar rota OSRM, usando polilinhas diretas:', err);
            // Draw direct straight lines as fallback
            const straightCoords = routeCoords.map(p => [p.lat, p.lng]);
            routePolyline = L.polyline(straightCoords, {
                color: '#6B6661',
                weight: 3,
                opacity: 0.7,
                dashArray: '5, 5'
            }).addTo(leafletMap);
            
            const bounds = L.latLngBounds(straightCoords);
            leafletMap.fitBounds(bounds, { padding: [40, 40] });
        });
}

// Open multi-point navigation URL in Google Maps
document.getElementById('btn-open-external-maps').onclick = () => {
    if (activeRoutePoints.length === 0) {
        alert('Nenhum ponto de destino com localização para traçar rota.');
        return;
    }
    
    // Construct Maps URL: https://www.google.com/maps/dir/HQ_lat,HQ_lng/p1_lat,p1_lng/p2_lat,p2_lng/...
    const routeList = [HQ, ...activeRoutePoints];
    const waypoints = routeList.map(p => `${p.lat},${p.lng}`).join('/');
    const mapsUrl = `https://www.google.com/maps/dir/${waypoints}`;
    
    window.open(mapsUrl, '_blank');
};
