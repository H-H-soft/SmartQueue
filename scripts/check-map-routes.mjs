import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const building = JSON.parse(fs.readFileSync(new URL('../src/data/airi-ground-floor.json', import.meta.url)));
const svg = fs.readFileSync(new URL('../public/maps/airi-ground-floor.svg', import.meta.url), 'utf8');
const walls = [...svg.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)].map(m => m.slice(1).map(Number));
const nodes = new Map(building.nodes.map(n => [n.id, n]));
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersects(a, b, wall) {
  const c = wall.slice(0, 2), d = wall.slice(2);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
for (const edge of building.edges) {
  const a = nodes.get(edge.from), b = nodes.get(edge.to);
  assert(a && b, `Missing endpoint: ${edge.from}–${edge.to}`);
  assert(!walls.some(w => intersects([a.x, a.y], [b.x, b.y], w)), `Scan outline intersection: ${edge.from}–${edge.to}`);
  assert(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) / 10 - edge.distance) < 0.011, 'Incorrect segment distance');
}
// Exercise the real routing implementation without adding a test runner dependency.
const source = fs.readFileSync(new URL('../src/routing/findRoute.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { findRoute, edgeCost } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const destinations = building.nodes.filter(n => n.label);
let pairs = 0;
for (const from of destinations) for (const to of destinations) {
  if (from.id === to.id) continue;
  assert(findRoute(building, from.id, to.id, 'standard'), `Unreachable landmark: ${from.id}–${to.id}`);
  assert(findRoute(building, from.id, to.id, 'wheelchair'), `Wheelchair corridor unavailable: ${from.id}–${to.id}`);
  pairs++;
}
assert.equal(findRoute(building, 'scan-11', 'scan-180', 'standard'), null, 'Do not invent access to the disconnected west wing');
assert(building.edges.every(e => e.stepFree === null), 'Routing preferences must not claim verified accessibility');
const corridor = { from: 'a', to: 'b', mode: 'walk', distance: 5, stepFree: null, wheelchairAllowedByUser: true };
assert.equal(edgeCost(corridor, 'wheelchair'), 5);
for (const restriction of [{ mode: 'stairs' }, { stepFree: false }, { minWidth: 0.7 }, { slope: 12 }, { status: 'out_of_service' }, { wheelchairAllowedByUser: false }]) {
  assert.equal(edgeCost({ ...corridor, ...restriction }, 'wheelchair'), null, JSON.stringify(restriction));
}
const atrium = findRoute(building, 'scan-23', 'scan-25', 'standard');
assert.deepEqual(atrium.nodePath, ['scan-23', 'scan-24', 'scan-25']);
const west = findRoute(building, 'scan-33', 'scan-179', 'standard');
assert.deepEqual(west.nodePath, ['scan-33', 'scan-32', 'scan-179']);
console.log(`${building.edges.length} edges checked; ${pairs} landmark routes reachable; both suspect shortcuts detour correctly. Scan intersections are a regression check, not proof of real-world clearance.`);
