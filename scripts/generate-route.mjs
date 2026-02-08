#!/usr/bin/env node

/**
 * generate-route.mjs
 *
 * Queries OpenStreetMap Overpass API for the road network in Westminster,
 * builds a graph, and uses Dijkstra's algorithm to find a connected loop
 * through key waypoints. This guarantees no gaps between street segments.
 *
 * Usage: node scripts/generate-route.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = resolve(__dirname, '.osm-cache-v2.json');
const OUTPUT_FILE = resolve(__dirname, '../src/games/bus-game/data/routeData.js');

// ── Config ──────────────────────────────────────────────────────────────────

const BBOX = '51.496,-0.145,51.510,-0.115';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Target game-unit span for the largest axis
const TARGET_SPAN = 500;
// Douglas-Peucker epsilon in game units
const DP_EPSILON = 2;
// Min distance between bus stops in game units
const MIN_STOP_SPACING = 40;
// Max distance from route to match a bus stop (game units)
const STOP_MATCH_RADIUS = 30;
// Padding around route for BOUNDS
const BOUNDS_PADDING = 100;

// Key waypoints defining the loop (lat, lng).
// Dijkstra will find the connected road path between each consecutive pair.
const LOOP_WAYPOINTS = [
  { lat: 51.5007, lon: -0.1218, name: 'Westminster Bridge (south)' },
  { lat: 51.5013, lon: -0.1220, name: 'Westminster Bridge (north)' },
  { lat: 51.5044, lon: -0.1231, name: 'Victoria Embankment (midpoint)' },
  { lat: 51.5075, lon: -0.1238, name: 'Victoria Embankment (north)' },
  { lat: 51.5073, lon: -0.1270, name: 'Northumberland Avenue (top)' },
  { lat: 51.5062, lon: -0.1283, name: 'Northumberland Avenue (bottom)' },
  { lat: 51.5065, lon: -0.1290, name: 'Cockspur Street (east)' },
  { lat: 51.5058, lon: -0.1310, name: 'Cockspur Street (west)' },
  { lat: 51.5050, lon: -0.1340, name: 'The Mall (east)' },
  { lat: 51.5020, lon: -0.1410, name: 'The Mall (west) / Buckingham Palace' },
  { lat: 51.5008, lon: -0.1370, name: 'Birdcage Walk (west)' },
  { lat: 51.5009, lon: -0.1290, name: 'Birdcage Walk (east)' },
  { lat: 51.5006, lon: -0.1264, name: 'Great George Street' },
  { lat: 51.5005, lon: -0.1247, name: 'Parliament Square (south)' },
  { lat: 51.5007, lon: -0.1225, name: 'Bridge Street → Westminster Bridge' },
];

// Road types that are driveable by a bus
const DRIVEABLE_TYPES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'residential', 'unclassified', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link',
]);

// ── Overpass query — ALL driveable roads in the bbox ────────────────────────

const ROAD_QUERY = `
[out:json][timeout:60];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${BBOX});
  node["highway"="bus_stop"](${BBOX});
  node["public_transport"="platform"]["bus"="yes"](${BBOX});
);
out body;
>;
out skel qt;
`;

// ── Overpass fetch with caching ─────────────────────────────────────────────

async function fetchOverpass(query, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`  Attempt ${attempt}/${retries}...`);
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.status === 429 || res.status === 504) {
        const wait = attempt * 5000;
        console.log(`  Got ${res.status}, retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`Overpass failed: ${res.status} ${res.statusText}`);
      return res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Error: ${err.message}, retrying...`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

async function getOsmData() {
  if (existsSync(CACHE_FILE)) {
    console.log('Using cached OSM data from', CACHE_FILE);
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
  }

  console.log('Fetching all driveable roads + bus stops from Overpass API...');
  const data = await fetchOverpass(ROAD_QUERY);
  console.log(`  Got ${data.elements.length} total elements`);

  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  console.log('Cached OSM data to', CACHE_FILE);
  return data;
}

// ── Haversine distance (meters) ─────────────────────────────────────────────

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Build road network graph ────────────────────────────────────────────────

function buildGraph(osmData) {
  const nodes = new Map(); // nodeId -> { lat, lon }
  const ways = [];         // { nodes: [nodeId...], name, highway }
  const busStops = [];

  for (const el of osmData.elements) {
    if (el.type === 'node') {
      if (el.lat !== undefined && el.lon !== undefined) {
        nodes.set(el.id, { lat: el.lat, lon: el.lon });
      }
      if (el.tags && (el.tags.highway === 'bus_stop' || el.tags.public_transport === 'platform')) {
        busStops.push({
          lat: el.lat,
          lon: el.lon,
          name: el.tags?.name || el.tags?.description || null,
        });
      }
    } else if (el.type === 'way' && el.tags?.highway) {
      if (DRIVEABLE_TYPES.has(el.tags.highway)) {
        ways.push({
          nodes: el.nodes,
          name: el.tags.name || null,
          highway: el.tags.highway,
        });
      }
    }
  }

  console.log(`\nGraph: ${nodes.size} nodes, ${ways.length} driveable ways, ${busStops.length} bus stops`);

  // Build adjacency list: nodeId -> [{ to: nodeId, dist: meters, wayName }]
  const adj = new Map();

  function addEdge(from, to, dist, name) {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, dist, name });
  }

  for (const way of ways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i];
      const b = way.nodes[i + 1];
      const na = nodes.get(a);
      const nb = nodes.get(b);
      if (!na || !nb) continue;
      const dist = haversineM(na.lat, na.lon, nb.lat, nb.lon);
      // Bidirectional edges (simplification — ignoring one-way for game purposes)
      addEdge(a, b, dist, way.name);
      addEdge(b, a, dist, way.name);
    }
  }

  console.log(`  Adjacency list: ${adj.size} connected nodes`);

  return { nodes, adj, busStops };
}

// ── Find nearest graph node to a lat/lng ────────────────────────────────────

function findNearestNode(nodes, adj, lat, lon) {
  let bestId = null;
  let bestDist = Infinity;
  // Only search among connected nodes (nodes in the adjacency list)
  for (const [id] of adj) {
    const n = nodes.get(id);
    if (!n) continue;
    const d = haversineM(lat, lon, n.lat, n.lon);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return { id: bestId, dist: bestDist };
}

// ── Dijkstra's shortest path ────────────────────────────────────────────────

function dijkstra(adj, startId, endId) {
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  // Simple priority queue using sorted array (sufficient for this graph size)
  const pq = [];

  dist.set(startId, 0);
  pq.push({ id: startId, d: 0 });

  while (pq.length > 0) {
    // Extract minimum
    let minIdx = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].d < pq[minIdx].d) minIdx = i;
    }
    const { id: u, d: du } = pq.splice(minIdx, 1)[0];

    if (visited.has(u)) continue;
    visited.add(u);

    if (u === endId) break;

    const edges = adj.get(u);
    if (!edges) continue;

    for (const { to: v, dist: w } of edges) {
      if (visited.has(v)) continue;
      const newDist = du + w;
      if (newDist < (dist.get(v) ?? Infinity)) {
        dist.set(v, newDist);
        prev.set(v, u);
        pq.push({ id: v, d: newDist });
      }
    }
  }

  // Reconstruct path
  if (!prev.has(endId) && startId !== endId) return null;

  const path = [];
  let cur = endId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return path;
}

// ── Build route through waypoints ───────────────────────────────────────────

function buildRoute(nodes, adj) {
  console.log('\nFinding connected route through waypoints...');

  // Map each loop waypoint to nearest graph node
  const graphWaypoints = LOOP_WAYPOINTS.map((wp) => {
    const nearest = findNearestNode(nodes, adj, wp.lat, wp.lon);
    console.log(`  ${wp.name}: nearest node ${nearest.id} (${nearest.dist.toFixed(0)}m away)`);
    return { ...wp, nodeId: nearest.id };
  });

  // Find path between each consecutive pair of waypoints
  const fullNodePath = [];
  const streetLabels = [];

  for (let i = 0; i < graphWaypoints.length; i++) {
    const from = graphWaypoints[i];
    const to = graphWaypoints[(i + 1) % graphWaypoints.length];

    const path = dijkstra(adj, from.nodeId, to.nodeId);
    if (!path) {
      console.error(`  ERROR: No path from "${from.name}" to "${to.name}"`);
      continue;
    }

    // Figure out street name for this segment from the edge data
    const segLabel = `${from.name} → ${to.name}`;

    // Append path (skip first node if it duplicates previous end)
    const startIdx = fullNodePath.length > 0 && path[0] === fullNodePath[fullNodePath.length - 1] ? 1 : 0;
    for (let j = startIdx; j < path.length; j++) {
      fullNodePath.push(path[j]);
      // Track the street name from the edge, falling back to segment label
      if (j > 0) {
        const edges = adj.get(path[j - 1]) || [];
        const edge = edges.find((e) => e.to === path[j]);
        streetLabels.push(edge?.name || from.name.split(' (')[0]);
      } else if (startIdx === 0) {
        streetLabels.push(from.name.split(' (')[0]);
      }
    }

    console.log(`  ${from.name} → ${to.name}: ${path.length} nodes, ${(path.length - 1)} edges`);
  }

  // Convert node IDs to lat/lng
  const routeLatLng = fullNodePath.map((id) => nodes.get(id));

  console.log(`\nFull route: ${routeLatLng.length} points`);

  return { routeLatLng, streetLabels, fullNodePath };
}

// ── Project lat/lng to game XZ ──────────────────────────────────────────────

function projectToGameCoords(routeLatLng, busStopsLatLng) {
  const lat0 = routeLatLng.reduce((s, p) => s + p.lat, 0) / routeLatLng.length;
  const lng0 = routeLatLng.reduce((s, p) => s + p.lon, 0) / routeLatLng.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  function project(lat, lon) {
    const x = (lon - lng0) * cosLat * 111320;
    const z = -(lat - lat0) * 111320;
    return [x, z];
  }

  const rawRoute = routeLatLng.map((p) => project(p.lat, p.lon));

  const rawStops = busStopsLatLng.map((s) => ({
    ...s,
    pos: project(s.lat, s.lon),
  }));

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of rawRoute) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const maxSpan = Math.max(spanX, spanZ);

  const scale = TARGET_SPAN / maxSpan;
  console.log(`\nProjection: center (${lat0.toFixed(5)}, ${lng0.toFixed(5)})`);
  console.log(`  Raw extent: ${spanX.toFixed(0)}m x ${spanZ.toFixed(0)}m`);
  console.log(`  Scale factor: ${scale.toFixed(2)} (1 game unit ~ ${(1 / scale).toFixed(2)}m)`);

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const gameRoute = rawRoute.map(([x, z]) => [
    Math.round(((x - cx) * scale) * 10) / 10,
    Math.round(((z - cz) * scale) * 10) / 10,
  ]);

  const gameStops = rawStops.map((s) => ({
    ...s,
    gamePos: [
      Math.round(((s.pos[0] - cx) * scale) * 10) / 10,
      Math.round(((s.pos[1] - cz) * scale) * 10) / 10,
    ],
  }));

  return { gameRoute, gameStops, scale, cx, cz, cosLat, lat0, lng0 };
}

// ── Douglas-Peucker simplification ──────────────────────────────────────────

function perpDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  const [ax, az] = points[0];
  const [bx, bz] = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i][0], points[i][1], ax, az, bx, bz);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

// ── Enforce max gap between consecutive waypoints ───────────────────────────

/**
 * Walk through the simplified route. Whenever two consecutive simplified points
 * are more than maxGap apart, re-insert points from fullRoute along the original
 * path so that no segment exceeds maxGap.
 */
