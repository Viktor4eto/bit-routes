// Wait for DOM to be ready
const seedEl = document.getElementById('seed');
const sizeEl = document.getElementById('size');
const noiseMethodEl = document.getElementById('noise-method');
const btnGen = document.getElementById('btn-generate');

// Debug: Check if noise method selector exists
if (!noiseMethodEl) {
  console.error('ERROR: noise-method element not found!');
} else {
  console.log('Noise method selector found, current value:', noiseMethodEl.value);
}
const btnClear = document.getElementById('btn-clear');
const btnHeightmap = document.getElementById('btn-heightmap');
const btn3D = document.getElementById('btn-3d');
const threeModal = document.getElementById('threed-modal');
const threeClose = document.getElementById('threed-close');
const threeCanvas = document.getElementById('threed-canvas');
const threeExag = document.getElementById('threed-exag');
const wLand = document.getElementById('w-land');
const wMountain = document.getElementById('w-mountain');
const wSnow = document.getElementById('w-snow');
const mapImg = document.getElementById('map');
const overlay = document.getElementById('overlay');
const stage = document.getElementById('stage');
const stats = document.getElementById('stats');
const loadingEl = document.getElementById('loading');
const routePreset = document.getElementById('route-preset');
const vehiclePreset = document.getElementById('vehicle-preset');
const allowWaterEl = document.getElementById('allow-water');
const algorithmSelect = document.getElementById('algorithm-select');

let W = 0, H = 0;
let waypoints = []; // Changed from start/end to array of waypoints
let useRelief = false;
let genController = null;
let lastRoute = null;
let threeViewReady = !!window.THREEVIEW;
let heightmapAvailable = false;

// Check immediately if THREEVIEW is already available
if (window.THREEVIEW) {
  threeViewReady = true;
  console.log('THREEVIEW already loaded');
}

// Also listen for the event in case it fires later
window.addEventListener('threeview-ready', () => {
  threeViewReady = true;
  console.log('THREEVIEW ready event received');
  if (window.THREEVIEW) {
  window.THREEVIEW.clearHeights?.();
}
  maybeEnable3D();
});

// Check available noise methods on startup
async function checkNoiseMethods() {
  try {
    const resp = await fetch('/noise-methods');
    if (resp.ok) {
      const info = await resp.json();
      console.log('Noise methods available:', info);

      // Disable unavailable methods
      if (!info.has_fastnoise) {
        const fastOption = noiseMethodEl.querySelector('option[value="fast"]');
        if (fastOption) {
          fastOption.disabled = true;
          fastOption.textContent = 'Fast (not available)';
        }
        // Make sure auto or opensimplex is selected
        if (noiseMethodEl.value === 'fast') {
          noiseMethodEl.value = 'auto';
        }
      }
    }
  } catch (e) {
    console.log('Could not check noise methods:', e);
  }
}

async function hasHeightmap() {
  try {
    const head = await fetch('/heightmap.bin', { method: 'HEAD', cache: 'no-store' });
    heightmapAvailable = head.ok;
    console.log('Heightmap available:', heightmapAvailable);
  } catch (e) {
    console.log('Heightmap check failed:', e);
    heightmapAvailable = false;
  }
  return heightmapAvailable;
}

function maybeEnable3D() {
  const shouldEnable = threeViewReady && heightmapAvailable;
  console.log('maybeEnable3D:', { threeViewReady, heightmapAvailable, shouldEnable });
  btn3D.disabled = !shouldEnable;
  if (shouldEnable) {
    console.log('3D button enabled!');
  }
}

function setStageSize(w, h) {
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  overlay.setAttribute('width', w);
  overlay.setAttribute('height', h);
}

function setLoading(on) {
  loadingEl.classList.toggle('show', on);
  loadingEl.setAttribute('aria-busy', on ? 'true' : 'false');
  stage.classList.toggle('loading', on);
  const ctrls = document.querySelectorAll('.controls input, .controls button, .controls select');
  ctrls.forEach(el => { el.disabled = on; });
}

