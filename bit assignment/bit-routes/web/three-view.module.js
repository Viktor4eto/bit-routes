// three-view.module.js - with water layer fix
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

let renderer, scene, camera, controls, mesh, routeLine;
let width = 0, height = 0;
let heights = null;
let hostEl = null;
let currentRoute = null;
let currentWaypoints = null;
let currentExag = 80;
let colorTexture = null;
let water = null;
let waypointMarkers = [];
let OrbitControls = null;

// === Height thresholds ===
const LEVELS = {
  SEA:   0.35,
  GRASS: 0.65,
  ROCK:  0.70,
  SNOW:  0.80
};

// Palette
const COLORS = {
  WATER: 0x3b79d0,
  GRASS: 0x71b24a,
  ROCK:  0x8a7a6b,
  SNOW:  0xffffff
};

async function loadOrbitControls() {
  if (OrbitControls) return OrbitControls;
  const module = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js');
  OrbitControls = module.OrbitControls;
  console.log('OrbitControls loaded');
  return OrbitControls;
}

async function loadHeightmap() {
  console.log('Loading heightmap...');
  const resp = await fetch('/heightmap.bin', { cache: 'no-store' });
  if (!resp.ok) throw new Error('No heightmap available. Generate a map first.');
  width = Number(resp.headers.get('X-Width'));
  height = Number(resp.headers.get('X-Height'));
  const buf = await resp.arrayBuffer();
  heights = new Float32Array(buf);

  if (!width || !height) {
    try {
      const m = await (await fetch('/meta')).json();
      width = Number(m.width) || width;
      height = Number(m.height) || height;
    } catch {}
    if (!width || !height) throw new Error('Heightmap dimensions missing.');
  }
  console.log('Heightmap loaded:', width, 'x', height, 'values:', heights.length);
}

function makeGeometry(exag) {
  const w = width, h = height;
  const geo = new THREE.PlaneGeometry(w - 1, h - 1, w - 1, h - 1);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const ix = i % w;
    const iy = Math.floor(i / w);
    const srcY = (h - 1 - iy);
    const heightValue = heights[srcY * w + ix];
    const z = (heightValue - 0.5) * exag;
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function colorMaterial() {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
}

function applyVertexColors(geo) {
  const w = width, h = height;
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const setRGB = (i, hex) => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    colors[i*3 + 0] = r;
    colors[i*3 + 1] = g;
    colors[i*3 + 2] = b;
  };
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const ix = i % w;
    const iy = Math.floor(i / w);
    const srcY = (h - 1 - iy);
    const h01 = heights[srcY * w + ix];
    let c;
    if (h01 < LEVELS.SEA)       c = COLORS.WATER;
    else if (h01 < LEVELS.GRASS) c = COLORS.GRASS;
    else if (h01 < LEVELS.ROCK)  c = COLORS.ROCK;
    else if (h01 < LEVELS.SNOW)  c = COLORS.ROCK;
    else                         c = COLORS.SNOW;
    setRGB(i, c);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function fitCamera(exag) {
  const size = Math.max(width, height);
  const fov = 55;
  const aspect = hostEl.clientWidth / hostEl.clientHeight;
  camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 5000);
  const dist = size * 1.2 + exag * 0.6;
  camera.position.set(0, -dist, dist * 0.8);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
}

