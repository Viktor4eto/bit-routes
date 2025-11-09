from __future__ import annotations
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import numpy as np
import json

from .terrain import generate_world, render_palette_png, render_relief_png, clear_terrain_cache, get_noise_method_info
from .pathfinding import route_with_algorithm, LAND, MOUNTAIN, SNOW
from .utils import Stopwatch, reseed

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
MAP_PATH = WEB / "map.png"
RELIEF_PATH = WEB / "relief.png"
META_PATH = ROOT / "current_meta.json"

app = FastAPI(title="Bit Routes")
app.mount("/static", StaticFiles(directory=str(WEB)), name="static")


@app.get("/", response_class=HTMLResponse)
def root():
    return (WEB / "index.html").read_text()


@app.get("/generate")
def generate(
        seed: int | None = Query(default=None),
        size: int = Query(default=512, ge=64, le=2048),
        method: str = Query(default='auto', description='Noise method: auto, fast, or opensimplex')
):
    """
    Generate a new terrain map.

    Query params:
    - seed: Random seed (optional, random if not provided)
    - size: Map size in pixels (64-2048)
    - method: Noise generation method
        - 'auto' (default): Use FastNoiseLite if available, else OpenSimplex
        - 'fast': Use FastNoiseLite (faster, requires pyfastnoiselite)
        - 'opensimplex': Use OpenSimplex (slower, always available)
    """
    seed = reseed(seed)

    # Validate method
    if method not in ['auto', 'fast', 'opensimplex']:
        return JSONResponse(
            {"error": f"Invalid method '{method}'. Use 'auto', 'fast', or 'opensimplex'"},
            status_code=400
        )

    try:
        with Stopwatch() as sw:
            heightmap, biomes = generate_world(size, size, seed, method=method)
            render_palette_png(biomes, str(MAP_PATH))
            render_relief_png(heightmap, biomes, str(RELIEF_PATH))
    except ImportError as e:
        return JSONResponse(
            {"error": str(e)},
            status_code=400
        )

    np.save(ROOT / "current_biomes.npy", biomes)
    np.save(ROOT / "current_height.npy", heightmap)

    # Determine which method was actually used
    info = get_noise_method_info()
    actual_method = method if method != 'auto' else info['default_method']

    meta = {
        "seed": int(seed),
        "width": int(biomes.shape[1]),
        "height": int(biomes.shape[0]),
        "ms": float(sw.ms),
        "method": actual_method
    }
    META_PATH.write_text(json.dumps(meta))
    return meta


@app.get("/meta")
def meta():
    """
    Returns details of the currently saved map if present.
    { seed, width, height, ms, method }
    """
    if META_PATH.exists():
        try:
            return JSONResponse(json.loads(META_PATH.read_text()))
        except Exception:
            pass
    return JSONResponse({"error": "no-meta"}, status_code=404)


@app.get("/noise-methods")
def noise_methods():
    """
    Get information about available noise generation methods.
    """
    return get_noise_method_info()


@app.get("/cache/clear")
def clear_cache():
    """
    Clear the terrain generation cache.
    Useful for freeing up disk space.
    """
    count = clear_terrain_cache()
    return {"cleared": count, "message": f"Deleted {count} cached terrain files"}


@app.get("/cache/stats")
def cache_stats():
    """
    Get statistics about the terrain cache.
    """
    from .terrain import CACHE_DIR

    if not CACHE_DIR.exists():
        return {"exists": False, "files": 0, "size_mb": 0}

    files = list(CACHE_DIR.glob("*.npz"))
    total_size = sum(f.stat().st_size for f in files)

    return {
        "exists": True,
        "files": len(files),
        "size_mb": round(total_size / (1024 * 1024), 2),
        "path": str(CACHE_DIR)
    }


@app.on_event("startup")
def _warm_start_last_map():
    npy_h = ROOT / "current_height.npy"
    npy_b = ROOT / "current_biomes.npy"
    if npy_h.exists() and npy_b.exists():
        try:
            heightmap = np.load(npy_h)
            biomes = np.load(npy_b)
            if not MAP_PATH.exists():
                render_palette_png(biomes, str(MAP_PATH))
            if not RELIEF_PATH.exists():
                render_relief_png(heightmap, biomes, str(RELIEF_PATH))
            h, w = biomes.shape
            if not META_PATH.exists():
                META_PATH.write_text(json.dumps({
                    "seed": -1,
                    "width": int(w),
                    "height": int(h),
                    "ms": 0.0,
                    "method": "unknown"
                }))
        except Exception:
            pass


@app.get("/relief.png")
def relief_png(az: float | None = None, alt: float | None = None, z: float | None = None):
    """
    Serve shaded relief; if missing or params provided, rebuild from current arrays.
    """
    npy_h = ROOT / "current_height.npy"
    npy_b = ROOT / "current_biomes.npy"
    need_build = (not RELIEF_PATH.exists()) or (az is not None or alt is not None or z is not None)
    if need_build and npy_h.exists() and npy_b.exists():
        heightmap = np.load(npy_h)
        biomes = np.load(npy_b)
        render_relief_png(
            heightmap,
            biomes,
            str(RELIEF_PATH),
            azimuth_deg=float(az) if az is not None else 315.0,
            altitude_deg=float(alt) if alt is not None else 55.0,
            z_factor=float(z) if z is not None else None,
        )
    return FileResponse(str(RELIEF_PATH), media_type="image/png")


