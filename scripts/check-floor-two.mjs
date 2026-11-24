import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function load(relative) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { floorTwoBuilding: building } = await load('../src/data/airi-floor-2.ts');
const { findRoute } = await load('../src/routing/findRoute.ts');
const nodes = building.nodes;
const index = new Map(nodes.map((n, i) => [n.id, i]));
const evidence = JSON.parse(fs.readFileSync(new URL('../src/data/room-video-evidence.json', import.meta.url)));
const mappedRooms = evidence.rooms.filter(r => r.status === 'mapped_approximately');
assert.equal(mappedRooms.length, 6);
for (const room of mappedRooms) {
  const node = nodes[index.get(room.nodeId)];
  assert(node && node.type === 'room' && node.label.startsWith(room.number), `Missing room ${room.number}`);
  assert.equal(building.edges.filter(e => e.from === node.id || e.to === node.id).length, 1, 'Rooms must be destinations, not corridor shortcuts');
}
// Independently compute all-pairs minimum costs to verify Dijkstra on both loops.
const costs = nodes.map((_, i) => nodes.map((_, j) => i === j ? 0 : Infinity));
for (const e of building.edges) {
  const i = index.get(e.from), j = index.get(e.to);
  assert(i !== undefined && j !== undefined);
  costs[i][j] = costs[j][i] = e.distance;
}
for (let k = 0; k < nodes.length; k++) for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
  costs[i][j] = Math.min(costs[i][j], costs[i][k] + costs[k][j]);
}
const landmarks = nodes.filter(n => n.label);
let pairs = 0;
for (const a of landmarks) for (const b of landmarks) {
  const route = findRoute(building, a.id, b.id, 'standard');
  assert(route, `${a.id} cannot reach ${b.id}`);
  assert(Math.abs(route.totalDistance - costs[index.get(a.id)][index.get(b.id)]) < 1e-7);
  const wheelchair = findRoute(building, a.id, b.id, 'wheelchair');
  assert(wheelchair);
  assert.equal(wheelchair.totalDistance, route.totalDistance);
  pairs++;
}
// Read the actual schematic footprint (M/H/V/L/Z) including its two courtyard holes.
const svg = fs.readFileSync(new URL('../public/maps/airi-floor-2.svg', import.meta.url), 'utf8');
const path = svg.match(/fill-rule="evenodd" d="([^"]+)"/)[1];
const tokens = path.match(/[MHVLZ]|-?\d+(?:\.\d+)?/g);
const polygons = []; let polygon = [], x = 0, y = 0;
for (let i = 0; i < tokens.length;) {
  const command = tokens[i++];
  if (command === 'Z') { polygons.push(polygon); polygon = []; continue; }
  if (command === 'M' || command === 'L') { x = +tokens[i++]; y = +tokens[i++]; }
  else if (command === 'H') x = +tokens[i++];
  else if (command === 'V') y = +tokens[i++];
  else throw new Error(`Unexpected path command ${command}`);
  polygon.push([x, y]);
}
function inside(px, py, p) {
  let result = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, ay] = p[i], [bx, by] = p[j];
    if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}
for (const edge of building.edges) {
  const a = nodes[index.get(edge.from)], b = nodes[index.get(edge.to)];
  const samples = Math.ceil(edge.distance * 2);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
    assert(polygons.filter(p => inside(px, py, p)).length % 2 === 1, `Outside corridor: ${edge.from}–${edge.to}`);
    assert(!(px > 351 && px < 388 && py > 116 && py < 203), 'Route enters stone stairwell void');
    assert(!(px > 475 && px < 550 && py > 130 && py < 188), 'Route crosses atrium stairs');
  }
}
console.log(`${landmarks.length} landmarks; ${pairs} shortest-path comparisons passed; ${building.edges.length} edges stay inside schematic corridors. Accessibility remains unverified.`);
