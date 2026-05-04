/* ===================================================
   Birmingham WebGIS — Application Logic
   =================================================== */

// ---- CONFIG ----
const CFG = {
  center: [52.475, -1.900],
  zoom: 13,
  dataPath: 'data/Birmingham.geojson',
  cats: {
    atm:         { color:'#6366f1', icon:'fa-credit-card',      label:'ATM' },
    bank:        { color:'#3b82f6', icon:'fa-building-columns',  label:'Bank' },
    parking:     { color:'#8b5cf6', icon:'fa-square-parking',    label:'Parking' },
    dentist:     { color:'#10b981', icon:'fa-tooth',             label:'Dentist' },
    school:      { color:'#f59e0b', icon:'fa-school',            label:'School' },
    university:  { color:'#ec4899', icon:'fa-graduation-cap',    label:'University' },
    bus_station: { color:'#ef4444', icon:'fa-bus',               label:'Bus Station' },
    hospital:    { color:'#14b8a6', icon:'fa-hospital',          label:'Hospital' },
    townhall:    { color:'#f97316', icon:'fa-landmark-dome',     label:'Town Hall' },
    government:  { color:'#06b6d4', icon:'fa-landmark',          label:'Government' },
    other:       { color:'#64748b', icon:'fa-map-marker-alt',    label:'Other' }
  },
  basemaps: {
    'OpenStreetMap': 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'CartoDB Voyager': 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    'CartoDB Dark': 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  }
};

// ---- STATE ----
const S = {
  map: null, basemap: null, cluster: null,
  allFeatures: [], pointMarkers: {},  // cat -> [markers]
  lineLayer: null, polyLayer: null,
  catVis: {}, dark: false, musicOn: false,
  audioCtx: null, ambGain: null,
  sidebarOpen: true, locMarker: null, locCircle: null,
  counts: { points:0, lines:0, polys:0 }
};

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadData();
  bindUI();
});

