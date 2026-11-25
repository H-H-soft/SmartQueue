import type { Building, GraphNode } from '../types';

// Screenshot-derived coordinates in airi-floor-2.svg, not surveyed meters.
const points: [string, number, number, string?, GraphNode['type']?][] = [
  ['lifts', 399, 159, 'Lifturi · hol central', 'elevator'],
  ['stone-stairs', 369, 207, undefined, 'stairs'],
  ['atrium-stairs', 468, 151, 'Parcare', 'stairs'],
  ['hall-north', 420, 110, 'Hol central · zona vitrată'],
  ['hall', 420, 213, 'Hol central · intersecție'],
  ['hall-south', 390, 283, 'Hol central · capăt sud'],
  ['lift-junction', 420, 159],
  ['south-junction', 390, 213],
  ['west-entry', 285, 205, 'Aripa stângă · acces'],
  ['west-ne', 187, 183], ['west-nw', 57, 183],
  ['west-sw', 57, 289, 'Aripa stângă · colț exterior'],
  ['west-se', 187, 289, 'Aripa stângă · colț interior'],
  ['west-junction', 187, 205],
  ['bridge', 600, 219],
  ['east-entry', 750, 216],
  ['east-nw', 837, 216],
  ['east-door-junction', 916, 216],
  ['enclosed-stairs', 916, 223, 'Ușă scară închisă · aripa dreaptă', 'stairs'],
  ['east-ne', 968, 216],
  ['east-se', 968, 320],
  ['east-sw', 837, 320],
  // Corridor-side door approaches inferred from the recording; not room interiors.
  ['s108-junction', 510, 216],
  ['s109-junction', 650, 218],
  ['s110-junction', 700, 217],
  ['l103-junction', 775, 216],
  ['l102-junction', 890, 216],
  ['room-s108', 510, 229, 'S 108', 'room'],
  ['room-s109', 650, 232, 'S 109', 'room'],
  ['room-s110', 700, 232, 'S 110', 'room'],
  ['room-l103', 775, 202, 'L 103 · Vodafone Innovation Hub', 'room'],
  ['room-l102', 890, 202, 'L 102', 'room'],
  ['room-l101', 977, 240, 'L 101', 'room'],
];
const nodes: GraphNode[] = points.map(([id, x, y, label, type]) => ({
  id: `f2-${id}`, floor: 'airi-floor-2', x, y, label, type: type ?? 'junction',
}));
const links = [
  ['lifts', 'lift-junction'], ['stone-stairs', 'south-junction'],
  ['atrium-stairs', 'lift-junction'], ['hall-north', 'lift-junction'],
  ['lift-junction', 'hall'], ['hall', 'south-junction'],
  ['south-junction', 'hall-south'], ['south-junction', 'west-entry'],
  ['west-entry', 'west-junction'], ['west-junction', 'west-ne'],
  ['west-ne', 'west-nw'], ['west-nw', 'west-sw'],
  ['west-sw', 'west-se'], ['west-se', 'west-junction'],
  ['hall', 's108-junction'], ['s108-junction', 'bridge'],
  ['bridge', 's109-junction'], ['s109-junction', 's110-junction'],
  ['s110-junction', 'east-entry'], ['east-entry', 'l103-junction'],
  ['l103-junction', 'east-nw'], ['east-nw', 'l102-junction'],
  ['l102-junction', 'east-door-junction'], ['east-door-junction', 'enclosed-stairs'],
  ['east-door-junction', 'east-ne'], ['east-ne', 'east-se'],
  ['east-se', 'east-sw'], ['east-sw', 'east-nw'],
  ['s108-junction', 'room-s108'], ['s109-junction', 'room-s109'],
  ['s110-junction', 'room-s110'], ['l103-junction', 'room-l103'],
  ['l102-junction', 'room-l102'], ['east-ne', 'room-l101'],
];
export const floorTwoBuilding: Building = {
  id: 'airi-utcn', name: 'AIRI @ UTCN',
  floors: [{ id: 'airi-floor-2', level: 1, name: 'Floor 2 · Etajul 1',
    plan: '/maps/airi-floor-2.svg', width: 1000, height: 420,
    distanceUnit: 'schematic', overviewBounds: { x: 15, y: 30, width: 985, height: 380 } }],
  nodes,
  edges: links.map(([a, b]) => {
    const from = nodes.find(n => n.id === `f2-${a}`)!;
    const to = nodes.find(n => n.id === `f2-${b}`)!;
    return { from: from.id, to: to.id, distance: Math.hypot(to.x - from.x, to.y - from.y), mode: 'walk', stepFree: null, wheelchairAllowedByUser: true };
  }),
  landmarks: nodes.filter(n => n.label).map(n => ({ nodeId: n.id, text: n.label! })),
};