function enforceMaxGap(simplified, fullRoute, maxGap) {
  // Build an index mapping: for each simplified point, find its closest index in fullRoute
  const simToFull = simplified.map(([x, z]) => {
    let bestIdx = 0, bestDist = Infinity;
    for (let j = 0; j < fullRoute.length; j++) {
      const d = Math.hypot(fullRoute[j][0] - x, fullRoute[j][1] - z);
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    }
    return bestIdx;
  });

  const result = [simplified[0]];

  for (let i = 1; i < simplified.length; i++) {
    const prev = result[result.length - 1];
    const curr = simplified[i];
    const gap = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);

    if (gap > maxGap) {
      const fullStart = simToFull[i - 1];
      const fullEnd = simToFull[i];

      if (fullEnd > fullStart) {
        // Walk along fullRoute from fullStart to fullEnd, emitting points every ~maxGap
        let accum = 0;
        for (let j = fullStart + 1; j < fullEnd; j++) {
          const segDist = Math.hypot(
            fullRoute[j][0] - fullRoute[j - 1][0],
            fullRoute[j][1] - fullRoute[j - 1][1]
          );
          accum += segDist;
          if (accum >= maxGap * 0.8) { // emit slightly before threshold for smoother curves
            result.push(fullRoute[j]);
            accum = 0;
          }
        }
      }
    }

    result.push(curr);
  }

  return result;
}