async function generate() {
  if (genController) { try { genController.abort(); } catch {} }
  genController = new AbortController();
  const { signal } = genController;
  setLoading(true);
  const seed = seedEl.value ? Number(seedEl.value) : '';
  const size = Number(sizeEl.value || 512);
  const method = noiseMethodEl ? noiseMethodEl.value : 'auto';

  console.log('Generate called with:', { seed, size, method });

  if (size < 128) {
    setLoading(false);
    stats.textContent = "Map size must be at least 128 × 128.";
    return;
  }

  const url = new URL('/generate', location.origin);
  if (seed !== '') url.searchParams.set('seed', seed);
  url.searchParams.set('size', size);
  url.searchParams.set('method', method);

  console.log('Fetching:', url.toString());

  try {
    const resp = await fetch(url, { signal });
    const meta = await resp.json();

    // Check for errors
    if (meta.error) {
      setLoading(false);
      stats.textContent = `Generation failed: ${meta.error}`;
      return;
    }

    W = meta.width; H = meta.height;
    setStageSize(W, H);
    const t = Date.now();
    const nextSrc = useRelief ? `/relief.png?t=${t}` : `/map.png?t=${t}`;
    await new Promise((resolve, reject) => {
      const onLoad = () => { cleanup(); resolve(); };
      const onError = (e) => { cleanup(); reject(e); };
      function cleanup() {
        mapImg.removeEventListener('load', onLoad);
        mapImg.removeEventListener('error', onError);
      }
      mapImg.addEventListener('load', onLoad, { once: true });
      mapImg.addEventListener('error', onError, { once: true });
      mapImg.src = nextSrc;
    });
    waypoints = [];
    lastRoute = null; // Clear route on new generation
    overlay.innerHTML = '';

    const methodText = meta.method ? ` (${meta.method})` : '';
    stats.textContent = `Generated seed=${meta.seed} size=${W}x${H} in ${meta.ms.toFixed(1)} ms${methodText}`;
  } catch (err) {
    if (err?.name === 'AbortError') {
      // silently ignore
    } else {
      console.error(err);
      stats.textContent = 'Generation failed. Check the server logs.';
    }
  } finally {
    setLoading(false);
    genController = null;
    await hasHeightmap();
    maybeEnable3D();
  }
}

function tileFromEvent(evt) {
  const rect = stage.getBoundingClientRect();
  const x = Math.floor((evt.clientX - rect.left) * (W / rect.width));
  const y = Math.floor((evt.clientY - rect.top) * (H / rect.height));
  return { x, y };
}

function drawPath(segments) {
  overlay.innerHTML = '';
  if (!segments || !segments.length) return;

  // Draw each segment with potentially different colors
  segments.forEach((points, idx) => {
    if (!points || !points.length) return;
    const pts = points.map(([x, y]) => `${x},${y}`).join(' ');
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts);
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#fbbf24');
    pl.setAttribute('stroke-width', '3');
    pl.setAttribute('stroke-linejoin', 'round');
    pl.setAttribute('stroke-linecap', 'round');
    overlay.appendChild(pl);
  });

  // Draw waypoint markers
  const mk = (x, y, color, r, label) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', r);
    c.setAttribute('fill', color);
    c.setAttribute('stroke', '#111827');
    c.setAttribute('stroke-width', '1.5');
    overlay.appendChild(c);

    if (label) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x);
      t.setAttribute('y', y - r - 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#fff');
      t.setAttribute('font-size', '12');
      t.setAttribute('font-weight', 'bold');
      t.setAttribute('stroke', '#111827');
      t.setAttribute('stroke-width', '3');
      t.setAttribute('paint-order', 'stroke');
      t.textContent = label;
      overlay.appendChild(t);
    }
  };

  waypoints.forEach((pt, idx) => {
    if (idx === 0) {
      mk(pt.x, pt.y, '#22c55e', 5, 'Start');
    } else if (idx === waypoints.length - 1) {
      mk(pt.x, pt.y, '#ef4444', 5, 'End');
    } else {
      mk(pt.x, pt.y, '#3b82f6', 4, `${idx}`);
    }
  });
}

