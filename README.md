# Bit Routes Documentation

**Bit Routes** is a multi-waypoint pathfinding visualization tool that generates procedural terrain maps and computes optimal routes between waypoints using various pathfinding algorithms. It features a 2D map view with terrain overlays and an interactive 3D terrain renderer.

---
##  Usage Guide

### **Starting the Server**
```bash
pip install -r server/requirements.txt
uvicorn server.app:app --reload
```
Navigate to `http://localhost:8000`

Works best on Chrome.

### **Basic Workflow**

1. **Generate Terrain**
   - Enter seed (optional) or leave blank for random
   - Set size (128-2048, default 512)
   - Select noise method (Auto/Fast/OpenSimplex)
   - Click "Generate"

2. **Add Waypoints**
   - Left-click on map to add waypoints in order
   - Right-click to remove last waypoint
   - Route auto-calculates after 2+ waypoints

3. **Adjust Settings**
   - Modify terrain costs (0-10, higher = avoid)
   - Select vehicle preset for common scenarios
   - Toggle "Has a boat" for water traversal
   - Choose algorithm for different trade-offs

4. **View in 3D**
   - Click "3D" button
   - Adjust exaggeration slider (5-120) for dramatic effect
   - Orbit, pan, zoom with mouse
   - Route and waypoints visualized in 3D

5. **Toggle Heightmap View**
   - Click "Heightmap" button to switch between flat and relief maps
   - Relief map shows 3D-looking shaded terrain

### **Algorithm Selection Tips**

- **A*** - Default choice, best overall
- **Dijkstra** - Use when you need guaranteed optimality verification
- **Greedy** - Quick preview, not for final routes
- **BFS** - Useful when all terrain has equal cost
- **Bidirectional** - Best for very long distances (> 500 tiles)

---

##  Project Structure

```
bit-routes/
├── server/
│   ├── pathfinding.py          # Core pathfinding algorithms
│   ├── terrain.py              # Terrain generation and rendering
│   ├── app.py                  # FastAPI web server and API endpoints
│   ├── utils.py                # Utility functions (timing, seeding)
│   └── requirements.txt        # Python dependencies
├── web/
│   ├── index.html              # Main HTML interface
│   ├── main.js                 # Frontend logic and interaction
│   ├── three-view.module.js    # 3D terrain visualization
│   └── styles.css              # Visual styling
├── .terrain_cache/             # Cached terrain data (auto-created)
├── current_biomes.npy          # Latest biome map
├── current_height.npy          # Latest heightmap
└── current_meta.json           # Latest map metadata
```

---

##  Backend (Python)

### **pathfinding.py**
Core pathfinding implementation with multiple algorithms.

#### **Biome System**
```python
WATER = 0      # Impassable by default (requires boat)
LAND = 1       # Normal terrain
MOUNTAIN = 2   # Higher traversal cost
SNOW = 3       # Highest traversal cost
```

#### **Algorithms**

| Algorithm | Optimal? | Speed | Description |
|-----------|----------|-------|-------------|
| **A*** | ✅ Yes | ⚡ Fast | Best overall - uses heuristics to guide search |
| **Dijkstra** | ✅ Yes | 🐌 Slower | Explores uniformly, guaranteed optimal |
| **Greedy Best-First** | ❌ No | ⚡⚡ Fastest | Rushes toward goal, not optimal |
| **Breadth-First (BFS)** | ⚠️ Steps | ⚡ Fast | Shortest path by steps (ignores terrain cost) |
| **Bidirectional A*** | ✅ Yes | ⚡⚡ Very Fast | Searches from both ends simultaneously |

#### **Key Functions**

```python
route_with_algorithm(
    algorithm: str,           # 'astar', 'dijkstra', 'greedy', 'bfs', 'bidirectional'
    biomes: np.ndarray,       # Height x Width terrain grid
    start: tuple[int, int],   # (x, y) starting position
    goal: tuple[int, int],    # (x, y) destination
    costs: dict[int, float],  # Custom terrain costs
    allow_water: bool         # Can traverse water tiles?
) -> tuple[list | None, dict]
```