let resizeHandler = null
async function ensureScene(exag, route = null, waypoints = null) {
  console.log('ensureScene called - renderer exists:', !!renderer, 'water exists:', !!water);

  if (renderer) {
    // Remove terrain mesh
    if (mesh) {
      console.log('Removing mesh from scene');
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh = null;
    }
    // Remove route line
    if (routeLine) {
      console.log('Removing routeLine from scene');
      scene.remove(routeLine);
      routeLine.geometry.dispose();
      routeLine.material.dispose();
      routeLine = null;
    }
    // Remove waypoint markers
    if (waypointMarkers.length > 0) {
      console.log('Removing', waypointMarkers.length, 'waypoint markers');
      waypointMarkers.forEach(marker => {
        scene.remove(marker);
        marker.geometry.dispose();
        marker.material.dispose();
      });
      waypointMarkers = [];
    }

    // ALWAYS remove water to recreate it
    if (water) {
      console.log('Removing water from scene');
      scene.remove(water);
      water.geometry.dispose();
      water.material.dispose();
      water = null;
    }
  } else {
    console.log('Initializing Three.js scene...');
    await loadOrbitControls();

    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: false
    });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(hostEl.clientWidth, hostEl.clientHeight);
    renderer.sortObjects = true; // Enable render order sorting
    hostEl.innerHTML = '';
    hostEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

    fitCamera(exag);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 0.7);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(-1, -1, 2).multiplyScalar(500);
    scene.add(dir);

    if (!resizeHandler) {
        resizeHandler = onResize;
        window.addEventListener('resize', resizeHandler);
    }
  }

  // Create terrain mesh
  console.log('Creating terrain mesh');
  const geo = makeGeometry(exag);
  applyVertexColors(geo);
  const mat = colorMaterial();

  mesh = new THREE.Mesh(geo, mat);
  mesh.scale.y = -1;
  mesh.renderOrder = 1; // Render terrain after water
  scene.add(mesh);
  console.log('Terrain mesh added with renderOrder:', mesh.renderOrder);

  // ALWAYS recreate water - this is critical
  console.log('Creating water layer');
  const wGeo = new THREE.PlaneGeometry(width - 1, height - 1, 1, 1);
  const wMat = new THREE.MeshPhongMaterial({
    color: COLORS.WATER,
    transparent: true,
    opacity: 0.35,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide
  });
  water = new THREE.Mesh(wGeo, wMat);
  const seaZ = (LEVELS.SEA - 0.5) * exag;
  water.position.set(0, 0, seaZ + 0.02);
  water.scale.y = -1;
  water.renderOrder = 0; // Render water before everything else
  scene.add(water);
  console.log('Water layer ADDED to scene at z:', seaZ + 0.02, 'renderOrder:', water.renderOrder);
  console.log('Scene now has', scene.children.length, 'children');

  // Only add route if it exists and has points
  if (route && route.length > 0) {
    console.log('Adding route with', route.length, 'points');
    addRoute3D(route, exag);
  }

  // Only add waypoints if they exist
  if (waypoints && waypoints.length > 0) {
    console.log('Adding', waypoints.length, 'waypoints');
    addWaypoints3D(waypoints, exag);
  }

  console.log('ensureScene complete - water in scene:', scene.children.includes(water));
}