function initMap() {
  S.map = L.map('map', {
    center: CFG.center, zoom: CFG.zoom,
    minZoom: 10, maxZoom: 19,
    zoomControl: false
  });

  S.basemap = L.tileLayer(CFG.basemaps['CartoDB Voyager'], {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(S.map);

  L.control.zoom({ position: 'bottomleft' }).addTo(S.map);
  L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(S.map);

  S.cluster = L.markerClusterGroup({
    maxClusterRadius: 50, spiderfyOnMaxZoom: true,
    showCoverageOnHover: false, animate: true
  });
  S.map.addLayer(S.cluster);

  // Coordinate tracking
  S.map.on('mousemove', e => {
    document.getElementById('c-lat').textContent = 'Lat: ' + e.latlng.lat.toFixed(5);
    document.getElementById('c-lng').textContent = 'Lng: ' + e.latlng.lng.toFixed(5);
  });
  S.map.on('zoomend', () => {
    document.getElementById('c-zoom').textContent = S.map.getZoom();
  });
}

// ---- DATA LOADING ----
async function loadData() {
  try {
    const r = await fetch(CFG.dataPath);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    S.allFeatures = data.features || [];
    processData();
    buildSidebar();
    updateStats();
    setTimeout(() => document.getElementById('loading-overlay').classList.add('done'), 500);
  } catch (e) {
    console.error('Load error:', e);
    document.querySelector('.loader-text').textContent = 'Error loading data!';
  }
}

function getCat(p) {
  if (p.amenity && CFG.cats[p.amenity]) return p.amenity;
  if (p.office === 'government') return 'government';
  if (p.amenity) return p.amenity;
  return 'other';
}

function catStyle(c) { return CFG.cats[c] || CFG.cats.other; }

function getName(p) { return p.name || p.name_en || p.operator || p.amenity || p.office || 'Unnamed'; }

function makeIcon(cat) {
  const s = catStyle(cat);
  return L.divIcon({
    className: '',
    html: '<div class="marker-pin" style="background:'+s.color+'"><i class="fas '+s.icon+'"></i></div>',
    iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30]
  });
}

function popupHTML(p, cat) {
  const s = catStyle(cat);
  const skip = new Set(['osm_id','osm_type']);
  let rows = '';
  for (const [k, v] of Object.entries(p)) {
    if (v == null || v === '' || skip.has(k)) continue;
    rows += '<tr><td>' + k.replace(/_/g,' ') + '</td><td>' + v + '</td></tr>';
  }
  return '<div class="pop-head" style="background:linear-gradient(135deg,'+s.color+','+s.color+'cc)">' +
    '<i class="fas '+s.icon+'"></i> ' + getName(p) +
    '</div><div class="pop-body"><table>' + rows + '</table>' +
    '<button class="pop-btn" onclick="openInfo('+p.osm_id+')"><i class="fas fa-info-circle"></i> Details</button></div>';
}

function processData() {
  const lineFeats = [];
  const polyFeats = [];

  S.allFeatures.forEach(f => {
    const g = f.geometry, p = f.properties;
    if (!g) return;

    if (g.type === 'Point') {
      S.counts.points++;
      const cat = getCat(p);
      const s = catStyle(cat);
      const ll = [g.coordinates[1], g.coordinates[0]];
      const m = L.marker(ll, { icon: makeIcon(cat), riseOnHover: true });
      m._cat = cat; m._props = p;
      m.bindPopup(popupHTML(p, cat), { maxWidth: 280, closeButton: true });
      m.on('click', () => {
        const el = m.getElement();
        if (el) {
          const pin = el.querySelector('.marker-pin');
          if (pin) { pin.classList.remove('bounce'); void pin.offsetWidth; pin.classList.add('bounce'); }
        }
        playClick();
      });
      if (!S.pointMarkers[cat]) S.pointMarkers[cat] = [];
      S.pointMarkers[cat].push(m);
      S.catVis[cat] = true;

    } else if (g.type === 'LineString') {
      S.counts.lines++;
      lineFeats.push(f);

    } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      S.counts.polys++;
      polyFeats.push(f);
    }
  });

  // Add points to cluster
  refreshCluster();

  // Lines layer
  S.lineLayer = L.geoJSON({ type:'FeatureCollection', features: lineFeats }, {
    style: feat => {
      const hw = feat.properties.highway;
      let color = '#8b5cf6', weight = 2, opacity = 0.5;
      if (hw === 'primary' || hw === 'trunk') { color = '#ef4444'; weight = 3; }
      else if (hw === 'secondary') { color = '#f59e0b'; weight = 2.5; }
      else if (hw === 'footway' || hw === 'path') { color = '#10b981'; weight = 1.5; opacity = 0.4; }
      return { color, weight, opacity };
    },
    onEachFeature: (feat, layer) => {
      layer.on('mouseover', function() { this.setStyle({ weight: 5, opacity: 1 }); });
      layer.on('mouseout', function() { S.lineLayer.resetStyle(this); });
      const p = feat.properties;
      if (p.name) layer.bindPopup('<div class="pop-head"><i class="fas fa-road"></i> ' + p.name + '</div><div class="pop-body"><small>' + (p.highway||'road') + '</small></div>');
    }
  }).addTo(S.map);

  // Polygons layer
  S.polyLayer = L.geoJSON({ type:'FeatureCollection', features: polyFeats }, {
    style: feat => {
      const b = feat.properties.building;
      let fill = '#6366f1';
      if (b === 'residential' || b === 'house' || b === 'apartments') fill = '#a78bfa';
      else if (b === 'commercial' || b === 'retail') fill = '#f59e0b';
      else if (b === 'industrial' || b === 'warehouse') fill = '#10b981';
      else if (b === 'church' || b === 'public' || b === 'civic') fill = '#ef4444';
      return { fillColor: fill, fillOpacity: 0.45, color: fill, weight: 1, opacity: 0.7 };
    },
    onEachFeature: (feat, layer) => {
      layer.on('mouseover', function() { this.setStyle({ fillOpacity: 0.8, weight: 2.5 }); });
      layer.on('mouseout', function() { S.polyLayer.resetStyle(this); });
      const p = feat.properties;
      const nm = p.name || p.building || 'Building';
      let rows = '';
      for (const [k,v] of Object.entries(p)) {
        if (v == null || v === '' || k==='osm_id' || k==='osm_type') continue;
        rows += '<tr><td>'+k.replace(/_/g,' ')+'</td><td>'+v+'</td></tr>';
      }
      layer.bindPopup('<div class="pop-head"><i class="fas fa-building"></i> '+nm+'</div><div class="pop-body"><table>'+rows+'</table></div>', {maxWidth:280});
    }
  }).addTo(S.map);
}