**Returns:**
- `path`: List of (x, y) coordinates, or `None` if unreachable
- `metadata`: Dict with `cost`, `expanded` (nodes explored), `error` (if any)

#### **Movement Model**
- **8-directional movement** (cardinal + diagonal)
- Diagonal moves cost √2 ≈ 1.414× more
- Final cost = `terrain_cost × distance_multiplier`

#### **Cost Validation**
All terrain costs are automatically clamped to [0, 10] range for safety.

---

### **terrain.py**
Procedural terrain generation and rendering with performance optimizations.

#### **Noise Generation Methods**

**FastNoiseLite (Recommended):**
- 3-5× faster than OpenSimplex
- Requires `pyfastnoiselite` package
- Same quality output
- Uses OpenSimplex2 noise type with FBM fractal

**OpenSimplex (Fallback):**
- Always available
- Slower but reliable
- Original implementation

**Auto Mode:**
- Uses FastNoiseLite if available
- Falls back to OpenSimplex automatically

#### **Terrain Caching System**
- Caches generated terrains in `.terrain_cache/`
- ~50× faster on cache hits
- Cache key includes: size, seed, octaves, scale, method
- Compressed NPZ format

**Cache Management Endpoints:**
```
GET /cache/stats   # View cache size and file count
GET /cache/clear   # Clear all cached terrain
```

#### **Adaptive Detail System**
Octave count adjusts based on map size:
- ≤256px: 3 octaves (basic detail)
- ≤512px: 4 octaves (good detail)
- ≤1024px: 5 octaves (fine detail)
- >1024px: 6 octaves (maximum detail)

#### **World Generation**
Uses **Fractal Brownian Motion (FBM)** with noise:
- **Adaptive octaves** (3-6 based on size)
- **Lacunarity 2.0** - frequency doubles each octave
- **Gain 0.5** - amplitude halves each octave
- **Scale 0.008** - base frequency

```python
generate_world(width: int, height: int, seed: int, method: str = 'auto')
    → (heightmap: np.ndarray, biomes: np.ndarray)
```

#### **Biome Classification**
Heights are normalized to [0, 1], then classified:

| Height Range | Biome | Color | Hex |
|--------------|-------|-------|-----|
| < 0.35 | Water | Blue | `#346FBA` |
| 0.35 - 0.65 | Land | Green | `#55A049` |
| 0.65 - 0.80 | Mountain | Brown | `#8B7D6B` |
| ≥ 0.80 | Snow | White | `#F5F5F5` |

#### **Relief Rendering**
Creates high-impact shaded relief maps with:
- **Hillshade** - Lambertian lighting simulation (azimuth 315°, altitude 55°)
- **Slope shading** - Steeper slopes appear darker (15% darkening)
- **Contour lines** - 40 bands (~2.5% elevation intervals), dilated 1px
- **Specular highlights** - Bright spots on steep, sunlit slopes (35% intensity)
- **Dynamic exaggeration** - Scales with map size (8× at 512px, 4× at 1024px)
- **Lighting curve** - Gamma 0.8 shaping with 0.35-1.0 range

**Customizable Relief:**
```
GET /relief.png?az=315&alt=55&z=8
```
- `az`: Azimuth angle (light direction)
- `alt`: Altitude angle (light height)
- `z`: Vertical exaggeration factor

---

### **app.py**
FastAPI web server providing REST API endpoints.

#### **Endpoints**

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Serves main HTML interface |
| `/generate` | GET | Generates new terrain map |
| `/meta` | GET | Returns current map metadata |
| `/noise-methods` | GET | Available noise generation methods |
| `/cache/stats` | GET | Terrain cache statistics |
| `/cache/clear` | GET | Clear terrain cache |
| `/map.png` | GET | Flat terrain map (color-coded) |
| `/relief.png` | GET | Shaded relief map (3D-looking) |
| `/heightmap.bin` | GET/HEAD | Raw height data (float32 binary) |
| `/route` | GET | Single-segment pathfinding |
| `/route-multi` | GET | Multi-waypoint pathfinding |
| `/check-tile` | GET | Check if tile is water |