function addWaypoints3D(waypoints, exag) {
  if (!waypoints || !waypoints.length) return;

  const w = width, h = height;
  const pos = mesh.geometry.attributes.position;

  waypoints.forEach((wp, idx) => {
    let x = Math.max(0, Math.min(w - 1, Math.round(wp.x)));
    let y = Math.max(0, Math.min(h - 1, Math.round(wp.y)));

    const flippedY = h - 1 - y;
    const flippedVertexIndex = flippedY * w + x;

    const gx = pos.getX(flippedVertexIndex);
    const gy = pos.getY(flippedVertexIndex);
    const gz = pos.getZ(flippedVertexIndex);
    const py = -gy;

    // Scale offset with exaggeration
    const offset = Math.max(3.0, exag * 0.08);

    // Use terrain height, but clamp to sea level minimum
    const seaZ = (LEVELS.SEA - 0.5) * exag;
    const terrainZ = Math.max(gz, seaZ);
    const finalZ = terrainZ + offset;

    // Different colors for start, end, and intermediate waypoints
    let color, size;
    if (idx === 0) {
      color = 0x22c55e; // green for start
      size = 6;
    } else if (idx === waypoints.length - 1) {
      color = 0xef4444; // red for end
      size = 6;
    } else {
      color = 0x3b82f6; // blue for intermediate
      size = 5;
    }

    // Create sphere marker
    const markerGeo = new THREE.SphereGeometry(size, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({
      color: color,
      depthTest: true,
      depthWrite: false
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(gx, py, finalZ);
    marker.renderOrder = 100; // Changed from 1000 to 100
    scene.add(marker);
    waypointMarkers.push(marker);

    // Add a vertical line from terrain to marker for visibility
    const lineGeo = new THREE.BufferGeometry();
    const linePoints = new Float32Array([
      gx, py, gz,
      gx, py, finalZ
    ]);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePoints, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.5,
      depthTest: true
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.renderOrder = 100; // Changed from 999 to 100
    scene.add(line);
    waypointMarkers.push(line);
  });
  console.log('Added', waypoints.length, 'waypoint markers with renderOrder 100');
}

function addRoute3D(route, exag) {
  if (!route || !route.length) {
    console.log('No route to add to 3D view');
    return;
  }

  if (routeLine) {
    scene.remove(routeLine);
    routeLine.geometry.dispose();
    routeLine.material.dispose();
    routeLine = null;
  }

  const w = width, h = height;
  const pts = new Float32Array(route.length * 3);
  const pos = mesh.geometry.attributes.position;

  for (let i = 0; i < route.length; i++) {
    let [x, y] = route[i];

    x = Math.max(0, Math.min(w - 1, Math.round(x)));
    y = Math.max(0, Math.min(h - 1, Math.round(y)));

    const flippedY = h - 1 - y;
    const flippedVertexIndex = flippedY * w + x;

    const gx = pos.getX(flippedVertexIndex);
    const gy = pos.getY(flippedVertexIndex);
    const gz = pos.getZ(flippedVertexIndex);
    const py = -gy;

    // Scale offset with exaggeration: at least 3 units, scales with exag
    const offset = Math.max(3.0, exag * 0.08);

    // Use terrain height, but clamp to sea level minimum to avoid underwater dips
    const seaZ = (LEVELS.SEA - 0.5) * exag;
    const terrainZ = Math.max(gz, seaZ);
    const finalZ = terrainZ + offset;

    pts[i * 3] = gx;
    pts[i * 3 + 1] = py;
    pts[i * 3 + 2] = finalZ;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pts, 3));

  const m = new THREE.LineBasicMaterial({
    color: 0xffff00,
    linewidth: 5,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
    depthWrite: false
  });

  routeLine = new THREE.Line(g, m);
  routeLine.renderOrder = 50; // Changed from 999 to 50
  scene.add(routeLine);
  console.log('Route added to 3D view with', route.length, 'points and renderOrder 50');
}

function animate() {
  if (!renderer) return;
  requestAnimationFrame(animate);
  controls && controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  if (!renderer || !camera) return;
  renderer.setSize(hostEl.clientWidth, hostEl.clientHeight);
  camera.aspect = hostEl.clientWidth / hostEl.clientHeight;
  camera.updateProjectionMatrix();
}

async function mount(el, exag = 8, route = null, waypoints = null) {
  console.log('mount() called with exag:', exag, 'route points:', route ? route.length : 0, 'waypoints:', waypoints ? waypoints.length : 0);
  hostEl = el;
  currentExag = exag;
  currentRoute = route;
  currentWaypoints = waypoints;

  try {
    await loadHeightmap();
    await ensureScene(exag, route, waypoints);
    animate();
  } catch (err) {
    console.error('Mount failed:', err);
    throw err;
  }
}

function unmount() {
  if (!renderer) return;
  window.removeEventListener('resize', onResize);
  renderer.dispose();
  hostEl.innerHTML = '';
  renderer = scene = camera = controls = mesh = routeLine = water = null;
  waypointMarkers = [];
  console.log('Unmounted');
}

function updateExaggeration(exag, route = null, waypoints = null) {
  if (!renderer) return;
  console.log('Updating exaggeration to:', exag, 'with route:', route ? route.length : 0, 'points');
  currentExag = exag;
  currentRoute = route;
  currentWaypoints = waypoints || currentWaypoints;
  ensureScene(exag, route, currentWaypoints);
}

function clearHeights() {
  heights = null;
  width = 0;
  height = 0;
}

console.log('Loading THREEVIEW module...');
window.THREEVIEW = { mount, unmount, updateExaggeration, clearHeights };
window.dispatchEvent(new Event('threeview-ready'));
console.log('THREEVIEW ready and exported');