function refreshCluster() {
  S.cluster.clearLayers();
  let vis = 0;
  for (const [cat, markers] of Object.entries(S.pointMarkers)) {
    if (S.catVis[cat]) {
      markers.forEach(m => S.cluster.addLayer(m));
      vis += markers.length;
    }
  }
  document.getElementById('st-visible').textContent = vis;
}

// ---- SIDEBAR ----
function buildSidebar() {
  buildBasemaps();
  buildDataLayers();
  buildFilters();
  buildLegend();

  // Collapsible sections
  document.querySelectorAll('.section-header').forEach(h => {
    h.addEventListener('click', () => {
      const body = document.getElementById(h.dataset.target);
      body.classList.toggle('open');
      h.querySelector('.chevron').style.transform = body.classList.contains('open') ? '' : 'rotate(-90deg)';
    });
  });
}

function buildBasemaps() {
  const el = document.getElementById('basemap-body');
  el.innerHTML = '';
  Object.keys(CFG.basemaps).forEach((name, i) => {
    const d = document.createElement('div');
    d.className = 'ctrl-row';
    d.innerHTML = '<input type="radio" name="bm" id="bm'+i+'" value="'+name+'" '+(name==='CartoDB Voyager'?'checked':'')+'><label for="bm'+i+'" class="ctrl-label">'+name+'</label>';
    d.querySelector('input').addEventListener('change', () => switchBM(name));
    el.appendChild(d);
  });
}

function buildDataLayers() {
  const el = document.getElementById('layers-body');
  el.innerHTML = '';
  [
    { id:'pts', label:'Points (Amenities)', checked:true, toggle: v => { for(const c in S.catVis) S.catVis[c]=v; refreshCluster(); document.querySelectorAll('#filter-body input').forEach(i=>i.checked=v); }},
    { id:'lns', label:'Roads & Paths', checked:true, toggle: v => v?S.map.addLayer(S.lineLayer):S.map.removeLayer(S.lineLayer) },
    { id:'pls', label:'Buildings', checked:true, toggle: v => v?S.map.addLayer(S.polyLayer):S.map.removeLayer(S.polyLayer) }
  ].forEach(lyr => {
    const d = document.createElement('div');
    d.className = 'ctrl-row';
    d.innerHTML = '<input type="checkbox" id="lyr-'+lyr.id+'" checked><label for="lyr-'+lyr.id+'" class="ctrl-label">'+lyr.label+'</label>';
    d.querySelector('input').addEventListener('change', e => lyr.toggle(e.target.checked));
    el.appendChild(d);
  });
}

function buildFilters() {
  const el = document.getElementById('filter-body');
  el.innerHTML = '';
  const sorted = Object.entries(S.pointMarkers).sort((a,b) => b[1].length - a[1].length);
  sorted.forEach(([cat, markers]) => {
    const s = catStyle(cat);
    const d = document.createElement('div');
    d.className = 'ctrl-row';
    d.innerHTML = '<input type="checkbox" id="cf-'+cat+'" checked>' +
      '<span class="cat-dot" style="background:'+s.color+'"></span>' +
      '<span class="ctrl-label">'+s.label+'</span>' +
      '<span class="ctrl-count">'+markers.length+'</span>';
    d.querySelector('input').addEventListener('change', e => { S.catVis[cat] = e.target.checked; refreshCluster(); });
    el.appendChild(d);
  });
}