#### **Generate Endpoint**
```
GET /generate?seed=12345&size=512&method=auto
```

Parameters:
- `seed`: Random seed (optional, generates random if omitted)
- `size`: Map size 64-2048 pixels (default 512)
- `method`: `auto` (default), `fast`, or `opensimplex`

Returns:
```json
{
  "seed": 12345,
  "width": 512,
  "height": 512,
  "ms": 123.4,
  "method": "fast"
}
```

Errors:
- 400: Invalid method or FastNoiseLite not available
- Automatic fallback to OpenSimplex on import error

#### **Heightmap Binary Format**
- Content-Type: `application/octet-stream`
- Data: Row-major float32 array
- Headers:
  - `X-Width`: Raster width
  - `X-Height`: Raster height
  - `Cache-Control: no-store`

#### **Multi-Waypoint Routing**
```
GET /route-multi?waypoints=[[x1,y1],[x2,y2],[x3,y3]]&land=1&mountain=3&snow=4&boat=0&algorithm=astar
```

Parameters:
- `waypoints`: JSON array of `[x,y]` pairs (minimum 2)
- `land`: Land cost 0-10 (default 1)
- `mountain`: Mountain cost 0-10 (default 3)
- `snow`: Snow cost 0-10 (default 4)
- `boat`: Water traversal 0 or 1 (default 0)
- `algorithm`: Routing algorithm (default `astar`)

Returns:
```json
{
  "segments": [[[x,y], ...], [[x,y], ...]],  // Individual paths between waypoints
  "full_path": [[x,y], ...],                  // Combined continuous path
  "total_cost": 123.45,
  "total_expanded": 1500,
  "algorithm": "astar",
  "ms": 12.3
}
```

Error cases:
```json
{
  "segments": null,
  "full_path": null,
  "error": "Segment 2 → 3 failed: unreachable",
  "ms": 8.7,
  "algorithm": "astar"
}
```

#### **Startup Behavior**
On server start:
1. Checks for existing `current_height.npy` and `current_biomes.npy`
2. Regenerates missing PNGs if arrays exist
3. Creates default metadata if missing
4. Enables immediate map viewing without generation

---

##  Frontend (JavaScript)

### **index.html**
Main interface structure with:
- **Generation controls** - Seed, size, noise method, generate button
- **Terrain costs** - Land, mountain, snow weights (0-10)
- **Route presets** - Scenic mountains, snow adventure, no mountains
- **Vehicle presets** - Hiker, mountain bike, 4×4, road car, snowmobile
- **Algorithm selector** - Choose routing algorithm
- **Map stage** - Interactive canvas with SVG overlay
- **Heightmap toggle** - Switch between flat and relief views
- **3D modal** - Three.js terrain viewer with exaggeration slider (5-120)
- **Info bubbles** - Hover tooltips for all controls

#### **Presets**

**Route Presets:**
```javascript
'scenic-mountains':        { land: 3, mountain: 1, snow: 6 }  // Prefers mountains
'mountain-snow-adventure': { land: 4, mountain: 2, snow: 2 }  // Balanced adventure
'no-mountains':            { land: 2, mountain: 10, snow: 6 } // Avoids high terrain
```

**Vehicle Presets:**
```javascript
'hiker':       { land: 1, mountain: 3, snow: 4 }   // Moderate mountain ability
'mtb':         { land: 1, mountain: 2, snow: 7 }   // Good off-road, bad in snow
'4x4':         { land: 1, mountain: 2, snow: 3 }   // Excellent off-road
'road-car':    { land: 1, mountain: 6, snow: 10 }  // Stick to flat terrain
'snowmobile':  { land: 3, mountain: 4, snow: 1 }   // Excels in snow!
```

---

### **main.js**
Core frontend logic handling user interactions and API calls.