async function requestRoute() {
  if (waypoints.length < 2) return;

  const url = new URL('/route-multi', location.origin);
  url.searchParams.set('waypoints', JSON.stringify(waypoints.map(pt => [pt.x, pt.y])));
  url.searchParams.set('land', wLand.value);
  url.searchParams.set('mountain', wMountain.value);
  url.searchParams.set('snow', wSnow.value);
  url.searchParams.set('boat', allowWaterEl.checked ? '1' : '0');
  url.searchParams.set('algorithm', algorithmSelect.value);

  const res = await (await fetch(url)).json();

  if (res.segments === null) {
    stats.textContent = `No route: ${res.error || 'unreachable'} (took ${res.ms.toFixed(1)} ms, ${res.algorithm})`;
    drawPath(null);
    lastRoute = null; // Clear route when no path found
    return;
  }

  drawPath(res.segments);
  lastRoute = res.full_path;

  const totalSteps = res.segments.reduce((sum, seg) => sum + seg.length, 0);
  stats.textContent = `Route: ${waypoints.length} waypoints, ${totalSteps} steps, cost=${res.total_cost.toFixed(2)}, expanded=${res.total_expanded}, ${res.ms.toFixed(1)} ms (${res.algorithm})`;
}

btnGen.addEventListener('click', generate);
btnClear.addEventListener('click', () => {
  overlay.innerHTML = '';
  waypoints = [];
  lastRoute = null; // Clear route when clearing waypoints
  stats.textContent = 'Cleared route.';
});

btnHeightmap.addEventListener('click', () => {
  useRelief = !useRelief;
  btnHeightmap.setAttribute('aria-pressed', useRelief ? 'true' : 'false');
  stage.classList.toggle('relief', useRelief);
  const t = Date.now();
  mapImg.src = useRelief ? `/relief.png?t=${t}` : `/map.png?t=${t}`;
});

btn3D.addEventListener('click', async () => {
  console.log('3D button clicked, waypoints:', waypoints);
  if (!window.THREEVIEW) {
    stats.textContent = '3D view not loaded yet. Please wait.';
    console.error('THREEVIEW not available');
    return;
  }
  if (!heightmapAvailable) {
    await hasHeightmap();
  }
  if (!heightmapAvailable) {
    stats.textContent = '3D is not ready yet. Generate a map first.';
    return;
  }
  threeModal.classList.remove('hidden');
  threeModal.setAttribute('aria-hidden', 'false');
  try {
    console.log('Mounting 3D view with waypoints:', waypoints);
    // Pass lastRoute (which is null when no route exists)
    await window.THREEVIEW.mount(threeCanvas, threeExag.valueAsNumber, lastRoute, waypoints);
    console.log('3D view mounted successfully');
  } catch (e) {
    console.error('3D mount error:', e);
    stats.textContent = (e && e.message) ? `3D init error: ${e.message}` : '3D view failed to initialize.';
  }
});

routePreset.addEventListener('change', () => {
  applyRoutePreset(routePreset.value);
  if (waypoints.length >= 2) requestRoute();
});

vehiclePreset.addEventListener('change', () => {
  applyVehiclePreset(vehiclePreset.value);
  if (waypoints.length >= 2) requestRoute();
});

algorithmSelect.addEventListener('change', () => {
  if (waypoints.length >= 2) requestRoute();
});

[wLand, wMountain, wSnow].forEach(el => {
  el.addEventListener('input', () => {
    routePreset.value = 'custom';
    vehiclePreset.value = 'custom';
    el.value = clamp01x10(el.value);
  });
});

threeClose.addEventListener('click', () => {
  threeModal.classList.add('hidden');
  threeModal.setAttribute('aria-hidden', 'true');
  window.THREEVIEW.unmount();
});

threeExag.addEventListener('input', () => {
  if (window.THREEVIEW) {
    console.log('Updating exaggeration with waypoints:', waypoints);
    // Pass lastRoute to updateExaggeration
    window.THREEVIEW.updateExaggeration(threeExag.valueAsNumber, lastRoute, waypoints);
  }
});


// Check if a tile is reachable from existing waypoints
async function isTileReachable(x, y) {
  try {
    // If no waypoints yet, any valid tile is reachable
    if (waypoints.length === 0) {
      const resp = await fetch(`/check-tile?x=${x}&y=${y}`);
      if (!resp.ok) return false;
      const data = await resp.json();
      // First waypoint: must not be water unless boat is enabled
      return allowWaterEl.checked || !data.is_water;
    }

    // Check if we can reach this tile from the last waypoint
    const lastWp = waypoints[waypoints.length - 1];
    const url = new URL('/route', location.origin);
    url.searchParams.set('x1', lastWp.x);
    url.searchParams.set('y1', lastWp.y);
    url.searchParams.set('x2', x);
    url.searchParams.set('y2', y);
    url.searchParams.set('land', wLand.value);
    url.searchParams.set('mountain', wMountain.value);
    url.searchParams.set('snow', wSnow.value);
    url.searchParams.set('boat', allowWaterEl.checked ? '1' : '0');
    url.searchParams.set('algorithm', algorithmSelect.value);

    const resp = await fetch(url);
    const data = await resp.json();

    return data.path !== null;
  } catch (e) {
    console.error('Failed to check reachability:', e);
    return false;
  }
}