function buildLegend() {
  const el = document.getElementById('legend-body');
  el.innerHTML = '';
  // Point categories
  for (const [cat, markers] of Object.entries(S.pointMarkers)) {
    const s = catStyle(cat);
    el.innerHTML += '<div class="legend-row"><span class="legend-icon" style="background:'+s.color+'"><i class="fas '+s.icon+'"></i></span><span>'+s.label+'</span></div>';
  }
  // Lines
  el.innerHTML += '<div class="legend-row"><span class="legend-line" style="background:#8b5cf6"></span><span>Roads / Paths</span></div>';
  // Polygons
  el.innerHTML += '<div class="legend-row"><span class="legend-box" style="background:rgba(99,102,241,.45)"></span><span>Buildings</span></div>';
}

function switchBM(name) {
  if (S.basemap) S.map.removeLayer(S.basemap);
  S.basemap = L.tileLayer(CFG.basemaps[name], {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(S.map);
}

function updateStats() {
  document.getElementById('st-points').textContent = S.counts.points;
  document.getElementById('st-lines').textContent = S.counts.lines;
  document.getElementById('st-polys').textContent = S.counts.polys;
  document.getElementById('badge-count').textContent = S.allFeatures.length;
}

// ---- UI HANDLERS ----
function bindUI() {
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('music-toggle').addEventListener('click', toggleMusic);
  document.getElementById('btn-locate').addEventListener('click', locateMe);
  document.getElementById('btn-home').addEventListener('click', () => S.map.flyTo(CFG.center, CFG.zoom, {duration:1}));
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFS);
  document.getElementById('info-close').addEventListener('click', () => document.getElementById('info-panel').classList.add('closed'));

  // Volume slider: update displayed value
  const volRange = document.getElementById('vol-range');
  if (volRange) {
    volRange.addEventListener('input', () => {
      document.getElementById('vol-val').textContent = volRange.value;
    });
  }

  initSearch();
}

function toggleSidebar() {
  S.sidebarOpen = !S.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', S.sidebarOpen);
  document.body.classList.toggle('sb-open', S.sidebarOpen);
  setTimeout(() => S.map.invalidateSize(), 350);
}

function toggleTheme() {
  S.dark = !S.dark;
  document.body.classList.toggle('dark-mode', S.dark);
  document.body.classList.toggle('light-mode', !S.dark);
  document.querySelector('#theme-toggle i').className = S.dark ? 'fas fa-sun' : 'fas fa-moon';
  switchBM(S.dark ? 'CartoDB Dark' : 'CartoDB Voyager');
  const radios = document.querySelectorAll('input[name="bm"]');
  radios.forEach(r => r.checked = r.value === (S.dark ? 'CartoDB Dark' : 'CartoDB Voyager'));
}

function toggleFS() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(()=>{});
    document.querySelector('#btn-fullscreen i').className = 'fas fa-compress';
  } else {
    document.exitFullscreen();
    document.querySelector('#btn-fullscreen i').className = 'fas fa-expand';
  }
}

function locateMe() {
  const btn = document.getElementById('btn-locate');
  btn.classList.add('active');
  S.map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
  S.map.once('locationfound', e => {
    btn.classList.remove('active');
    if (S.locMarker) S.map.removeLayer(S.locMarker);
    if (S.locCircle) S.map.removeLayer(S.locCircle);
    S.locMarker = L.marker(e.latlng, {
      icon: L.divIcon({ className:'', html:'<div class="locate-dot"></div>', iconSize:[18,18], iconAnchor:[9,9] })
    }).addTo(S.map).bindPopup(
      '<div class="pop-head"><i class="fas fa-location-dot"></i> Your Location</div>' +
      '<div class="pop-body">Lat: '+e.latlng.lat.toFixed(5)+'<br>Lng: '+e.latlng.lng.toFixed(5)+'<br>±'+Math.round(e.accuracy)+'m</div>'
    ).openPopup();
    S.locCircle = L.circle(e.latlng, { radius: e.accuracy/2, color:'#6366f1', fillColor:'#6366f1', fillOpacity:.08, weight:1 }).addTo(S.map);
  });
  S.map.once('locationerror', () => {
    btn.classList.remove('active');
    alert('Could not get your location. Please enable location services.');
  });
}

