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
window.updateHQ = updateHQ;

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
    
    // Match coordinates like @-1.3653158,-48.3846175 or q=-1.3653158,-48.3846175 or !3d-1.3653158!4d-48.3846175, or direct coordinates -1.3653158,-48.3846175
    const regexAt = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const regexQ = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
    const regexBang = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
    const regexDirect = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
    
    let match = link.match(regexAt) || link.match(regexQ) || link.match(regexBang) || link.match(regexDirect);
    
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
    
    // Remove existing polylines
    if (window.routePolylines && window.routePolylines.length > 0) {
        window.routePolylines.forEach(p => leafletMap.removeLayer(p));
    }
    window.routePolylines = [];

    const daySchedules = state.schedules.filter(s => s.dateStr === activeDate && s.shift === shift);
    
    // Group schedules by vehicle (plate)
    let grouped = {};
    daySchedules.forEach(s => {
        const vPlate = s.vehicle || 'sem-veiculo';
        if (!grouped[vPlate]) grouped[vPlate] = [];
        grouped[vPlate].push(s);
    });

    // Populate route stats
    let totalVisits = daySchedules.length;
    let locatedVisitsCount = 0;
    
    // Summary Container
    const summaryContainer = document.getElementById('route-vehicles-summary');
    summaryContainer.innerHTML = '';
    
    // Sequence list container
    const listEl = document.getElementById('route-sequence-list');
    listEl.innerHTML = '';
    
    // Colors
    const colors = ['#0288d1', '#2e7d32', '#ed6c02', '#8e24aa', '#d32f2f', '#4caf50', '#009688'];
    let colorIdx = 0;

    // Draw HQ Marker
    const hqIcon = L.divIcon({
        className: 'hq-marker',
        html: `<div style="background:var(--text-primary);color:white;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;border:3px solid var(--border-color);box-shadow:var(--shadow-md)">🏠</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    L.marker([HQ.lat, HQ.lng], { icon: hqIcon })
        .addTo(markersGroup)
        .bindPopup(`<b>${HQ.name}</b><br>Base Operacional`);

    let allLocatedCoords = [];

    // For each vehicle group
    Object.keys(grouped).forEach((plate) => {
        const sList = grouped[plate];
        const vInfo = (state.vehicles || []).find(v => v && v.plate === plate);
        const vName = vInfo ? `${plate} (${vInfo.name})` : (plate === 'sem-veiculo' ? 'Sem veículo' : plate);
        
        let locPoints = [];
        let unlocated = [];
        
        sList.forEach((s, idx) => {
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
                    locatedVisitsCount++;
                    allLocatedCoords.push(coords);
                    return;
                }
            }
            unlocated.push(s);
        });
        
        const optimized = optimizeRouteSequence(locPoints);
        const routeColor = plate === 'sem-veiculo' ? '#6B6661' : colors[colorIdx % colors.length];
        colorIdx++;

        // Add vehicle group header in sequence area
        const groupHeader = document.createElement('div');
        groupHeader.style.padding = '8px 4px';
        groupHeader.style.marginTop = '15px';
        groupHeader.style.fontWeight = '800';
        groupHeader.style.fontSize = '0.8rem';
        groupHeader.style.borderBottom = `2px solid ${routeColor}`;
        groupHeader.style.color = routeColor;
        groupHeader.textContent = `VEÍCULO: ${vName.toUpperCase()}`;
        listEl.appendChild(groupHeader);

        // Add Sede technical starting point for this vehicle
        const hqItem = document.createElement('div');
        hqItem.className = 'sequence-item';
        hqItem.style.borderLeft = `4px solid ${routeColor}`;
        hqItem.innerHTML = `
            <span class="seq-num" style="background:#1C1A17">🏠</span>
            <div class="seq-details">
                <span class="seq-title">${HQ.name}</span>
                <span class="seq-sub">Base Técnica</span>
            </div>
        `;
        listEl.appendChild(hqItem);

        // Add optimized points
        optimized.forEach((p, idx) => {
            const item = document.createElement('div');
            item.className = 'sequence-item';
            item.style.borderLeft = `4px solid ${routeColor}`;
            item.innerHTML = `
                <span class="seq-num" style="background:${routeColor};">${idx + 1}º</span>
                <div class="seq-details">
                    <span class="seq-title">${p.name} (${p.protocol})</span>
                    <span class="seq-sub">${p.reason} ${p.derived ? '(Localização Estimada)' : ''}</span>
                </div>
            `;
            listEl.appendChild(item);

            // Add markers with custom color matching vehicle
            const markerIcon = L.divIcon({
                className: 'route-marker',
                html: `<div style="background:${routeColor};color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid white;box-shadow:var(--shadow-sm)">${idx + 1}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            L.marker([p.lat, p.lng], { icon: markerIcon })
                .addTo(markersGroup)
                .bindPopup(`
                    <b>${idx + 1}º - ${p.name} (${p.protocol})</b><br>
                    <b>Veículo:</b> ${vName}<br>
                    <b>Motivo:</b> ${p.reason}<br>
                    <b>Obs:</b> ${p.notes}
                `);
        });

        // Add unlocated
        unlocated.forEach(s => {
            const item = document.createElement('div');
            item.className = 'sequence-item';
            item.style.opacity = '0.5';
            item.innerHTML = `
                <span class="seq-num unlocated"><i data-lucide="map-pin-off" style="width:12px;height:12px"></i></span>
                <div class="seq-details">
                    <span class="seq-title">${s.name} (${s.protocol})</span>
                    <span class="seq-sub">${s.reason} — Sem Localização</span>
                </div>
            `;
            listEl.appendChild(item);
        });

        // Draw polyline and fetch distance
        if (optimized.length > 0) {
            drawOSRMRouteForVehicle(optimized, routeColor, plate, vName, summaryContainer);
        } else {
            const summaryRow = document.createElement('div');
            summaryRow.style.padding = '4px 0';
            summaryRow.innerHTML = `<span style="display:inline-block; width:10px; height:10px; background:${routeColor}; border-radius:50%; margin-right:6px; vertical-align:middle;"></span><strong>${vName}</strong>: ${sList.length} visitas (Sem mapa)`;
            summaryContainer.appendChild(summaryRow);
        }
    });

    // Update general counts
    document.getElementById('route-total-visits').textContent = totalVisits;
    document.getElementById('route-located-visits').textContent = locatedVisitsCount;
    document.getElementById('modal-route-title').textContent = `Roteirização — Turno da ${shift === 'morning' ? 'Manhã' : 'Tarde'}`;
    document.getElementById('modal-route-subtitle').textContent = `Otimizando trajeto a partir da base técnica: ${HQ.name}`;

    // Fit map bounds
    if (allLocatedCoords.length > 0) {
        const bounds = L.latLngBounds([HQ, ...allLocatedCoords].map(p => [p.lat, p.lng]));
        leafletMap.fitBounds(bounds, { padding: [40, 40] });
    } else {
        leafletMap.setView([HQ.lat, HQ.lng], 13);
    }
    lucide.createIcons({ props: { style: 'width: 12px; height: 12px; display: inline-block' } });
}