@app.get("/map.png")
def map_png():
    return FileResponse(str(MAP_PATH), media_type="image/png")


@app.get("/route")
def route(
        x1: int, y1: int, x2: int, y2: int,
        land: int = Query(1, ge=0, le=10),
        mountain: int = Query(3, ge=0, le=10),
        snow: int = Query(4, ge=0, le=10),
        boat: int = Query(0, ge=0, le=1),
        algorithm: str = Query('astar', description='Routing algorithm'),
):
    """Single-segment route endpoint with algorithm selection"""
    npy = ROOT / "current_biomes.npy"
    if not npy.exists():
        return JSONResponse({"error": "No map generated yet"}, status_code=400)
    biomes = np.load(npy)
    with Stopwatch() as sw:
        path, meta = route_with_algorithm(
            algorithm,
            biomes,
            (x1, y1),
            (x2, y2),
            costs={LAND: land, MOUNTAIN: mountain, SNOW: snow},
            allow_water=bool(boat)
        )
    if path is None:
        return {"path": None, "ms": float(sw.ms), "algorithm": algorithm, **meta}
    py_path = [[int(x), int(y)] for (x, y) in path]
    return {
        "path": py_path,
        "ms": float(sw.ms),
        "algorithm": algorithm,
        "expanded": int(meta.get("expanded", 0)),
        "cost": float(meta.get("cost", 0.0))
    }


@app.get("/route-multi")
def route_multi(
        waypoints: str = Query(..., description="JSON array of [x,y] pairs"),
        land: int = Query(1, ge=0, le=10),
        mountain: int = Query(3, ge=0, le=10),
        snow: int = Query(4, ge=0, le=10),
        boat: int = Query(0, ge=0, le=1),
        algorithm: str = Query('astar', description='Routing algorithm'),
):
    """
    Multi-waypoint routing endpoint with algorithm selection.
    Chains selected algorithm between consecutive waypoints.
    """
    npy = ROOT / "current_biomes.npy"
    if not npy.exists():
        return JSONResponse({"error": "No map generated yet"}, status_code=400)

    try:
        waypoint_list = json.loads(waypoints)
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid waypoints JSON"}, status_code=400)

    if not isinstance(waypoint_list, list) or len(waypoint_list) < 2:
        return JSONResponse({"error": "Need at least 2 waypoints"}, status_code=400)

    biomes = np.load(npy)
    costs = {LAND: land, MOUNTAIN: mountain, SNOW: snow}
    allow_water = bool(boat)

    segments = []
    total_cost = 0.0
    total_expanded = 0
    full_path = []

    with Stopwatch() as sw:
        for i in range(len(waypoint_list) - 1):
            start = tuple(waypoint_list[i])
            end = tuple(waypoint_list[i + 1])

            path, meta = route_with_algorithm(
                algorithm,
                biomes,
                start,
                end,
                costs=costs,
                allow_water=allow_water
            )

            if path is None:
                error_msg = meta.get("error", "unreachable")
                return {
                    "segments": None,
                    "full_path": None,
                    "error": f"Segment {i} → {i + 1} failed: {error_msg}",
                    "ms": float(sw.ms),
                    "algorithm": algorithm,
                    "total_cost": 0.0,
                    "total_expanded": total_expanded
                }

            py_path = [[int(x), int(y)] for (x, y) in path]
            segments.append(py_path)

            total_cost += meta.get("cost", 0.0)
            total_expanded += meta.get("expanded", 0)

            if i == 0:
                full_path.extend(py_path)
            else:
                full_path.extend(py_path[1:])

    return {
        "segments": segments,
        "full_path": full_path,
        "total_cost": float(total_cost),
        "total_expanded": int(total_expanded),
        "algorithm": algorithm,
        "ms": float(sw.ms)
    }


@app.get("/check-tile")
def check_tile(x: int, y: int):
    """
    Check if a specific tile is water.
    Returns: {"is_water": bool, "biome": int}
    """
    npy = ROOT / "current_biomes.npy"
    if not npy.exists():
        return JSONResponse({"error": "No map generated yet"}, status_code=400)

    biomes = np.load(npy)
    h, w = biomes.shape

    if not (0 <= x < w and 0 <= y < h):
        return JSONResponse({"error": "Out of bounds"}, status_code=400)

    from .pathfinding import WATER
    biome = int(biomes[y, x])
    is_water = (biome == WATER)

    return {"is_water": is_water, "biome": biome}


@app.get("/heightmap.bin")
def heightmap_bin():
    """
    Returns the current heightmap as raw float32 binary (row-major).
    Headers:
      X-Width, X-Height  -> raster size
    """
    npy_h = ROOT / "current_height.npy"
    if not npy_h.exists():
        return JSONResponse({"error": "no-heightmap"}, status_code=404)
    arr = np.load(npy_h).astype(np.float32, copy=False)
    h, w = arr.shape
    headers = {
        "X-Width": str(w),
        "X-Height": str(h),
        "Cache-Control": "no-store"
    }
    return Response(content=arr.tobytes(order="C"), media_type="application/octet-stream", headers=headers)


@app.head("/heightmap.bin")
def heightmap_head():
    npy_h = ROOT / "current_height.npy"
    if not npy_h.exists():
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    arr = np.load(npy_h, mmap_mode="r")
    h, w = arr.shape
    return Response(status_code=200, headers={
        "X-Width": str(w),
        "X-Height": str(h),
        "Cache-Control": "no-store",
        "Content-Length": "0",
    })