stage.addEventListener('click', async (evt) => {
  const t = tileFromEvent(evt);

  // Check if this tile is reachable
  const reachable = await isTileReachable(t.x, t.y);
  if (!reachable) {
    if (waypoints.length === 0) {
      stats.textContent = `Cannot place start waypoint in water at ${t.x},${t.y}. Enable "Has a boat" to allow water waypoints.`;
    } else {
      stats.textContent = `Cannot reach ${t.x},${t.y} from last waypoint at ${waypoints[waypoints.length - 1].x},${waypoints[waypoints.length - 1].y}. Try a different location or adjust settings.`;
    }
    return;
  }

  waypoints.push(t);

  if (waypoints.length === 1) {
    stats.textContent = `Start at ${t.x},${t.y}. Click to add more waypoints.`;
    // Draw the start marker immediately
    const mk = (x, y, color, r, label) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x);
      c.setAttribute('cy', y);
      c.setAttribute('r', r);
      c.setAttribute('fill', color);
      c.setAttribute('stroke', '#111827');
      c.setAttribute('stroke-width', '1.5');
      overlay.appendChild(c);

      if (label) {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', x);
        txt.setAttribute('y', y - r - 4);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#fff');
        txt.setAttribute('font-size', '12');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('stroke', '#111827');
        txt.setAttribute('stroke-width', '3');
        txt.setAttribute('paint-order', 'stroke');
        txt.textContent = label;
        overlay.appendChild(txt);
      }
    };
    mk(t.x, t.y, '#22c55e', 5, 'Start');
  } else if (waypoints.length === 2) {
    stats.textContent = `Added waypoint at ${t.x},${t.y}. Finding route...`;
    await requestRoute();
  } else {
    stats.textContent = `Added waypoint ${waypoints.length - 1} at ${t.x},${t.y}. Finding route...`;
    await requestRoute();
  }
});

// Right-click to remove last waypoint
stage.addEventListener('contextmenu', (evt) => {
  evt.preventDefault();
  if (waypoints.length > 0) {
    const removed = waypoints.pop();
    stats.textContent = `Removed waypoint at ${removed.x},${removed.y}. ${waypoints.length} waypoints remaining.`;
    if (waypoints.length >= 2) {
      requestRoute();
    } else {
      overlay.innerHTML = '';
      lastRoute = null; // Clear route when removing waypoints
      if (waypoints.length === 1) {
        // Redraw the start marker
        const mk = (x, y, color, r, label) => {
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', x);
          c.setAttribute('cy', y);
          c.setAttribute('r', r);
          c.setAttribute('fill', color);
          c.setAttribute('stroke', '#111827');
          c.setAttribute('stroke-width', '1.5');
          overlay.appendChild(c);

          if (label) {
            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', x);
            txt.setAttribute('y', y - r - 4);
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('fill', '#fff');
            txt.setAttribute('font-size', '12');
            txt.setAttribute('font-weight', 'bold');
            txt.setAttribute('stroke', '#111827');
            txt.setAttribute('stroke-width', '3');
            txt.setAttribute('paint-order', 'stroke');
            txt.textContent = label;
            overlay.appendChild(txt);
          }
        };
        const start = waypoints[0];
        mk(start.x, start.y, '#22c55e', 5, 'Start');
        stats.textContent = `Start at ${start.x},${start.y}. Click to add more waypoints.`;
      }
    }
  }
});

