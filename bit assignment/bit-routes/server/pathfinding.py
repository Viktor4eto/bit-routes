from __future__ import annotations
import heapq
import numpy as np
from collections import deque

# Biome codes
WATER, LAND, MOUNTAIN, SNOW = 0, 1, 2, 3

# Default movement costs per biome
DEFAULT_COSTS = {
    LAND: 1.0,
    WATER: 1.0,
    MOUNTAIN: 3.0,
    SNOW: 4.0,
}

# 8-neighborhood
NEIGHBORS = [
    (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
    (-1, -1, 1.41421356), (1, -1, 1.41421356), (-1, 1, 1.41421356), (1, 1, 1.41421356)
]


def _prepare_costs(costs):
    """Prepare and validate costs dictionary"""
    if costs is None:
        costs = DEFAULT_COSTS.copy()
    else:
        merged = DEFAULT_COSTS.copy()
        merged.update(costs)
        costs = merged

    for k in (WATER, LAND, MOUNTAIN, SNOW):
        v = float(costs.get(k, DEFAULT_COSTS.get(k, 1.0)))
        costs[k] = max(0.0, min(10.0, v))

    return costs


def astar(
        biomes: np.ndarray,
        start: tuple[int, int],
        goal: tuple[int, int],
        *,
        costs: dict[int, float] | None = None,
        allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    """A* pathfinding - optimal with heuristic guidance"""
    costs = _prepare_costs(costs)
    h, w = biomes.shape
    sx, sy = start
    gx, gy = goal

    if not (0 <= sx < w and 0 <= sy < h and 0 <= gx < w and 0 <= gy < h):
        return None, {"error": "Out of bounds"}
    if not allow_water and (biomes[sy, sx] == WATER or biomes[gy, gx] == WATER):
        return None, {"error": "Start or goal in water"}

    def heuristic(x: int, y: int) -> float:
        dx = abs(x - gx)
        dy = abs(y - gy)
        dmin, dmax = (dx, dy) if dx < dy else (dy, dx)
        return (1.41421356 * dmin + (dmax - dmin))

    size = w * h
    INF = 1e30
    g = np.full(size, INF, dtype=np.float32)
    parent = np.full(size, -1, dtype=np.int32)
    closed = np.zeros(size, dtype=np.uint8)

    def idx(x: int, y: int) -> int:
        return y * w + x

    def xy(i: int) -> tuple[int, int]:
        return (int(i % w), int(i // w))

    start_i = idx(sx, sy)
    goal_i = idx(gx, gy)
    g[start_i] = 0.0

    open_heap: list[tuple[float, int]] = []
    heapq.heappush(open_heap, (heuristic(sx, sy), start_i))

    expanded = 0

    while open_heap:
        f_curr, i = heapq.heappop(open_heap)
        if closed[i]:
            continue
        closed[i] = 1
        expanded += 1
        if i == goal_i:
            path: list[tuple[int, int]] = []
            cur = i
            while cur != -1:
                path.append(xy(cur))
                cur = parent[cur]
            path.reverse()
            return path, {"expanded": int(expanded), "cost": float(g[goal_i])}
        x, y = xy(i)
        gi = g[i]
        for dx, dy, step in NEIGHBORS:
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if biomes[ny, nx] == WATER and not allow_water:
                continue
            j = idx(nx, ny)
            if closed[j]:
                continue
            tile = int(biomes[ny, nx])
            move_cost = costs.get(tile, 1.0) * step
            tentative = gi + move_cost
            if tentative < g[j]:
                g[j] = tentative
                parent[j] = i
                f = tentative + heuristic(nx, ny)
                heapq.heappush(open_heap, (f, j))

    return None, {"error": "Unreachable"}


def dijkstra(
        biomes: np.ndarray,
        start: tuple[int, int],
        goal: tuple[int, int],
        *,
        costs: dict[int, float] | None = None,
        allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    """Dijkstra's algorithm - optimal without heuristic, explores uniformly"""
    costs = _prepare_costs(costs)
    h, w = biomes.shape
    sx, sy = start
    gx, gy = goal

    if not (0 <= sx < w and 0 <= sy < h and 0 <= gx < w and 0 <= gy < h):
        return None, {"error": "Out of bounds"}
    if not allow_water and (biomes[sy, sx] == WATER or biomes[gy, gx] == WATER):
        return None, {"error": "Start or goal in water"}

    size = w * h
    INF = 1e30
    g = np.full(size, INF, dtype=np.float32)
    parent = np.full(size, -1, dtype=np.int32)
    closed = np.zeros(size, dtype=np.uint8)

    def idx(x: int, y: int) -> int:
        return y * w + x

    def xy(i: int) -> tuple[int, int]:
        return (int(i % w), int(i // w))

    start_i = idx(sx, sy)
    goal_i = idx(gx, gy)
    g[start_i] = 0.0

    open_heap: list[tuple[float, int]] = []
    heapq.heappush(open_heap, (0.0, start_i))

    expanded = 0

    while open_heap:
        cost, i = heapq.heappop(open_heap)
        if closed[i]:
            continue
        closed[i] = 1
        expanded += 1
        if i == goal_i:
            path: list[tuple[int, int]] = []
            cur = i
            while cur != -1:
                path.append(xy(cur))
                cur = parent[cur]
            path.reverse()
            return path, {"expanded": int(expanded), "cost": float(g[goal_i])}
        x, y = xy(i)
        gi = g[i]
        for dx, dy, step in NEIGHBORS:
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if biomes[ny, nx] == WATER and not allow_water:
                continue
            j = idx(nx, ny)
            if closed[j]:
                continue
            tile = int(biomes[ny, nx])
            move_cost = costs.get(tile, 1.0) * step
            tentative = gi + move_cost
            if tentative < g[j]:
                g[j] = tentative
                parent[j] = i
                heapq.heappush(open_heap, (tentative, j))

    return None, {"error": "Unreachable"}


def greedy_best_first(
        biomes: np.ndarray,
        start: tuple[int, int],
        goal: tuple[int, int],
        *,
        costs: dict[int, float] | None = None,
        allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    """Greedy Best-First Search - fast but not optimal, follows heuristic greedily"""
    costs = _prepare_costs(costs)
    h, w = biomes.shape
    sx, sy = start
    gx, gy = goal

    if not (0 <= sx < w and 0 <= sy < h and 0 <= gx < w and 0 <= gy < h):
        return None, {"error": "Out of bounds"}
    if not allow_water and (biomes[sy, sx] == WATER or biomes[gy, gx] == WATER):
        return None, {"error": "Start or goal in water"}

    def heuristic(x: int, y: int) -> float:
        dx = abs(x - gx)
        dy = abs(y - gy)
        dmin, dmax = (dx, dy) if dx < dy else (dy, dx)
        return (1.41421356 * dmin + (dmax - dmin))

    size = w * h
    INF = 1e30
    g = np.full(size, INF, dtype=np.float32)
    parent = np.full(size, -1, dtype=np.int32)
    closed = np.zeros(size, dtype=np.uint8)

    def idx(x: int, y: int) -> int:
        return y * w + x

    def xy(i: int) -> tuple[int, int]:
        return (int(i % w), int(i // w))

    start_i = idx(sx, sy)
    goal_i = idx(gx, gy)
    g[start_i] = 0.0

    open_heap: list[tuple[float, int]] = []
    heapq.heappush(open_heap, (heuristic(sx, sy), start_i))

    expanded = 0

    while open_heap:
        h_curr, i = heapq.heappop(open_heap)
        if closed[i]:
            continue
        closed[i] = 1
        expanded += 1
        if i == goal_i:
            path: list[tuple[int, int]] = []
            cur = i
            while cur != -1:
                path.append(xy(cur))
                cur = parent[cur]
            path.reverse()
            return path, {"expanded": int(expanded), "cost": float(g[goal_i])}
        x, y = xy(i)
        gi = g[i]
        for dx, dy, step in NEIGHBORS:
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if biomes[ny, nx] == WATER and not allow_water:
                continue
            j = idx(nx, ny)
            if closed[j]:
                continue
            tile = int(biomes[ny, nx])
            move_cost = costs.get(tile, 1.0) * step
            tentative = gi + move_cost
            if tentative < g[j]:
                g[j] = tentative
                parent[j] = i
                heapq.heappush(open_heap, (heuristic(nx, ny), j))

    return None, {"error": "Unreachable"}


def breadth_first(
        biomes: np.ndarray,
        start: tuple[int, int],
        goal: tuple[int, int],
        *,
        costs: dict[int, float] | None = None,
        allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    """Breadth-First Search - finds shortest path by steps (ignores costs)"""
    h, w = biomes.shape
    sx, sy = start
    gx, gy = goal

    if not (0 <= sx < w and 0 <= sy < h and 0 <= gx < w and 0 <= gy < h):
        return None, {"error": "Out of bounds"}
    if not allow_water and (biomes[sy, sx] == WATER or biomes[gy, gx] == WATER):
        return None, {"error": "Start or goal in water"}

    size = w * h
    parent = np.full(size, -1, dtype=np.int32)
    visited = np.zeros(size, dtype=np.uint8)

    def idx(x: int, y: int) -> int:
        return y * w + x

    def xy(i: int) -> tuple[int, int]:
        return (int(i % w), int(i // w))

    start_i = idx(sx, sy)
    goal_i = idx(gx, gy)

    queue = deque([start_i])
    visited[start_i] = 1

    expanded = 0

    while queue:
        i = queue.popleft()
        expanded += 1

        if i == goal_i:
            path: list[tuple[int, int]] = []
            cur = i
            while cur != -1:
                path.append(xy(cur))
                cur = parent[cur]
            path.reverse()
            # Calculate cost after finding path
            costs = _prepare_costs(costs)
            total_cost = 0.0
            for k in range(len(path) - 1):
                x1, y1 = path[k]
                x2, y2 = path[k + 1]
                dx, dy = abs(x2 - x1), abs(y2 - y1)
                step = 1.41421356 if (dx + dy) == 2 else 1.0
                tile = int(biomes[y2, x2])
                total_cost += costs.get(tile, 1.0) * step
            return path, {"expanded": int(expanded), "cost": float(total_cost)}

        x, y = xy(i)
        for dx, dy, step in NEIGHBORS:
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if biomes[ny, nx] == WATER and not allow_water:
                continue
            j = idx(nx, ny)
            if visited[j]:
                continue
            visited[j] = 1
            parent[j] = i
            queue.append(j)

    return None, {"error": "Unreachable"}


def bidirectional_astar(
        biomes: np.ndarray,
        start: tuple[int, int],
        goal: tuple[int, int],
        *,
        costs: dict[int, float] | None = None,
        allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    """Bidirectional A* - searches from both start and goal simultaneously"""
    costs = _prepare_costs(costs)
    h, w = biomes.shape
    sx, sy = start
    gx, gy = goal

    if not (0 <= sx < w and 0 <= sy < h and 0 <= gx < w and 0 <= gy < h):
        return None, {"error": "Out of bounds"}
    if not allow_water and (biomes[sy, sx] == WATER or biomes[gy, gx] == WATER):
        return None, {"error": "Start or goal in water"}

    size = w * h
    INF = 1e30

    # Forward search data
    g_fwd = np.full(size, INF, dtype=np.float32)
    parent_fwd = np.full(size, -1, dtype=np.int32)
    closed_fwd = np.zeros(size, dtype=np.uint8)

    # Backward search data
    g_bwd = np.full(size, INF, dtype=np.float32)
    parent_bwd = np.full(size, -1, dtype=np.int32)
    closed_bwd = np.zeros(size, dtype=np.uint8)

    def idx(x: int, y: int) -> int:
        return y * w + x

    def xy(i: int) -> tuple[int, int]:
        return (int(i % w), int(i // w))

    def heuristic_fwd(x: int, y: int) -> float:
        dx, dy = abs(x - gx), abs(y - gy)
        dmin, dmax = (dx, dy) if dx < dy else (dy, dx)
        return (1.41421356 * dmin + (dmax - dmin))

    def heuristic_bwd(x: int, y: int) -> float:
        dx, dy = abs(x - sx), abs(y - sy)
        dmin, dmax = (dx, dy) if dx < dy else (dy, dx)
        return (1.41421356 * dmin + (dmax - dmin))

    start_i = idx(sx, sy)
    goal_i = idx(gx, gy)

    g_fwd[start_i] = 0.0
    g_bwd[goal_i] = 0.0

    open_fwd: list[tuple[float, int]] = []
    open_bwd: list[tuple[float, int]] = []
    heapq.heappush(open_fwd, (heuristic_fwd(sx, sy), start_i))
    heapq.heappush(open_bwd, (heuristic_bwd(gx, gy), goal_i))

    best_cost = INF
    meeting_point = -1
    expanded = 0

    while open_fwd and open_bwd:
        # Forward step
        if open_fwd:
            _, i = heapq.heappop(open_fwd)
            if not closed_fwd[i]:
                closed_fwd[i] = 1
                expanded += 1

                # Check if backward search reached this node
                if closed_bwd[i]:
                    total = g_fwd[i] + g_bwd[i]
                    if total < best_cost:
                        best_cost = total
                        meeting_point = i

                x, y = xy(i)
                gi = g_fwd[i]

                for dx, dy, step in NEIGHBORS:
                    nx, ny = x + dx, y + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    if biomes[ny, nx] == WATER and not allow_water:
                        continue
                    j = idx(nx, ny)
                    if closed_fwd[j]:
                        continue
                    tile = int(biomes[ny, nx])
                    move_cost = costs.get(tile, 1.0) * step
                    tentative = gi + move_cost
                    if tentative < g_fwd[j]:
                        g_fwd[j] = tentative
                        parent_fwd[j] = i
                        f = tentative + heuristic_fwd(nx, ny)
                        heapq.heappush(open_fwd, (f, j))

        # Backward step
        if open_bwd:
            _, i = heapq.heappop(open_bwd)
            if not closed_bwd[i]:
                closed_bwd[i] = 1
                expanded += 1

                # Check if forward search reached this node
                if closed_fwd[i]:
                    total = g_fwd[i] + g_bwd[i]
                    if total < best_cost:
                        best_cost = total
                        meeting_point = i

                x, y = xy(i)
                gi = g_bwd[i]

                for dx, dy, step in NEIGHBORS:
                    nx, ny = x + dx, y + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    if biomes[ny, nx] == WATER and not allow_water:
                        continue
                    j = idx(nx, ny)
                    if closed_bwd[j]:
                        continue
                    tile = int(biomes[ny, nx])
                    move_cost = costs.get(tile, 1.0) * step
                    tentative = gi + move_cost
                    if tentative < g_bwd[j]:
                        g_bwd[j] = tentative
                        parent_bwd[j] = i
                        f = tentative + heuristic_bwd(nx, ny)
                        heapq.heappush(open_bwd, (f, j))

        # Check for convergence
        if meeting_point != -1:
            # Reconstruct path
            path_fwd = []
            cur = meeting_point
            while cur != -1:
                path_fwd.append(xy(cur))
                cur = parent_fwd[cur]
            path_fwd.reverse()

            path_bwd = []
            cur = parent_bwd[meeting_point]
            while cur != -1:
                path_bwd.append(xy(cur))
                cur = parent_bwd[cur]

            path = path_fwd + path_bwd
            return path, {"expanded": int(expanded), "cost": float(best_cost)}

    return None, {"error": "Unreachable"}


# Algorithm registry
ALGORITHMS = {
    'astar': astar,
    'dijkstra': dijkstra,
    'greedy': greedy_best_first,
    'bfs': breadth_first,
    'bidirectional': bidirectional_astar,
}


def route_with_algorithm(
        algorithm: str,
        biomes: np.ndarray,
        start: tuple[int, int],
        goal: tuple[int, int],
        *,
        costs: dict[int, float] | None = None,
        allow_water: bool = False
) -> tuple[list[tuple[int, int]] | None, dict]:
    """Route using specified algorithm"""
    algo_func = ALGORITHMS.get(algorithm, astar)
    return algo_func(biomes, start, goal, costs=costs, allow_water=allow_water)