// ---- SEARCH ----
function initSearch() {
  const inp = document.getElementById('search-input');
  const res = document.getElementById('search-results');
  const clr = document.getElementById('search-clear');
  let timer;

  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inp.value.trim().toLowerCase();
    clr.classList.toggle('hidden', q.length === 0);
    if (q.length < 2) { res.classList.remove('visible'); return; }
    timer = setTimeout(() => doSearch(q), 200);
  });

  clr.addEventListener('click', () => {
    inp.value = ''; clr.classList.add('hidden'); res.classList.remove('visible');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#search-box')) res.classList.remove('visible');
  });
}

function doSearch(q) {
  const res = document.getElementById('search-results');
  res.innerHTML = '';
  const hits = S.allFeatures.filter(f => {
    if (f.geometry.type !== 'Point') return false;
    const p = f.properties;
    return [p.name, p.name_en, p.operator, p.amenity, p.office].filter(Boolean).join(' ').toLowerCase().includes(q);
  }).slice(0, 12);

  if (!hits.length) {
    res.innerHTML = '<div class="sr-item" style="justify-content:center;color:var(--text2)"><i>No results</i></div>';
    res.classList.add('visible');
    return;
  }

  hits.forEach(f => {
    const cat = getCat(f.properties);
    const s = catStyle(cat);
    const d = document.createElement('div');
    d.className = 'sr-item';
    d.innerHTML = '<span class="sr-icon" style="background:'+s.color+'"><i class="fas '+s.icon+'"></i></span>' +
      '<span class="sr-name">'+getName(f.properties)+'</span><span class="sr-cat">'+s.label+'</span>';
    d.addEventListener('click', () => {
      const ll = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
      S.map.flyTo(ll, 17, {duration:1});
      res.classList.remove('visible');
      document.getElementById('search-input').value = getName(f.properties);
      playClick();
      setTimeout(() => {
        for (const ms of Object.values(S.pointMarkers)) {
          for (const m of ms) {
            if (m._props.osm_id === f.properties.osm_id) {
              S.cluster.zoomToShowLayer(m, () => m.openPopup());
              return;
            }
          }
        }
      }, 1100);
    });
    res.appendChild(d);
  });
  res.classList.add('visible');
}

// ---- INFO PANEL ----
window.openInfo = function(osmId) {
  const f = S.allFeatures.find(x => x.properties.osm_id === osmId);
  if (!f) return;
  const p = f.properties, cat = getCat(p), s = catStyle(cat);
  document.getElementById('info-title').innerHTML = '<i class="fas '+s.icon+'" style="color:'+s.color+'"></i> '+getName(p);
  let html = '<table class="info-tbl">';
  html += '<tr><td>Category</td><td><span class="cat-dot" style="background:'+s.color+';display:inline-block;margin-right:5px"></span>'+s.label+'</td></tr>';
  if (f.geometry.type === 'Point') html += '<tr><td>Coordinates</td><td>'+f.geometry.coordinates[1].toFixed(5)+', '+f.geometry.coordinates[0].toFixed(5)+'</td></tr>';
  for (const [k,v] of Object.entries(p)) {
    if (v==null || v==='' || k==='osm_id' || k==='osm_type') continue;
    html += '<tr><td>'+k.replace(/_/g,' ')+'</td><td>'+v+'</td></tr>';
  }
  html += '</table>';
  document.getElementById('info-content').innerHTML = html;
  document.getElementById('info-panel').classList.remove('closed');
  S.map.closePopup();
};

// ---- AUDIO ----
// Volume level (0-1), default 0.5 for clearly audible music
S.musicVolume = 0.5;

/**
 * Toggle background music on/off.
 * Uses Web Audio API with rich, audible ambient pad:
 *  - Multiple waveforms (triangle + sine) for warmth
 *  - Mid-range frequencies (261-523 Hz) that are clearly audible
 *  - Slow LFO modulation for dreamy movement
 *  - Master gain at 0.45 so users can actually hear it
 */