// Auto-generate on load
window.addEventListener('load', async () => {
  console.log('Page loaded, checking 3D status...');
  btn3D.disabled = true;

  // Check available noise methods
  await checkNoiseMethods();

  await hasHeightmap();
  maybeEnable3D();

  try {
    const resp = await fetch('/meta');
    if (resp.ok) {
      const meta = await resp.json();
      W = meta.width; H = meta.height;
      setStageSize(W, H);
      const t = Date.now();
      const nextSrc = `/map.png?t=${t}`;
      await new Promise((resolve, reject) => {
        const onLoad = () => { cleanup(); resolve(); };
        const onError = (e) => { cleanup(); reject(e); };
        function cleanup() {
          mapImg.removeEventListener('load', onLoad);
          mapImg.removeEventListener('error', onError);
        }
        mapImg.addEventListener('load', onLoad, { once: true });
        mapImg.addEventListener('error', onError, { once: true });
        mapImg.src = nextSrc;
      });
      const methodText = meta.method ? ` (${meta.method})` : '';
      stats.textContent = `Loaded previous map size=${W}x${H}${meta.seed !== -1 ? ` (seed=${meta.seed})` : ''}${methodText}. Click to add waypoints.`;
      return;
    }
  } catch (e) {
    console.log('No previous map, generating new one...');
  }

  generate().then(async () => {
    await hasHeightmap();
    maybeEnable3D();
  }).catch(() => {});
});

// --- Presets ---
const clamp01x10 = v => Math.max(0, Math.min(10, Number(v)));

const ROUTE_PRESETS = {
  'scenic-mountains':  { land: 3, mountain: 1, snow: 6 },
  'mountain-snow-adventure': { land: 4, mountain: 2, snow: 2 },
  'no-mountains':      { land: 2, mountain: 10, snow: 6 },
};

const VEHICLE_PRESETS = {
  'hiker':       { land: 1, mountain: 3, snow: 4 },
  'mtb':         { land: 1, mountain: 2, snow: 7 },
  '4x4':         { land: 1, mountain: 2, snow: 3 },
  'road-car':    { land: 1, mountain: 6, snow: 10 },
  'snowmobile':  { land: 3, mountain: 4, snow: 1 },
};

function applyWeights({ land, mountain, snow }) {
  if (land   != null) wLand.value      = clamp01x10(land);
  if (mountain != null) wMountain.value = clamp01x10(mountain);
  if (snow   != null) wSnow.value      = clamp01x10(snow);
}

function applyRoutePreset(name) {
  if (name === 'custom') return;
  const p = ROUTE_PRESETS[name];
  if (p) {
    applyWeights(p);
    vehiclePreset.value = 'custom';
  }
}

function applyVehiclePreset(name) {
  if (name === 'custom') return;
  const p = VEHICLE_PRESETS[name];
  if (p) {
    applyWeights(p);
    routePreset.value = 'custom';
  }
}

// Prevent disabling "Has a boat" if current route requires water
allowWaterEl.addEventListener('change', async () => {
  // Turning ON: allow and just recompute (if applicable)
  if (allowWaterEl.checked) {
    if (waypoints.length >= 2) await requestRoute();
    return;
  }

  // Turning OFF: if we have a multi-waypoint route, probe land-only first
  if (waypoints.length >= 2) {
    try {
      const url = new URL('/route-multi', location.origin);
      url.searchParams.set('waypoints', JSON.stringify(waypoints.map(pt => [pt.x, pt.y])));
      url.searchParams.set('land', wLand.value);
      url.searchParams.set('mountain', wMountain.value);
      url.searchParams.set('snow', wSnow.value);
      url.searchParams.set('boat', '0'); // force land-only
      url.searchParams.set('algorithm', algorithmSelect.value);

      const res = await (await fetch(url)).json();
      if (res.segments === null) {
        // Land-only impossible → revert toggle and explain
        allowWaterEl.checked = true;
        stats.textContent = 'Cannot disable "Has a boat": the current route requires water.';
        return;
      }

      // Land-only works → accept disabling and update the route
      drawPath(res.segments);
      lastRoute = res.full_path;
      const totalSteps = res.segments.reduce((s, seg) => s + seg.length, 0);
      stats.textContent = `Boat disabled: switched to land-only route (${totalSteps} steps).`;
    } catch (e) {
      console.error('Boat toggle check failed', e);
      // Be safe: keep boat enabled if we cannot verify
      allowWaterEl.checked = true;
      stats.textContent = 'Could not verify land-only route; keeping "Has a boat" enabled.';
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const activeTag = document.activeElement.tagName.toLowerCase();
    // Ignore Enter inside textareas or buttons to avoid interference
    if (activeTag !== "textarea" && activeTag !== "button") {
      event.preventDefault();
      const btnGenerate = document.getElementById("btn-generate");
      if (btnGenerate && !btnGenerate.disabled) {
        btnGenerate.click();
      }
    }
  }
});