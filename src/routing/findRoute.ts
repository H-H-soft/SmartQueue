import type {
  AccessibilityProfile,
  Building,
  Edge,
  Route,
  RouteStep,
} from '../types';

// ---------- Reguli de accesibilitate ----------

const WHEELCHAIR_MIN_WIDTH = 0.9; // metri
const WHEELCHAIR_MAX_SLOPE = 8;   // procente

// Viteza medie de deplasare (m/s), pentru estimarea timpului
const SPEED: Record<AccessibilityProfile, number> = {
  standard: 1.3,
  wheelchair: 1.0,
  visual: 0.8,
  reduced: 0.7,
};

const VERTICAL_TRANSITION_SECONDS = 20; // așteptare lift / urcat scări

/**
 * Costul unei muchii pentru un profil.
 * Returnează null dacă muchia nu poate fi folosită deloc de acel profil.
 */
export function edgeCost(edge: Edge, profile: AccessibilityProfile): number | null {
  if (edge.status === 'out_of_service') return null;

  if (profile === 'wheelchair') {
    if (!edge.stepFree || edge.mode === 'stairs') return null;
    if (edge.minWidth !== undefined && edge.minWidth < WHEELCHAIR_MIN_WIDTH) return null;
    if (edge.slope !== undefined && edge.slope > WHEELCHAIR_MAX_SLOPE) return null;
  }

  let cost = edge.distance;
  if (profile === 'reduced' && edge.mode === 'stairs') cost *= 5; // scările sunt obositoare
  if (profile === 'visual' && edge.mode === 'stairs') cost *= 2;  // preferăm liftul
  return cost;
}

// ---------- Graf și Dijkstra ----------

interface Neighbor {
  to: string;
  edge: Edge;
  cost: number;
}

function buildAdjacency(building: Building, profile: AccessibilityProfile) {
  const adj = new Map<string, Neighbor[]>();
  const add = (a: string, b: string, edge: Edge, cost: number) => {
    const list = adj.get(a) ?? [];
    list.push({ to: b, edge, cost });
    adj.set(a, list);
  };
  for (const edge of building.edges) {
    const cost = edgeCost(edge, profile);
    if (cost === null) continue;
    add(edge.from, edge.to, edge, cost);
    add(edge.to, edge.from, edge, cost);
  }
  return adj;
}

type Adjacency = ReturnType<typeof buildAdjacency>;
const adjacencyCache = new WeakMap<Building, Map<AccessibilityProfile, Adjacency>>();

function getAdjacency(building: Building, profile: AccessibilityProfile): Adjacency {
  let byProfile = adjacencyCache.get(building);
  if (!byProfile) {
    byProfile = new Map();
    adjacencyCache.set(building, byProfile);
  }

  let adjacency = byProfile.get(profile);
  if (!adjacency) {
    adjacency = buildAdjacency(building, profile);
    byProfile.set(profile, adjacency);
  }
  return adjacency;
}

interface QueueItem {
  node: string;
  distance: number;
}

function push(queue: QueueItem[], item: QueueItem) {
  let index = queue.length;
  queue.push(item);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (queue[parent].distance <= item.distance) break;
    queue[index] = queue[parent];
    index = parent;
  }
  queue[index] = item;
}

function pop(queue: QueueItem[]): QueueItem | undefined {
  const first = queue[0];
  const last = queue.pop();
  if (!first || !last || queue.length === 0) return first;

  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= queue.length) break;
    const child = right < queue.length && queue[right].distance < queue[left].distance
      ? right
      : left;
    if (queue[child].distance >= last.distance) break;
    queue[index] = queue[child];
    index = child;
  }
  queue[index] = last;
  return first;
}

function dijkstra(adj: Map<string, Neighbor[]>, start: string, goal: string) {
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { node: string; edge: Edge }>();
  const queue: QueueItem[] = [{ node: start, distance: 0 }];

  while (queue.length > 0) {
    const current = pop(queue)!;
    if (current.distance !== dist.get(current.node)) continue;
    if (current.node === goal) break;

    for (const n of adj.get(current.node) ?? []) {
      const nd = current.distance + n.cost;
      if (nd < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, nd);
        prev.set(n.to, { node: current.node, edge: n.edge });
        push(queue, { node: n.to, distance: nd });
      }
    }
  }

  if (!dist.has(goal)) return null; // nu există traseu pentru acest profil

  const nodePath = [goal];
  const edges: Edge[] = [];
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur)!;
    edges.unshift(p.edge);
    nodePath.unshift(p.node);
    cur = p.node;
  }
  return { nodePath, edges };
}

