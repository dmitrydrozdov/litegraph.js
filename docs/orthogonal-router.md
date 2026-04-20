# Orthogonal Link Routing

Developer documentation for the orthogonal (Manhattan) link router added to
LiteGraph as the fourth render mode
`LiteGraph.LINK_RENDER_MODES.ORTHOGONAL_LINK` (enum value `3`).

This document describes the algorithm **as implemented** in
[src/litegraph.js](../src/litegraph.js). For the original design rationale and
open questions, see [ORTHOGONAL_LINK_ROUTING.md](../ORTHOGONAL_LINK_ROUTING.md).
For the spec, see [openspec/changes/orthogonal-link-routing/](../openspec/changes/orthogonal-link-routing/).

---

## 1. What it does

Renders links between node slots as axis-aligned polylines that:

- Leave and enter each slot perpendicular to the node edge (clean stubs).
- Avoid passing through other nodes' bounding boxes.
- Prefer fewer bends and fewer crossings with other links.
- Render with rounded quarter-arc corners (the cached polyline itself is
  sharp-cornered — rounding is purely a render-time transform).
- Are hit-testable along their full length, not just near a midpoint.
- Offset parallel links between the same node pair so they don't overlap.

The mode is opt-in at the canvas level and does not change the data model —
routed polylines are ephemeral and never serialized.

```js
canvas.links_render_mode = LiteGraph.ORTHOGONAL_LINK;
```

---

## 2. Public API

### Mode selection

- `LiteGraph.ORTHOGONAL_LINK = 3` — top-level enum, same convention as
  `STRAIGHT_LINK`, `LINEAR_LINK`, `SPLINE_LINK`.
- `LiteGraph.LINK_RENDER_MODES` — array of mode names with named properties
  attached (`.STRAIGHT_LINK`, `.LINEAR_LINK`, `.SPLINE_LINK`, `.ORTHOGONAL_LINK`).

### Tuning constants

All on the `LiteGraph` namespace, read by the router on every frame.
Changing them takes effect on the next render.

| Constant | Default | Meaning |
|---|---|---|
| `LINK_ORTHOGONAL_STUB_LENGTH` | 18 | Length of the straight stub leaving/entering a slot before the routed path begins (graph px). |
| `LINK_ORTHOGONAL_STABILITY_BIAS` | 0.001 | Per-edge tie-break penalty applied when a candidate A\* edge is **not** contained in the previous route of the same link. Breaks equal-cost ties in favor of the previous path, preventing flicker when dragging. Must stay well below the smallest meaningful length delta (1 graph px) so non-tied routes are unaffected. |
| `LINK_ORTHOGONAL_PADDING` | 8 | Obstacle inflation — how much free space the router insists around each node (graph px). |
| `LINK_ORTHOGONAL_CORNER_RADIUS` | 8 | Maximum fillet radius at each polyline corner. Clamped at render time to half the shorter adjacent segment. |
| `LINK_ORTHOGONAL_TURN_COST` | 10 | A\* cost added per 90° turn. Higher values bias toward straighter paths. |
| `LINK_ORTHOGONAL_CROSSING_COST` | 50 | A\* cost added per crossing with an already-routed link in the current frame. Higher values bias toward detours. |
| `LINK_ORTHOGONAL_PARALLEL_OFFSET` | 12 | Perpendicular offset per parallel link between the same ordered node pair. |

### Low-level functions

Exposed on the `LiteGraph` namespace for external consumers:

- `LiteGraph.segmentsIntersect(a1, a2, b1, b2)` — axis-aligned segment crossing.
- `LiteGraph.segmentCrossesRect(p1, p2, rect)` — segment-vs-rectangle test, open interior.
- `LiteGraph.pointToSegmentDistance(p, a, b)` — Euclidean distance from point to segment.
- `LiteGraph.polylineMidpoint(polyline)` — arc-length midpoint of a Float32Array polyline.

On `LGraphCanvas.prototype`:

- `routeOrthogonalLink(origin_slot_pos, origin_slot_dir, origin_offset, target_slot_pos, target_slot_dir, target_offset, obstacles, already_routed)` — compute a polyline. Returns a `Float32Array` of interleaved `[x, y, x, y, …]`.
- `strokeRoundedPolyline(ctx, polyline, radius)` — emit `lineTo`/`arcTo` calls to the given Canvas2D context for a sharp-cornered polyline.