#### **Key Features**

**Noise Method Detection:**
- Checks `/noise-methods` endpoint on startup
- Disables "Fast" option if FastNoiseLite unavailable
- Auto-switches to available method

**Waypoint Management:**
- **Left-click** - Add waypoint (validates reachability)
- **Right-click** - Remove last waypoint
- Auto-routes when 2+ waypoints exist
- Visual markers: green (start), blue (intermediate), red (end)

**Path Visualization:**
- SVG polyline overlay in yellow `#fbbf24`
- 3px stroke width (3.5px in relief mode)
- Rounded joins and caps
- Persists across exaggeration changes

**Reachability Validation:**
```javascript
async isTileReachable(x, y)
```
- First waypoint: Must not be water (unless boat enabled)
- Subsequent waypoints: Must be reachable from previous point
- Shows helpful error messages for unreachable tiles
- Prevents invalid route configurations

**Boat Toggle Protection:**
When disabling "Has a boat":
1. Attempts land-only route calculation
2. If impossible, keeps boat enabled and shows warning
3. If possible, updates to land-only route
4. Prevents breaking existing water-dependent routes

**State Management:**
```javascript
waypoints = []         // Array of {x, y} positions
lastRoute = null       // Most recent full path (for 3D view)
useRelief = false      // Toggle between flat/relief map
heightmapAvailable     // Tracks if 3D data ready
threeViewReady         // Tracks if Three.js loaded
```

**Auto-generation:**
- On page load, attempts to load previous map
- If no previous map exists, generates new 512×512 map
- Enables 3D button only when both Three.js and heightmap ready

**Preset Interactions:**
- Changing terrain costs sets both presets to "Custom"
- Selecting route preset sets vehicle to "Custom"
- Selecting vehicle preset sets route to "Custom"
- Auto-recalculates route if waypoints exist

---

### **three-view.module.js**
Interactive 3D terrain visualization using Three.js r160.

#### **Architecture**

```javascript
window.THREEVIEW = {
  mount(el, exag, route, waypoints),              // Initialize 3D view
  unmount(),                                       // Cleanup and dispose
  updateExaggeration(exag, route, waypoints),     // Refresh with new settings
  clearHeights()                                   // Clear cached heightmap
}
```

#### **Rendering Pipeline**

1. **Heightmap Loading** - Fetches `/heightmap.bin` (float32 binary)
2. **Geometry Creation** - PlaneGeometry with `(width-1) × (height-1)` segments
3. **Vertex Height Application** - Z values from heightmap with exaggeration
4. **Vertex Coloring** - Colors based on biome classification
5. **Normal Computation** - For proper lighting
6. **Water Layer** - Semi-transparent plane at sea level
7. **Route/Waypoints** - Yellow line + colored sphere markers
8. **Lighting Setup** - Hemisphere + directional lights

#### **Layer System (Render Order)**

All objects use `renderOrder` for proper transparency:
- **Water**: -1 (renders first, behind everything)
- **Terrain**: 0 (renders second, above water)
- **Route line**: 50 (renders third, above terrain)
- **Waypoint markers**: 100 (renders last, always visible)

#### **Key Features**

**Dynamic Exaggeration:**
```javascript
z = (heightValue - 0.5) × exaggeration
```
- Slider range: 5 - 120
- Default: 80 (suitable for 512px maps)
- Applied to both terrain and water layer

**Water Layer:**
- Semi-transparent blue (`0x3b79d0` at 35% opacity)
- Fixed at sea level (height 0.35)
- **Always recreated** when updating exaggeration
- Positioned 0.02 units above calculated sea level
- Double-sided rendering for visibility from all angles

**Route Rendering:**
- Yellow line (`0xffff00`) with 90% opacity
- Line width: 5 (note: limited browser support)
- Follows terrain surface with dynamic offset
- **Offset formula:** `Math.max(3.0, exag × 0.08)`
- **Sea level clamping:** `terrainZ = Math.max(gz, seaZ)`
- Never dips below water surface
- Depth test enabled, depth write disabled