// ---------- Din traseu în instrucțiuni ----------

interface Vec {
  x: number;
  y: number;
}

function turnDirection(prev: Vec, next: Vec): 'left' | 'right' | 'straight' | 'back' {
  const dot = prev.x * next.x + prev.y * next.y;
  const cross = prev.x * next.y - prev.y * next.x;
  // Pe ecran axa y merge în jos, deci unghi pozitiv = viraj la dreapta
  const angle = (Math.atan2(cross, dot) * 180) / Math.PI;
  const abs = Math.abs(angle);
  if (abs < 30) return 'straight';
  if (abs > 150) return 'back';
  return angle > 0 ? 'right' : 'left';
}

function buildSteps(building: Building, nodePath: string[], edges: Edge[]): RouteStep[] {
  const nodes = new Map(building.nodes.map((n) => [n.id, n]));
  const floors = new Map(building.floors.map((f) => [f.id, f]));
  const landmarkAt = (nodeId: string) =>
    building.landmarks.find((l) => l.nodeId === nodeId)?.text;

  const steps: RouteStep[] = [];
  let nextId = 1;
  let walkDistance = 0;
  let walkEndNode = '';
  let lastVec: Vec | null = null;

  const flushWalk = () => {
    if (walkDistance <= 0) return;
    const meters = Math.round(walkDistance);
    steps.push({
      id: nextId++,
      action: 'walk',
      distance: meters,
      text: `Mergi înainte ${meters} metri`,
      landmark: landmarkAt(walkEndNode),
      nodeId: walkEndNode,
    });
    walkDistance = 0;
  };

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const a = nodes.get(nodePath[i])!;
    const b = nodes.get(nodePath[i + 1])!;

    if (
      edge.mode === 'elevator' ||
      edge.mode === 'stairs' ||
      (edge.mode === 'ramp' && a.floor !== b.floor)
    ) {
      flushWalk();
      lastVec = null;
      const floorName = floors.get(b.floor)?.name ?? b.floor;
      const action = edge.mode;
      steps.push({
        id: nextId++,
        action,
        text:
          action === 'elevator'
            ? `Ia ${a.label ?? 'liftul'} până la ${floorName}`
            : action === 'stairs'
              ? `Folosește scările până la ${floorName}`
              : `Folosește rampa până la ${floorName}`,
        toFloor: b.floor,
        nodeId: b.id,
      });
      continue;
    }

    const vec: Vec = { x: b.x - a.x, y: b.y - a.y };
    if (lastVec) {
      const dir = turnDirection(lastVec, vec);
      if (dir !== 'straight') {
        flushWalk();
        steps.push({
          id: nextId++,
          action: 'turn',
          direction: dir,
          text:
            dir === 'left' ? 'Virează la stânga'
            : dir === 'right' ? 'Virează la dreapta'
            : 'Întoarce-te',
          nodeId: a.id,
        });
      }
    }
    walkDistance += edge.distance;
    walkEndNode = b.id;
    lastVec = vec;
  }
  flushWalk();

  const dest = nodes.get(nodePath[nodePath.length - 1])!;
  steps.push({
    id: nextId++,
    action: 'arrive',
    text: `Ai ajuns la ${dest.label ?? 'destinație'}`,
    nodeId: dest.id,
  });

  return steps;
}

// ---------- Funcția principală ----------

/**
 * Calculează traseul între două noduri, după profilul de accesibilitate.
 * Returnează null dacă nu există niciun traseu posibil pentru profilul ales.
 */
export function findRoute(
  building: Building,
  fromId: string,
  toId: string,
  profile: AccessibilityProfile = 'standard',
): Route | null {
  const known = new Set(building.nodes.map((n) => n.id));
  if (!known.has(fromId) || !known.has(toId)) return null;

  const adj = getAdjacency(building, profile);
  const result = dijkstra(adj, fromId, toId);
  if (!result) return null;

  const { nodePath, edges } = result;
  const totalDistance = edges.reduce((sum, e) => sum + e.distance, 0);
  const verticalMoves = edges.filter((e) => e.mode === 'elevator' || e.mode === 'stairs').length;
  const estimatedSeconds = Math.round(
    totalDistance / SPEED[profile] + verticalMoves * VERTICAL_TRANSITION_SECONDS,
  );

  return {
    from: fromId,
    to: toId,
    profile,
    steps: buildSteps(building, nodePath, edges),
    nodePath,
    totalDistance,
    estimatedSeconds,
  };
}