---

## 3. Per-frame pipeline

Entry points sit in [`drawConnections`](../src/litegraph.js) (the existing
link-drawing loop). When the mode is `ORTHOGONAL_LINK`, the loop is preceded
by a router pre-pass:

```
drawConnections(ctx)
  ├─ if (mode changed)           invalidate caches (bump _route_version)
  ├─ if (mode == ORTHOGONAL_LINK) _routeOrthogonalLinks()   ← pre-pass
  └─ usual per-link loop
        └─ renderLink(ctx, a, b, link, …)
              └─ if (ORTHOGONAL_LINK)  strokeRoundedPolyline(link._polyline)
                 else                  existing bezier / linear / straight path
```

### 3.1 `_routeOrthogonalLinks` (pre-pass)

1. **Collect records.** Walk every input slot on every node (the same order as
   the legacy loop) and build a per-link record containing start/end node,
   slot indices, and slot objects.
2. **Count parallel pairs.** Build a map `(origin_id, target_id) → count` so
   links between the same ordered pair can be offset later.
3. **Sort by `link.id` ascending.** This gives the stable "routing order"
   required for deterministic crossing accounting.
4. **Assign parallel indices & offsets.** For each record, `pair_idx` is its
   ordinal within the pair; the offset is
   `(pair_idx − (count − 1)/2) · LINK_ORTHOGONAL_PARALLEL_OFFSET`.
   - Origin gets `+off`.
   - Target gets `−off` (see [§4](#4-parallel-link-offsetting)).
5. **For each record in order:**
   a. Compute slot positions via `node.getConnectionPos(...)`.
   b. Compute the slot directions: slot-provided `.dir`, else defaults
      `(horizontal ? DOWN : RIGHT)` for outputs,
      `(horizontal ? UP : LEFT)` for inputs.
   c. **Cache check.** Reuse `link._polyline` if
      `link._route_version === canvas._route_version` **and**
      `link._route_mode === ORTHOGONAL_LINK` **and** origin/target offsets
      match. On hit, just append the cached polyline to `already_routed` and skip.
   d. On miss, build the per-link obstacle set (see [§3.2](#32-obstacle-set)),
      call `routeOrthogonalLink`, store polyline + metadata on the link, and
      append the polyline to `already_routed` so subsequent links see it for
      crossing counting.
   e. Update `link._pos` to the polyline's arc-length midpoint (keeps the
      tooltip system working unchanged).

### 3.2 Obstacle set

Built per link by `_orthoBuildObstacles(graph, excluded_ids, neighborhood, padding)`:

- Start from every node's bounding box, inflated by `LINK_ORTHOGONAL_PADDING`.
- **Endpoint nodes are included**, not excluded — otherwise A\* will prefer to
  cut straight through the source or target node interior when that's the
  shortest path.
  The stub is prepended outside A\*'s grid, so as long as
  `LINK_ORTHOGONAL_STUB_LENGTH > LINK_ORTHOGONAL_PADDING` the stub tip
  sits `(stubLen - padding)` px outside the endpoint node's inflated bbox and
  A\* can still start/end there.
- Drop obstacles that don't overlap a **neighborhood bbox** around the two
  stub tips, extended by `padding + 32 px`. This is a performance filter and
  is safe because routes never leave that neighborhood.

### 3.3 `routeOrthogonalLink` (per link)

1. **Stub geometry.** For each slot, compute three points:
   - `slot_pos` — the exact slot attachment point (first/last polyline vertex).
   - `stub_base = slot_pos + slot_dir · STUB_LENGTH` — end of the perpendicular stub.
   - `stub_tip  = stub_base + perp · offset` — offset to the side for parallel links.
   When the offset is 0, `stub_tip === stub_base` and the two collapse during cleanup.
2. **Initial direction at origin:** pinned to `origin_slot_dir` unconditionally.
   A\*'s U-turn rule then forbids the first move being `−slot_dir`, which is
   what keeps the path from doubling back into the source node.
3. **Forbidden arrival directions at target:** always includes
   `+target_slot_dir` (would mean arriving from inside the node); when
   `target_offset != 0`, also includes the jog-reverse direction (would
   U-turn against the stub-tip-to-stub-base segment).
4. **Hanan grid.** `_orthoBuildHananGrid` returns sorted-unique `xs` and `ys`
   drawn from `{origin_tip, target_tip} ∪ {left, right, top, bottom}` of every
   obstacle. A\* moves on the cartesian product of these coordinates.
5. **A\* search** (see [§3.4](#34-a-search)).
6. **L-route fallback.** If A\* returns no path (e.g., an endpoint fully
   enclosed by overlapping obstacles), produce a two-segment L-route
   connecting the stub tips — first along `origin_slot_dir`'s axis, then
   perpendicular. Obstacles are ignored here. A link is always drawn.
7. **Assemble.** Build
   `[slot_pos_origin, stub_base_origin, stub_tip_origin, …A\* points…, stub_tip_target, stub_base_target, slot_pos_target]`.
8. **Clean up.** Drop consecutive duplicates, then merge any three collinear
   consecutive points into two. Result satisfies the spec's "no redundant
   vertices" and "all segments axis-aligned" requirements.
9. Convert to a `Float32Array` of interleaved `[x, y, x, y, …]` and return.

### 3.4 A\* search

Implemented in `_orthoAStar(o_tip, init_dir, t_tip, forbidden_arrivals, xs, ys, obstacles, already_routed)`.

- **State:** `(xi, yi, di)` where `xi`, `yi` are Hanan grid indices and `di`
  is one of `{RIGHT, LEFT, DOWN, UP}` representing the direction the router
  was heading when it *arrived at* this state.
- **State key:** `(xi · |ys| + yi) · 4 + di` — integer, cheap hash lookup.
- **Open set:** binary min-heap keyed by `f = g + h`
  (see `_orthoHeapPush` / `_orthoHeapPop`).
- **Closed set:** `{stateKey → true}`. Once popped, a state is never
  re-expanded.
- **Best-cost map:** `{stateKey → g}` used to skip enqueuing a worse path
  to the same `(xi, yi, di)`.
- **Cost per transition:** `segment_length + turn_cost + crossing_cost + stability_bias`
  - `segment_length` = |Δx| + |Δy| (Manhattan = Euclidean for axis-aligned moves)
  - `turn_cost` = `LINK_ORTHOGONAL_TURN_COST` if the new direction differs
    from the state's direction, else 0.
  - `crossing_cost` = `LINK_ORTHOGONAL_CROSSING_COST · crossings` where
    crossings are proper intersections (excluding shared endpoints and
    parallel overlaps) with any polyline in `already_routed`.
  - `stability_bias` = `LINK_ORTHOGONAL_STABILITY_BIAS` if a previous
    polyline for this link exists **and** the candidate edge is not fully
    contained in one of its segments, else 0. Its magnitude (1e-3 by default)
    is too small to affect a non-tied decision — it only resolves ties in
    favor of the previous route, preventing flicker during drags.
- **Heuristic:** Manhattan distance from `(xs[xi], ys[yi])` to
  `(xs[gx], ys[gy])`. Admissible because turn/crossing costs are
  non-negative and Manhattan is a lower bound on any orthogonal path length.
- **Neighbor expansion:**
  1. Skip the opposite of the current direction (`_ORTHO_DIR_OPPOSITE`) —
     this is the U-turn block and it is what makes the initial-direction
     trick work for stubs.
  2. Skip out-of-grid neighbors.
  3. **Skip any grid vertex already visited on the current path.** The A\*
     expansion walks `cur.parent` and rejects `(nxi, nyi)` if it appears on
     any ancestor. Because all grid segments are axis-aligned, self-crossings
     can only occur at grid vertices — so this check eliminates geometric
     self-crossings entirely. Parent-chain length is at most `|xs| · |ys|`
     (typically well under 100) so overhead per expansion is small.
  4. Skip neighbors whose connecting segment crosses any obstacle's open
     interior (`segmentCrossesRect`; touching inflated edges is legal).
- **Goal check:** when popping a state at `(gx, gy)`, accept if
  `di` is not in `forbidden_arrivals`. Otherwise discard and keep searching —
  A\* may find a different arrival direction that is acceptable.
- **Path reconstruction:** walk the `parent` chain from the accepted goal
  state back to the start and reverse to produce the point sequence.

### 3.5 Rendering

The cached polyline is strokable in two ways:

- **Sharp** — direct `moveTo`/`lineTo` over each vertex. Used internally
  when reasoning about geometry (hit-testing, midpoint).
- **Rounded** — `strokeRoundedPolyline(ctx, polyline, radius)` walks each
  interior vertex and emits:
  1. `lineTo(corner − r · prev_dir)` — stop short of the corner by `r`.
  2. `arcTo(corner, corner + r · next_dir, r)` — quarter-arc fillet tangent
     to both segments.
  Where `r = min(LINK_ORTHOGONAL_CORNER_RADIUS, prev_seg_len / 2, next_seg_len / 2)`
  so the arc never extends past either adjacent endpoint.

Rounding does **not** modify `link._polyline` — it's purely a render-time
transform. Hit-testing always runs on the sharp polyline, so visual and
logical geometry never drift.

---

## 4. Parallel-link offsetting

When ≥ 2 links share the same ordered `(origin_id, target_id)`, each stub is
offset perpendicular to its slot direction so the links don't overlap.

For a pair with `count` links, routed in `link.id` order, the `pair_idx`-th link
gets origin offset `off = (pair_idx − (count − 1)/2) · LINK_ORTHOGONAL_PARALLEL_OFFSET`.

**Target offset sign.** On aligned slot pairs (the common case, e.g. a RIGHT
output feeding a LEFT input), the origin and target perpendicular vectors
point opposite on screen (`perp_origin = [0, +1]` = DOWN; `perp_target = [0, −1]` = UP).
To keep both stubs shifted *in the same screen direction* — which is what
makes parallel routes actually parallel — the target uses `−off`:

```
origin_offset =  off    →  stub_tip shifts by perp_origin · (+off)
target_offset = −off    →  stub_tip shifts by perp_target · (−off) = same screen shift
```

Without the sign flip, the two stubs shift in opposite screen directions and
parallel links end up diagonal, often crossing each other unnecessarily.

Single-link pairs (`count == 1`) always get `off = 0`; both stub bases equal
the slot position in screen space.

---

## 5. Caching and invalidation

The router keeps a per-link cache on the `LLink` object. All cache fields are
prefixed with `_` so they don't participate in serialization:

| Field | Meaning |
|---|---|
| `link._polyline` | Float32Array of interleaved xy; sharp-cornered |
| `link._route_version` | value of `canvas._route_version` at cache-fill time |
| `link._route_mode` | `LINK_RENDER_MODES` value at cache-fill time |
| `link._route_origin_offset` | origin parallel offset at cache-fill time |
| `link._route_target_offset` | target parallel offset at cache-fill time |

The cache is reused when all four snapshotted values match the current frame.
Any mismatch triggers re-routing.

**Invalidation.** `canvas._route_version` is a monotonic integer. It is
incremented:

- In [`LGraph.prototype.add`](../src/litegraph.js) for every attached canvas.
- In [`LGraph.prototype.remove`](../src/litegraph.js) for every attached canvas.
- In `processMouseMove` inside the drag block (once per drag event).
- In `drawConnections` when `canvas.links_render_mode` changes.

On a stationary graph, `_route_version` does not change and no A\* runs after
the first frame — the pre-pass just walks the cache.

---

## 6. Hit-testing

Replaces the legacy single-point circle test. For any link with a cached
`_polyline` (any orthogonal link after the first render):

1. Coarse-reject against the polyline's bounding box inflated by the threshold.
2. For each segment, compute `pointToSegmentDistance`.
3. Hit if any distance ≤ `4 / canvas.ds.scale` (4 screen pixels).

Links without a cached polyline (other render modes) fall back to the legacy
circle-around-`link._pos` test, so spline/linear/straight hit-testing is
unchanged.

The midpoint-by-arc-length is still written to `link._pos`, which keeps the
existing tooltip system working without modification.

---

## 7. Determinism

The router is fully deterministic: same graph state + same tuning constants
→ same polylines, every frame, every run.

Sources of determinism:

- Links are routed in ascending `link.id`. `link.id` is assigned at
  connection-creation time (or via UUID if `LiteGraph.use_uuids` is on).
- Crossing costs are charged only against links already routed in the
  current frame. The order is stable.
- A\*'s tie-breaking is structural (insertion order into the heap); equal-cost
  tied states fall out in a repeatable order given the same input grid.
- No random numbers, no timing-dependent decisions.

A consequence: if the user re-orders link creation (delete and re-add in a
different order), the resulting picture may shift because the frame's
"already-routed" set differs. The picture stays stable across normal
interactions.

---

## 8. Complexity

Let `N` be the number of nodes in the route's neighborhood (typically < 20
after obstacle filtering), `L` the total number of visible links.

- Hanan grid build: `O(N)` coordinate insertions, `O(N log N)` sort.
- Grid size: up to `O(N²)` vertices.
- A\* per link (worst case): `O(N² log N²)` with the binary heap.
- Crossing cost per A\* transition: `O(Σ polyline_lengths)` — dominated by
  already-routed links in the current frame.
- Frame total (cold): `O(L · N² log N² + L²)` in the worst case.
- Frame total (cache hit for every link): `O(L)` — just walking the records.

Steady-state rendering, with a stationary graph, is effectively free.

---

## 9. Serialization safety

The feature adds **zero** fields to `LLink.serialize()` output:

- `_polyline`, `_route_version`, `_route_mode`, `_route_origin_offset`,
  `_route_target_offset` all use the underscore prefix.
- `LLink.prototype.serialize` returns the same 6-tuple as before.
- `LGraph.prototype.serialize` walks `link.serialize()` for every link — so
  underscore fields never reach the serialized form.

Loading a graph created before this change produces identical behavior; the
new mode is opt-in and the router recomputes polylines from scratch.

---

## 10. Limitations and trade-offs

- **Group boxes, comments, UI panels** are not obstacles — links pass through
  them. Acceptable because those layers are decorative.
- **Parallel-link offset is naive** — symmetric perpendicular shift. Five or
  more links between the same node pair will look cramped. The follow-up
  `link-waypoint-editing` change will let users pin individual routes.
- **Crossing accounting is approximate.** True mutual-minimum-crossing is
  NP-hard (it's multicommodity routing). The current scheme charges
  crossings only against earlier-routed links and accepts the resulting
  order-dependence as a trade for O(L) routing.
- **Route caching is coarse.** A drag on any node bumps `_route_version` for
  every canvas the graph is attached to, which invalidates every link's
  cache. The per-route neighborhood bbox was considered but rejected for
  complexity; the coarser scheme still hits 60fps on the 100-node fixture.
- **No user editing yet.** Segment drag, pinned waypoints, and persisted
  routes are out of scope for this change and covered by the follow-up
  `link-waypoint-editing` proposal.

---

## 11. Code map

| Concern | Location |
|---|---|
| Mode enum & tuning constants | `LiteGraph` globals near [src/litegraph.js:92](../src/litegraph.js#L92) |
| Per-frame pre-pass | `LGraphCanvas.prototype._routeOrthogonalLinks` |
| Per-link entry point | `LGraphCanvas.prototype.routeOrthogonalLink` |
| Corner stroker | `LGraphCanvas.prototype.strokeRoundedPolyline` |
| A\* internals | `_orthoAStar`, `_orthoBuildHananGrid`, `_orthoBuildObstacles` |
| Geometry primitives | `segmentsIntersect`, `segmentCrossesRect`, `pointToSegmentDistance` |
| Cache-version bumps | `LGraph.prototype.add`, `LGraph.prototype.remove`, drag block in `processMouseMove` |
| Hit-test polyline path | "not over a node" branch in `LGraphCanvas.prototype.processMouseMove` |
| Render dispatch | `LGraphCanvas.prototype.renderLink` |

---

## 12. Demo

See [editor/orthogonal_demo.html](../editor/orthogonal_demo.html). It provides:

- Mode toggle buttons for all four render modes.
- A small hand-crafted scene (two sources, a blocker, a target) that
  exercises perpendicular stubs, rounded corners, parallel offsets, and
  obstacle avoidance.
- A 100-node / 200-link stress fixture for performance testing.
- A live input bound to `LiteGraph.LINK_ORTHOGONAL_STUB_LENGTH`.