**Waypoint Markers:**
- **Start**: Green sphere (`0x22c55e`, 6 units)
- **End**: Red sphere (`0xef4444`, 6 units)
- **Intermediate**: Blue spheres (`0x3b82f6`, 5 units)
- Vertical connection lines (50% opacity)
- Positioned above terrain with same offset as route
- Markers use `MeshBasicMaterial` (unaffected by lighting)

**Camera System:**
- Perspective camera (55° FOV)
- Auto-fit calculation: `distance = size × 1.2 + exag × 0.6`
- Initial position: Southwest at 45° elevation
- Up vector: Z-axis (0, 0, 1)
- OrbitControls with damping enabled

**Coordinate Transformation:**
```javascript
// Map coordinates → Three.js coordinates
threejs_y = -map_y  // Y-axis flipped
vertex_index = (height - 1 - map_y) * width + map_x
```

**Scene Management:**
- Background color: `0x0b1220` (dark blue)
- Hemisphere light: White → dark gray (0.7 intensity)
- Directional light: White (0.9 intensity) from southwest
- Window resize handling with aspect ratio updates

**Memory Management:**
- Proper disposal of geometries and materials
- Clears all objects on unmount
- Removes event listeners
- Reuses scene/renderer when updating exaggeration

#### **Event System**
```javascript
window.addEventListener('threeview-ready', () => {
  // Three.js module loaded and ready
});
```

---

### **styles.css**
Modern dark-themed UI styling.

#### **Design System**

**Colors:**
```css
Background:    #0f172a  (dark slate)
Controls:      #1e293b  (medium slate)
Text:          #e2e8f0  (light gray)
Border:        #334155  (slate border)
Primary:       #3b82f6  (blue buttons)
Accent:        #8b5cf6  (purple 3D button)
Status:        #cbd5e1  (light slate)
```

**Typography:**
```css
Font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial
```

**Components:**
- **Controls** - Flexbox layout with 12px gaps, wraps on small screens
- **Labels** - Dark background `#1e293b`, 6px internal padding, 8px border-radius
- **Buttons** - Blue `#3b82f6`, 8×12px padding, hover brightness 1.1
- **Stage** - Relative positioning for SVG overlay, pixelated image rendering
- **Loading overlay** - 55% opacity background, 1px backdrop blur, centered spinner
- **3D Modal** - Fixed fullscreen, 80% rgba black background, 20px padding
- **Info bubbles** - Absolute positioned, hover-activated tooltips

**Loading States:**
- Animated spinner (22px, 0.8s rotation)
- Disables all controls during generation
- Pointer events blocked on stage
- ARIA attributes for accessibility

**Relief Mode Effects:**
```css
.stage.relief #map {
  filter: contrast(1.05) saturate(1.05);  /* Enhanced contrast */
}
.stage.relief #overlay polyline {
  stroke-width: 3.5;  /* Thicker route line */
}
```

**Responsive Design:**
- Max width 980px, centered with auto margins
- 24px vertical margin, 16px horizontal padding
- Controls wrap on narrow screens
- 3D modal: 90vw × 80vh with auto-centering

**Accessibility:**
- Focus styles on interactive elements
- ARIA labels and live regions
- Keyboard navigation support
- High contrast text
- Cursor helpers (pointer, help)

---

##  Technical Details

### **Performance Considerations**

**Backend:**
- NumPy arrays for efficient grid operations
- Pre-allocated arrays minimize GC pressure
- Heapq for O(log n) priority queue operations
- Vectorized operations where possible
- Typical route: < 20ms for 512² map
- Terrain generation: ~100ms (FastNoiseLite) vs ~400ms (OpenSimplex)
- Cache hits: ~2ms (50× speedup)

**Frontend:**
- SVG for crisp vector routes (infinite scaling)
- Image caching with timestamp query params
- Event debouncing (not currently implemented but recommended)
- WebGL rendering targets 60 FPS
- Geometry reuse in 3D view
- Minimal DOM manipulation