// ── Close the loop ──────────────────────────────────────────────────────────

function closeLoop(route) {
  const first = route[0];
  const last = route[route.length - 1];
  const gap = Math.hypot(first[0] - last[0], first[1] - last[1]);
  console.log(`\nLoop closure gap: ${gap.toFixed(1)} game units`);
  if (gap > 5) {
    route.push([first[0], first[1]]);
    console.log('  Added closing waypoint');
  }
  return route;
}

// ── Match bus stops to route ────────────────────────────────────────────────

function dist2d(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function matchBusStops(route, gameStops, matchRadius) {
  const candidates = [];
  for (const stop of gameStops) {
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < route.length; i++) {
      const d = dist2d(stop.gamePos[0], stop.gamePos[1], route[i][0], route[i][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestDist <= matchRadius) {
      candidates.push({
        idx: bestIdx,
        dist: bestDist,
        name: stop.name,
        lat: stop.lat,
        lon: stop.lon,
      });
    }
  }

  candidates.sort((a, b) => a.idx - b.idx);

  // Deduplicate: keep one per nearby index range (prefer named stops)
  const deduped = [];
  for (const c of candidates) {
    const nearby = deduped.find((d) => Math.abs(d.idx - c.idx) < 3);
    if (nearby) {
      if (!nearby.name && c.name) {
        deduped[deduped.indexOf(nearby)] = c;
      } else if (nearby.name && c.name && c.dist < nearby.dist) {
        deduped[deduped.indexOf(nearby)] = c;
      }
    } else {
      deduped.push(c);
    }
  }

  // Enforce minimum spacing
  const selected = [];
  for (const c of deduped) {
    if (selected.length === 0) { selected.push(c); continue; }
    const last = selected[selected.length - 1];
    const spacing = dist2d(route[c.idx][0], route[c.idx][1], route[last.idx][0], route[last.idx][1]);
    if (spacing >= MIN_STOP_SPACING) selected.push(c);
  }

  return selected.slice(0, 10);
}

// ── Assign street names to unnamed stops ────────────────────────────────────

function assignStreetNames(stops, streetLabels) {
  for (const stop of stops) {
    if (stop.name && !stop.name.startsWith('Stop ')) continue;
    const label = streetLabels[Math.min(stop.idx, streetLabels.length - 1)];
    stop.name = label || 'Unknown';
  }
}

// ── Deduplicate stop names ──────────────────────────────────────────────────

function deduplicateStopNames(stops) {
  const seen = new Map();
  for (const s of stops) {
    const count = (seen.get(s.name) || 0) + 1;
    seen.set(s.name, count);
    if (count > 1) {
      const suffixes = ['North', 'South', 'East', 'West', 'Central'];
      s.name = `${s.name} ${suffixes[(count - 2) % suffixes.length]}`;
    }
  }
}

// ── Detect junctions & side-road stubs ─────────────────────────────────────

// Manual roundabout/major junction definitions (OSM doesn't tag these as roundabouts)
const MANUAL_ROUNDABOUTS = [
  { name: 'Parliament Square', lat: 51.5005, lon: -0.1264, radiusM: 35 },
  { name: 'Trafalgar Square', lat: 51.5063, lon: -0.1285, radiusM: 30 },
];

function detectJunctionsAndStubs(nodes, adj, fullNodePath, gameRoute, routeLatLng, scale, cx, cz, cosLat, lat0, lng0) {
  // Build set of node IDs on the bus route for quick lookup
  const routeNodeSet = new Set(fullNodePath);

  // --- Junctions (roundabouts) ---
  // Project manual roundabouts to game coordinates
  const junctions = MANUAL_ROUNDABOUTS.map((rb) => {
    const rawX = (rb.lon - lng0) * cosLat * 111320;
    const rawZ = -(rb.lat - lat0) * 111320;
    const gx = Math.round(((rawX - cx) * scale) * 10) / 10;
    const gz = Math.round(((rawZ - cz) * scale) * 10) / 10;
    const radius = Math.round(rb.radiusM * scale * 10) / 10;
    return { x: gx, z: gz, radius, name: rb.name, arms: 4 };
  });

  // --- Side-road stubs ---
  // For each node on the bus route, check if it connects to roads leading off-route
  const stubs = [];
  const MIN_STUB_SPACING = 15; // game units between stubs

  for (let ri = 0; ri < fullNodePath.length; ri++) {
    const nodeId = fullNodePath[ri];
    const edges = adj.get(nodeId);
    if (!edges) continue;

    // Get game-space position for this route node
    const routeNode = nodes.get(nodeId);
    if (!routeNode) continue;

    // Find edges leading to nodes NOT on the bus route
    for (const edge of edges) {
      if (routeNodeSet.has(edge.to)) continue; // skip edges to route nodes

      const targetNode = nodes.get(edge.to);
      if (!targetNode) continue;

      // Project both nodes to game coords
      const fromRawX = (routeNode.lon - lng0) * cosLat * 111320;
      const fromRawZ = -(routeNode.lat - lat0) * 111320;
      const fromGX = (fromRawX - cx) * scale;
      const fromGZ = (fromRawZ - cz) * scale;

      const toRawX = (targetNode.lon - lng0) * cosLat * 111320;
      const toRawZ = -(targetNode.lat - lat0) * 111320;
      const toGX = (toRawX - cx) * scale;
      const toGZ = (toRawZ - cz) * scale;

      // Compute angle the side road leaves the route
      const sdx = toGX - fromGX;
      const sdz = toGZ - fromGZ;
      const sideLen = Math.hypot(sdx, sdz);
      if (sideLen < 2) continue; // too short

      const angle = Math.atan2(sdx, sdz);

      // Check spacing — skip if too close to existing stub
      let tooClose = false;
      for (const existing of stubs) {
        if (Math.hypot(fromGX - existing.x, fromGZ - existing.z) < MIN_STUB_SPACING) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Check if inside a roundabout zone — skip
      let inRoundabout = false;
      for (const j of junctions) {
        if (Math.hypot(fromGX - j.x, fromGZ - j.z) < j.radius + 5) {
          inRoundabout = true;
          break;
        }
      }
      if (inRoundabout) continue;

      // Vary length: 20-35 based on position for visual variety
      const stubLen = 20 + Math.round(((Math.abs(fromGX * 7 + fromGZ * 13)) % 15));

      stubs.push({
        x: Math.round(fromGX * 10) / 10,
        z: Math.round(fromGZ * 10) / 10,
        angle: Math.round(angle * 1000) / 1000,
        length: stubLen,
      });
    }
  }

  // Limit to 20 stubs
  const finalStubs = stubs.slice(0, 20);

  console.log(`\nDetected ${junctions.length} junctions, ${finalStubs.length} side-road stubs`);
  for (const j of junctions) console.log(`  Junction: ${j.name} at (${j.x}, ${j.z}) r=${j.radius}`);

  return { junctions, sideRoads: finalStubs };
}

// ── Write routeData.js ─────────────────────────────────────────────────────

function writeRouteData(route, stops, junctions = [], sideRoads = []) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of route) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const bounds = {
    minX: Math.floor(minX - BOUNDS_PADDING),
    maxX: Math.ceil(maxX + BOUNDS_PADDING),
    minZ: Math.floor(minZ - BOUNDS_PADDING),
    maxZ: Math.ceil(maxZ + BOUNDS_PADDING),
  };

  const routeLines = [];
  for (let i = 0; i < route.length; i += 5) {
    const chunk = route.slice(i, i + 5);
    routeLines.push('  ' + chunk.map(([x, z]) => `[${x}, ${z}]`).join(', ') + ',');
  }

  const stopLines = stops.map((s) => `  { i: ${s.idx}, n: '${s.name.replace(/'/g, "\\'")}' },`);

  const junctionLines = junctions.map((j) =>
    `  { x: ${j.x}, z: ${j.z}, radius: ${j.radius}, name: '${j.name.replace(/'/g, "\\'")}', arms: ${j.arms} },`
  );

  const stubLines = sideRoads.map((s) =>
    `  { x: ${s.x}, z: ${s.z}, angle: ${s.angle}, length: ${s.length} },`
  );

  const output = `// Auto-generated by scripts/generate-route.mjs — do not edit manually
// Source: OpenStreetMap Overpass API (Westminster Loop, Central London)
// Generated: ${new Date().toISOString()}

export const ROUTE = [
${routeLines.join('\n')}
];

export const STOPS = [
${stopLines.join('\n')}
];

export const BOUNDS = {
  minX: ${bounds.minX},
  maxX: ${bounds.maxX},
  minZ: ${bounds.minZ},
  maxZ: ${bounds.maxZ},
};

export const JUNCTIONS = [
${junctionLines.join('\n')}
];

export const SIDE_ROADS = [
${stubLines.join('\n')}
];

export function newPax() {
  var p = [];
  for (var i = 0; i < STOPS.length - 1; i++) {
    var c = 1 + Math.floor(Math.random() * 3);
    for (var j = 0; j < c; j++) {
      var d = i + 1 + Math.floor(Math.random() * (STOPS.length - i - 1));
      p.push({ origin: i, dest: Math.min(d, STOPS.length - 1), on: false, done: false });
    }
  }
  return p;
}
`;

  writeFileSync(OUTPUT_FILE, output);
  console.log(`\nWrote ${OUTPUT_FILE}`);
  console.log(`  ${route.length} waypoints, ${stops.length} stops`);
  console.log(`  BOUNDS: X [${bounds.minX}, ${bounds.maxX}], Z [${bounds.minZ}, ${bounds.maxZ}]`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Westminster Loop Route Generator (v2 — graph-based) ===\n');

  // 1. Fetch OSM data (all driveable roads)
  const osmData = await getOsmData();

  // 2. Build road graph
  const { nodes, adj, busStops } = buildGraph(osmData);

  // 3. Find connected route through waypoints using Dijkstra
  const { routeLatLng, streetLabels: rawStreetLabels, fullNodePath } = buildRoute(nodes, adj);

  if (routeLatLng.length < 10) {
    console.error('ERROR: Too few route points. Check waypoint coordinates.');
    process.exit(1);
  }

  // 4. Project to game coordinates
  const { gameRoute, gameStops, scale, cx, cz, cosLat, lat0, lng0 } = projectToGameCoords(routeLatLng, busStops);

  // 5a. Remove backtracking from the full-resolution route BEFORE resampling.
  //     Dijkstra paths through dual carriageways and roundabouts create sharp turns.
  //     Remove any point where the angle between incoming and outgoing segments > 90°.
  let cleanRoute = [...gameRoute];
  let cleanLabels = [...rawStreetLabels];
  let cleanPass = true;
  while (cleanPass) {
    cleanPass = false;
    const toRemove = new Set();
    for (let i = 1; i < cleanRoute.length - 1; i++) {
      if (toRemove.has(i)) continue;
      const [ax, az] = cleanRoute[i - 1];
      const [bx, bz] = cleanRoute[i];
      const [cx, cz] = cleanRoute[i + 1];
      const abx = bx - ax, abz = bz - az;
      const bcx = cx - bx, bcz = cz - bz;
      const dot = abx * bcx + abz * bcz;
      const magAB = Math.hypot(abx, abz);
      const magBC = Math.hypot(bcx, bcz);
      if (magAB < 0.01 || magBC < 0.01) { toRemove.add(i); cleanPass = true; continue; }
      const cosAngle = dot / (magAB * magBC);
      if (cosAngle < 0) { toRemove.add(i); cleanPass = true; }
    }
    if (toRemove.size > 0) {
      console.log(`  Removing ${toRemove.size} backtracking points from raw route`);
      cleanRoute = cleanRoute.filter((_, i) => !toRemove.has(i));
      cleanLabels = cleanLabels.filter((_, i) => !toRemove.has(i));
    }
  }
  // Also remove duplicate consecutive points
  {
    const deduped = [cleanRoute[0]];
    const dedupedLabels = [cleanLabels[0]];
    for (let i = 1; i < cleanRoute.length; i++) {
      if (Math.hypot(cleanRoute[i][0] - deduped[deduped.length - 1][0], cleanRoute[i][1] - deduped[deduped.length - 1][1]) > 0.5) {
        deduped.push(cleanRoute[i]);
        dedupedLabels.push(cleanLabels[i]);
      }
    }
    cleanRoute = deduped;
    cleanLabels = dedupedLabels;
  }
  console.log(`After backtrack removal: ${gameRoute.length} -> ${cleanRoute.length} points`);

  // 5b. Simplify by uniform re-sampling with interpolation.
  //    Walk the cleaned route polyline, emit a point every SAMPLE_INTERVAL game units.
  //    Interpolates along edges so no gap exceeds the interval.
  const SAMPLE_INTERVAL = 25; // game units between waypoints

  // First, compute cumulative arc-length at each raw point
  const cumLen = [0];
  for (let i = 1; i < cleanRoute.length; i++) {
    const d = Math.hypot(
      cleanRoute[i][0] - cleanRoute[i - 1][0],
      cleanRoute[i][1] - cleanRoute[i - 1][1]
    );
    cumLen.push(cumLen[i - 1] + d);
  }
  const totalLen = cumLen[cumLen.length - 1];
  console.log(`\nTotal route path length: ${totalLen.toFixed(1)} game units`);

  // Sample at uniform arc-length intervals
  let finalRoute = [cleanRoute[0]];
  let segIdx = 0; // current segment index in the polyline
  for (let dist = SAMPLE_INTERVAL; dist < totalLen; dist += SAMPLE_INTERVAL) {
    // Find which segment contains this distance
    while (segIdx < cleanRoute.length - 2 && cumLen[segIdx + 1] < dist) segIdx++;
    // Interpolate within segment
    const segStart = cumLen[segIdx];
    const segEnd = cumLen[segIdx + 1];
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (dist - segStart) / segLen : 0;
    finalRoute.push([
      Math.round((cleanRoute[segIdx][0] + t * (cleanRoute[segIdx + 1][0] - cleanRoute[segIdx][0])) * 10) / 10,
      Math.round((cleanRoute[segIdx][1] + t * (cleanRoute[segIdx + 1][1] - cleanRoute[segIdx][1])) * 10) / 10,
    ]);
  }
  // Always include the last point
  const lastFull = cleanRoute[cleanRoute.length - 1];
  const lastSampled = finalRoute[finalRoute.length - 1];
  if (Math.hypot(lastFull[0] - lastSampled[0], lastFull[1] - lastSampled[1]) > 1) {
    finalRoute.push(lastFull);
  }
  console.log(`Sampled: ${cleanRoute.length} -> ${finalRoute.length} waypoints (interval=${SAMPLE_INTERVAL})`);

  // Map simplified waypoints back to street labels
  const simplifiedStreetLabels = finalRoute.map(([x, z]) => {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < cleanRoute.length; i++) {
      const d = Math.hypot(x - cleanRoute[i][0], z - cleanRoute[i][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return cleanLabels[bestIdx] || 'Unknown';
  });

  // 6. Close the loop
  finalRoute = closeLoop(finalRoute);
  simplifiedStreetLabels.push(simplifiedStreetLabels[0]);

  // 7. Match bus stops
  console.log('\nMatching bus stops...');
  let matchedStops = matchBusStops(finalRoute, gameStops, STOP_MATCH_RADIUS);
  console.log(`  Matched ${matchedStops.length} stops within ${STOP_MATCH_RADIUS} game units`);

  assignStreetNames(matchedStops, simplifiedStreetLabels);

  // Synthesize stops if too few
  if (matchedStops.length < 6) {
    console.log('  Too few OSM stops matched, synthesizing from street names...');
    const routeLen = finalRoute.length;
    const interval = Math.floor(routeLen / 8);
    const synthetic = [];
    for (let i = 0; i < routeLen - 1; i += interval) {
      synthetic.push({ idx: i, name: `Stop ${i}` });
    }
    assignStreetNames(synthetic, simplifiedStreetLabels);

    const allIndices = new Set(matchedStops.map((s) => s.idx));
    for (const s of synthetic) {
      if (!allIndices.has(s.idx)) {
        matchedStops.push(s);
        allIndices.add(s.idx);
      }
    }
    matchedStops.sort((a, b) => a.idx - b.idx);

    const spaced = [matchedStops[0]];
    for (let i = 1; i < matchedStops.length; i++) {
      const last = spaced[spaced.length - 1];
      const d = dist2d(
        finalRoute[matchedStops[i].idx][0], finalRoute[matchedStops[i].idx][1],
        finalRoute[last.idx][0], finalRoute[last.idx][1]
      );
      if (d >= MIN_STOP_SPACING) spaced.push(matchedStops[i]);
    }
    matchedStops = spaced.slice(0, 10);
  }

  deduplicateStopNames(matchedStops);

  for (const s of matchedStops) {
    console.log(`  [${s.idx}] ${s.name}`);
  }

  // 8. Detect junctions & side-road stubs
  const { junctions, sideRoads } = detectJunctionsAndStubs(
    nodes, adj, fullNodePath, finalRoute, routeLatLng, scale, cx, cz, cosLat, lat0, lng0
  );

  // 9. Write output
  writeRouteData(finalRoute, matchedStops, junctions, sideRoads);

  // 9. Validate — check max distance between consecutive waypoints
  console.log('\nRoute validation:');
  let maxGap = 0;
  for (let i = 1; i < finalRoute.length; i++) {
    const d = dist2d(finalRoute[i][0], finalRoute[i][1], finalRoute[i - 1][0], finalRoute[i - 1][1]);
    if (d > maxGap) maxGap = d;
    if (d > 30) {
      console.log(`  WARNING: Gap of ${d.toFixed(1)} game units between waypoints ${i - 1} and ${i}`);
    }
  }
  console.log(`  Max gap between consecutive waypoints: ${maxGap.toFixed(1)} game units`);
  if (maxGap < 30) {
    console.log('  ✓ All gaps under 30 game units — route is well-connected!');
  }

  console.log('\nDone! Run the game to test the new route.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
