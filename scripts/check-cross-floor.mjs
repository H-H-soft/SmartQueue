import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function load(path) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const [{ floorTwoBuilding }, { connectAiriFloors }, { findRoute, edgeCost }] = await Promise.all([
  load('../src/data/airi-floor-2.ts'), load('../src/data/connect-floors.ts'), load('../src/routing/findRoute.ts'),
]);
const ground = JSON.parse(fs.readFileSync(new URL('../src/data/airi-ground-floor.json', import.meta.url)));
const building = connectAiriFloors(ground, floorTwoBuilding);
const nodes = new Map(building.nodes.map(n => [n.id, n]));
const lower = building.nodes.filter(n => n.floor === 'airi-ground' && n.label);
const upper = building.nodes.filter(n => n.floor === 'airi-floor-2' && n.label);
let checked = 0;
for (const profile of ['standard', 'wheelchair', 'visual', 'reduced']) {
  for (const a of lower) for (const b of upper) for (const [from, to] of [[a, b], [b, a]]) {
    const route = findRoute(building, from.id, to.id, profile);
    assert(route, `${profile}: ${from.id} -> ${to.id}`);
    const transitions = route.steps.filter(s => s.toFloor);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].fromFloor, from.floor);
    assert.equal(transitions[0].toFloor, to.floor);
    if (profile === 'wheelchair') assert.equal(transitions[0].action, 'elevator');
    assert.equal(route.distanceUnit, 'schematic');
    assert.equal(route.estimatedSeconds, undefined);
    for (const step of route.steps) {
      if (step.pathNodeIds) assert.equal(new Set(step.pathNodeIds.map(id => nodes.get(id).floor)).size, 1);
    }
    // Independently try every eligible connector, using shortest same-floor legs.
    let best = Infinity;
    for (const edge of building.edges.filter(e => nodes.get(e.from).floor !== nodes.get(e.to).floor)) {
      const cost = edgeCost(edge, profile);
      if (cost === null) continue;
      const entry = nodes.get(edge.from).floor === from.floor ? edge.from : edge.to;
      const exit = entry === edge.from ? edge.to : edge.from;
      const first = findRoute(building, from.id, entry, profile);
      const last = findRoute(building, exit, to.id, profile);
      if (!first || !last) continue;
      function weight(path) {
        return path.nodePath.slice(1).reduce((sum, id, i) => {
          const prev = path.nodePath[i];
          const e = building.edges.find(e => e.from === prev && e.to === id || e.to === prev && e.from === id);
          return sum + edgeCost(e, profile);
        }, 0);
      }
      best = Math.min(best, weight(first) + cost + weight(last));
    }
    const actual = route.nodePath.slice(1).reduce((sum, id, i) => {
      const prev = route.nodePath[i];
      const edge = building.edges.find(e => e.from === prev && e.to === id || e.to === prev && e.from === id);
      return sum + edgeCost(edge, profile);
    }, 0);
    assert(Math.abs(actual - best) < 1e-7, 'Did not choose the lowest eligible connector cost');
    checked++;
  }
}
for (const group of [lower, upper]) for (const a of group) for (const b of group) {
  const route = findRoute(building, a.id, b.id, 'standard');
  assert(route.nodePath.every(id => nodes.get(id).floor === a.floor), 'Same-floor route must not leave the floor');
}
const unavailable = { ...building, edges: building.edges.map(e => e.mode === 'elevator' ? { ...e, status: 'out_of_service' } : e) };
assert.equal(findRoute(unavailable, 'scan-11', 'f2-room-l101', 'wheelchair'), null);
assert(findRoute(unavailable, 'scan-11', 'f2-room-l101', 'standard'));
assert.equal(findRoute(building, 'scan-180', 'f2-room-l101', 'standard'), null);
// New ground-floor approach segments must not intersect the existing scan outline.
const svg = fs.readFileSync(new URL('../public/maps/airi-ground-floor.svg', import.meta.url), 'utf8');
const walls = [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map(m => m.slice(1).map(Number));
const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
for (const e of building.edges.filter(e => e.mode === 'walk' && (e.from.startsWith('g-') || e.to.startsWith('g-')))) {
  const na = nodes.get(e.from), nb = nodes.get(e.to), a = [na.x, na.y], b = [nb.x, nb.y];
  assert(!walls.some(w => {
    const c = w.slice(0,2), d = w.slice(2);
    return cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0;
  }), `Approach crosses outline: ${e.from} -> ${e.to}`);
}
console.log(`${checked} cross-floor routes passed in both directions across four profiles; connector choice, lift outage, step boundaries, and same-floor isolation verified.`);