**Memory Usage:**
- 512×512 map: ~1MB heightmap + ~250KB biome map
- 3D view: ~5MB total (geometry + textures)
- Cache: ~1.5MB per cached terrain (compressed)

### **Data Flow**

```
User Click → Reachability Check → Add Waypoint
   ↓
Waypoints Array → /route-multi API
   ↓
Pathfinding (Python) → JSON Response
   ↓
SVG Path Drawing + Stats Update
   ↓
[Optional] 3D View → Heightmap Binary → Three.js Scene
```

### **File Formats**

**Heightmap Binary (`/heightmap.bin`):**
- Float32 array (4 bytes per value)
- Row-major order (Y × Width + X indexing)
- Normalized [0, 1] range
- 512×512 map = 1,048,576 bytes

**NPY Files:**
- NumPy native format
- Compressed with `np.savez_compressed`
- Fast memory-mapped loading
- Preserves dtype and shape

**Cache Files (`.terrain_cache/*.npz`):**
- Compressed NumPy archive
- Contains both heightmap and biomes
- MD5 hash filename for uniqueness
- Average compression: 70% size reduction

### **Coordinate Systems**

**2D Map (SVG):**
- Origin: Top-left (0, 0)
- X: Left → Right
- Y: Top → Bottom
- Units: Pixels

**3D View (Three.js):**
- Origin: Center (0, 0, 0)
- X: Left → Right  
- Y: Back → Front (negated from map Y!)
- Z: Down → Up
- Units: World space (1 unit = 1 pixel)

**Conversion:**
```javascript
// Map → Three.js
threejs_x = map_x - width/2
threejs_y = -(map_y - height/2)
threejs_z = (heightmap[map_y][map_x] - 0.5) × exaggeration

// Three.js → Map
map_x = threejs_x + width/2
map_y = -threejs_y + height/2
```

### **Pathfinding Implementation Details**

**Heuristic (A*, Bidirectional):**
```python
# Octile distance (accounts for diagonal movement)
dmin = min(dx, dy)
dmax = max(dx, dy)
h = 1.414 × dmin + (dmax - dmin)
```

**Priority Queue:**
```python
# (priority, node_index)
heappush(heap, (f_score, node))
```

**Node Indexing:**
```python
# Flat array indexing for 2D grid
index = y × width + x
x, y = index % width, index // width
```

**Closed Set:**
- uint8 numpy array (1 byte per node)
- O(1) membership testing
- Compact memory footprint

---

##  Customization

### **Adding New Algorithms**

1. Implement in `pathfinding.py`:
```python
def my_algorithm(
    biomes: np.ndarray,
    start: tuple[int, int],
    goal: tuple[int, int],
    *,
    costs: dict[int, float] | None = None,
    allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    # Your implementation
    return path, {"expanded": count, "cost": total}
```

2. Register in `ALGORITHMS` dict:
```python
ALGORITHMS = {
    # ...existing...
    'myalgo': my_algorithm,
}
```

3. Update `index.html` algorithm selector:
```html
<option value="myalgo">My Algorithm (Description)</option>
```

### **New Terrain Types**

1. Add biome constant in `terrain.py`:
```python
WATER, LAND, MOUNTAIN, SNOW, DESERT = 0, 1, 2, 3, 4
```

2. Update `PALETTE` colors:
```python
PALETTE = {
    # ...existing...
    DESERT: (255, 220, 150),  # sandy yellow
}
```

3. Modify `classify_biomes()` thresholds:
```python
biomes[(h >= 0.30) & (h < 0.35)] = DESERT
```

4. Add to `DEFAULT_COSTS` in `pathfinding.py`:
```python
DEFAULT_COSTS = {
    # ...existing...
    DESERT: 2.0,
}
```

5. Update vertex coloring in `three-view.module.js`:
```javascript
const COLORS = {
    // ...existing...
    DESERT: 0xffdc96
};

// In applyVertexColors:
else if (h01 < 0.35) c = COLORS.DESERT;
```