function toggleMusic() {
  const ic = document.querySelector('#music-toggle i');
  const slider = document.getElementById('volume-slider');

  // First time: create the audio graph
  if (!S.audioCtx) {
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain node
    S.ambGain = S.audioCtx.createGain();
    S.ambGain.gain.value = 0;
    S.ambGain.connect(S.audioCtx.destination);

    // Ambient chord: C4-E4-G4-B4 (mid-range, clearly audible)
    const voices = [
      { freq: 261.63, type: 'triangle', vol: 0.30 },  // C4
      { freq: 329.63, type: 'sine',     vol: 0.25 },  // E4
      { freq: 392.00, type: 'triangle', vol: 0.22 },  // G4
      { freq: 493.88, type: 'sine',     vol: 0.18 },  // B4
      { freq: 523.25, type: 'triangle', vol: 0.12 },  // C5 (octave shimmer)
    ];

    voices.forEach((v, i) => {
      // Main oscillator
      const osc = S.audioCtx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = v.freq;
      osc.detune.value = (i - 2) * 6; // slight detune for chorus effect

      // Per-voice gain
      const voiceGain = S.audioCtx.createGain();
      voiceGain.gain.value = v.vol;

      // Slow LFO for gentle pitch wobble (vibrato)
      const lfo = S.audioCtx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.15 + i * 0.07; // very slow wobble
      const lfoGain = S.audioCtx.createGain();
      lfoGain.gain.value = 3; // subtle pitch variation
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();

      // Slow volume tremolo for breathing effect
      const tremolo = S.audioCtx.createOscillator();
      tremolo.type = 'sine';
      tremolo.frequency.value = 0.08 + i * 0.03;
      const tremoloGain = S.audioCtx.createGain();
      tremoloGain.gain.value = 0.08;
      tremolo.connect(tremoloGain);
      tremoloGain.connect(voiceGain.gain);
      tremolo.start();

      // Connect: osc -> voiceGain -> masterGain
      osc.connect(voiceGain);
      voiceGain.connect(S.ambGain);
      osc.start();
    });

    // Show volume slider
    if (slider) slider.classList.remove('hidden');
  }

  // Toggle play/pause
  S.musicOn = !S.musicOn;

  if (S.musicOn) {
    S.audioCtx.resume();
    // Fade in to target volume over 0.8 seconds
    S.ambGain.gain.cancelScheduledValues(S.audioCtx.currentTime);
    S.ambGain.gain.setValueAtTime(S.ambGain.gain.value, S.audioCtx.currentTime);
    S.ambGain.gain.linearRampToValueAtTime(S.musicVolume, S.audioCtx.currentTime + 0.8);
    ic.className = 'fas fa-volume-high';
  } else {
    // Fade out over 0.5 seconds
    S.ambGain.gain.cancelScheduledValues(S.audioCtx.currentTime);
    S.ambGain.gain.setValueAtTime(S.ambGain.gain.value, S.audioCtx.currentTime);
    S.ambGain.gain.linearRampToValueAtTime(0, S.audioCtx.currentTime + 0.5);
    ic.className = 'fas fa-volume-xmark';
  }
}

/**
 * Handle volume slider changes.
 */
function onVolumeChange(val) {
  S.musicVolume = parseFloat(val);
  if (S.ambGain && S.musicOn) {
    S.ambGain.gain.cancelScheduledValues(S.audioCtx.currentTime);
    S.ambGain.gain.setValueAtTime(S.ambGain.gain.value, S.audioCtx.currentTime);
    S.ambGain.gain.linearRampToValueAtTime(S.musicVolume, S.audioCtx.currentTime + 0.1);
  }
}

/**
 * Play a clear "pop" sound effect when a marker is clicked.
 * Two-tone descending chime that's clearly audible.
 */
function playClick() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Tone 1: high ping
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(1200, t);
    o1.frequency.exponentialRampToValueAtTime(600, t + 0.15);
    g1.gain.setValueAtTime(0.35, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o1.connect(g1); g1.connect(ctx.destination);
    o1.start(t); o1.stop(t + 0.25);

    // Tone 2: soft harmonic (delayed slightly)
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(800, t + 0.05);
    o2.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.2, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o2.connect(g2); g2.connect(ctx.destination);
    o2.start(t); o2.stop(t + 0.3);
  } catch(e) {}
}