function drawOSRMRouteForVehicle(points, color, plate, vehicleName, summaryContainer) {
    const routeCoords = [HQ, ...points];
    const coordString = routeCoords.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
    
    const summaryRow = document.createElement('div');
    summaryRow.id = `summary-row-${plate}`;
    summaryRow.style.padding = '4px 0';
    summaryRow.innerHTML = `<span style="display:inline-block; width:10px; height:10px; background:${color}; border-radius:50%; margin-right:6px; vertical-align:middle;"></span><strong>${vehicleName}</strong>: ${points.length} visitas | <span id="dist-val-${plate}">Calculando KM...</span>`;
    summaryContainer.appendChild(summaryRow);

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const routeGeo = data.routes[0].geometry;
                const pathCoordinates = routeGeo.coordinates.map(c => [c[1], c[0]]); // Swap to Lat/Lng
                
                const poly = L.polyline(pathCoordinates, {
                    color: color,
                    weight: 5,
                    opacity: 0.8,
                    dashArray: '2, 6'
                }).addTo(leafletMap);
                
                window.routePolylines.push(poly);

                const distKM = (data.routes[0].distance / 1000).toFixed(1);
                document.getElementById(`dist-val-${plate}`).innerHTML = `<span style="color:var(--primary); font-weight:700;">${distKM} km</span>`;
            } else {
                throw new Error('OSRM failed');
            }
        })
        .catch(err => {
            // Fallback straight lines
            const straightCoords = routeCoords.map(p => [p.lat, p.lng]);
            const poly = L.polyline(straightCoords, {
                color: color,
                weight: 3,
                opacity: 0.6,
                dashArray: '5, 5'
            }).addTo(leafletMap);
            window.routePolylines.push(poly);

            let dist = 0;
            for(let i=0; i<routeCoords.length - 1; i++) {
                dist += getDistance(routeCoords[i], routeCoords[i+1]) * 111000;
            }
            const distKM = (dist / 1000).toFixed(1);
            document.getElementById(`dist-val-${plate}`).innerHTML = `<span style="color:var(--primary); font-weight:700;">${distKM} km (Est.)</span>`;
        });
}

function optimizeSequenceForTech(scheds) {
    let locPoints = [];
    scheds.forEach((s, idx) => {
        if (s.mapLink) {
            const coords = parseMapLink(s.mapLink, idx);
            if (coords) {
                locPoints.push({ ...coords, schedule: s });
            }
        }
    });
    
    const optimizedPoints = optimizeRouteSequence(locPoints);
    const optimizedSchedules = optimizedPoints.map(p => p.schedule);
    const unlocatedSchedules = scheds.filter(s => !optimizedSchedules.some(os => os.id === s.id));
    
    return [...optimizedSchedules, ...unlocatedSchedules];
}
window.optimizeSequenceForTech = optimizeSequenceForTech;

function calculateAndShowTechKM(plate, morningScheds, afternoonScheds) {
    let morningPoints = [];
    morningScheds.forEach((s, idx) => {
        if (s.mapLink) {
            const coords = parseMapLink(s.mapLink, idx);
            if (coords) morningPoints.push(coords);
        }
    });
    
    let afternoonPoints = [];
    afternoonScheds.forEach((s, idx) => {
        if (s.mapLink) {
            const coords = parseMapLink(s.mapLink, idx + 10);
            if (coords) afternoonPoints.push(coords);
        }
    });
    
    let totalDistMeters = 0;
    
    const fetchDist = async (pts) => {
        if (pts.length === 0) return 0;
        const routeCoords = [HQ, ...pts];
        const coordString = routeCoords.map(p => `${p.lng},${p.lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=false`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                return data.routes[0].distance;
            }
        } catch(e) {
            let dist = 0;
            for(let i=0; i<routeCoords.length - 1; i++) {
                dist += getDistance(routeCoords[i], routeCoords[i+1]) * 111000;
            }
            return dist;
        }
        return 0;
    };
    
    Promise.all([fetchDist(morningPoints), fetchDist(afternoonPoints)]).then(distances => {
        const totalKM = ((distances[0] + distances[1]) / 1000).toFixed(1);
        const kmValEl = document.getElementById('tech-km-value');
        if (kmValEl) kmValEl.textContent = `${totalKM} km`;
    });
}
window.calculateAndShowTechKM = calculateAndShowTechKM;

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