### **Custom Presets**

Edit in `main.js`:
```javascript
const ROUTE_PRESETS = {
    // ...existing...
    'desert-explorer': { land: 2, mountain: 4, snow: 8, desert: 1 }
};

const VEHICLE_PRESETS = {
    // ...existing...
    'dune-buggy': { land: 2, mountain: 5, snow: 10, desert: 1 }
};
```

Update HTML dropdowns:
```html
<option value="desert-explorer">Desert explorer</option>
<option value="dune-buggy">Dune buggy</option>
```

### **Adjusting Terrain Generation**

**Change noise parameters** in `terrain.py`:
```python
def _fbm_noise_fast(..., lacunarity=2.5, gain=0.6, scale=0.01):
    # More lacunarity = more contrast between octaves
    # Higher gain = more influence from higher octaves
    # Larger scale = larger features
```

**Modify biome thresholds**:
```python
def classify_biomes(heightmap, thr_water=0.30, thr_mountain=0.70, thr_snow=0.85):
    # Adjust to change biome distribution
```

**Customize relief rendering**:
```python
def render_relief_png(..., azimuth_deg=270.0, altitude_deg=45.0):
    # Different light angle for different mood
```

---

##  Algorithm Comparison

**Test scenario: 512×512 map, 400-tile diagonal route, moderate terrain**

| Algorithm | Cost | Nodes Expanded | Time (ms) | Optimal? | Notes |
|-----------|------|----------------|-----------|----------|-------|
| A* | 487.3 | 2,341 | 12.4 | ✅ | Best default choice |
| Dijkstra | 487.3 | 8,956 | 38.7 | ✅ | Explores more uniformly |
| Greedy | 501.8 | 891 | 4.2 | ❌ | Fastest but suboptimal |
| BFS | 489.1 | 3,124 | 8.9 | ⚠️ | Optimal steps, not cost |
| Bidirectional | 487.3 | 1,204 | 7.8 | ✅ | Fewest expansions |

**Key Insights:**
- Bidirectional A* expands ~50% fewer nodes than standard A*
- Greedy is 3× faster but 3% more expensive
- Dijkstra guarantees optimality but explores 4× more nodes
- BFS ignores terrain costs, finds geometrically shortest path

**When to use each:**
- **Production routes**: A* or Bidirectional A*
- **Quick previews**: Greedy
- **Research/verification**: Dijkstra
- **Equal-cost terrain**: BFS
- **Very long distances**: Bidirectional A*

---

##  Troubleshooting

### Common Issues

**"No map generated yet"**
- Solution: Click "Generate" to create initial terrain
- Check: Server logs for Python errors
- Verify: `/meta` endpoint returns valid JSON

**"Cannot reach X,Y from last waypoint"**
- Solution 1: Enable "Has a boat" if crossing water
- Solution 2: Adjust terrain costs (lower the blocking terrain cost)
- Solution 3: Choose different waypoint location
- Solution 4: Use different algorithm (try Dijkstra for guaranteed path if exists)

**"Cannot disable 'Has a boat': the current route requires water"**
- Explanation: Route would become impossible without water traversal
- Solution: Remove waypoints and create land-only route first
- Note: This is intentional protection against breaking routes

**3D view not loading**
- Check 1: Ensure map is generated first (click Generate)
- Check 2: Browser console for Three.js/WebGL errors
- Check 3: Verify `/heightmap.bin` returns 200 status
- Check 4: Try different browser (WebGL support required)
- Check 5: Disable browser extensions that block WebGL

**Route jumps/glitches in 3D**
- Fixed: Latest version implements smooth terrain following
- Workaround: Adjust exaggeration
---

##  License & Credits

**Bit Routes** uses:
- **FastAPI** - Modern Python web framework
- **Three.js** - WebGL 3D rendering
- **NumPy** - Fast numerical computing
- **OpenSimplex** - Noise generation
- **Pillow** - Image processing
- **PyFastNoiseLite** - Fast noise generation


---

*Last updated: November 2025*
