import type { Building, Edge, GraphNode } from '../types';

/** Join the user-identified landings. Approach positions are schematic, not surveyed. */
export function connectAiriFloors(ground: Building, upper: Building): Building {
  const approaches: GraphNode[] = [
    { id: 'g-stone-stairs', floor: 'airi-ground', type: 'stairs', x: 289.7, y: 540, markerOffsetX: -19.7, label: 'Scara de piatră · parter' },
    { id: 'g-wing-stairs', floor: 'airi-ground', type: 'stairs', x: 565, y: 614, label: 'Scară închisă · aripa dreaptă' },
  ];
  const atriumStairs = ground.nodes.filter(n => n.id === 'g-atrium-stairs');
  // Keep existing landmark numbers; the new ground-floor stairs are point 12.
  const nodes = [...ground.nodes.filter(n => n.id !== 'g-atrium-stairs'), ...upper.nodes, ...approaches, ...atriumStairs];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const approachLinks: Edge[] = [['scan-26', 'g-stone-stairs'], ['scan-27', 'g-stone-stairs'], ['scan-17', 'g-wing-stairs']].map(([from, to]) => {
    const a = byId.get(from)!, b = byId.get(to)!;
    return { from, to, distance: Math.hypot(b.x - a.x, b.y - a.y) / 10, mode: 'walk', stepFree: null, wheelchairAllowedByUser: true };
  });
  const transitions: Edge[] = [
    { from: 'scan-26', to: 'f2-lifts', mode: 'elevator', distance: 0, routingCost: 80, stepFree: null, wheelchairAllowedByUser: true, transitionName: 'lifturile centrale' },
    { from: 'g-stone-stairs', to: 'f2-stone-stairs', mode: 'stairs', distance: 0, routingCost: 60, stepFree: false, transitionName: 'scara de piatră' },
    { from: 'g-atrium-stairs', to: 'f2-atrium-stairs', mode: 'stairs', distance: 0, routingCost: 60, stepFree: false, transitionName: 'scara de lemn a atriumului' },
    { from: 'g-wing-stairs', to: 'f2-enclosed-stairs', mode: 'stairs', distance: 0, routingCost: 60, stepFree: false, transitionName: 'scara închisă din aripa dreaptă' },
  ];
  // Compare both plans in approximate common drawing units. This is a routing
  // weight only: ground distances remain meters; upper coordinates are schematic.
  // 605 / 945 aligns the drawn widths of the two floor overviews. Transition
  // penalties express effort, not a measured lift wait or staircase length.
  return {
    ...ground,
    floors: [...ground.floors, ...upper.floors], nodes,
    edges: [
      ...[...ground.edges, ...approachLinks].map(e => ({ ...e, routingCost: e.distance * 10 })),
      ...upper.edges.map(e => ({ ...e, routingCost: e.distance * 605 / 945 })),
      ...transitions,
    ],
    landmarks: [...ground.landmarks, ...upper.landmarks, ...approaches.map(n => ({ nodeId: n.id, text: n.label! }))],
  };
}
