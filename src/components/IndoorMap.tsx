import { useId, useMemo, useState } from 'react';
import type { Building, Edge, GraphNode, Route } from '../types';
import './IndoorMap.css';

interface Props {
  building: Building;
  floorId: string;
  route: Route | null;
  activeNodeId?: string;
  startNodeId?: string;
  destinationNodeId?: string;
  currentStepIndex?: number;
  routeIsPreview?: boolean;
  onNodeSelect?: (nodeId: string) => void;
  locationLabel?: (node: GraphNode) => string;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;
const ZOOM_STEP = 0.2;
const VIEW_PADDING_X = 48;
const VIEW_PADDING_Y = 44;

function pointsAttribute(nodes: GraphNode[]) {
  return nodes.map((node) => `${node.x},${node.y}`).join(' ');
}

function largestConnectedComponent(nodes: GraphNode[], edges: Edge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const neighbors = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    neighbors.get(edge.from)?.push(edge.to);
    neighbors.get(edge.to)?.push(edge.from);
  }

  const visited = new Set<string>();
  let largest = new Set<string>();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const component = new Set<string>([node.id]);
    const pending = [node.id];
    visited.add(node.id);
    while (pending.length) {
      const current = pending.pop()!;
      for (const neighbor of neighbors.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        component.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (component.size > largest.size) largest = component;
  }
  return largest;
}

function shortestPathTree(nodes: GraphNode[], edges: Edge[], rootId?: string) {
  if (!rootId || nodes.length < 2) return [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const neighbors = new Map(nodes.map((node) => [node.id, [] as { nodeId: string; edge: Edge }[]]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    neighbors.get(edge.from)?.push({ nodeId: edge.to, edge });
    neighbors.get(edge.to)?.push({ nodeId: edge.from, edge });
  }

  const distances = new Map(nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const parentEdges = new Map<string, Edge>();
  const visited = new Set<string>();
  distances.set(rootId, 0);

  while (visited.size < nodes.length) {
    let current: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [nodeId, distance] of distances) {
      if (!visited.has(nodeId) && distance < bestDistance) {
        current = nodeId;
        bestDistance = distance;
      }
    }
    if (!current) break;
    visited.add(current);
    for (const { nodeId, edge } of neighbors.get(current) ?? []) {
      if (visited.has(nodeId)) continue;
      const candidate = bestDistance + edge.distance;
      if (candidate < (distances.get(nodeId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(nodeId, candidate);
        parentEdges.set(nodeId, edge);
      }
    }
  }

  return [...parentEdges.values()];
}

function pointsBounds(nodes: GraphNode[]) {
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const x = Math.min(...xs) - VIEW_PADDING_X;
  const y = Math.min(...ys) - VIEW_PADDING_Y;
  return {
    x,
    y,
    width: Math.max(...xs) - Math.min(...xs) + VIEW_PADDING_X * 2,
    height: Math.max(...ys) - Math.min(...ys) + VIEW_PADDING_Y * 2,
  };
}

function routeCamera(bounds: ReturnType<typeof pointsBounds>, routeNodes: GraphNode[], position: GraphNode | undefined, zoom: number) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  if (!position || routeNodes.length < 2) {
    return {
      rotation: 0,
      zoom,
      transform: `translate(${centerX * (1 - zoom)} ${centerY * (1 - zoom)}) scale(${zoom})`,
    };
  }

  const positionIndex = routeNodes.findIndex((node) => node.id === position.id);
  const next = positionIndex >= 0 ? routeNodes[positionIndex + 1] : undefined;
  if (!next) {
    return {
      rotation: 0,
      zoom,
      transform: `translate(${centerX * (1 - zoom)} ${centerY * (1 - zoom)}) scale(${zoom})`,
    };
  }

  const direction = Math.atan2(next.y - position.y, next.x - position.x);
  const rotation = -90 - (direction * 180) / Math.PI;
  const radians = (rotation * Math.PI) / 180;
  const routePoints = routeNodes.map((node) => {
    const dx = node.x - position.x;
    const dy = node.y - position.y;
    return {
      x: dx * Math.cos(radians) - dy * Math.sin(radians),
      y: dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  });
  const minX = Math.min(...routePoints.map((point) => point.x));
  const maxX = Math.max(...routePoints.map((point) => point.x));
  const minY = Math.min(...routePoints.map((point) => point.y));
  const maxY = Math.max(...routePoints.map((point) => point.y));
  const targetX = centerX;
  const targetY = bounds.y + bounds.height * 0.66;
  const inset = 32;
  const fitX = (bounds.width - inset * 2) / Math.max(1, maxX - minX);
  const fitAbove = minY < 0 ? (targetY - bounds.y - inset) / -minY : Number.POSITIVE_INFINITY;
  const fitBelow = maxY > 0 ? (bounds.y + bounds.height - inset - targetY) / maxY : Number.POSITIVE_INFINITY;
  const fittedZoom = Math.max(0.45, Math.min(1.15, fitX, fitAbove, fitBelow));
  const finalZoom = fittedZoom * zoom;

  return {
    rotation,
    zoom: finalZoom,
    transform: `translate(${targetX} ${targetY}) rotate(${rotation}) scale(${finalZoom}) translate(${-position.x} ${-position.y})`,
  };
}

export default function IndoorMap({ building, floorId, route, activeNodeId, startNodeId, destinationNodeId, currentStepIndex = 0, routeIsPreview = false, onNodeSelect, locationLabel }: Props) {
  const titleId = `map-${useId().replace(/:/g, '')}`;
  const [zoom, setZoom] = useState(1);
  const floor = building.floors.find((item) => item.id === floorId);
  const nodesById = useMemo(
    () => new Map(building.nodes.map((node) => [node.id, node])),
    [building],
  );

  const floorNodes = building.nodes.filter((node) => node.floor === floorId);
  const floorEdges = building.edges.filter((edge) => {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    return from?.floor === floorId && to?.floor === floorId;
  });
  const connectedIds = useMemo(
    () => largestConnectedComponent(floorNodes, floorEdges),
    [floorEdges, floorNodes],
  );
  const mapNodes = floorNodes.filter((node) => connectedIds.has(node.id));
  const connectedEdges = floorEdges.filter((edge) => connectedIds.has(edge.from) && connectedIds.has(edge.to));
  const mainEntrance = mapNodes.find((node) => node.type === 'entrance') ?? mapNodes[0];
  const mapEdges = useMemo(
    () => shortestPathTree(mapNodes, connectedEdges, mainEntrance?.id),
    [connectedEdges, mainEntrance?.id, mapNodes],
  );

  const routeNodes = useMemo(() => {
    if (!route) return [];
    return route.nodePath
      .map((id) => nodesById.get(id))
      .filter((node): node is GraphNode => node?.floor === floorId && connectedIds.has(node.id));
  }, [connectedIds, floorId, nodesById, route]);

  const start = nodesById.get(route?.from ?? startNodeId ?? activeNodeId ?? '');
  const destination = nodesById.get(route?.to ?? destinationNodeId ?? '');
  const turns = route?.steps
    .map((step, index) => ({ ...step, number: index + 1, node: nodesById.get(step.nodeId), active: index === currentStepIndex }))
    .filter((step) => step.action === 'turn')
    .filter((step) => step.node?.floor === floorId && connectedIds.has(step.node.id)) ?? [];
  const activeStep = route?.steps[currentStepIndex];
  const activePath = activeStep?.pathNodeIds
    ?.map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => node?.floor === floorId && connectedIds.has(node.id)) ?? [];
  const landmarks = mapNodes.filter((node) => node.label);
  const bounds = useMemo(() => pointsBounds(mapNodes), [mapNodes]);
  const scaleLength = Math.round((floor?.pixelsPerMeter ?? 10) * 5);
  const lastConfirmedId = currentStepIndex > 0
    ? route?.steps[Math.min(currentStepIndex - 1, (route?.steps.length ?? 1) - 1)]?.nodeId
    : startNodeId ?? activeNodeId;
  const userPosition = nodesById.get(lastConfirmedId ?? '');
  const camera = routeCamera(bounds, routeNodes, userPosition, zoom);
  const userPositionIndex = userPosition ? routeNodes.findIndex((node) => node.id === userPosition.id) : -1;
  const userNextNode = userPositionIndex >= 0 ? routeNodes[userPositionIndex + 1] : undefined;
  const userDirection = userNextNode
    ? (Math.atan2(userNextNode.y - userPosition!.y, userNextNode.x - userPosition!.x) * 180) / Math.PI + 90
    : 0;
  const mapLandmarks = landmarks.map((node, index) => ({
    node,
    label: locationLabel?.(node) ?? node.label ?? 'Reper',
    number: index + 1,
  }));

  if (!floor || mapNodes.length === 0) return null;

  return (
    <section className="map-panel" aria-label={`Hartă GPS interioară: ${floor.name}`}>
      <header className="map-panel__heading">
        <div>
          <span className="map-panel__kicker">HARTĂ GPS INTERIOARĂ · NIVEL 0</span>
          <h3>{floor.name}</h3>
          <p>{route ? 'Harta rotește drumul ca direcția următorului segment să fie mereu în sus.' : 'Alege reperul în care te afli și destinația; punctul albastru arată poziția selectată.'}</p>
        </div>
        <div className="map-zoom" role="group" aria-label="Mărire hartă">
          <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))} aria-label="Mărește harta">+</button>
          <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))} aria-label="Micșorează harta">−</button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Încadrează planul">Încadrează</button>
        </div>
      </header>

      <div className="map-scroll">
        <svg
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
          role={onNodeSelect ? 'group' : 'img'}
          aria-labelledby={titleId}
          className="indoor-map"
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={titleId}>{floor.name}: rețeaua de legături a turului virtual și cele {landmarks.length} destinații recunoscute.</title>
          <desc>Harta este decupată la zona conectată de la intrarea principală. Liniile arată conexiunile de navigare folosite pentru a ajunge la repere, iar contururile fine provin din geometria 3D. Lățimea reală a culoarelor nu este cunoscută.</desc>
          <defs>
            <pattern id={`${titleId}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" className="indoor-map__grid-dot" />
            </pattern>
            <marker id={`${titleId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="indoor-map__arrow" />
            </marker>
            <filter id={`${titleId}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#18382a" floodOpacity=".2" />
            </filter>
          </defs>

          <rect className="indoor-map__canvas" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />
          <rect className="indoor-map__grid" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={`url(#${titleId}-grid)`} />

          <g transform={camera.transform}>
            <image className="indoor-map__plan" href={floor.plan} x="0" y="0" width={floor.width} height={floor.height} preserveAspectRatio="none" />

            <g className="indoor-map__network" aria-hidden="true">
              {mapEdges.map((edge) => {
                const from = nodesById.get(edge.from)!;
                const to = nodesById.get(edge.to)!;
                return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              })}
            </g>
            <g className="indoor-map__network-core" aria-hidden="true">
              {mapEdges.map((edge) => {
                const from = nodesById.get(edge.from)!;
                const to = nodesById.get(edge.to)!;
                return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
              })}
          <h3 id={headingId}>{floor.name}</h3>
          <p>{route ? 'Linia verde arată succesiunea estimată a scanărilor.' : 'Alege plecarea și sosirea ca să vezi traseul pe plan.'}</p>
        </div>
      </div>
      <div className="map-scroll" role="group" aria-label={`Harta punctelor scanate pentru ${floor.name}`}>
      <svg
        viewBox={`0 0 ${floor.width} ${floor.height}`}
        role="img"
        aria-labelledby={titleId}
        className="indoor-map"
      >
        <title id={titleId}>
          {floor.name}: plan schematic cu scanările clădirii și, dacă a fost calculat, traseul estimat.
          Indicațiile scrise și vocale sunt afișate sub hartă.
        </title>

        <rect
          className="indoor-map__background"
          x="8"
          y="8"
          width={floor.width - 16}
          height={floor.height - 16}
          rx="20"
        />

        {route && corridors.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          if (route) {
            const pathPairs = route.nodePath.slice(1).map((id, index) =>
              new Set([route.nodePath[index], id]),
            );
            if (!pathPairs.some((pair) => pair.has(edge.from) && pair.has(edge.to))) return null;
          }

          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={edge.status === 'out_of_service' ? 'indoor-map__corridor indoor-map__corridor--closed' : 'indoor-map__corridor'}
            />
          );
        })}

        {segments.map(({ from, to }, index) => (
          <line
            key={`${from.id}-${to.id}-${index}`}
            className="indoor-map__route"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        ))}

        {!route && (
          <text className="indoor-map__empty" x={floor.width / 2} y={floor.height / 2} textAnchor="middle">
            {activeNodeId ? 'Alege destinația pentru a vedea traseul' : 'Alege plecarea și destinația pentru a vedea traseul'}
          </text>
        )}

        {nodes.map((node) => {
          const isStart = route?.from === node.id;
          const isEnd = route?.to === node.id;
          const isActive = activeNodeId === node.id;
          const isOnRoute = Boolean(nodePath?.includes(node.id));
          if (route && !isOnRoute) return null;
          if (!route && node.id !== activeNodeId) return null;
          const anchor =
            node.x > floor.width - 130
              ? 'end'
              : node.x < 130
                ? 'start'
                : 'middle';

          return (
            <g key={node.id}>
              {isActive && (
                <circle
                  className="indoor-map__active-ring"
                  cx={node.x}
                  cy={node.y}
                  r="19"
                />
              )}

              <circle
                className={`indoor-map__node${isStart ? ' indoor-map__node--start' : ''}${isEnd ? ' indoor-map__node--destination' : ''}`}
                cx={node.x}
                cy={node.y}
                r={isStart || isEnd ? 11 : isActive ? 9 : isOnRoute ? 6 : 4}
              />

              {(isStart || isEnd || isActive) && (
                <text
                  className="indoor-map__label"
                  x={node.x}
                  y={node.y - 26}
                  textAnchor={anchor}
                >
                  {!route ? 'PLECARE' : isStart && isEnd ? 'PLECARE / SOSIRE' : isStart ? 'PLECARE' : isEnd ? 'SOSIRE' : 'PAS CURENT'}
                </text>
              )}
            </g>

            {mapLandmarks
              .filter(({ node }) => node.id !== userPosition?.id && (!route || (node.id !== start?.id && node.id !== destination?.id)))
              .map(({ node, label, number }) => {
              const selected = node.id === startNodeId || node.id === destinationNodeId;
              return <g key={node.id} className={`indoor-map__landmark${selected ? ' is-selected' : ''}`} role={onNodeSelect ? 'button' : undefined} tabIndex={onNodeSelect ? 0 : undefined} aria-label={onNodeSelect ? `${number}. Alege ${label}` : label} onClick={onNodeSelect ? () => onNodeSelect(node.id) : undefined} onKeyDown={onNodeSelect ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNodeSelect(node.id); } } : undefined}>
                <title>{`${number}. ${label}`}</title>
                <circle className="indoor-map__landmark-hit" cx={node.x} cy={node.y} r="19" />
                <circle className="indoor-map__landmark-dot" cx={node.x} cy={node.y} r={selected ? 11 : 9} />
                <text className="indoor-map__landmark-number" x={node.x} y={node.y + 4} textAnchor="middle">{number}</text>
              </g>;
            })}

            {routeNodes.length > 1 && <>
              <polyline className="indoor-map__route-underlay" points={pointsAttribute(routeNodes)} />
              <polyline
                className={`indoor-map__route-line${routeIsPreview ? ' is-preview' : ''}`}
                points={pointsAttribute(routeNodes)}
                markerMid={`url(#${titleId}-arrow)`}
                markerEnd={`url(#${titleId}-arrow)`}
              />
            </>}

            {activePath.length > 1 && <polyline
              className="indoor-map__route-current"
              points={pointsAttribute(activePath)}
              markerEnd={`url(#${titleId}-arrow)`}
              aria-hidden="true"
            />}

            {turns.map((turn) => turn.node && (
              <g key={turn.id} className={`indoor-map__turn-marker${turn.active ? ' is-current' : ''}`} transform={`translate(${turn.node.x} ${turn.node.y})`}>
                <circle r="12" />
                <text y="4" textAnchor="middle">{turn.number}</text>
              </g>
            ))}

            {destination && destination.floor === floorId && <g className="indoor-map__pin indoor-map__pin--destination" transform={`translate(${destination.x} ${destination.y})`} filter={`url(#${titleId}-shadow)`}>
              <circle r="16" />
              <text y="5" textAnchor="middle">D</text>
            </g>}

            {userPosition?.floor === floorId && <g className={`indoor-map__you${route && userNextNode ? ' is-following' : ''}`} transform={`translate(${userPosition.x} ${userPosition.y})`} filter={`url(#${titleId}-shadow)`}>
              <circle className="indoor-map__you-halo" r="25" />
              <g transform={route && userNextNode ? `rotate(${userDirection})` : undefined}>
                {route && userNextNode && <path className="indoor-map__you-arrow" d="M0 -26L-8 -10L0 -13L8 -10Z" />}
                <circle className="indoor-map__you-dot" r="13" />
                <circle className="indoor-map__you-core" r="4" />
              </g>
              <text className="indoor-map__you-label" transform={`rotate(${-camera.rotation})`} x="0" y="39" textAnchor="middle">AICI</text>
            </g>}
          </g>

          <g className="indoor-map__scale" transform={`translate(${bounds.x + 22} ${bounds.y + bounds.height - 20})`} aria-label="Bară de scară: 5 metri în coordonatele planului">
            <line x1="0" y1="0" x2={scaleLength * camera.zoom} y2="0" />
            <line x1="0" y1="-5" x2="0" y2="5" />
            <line x1={scaleLength * camera.zoom} y1="-5" x2={scaleLength * camera.zoom} y2="5" />
            <text x={(scaleLength * camera.zoom) / 2} y="-8" textAnchor="middle">5 m · model</text>
          </g>
        </svg>
        {route && userNextNode && <div className="map-direction-cue" aria-hidden="true"><span className="map-direction-cue__arrow">↑</span><span><strong>SUS = ÎNAINTE</strong><small>Harta se rotește pe direcția următorului segment</small></span></div>}
        <div className="map-hud"><span><i />{userPosition ? `Ultimul reper: ${locationLabel?.(userPosition) ?? userPosition.label ?? 'poziție aleasă'}` : 'Alege punctul unde te afli'}</span><span>{mapNodes.length} puncte în tur · parter</span></div>
      </div>

      <div className="map-legend" aria-label="Legendă hartă">
        <span><i className="map-legend__swatch map-legend__swatch--network" />Legături principale către repere</span>
        {route && <span><i className={`map-legend__swatch map-legend__swatch--route${routeIsPreview ? ' is-preview' : ''}`} />Traseu selectat</span>}
        {activePath.length > 1 && <span><i className="map-legend__swatch map-legend__swatch--current" />Segmentul indicației curente</span>}
        <span><i className="map-legend__pin map-legend__pin--start">●</i>Poziția aleasă / confirmată</span>
        <span><i className="map-legend__pin map-legend__pin--destination">D</i>Sosire</span>
        <small>Benzile sunt simbolice; lățimea culoarelor nu este măsurată în tur.</small>
      </div>

      <div className="map-places">
        <div className="map-places__heading"><strong>Locuri de reper</strong><span>{mapLandmarks.length} destinații în tur</span></div>
        <ol>
          {mapLandmarks.map(({ node, label, number }) => {
            const selected = node.id === startNodeId || node.id === destinationNodeId;
            const content = <><span className="map-places__number">{number.toString().padStart(2, '0')}</span><span className="map-places__label">{label}</span><span className="map-places__arrow" aria-hidden="true">↗</span></>;
            return <li key={node.id}>
              {onNodeSelect
                ? <button type="button" className={`map-places__item${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => onNodeSelect(node.id)}>{content}</button>
                : <div className="map-places__item">{content}</div>}
            </li>;
          })}
        </ol>
      </div>
      <ul className="map-legend" aria-label="Legendă hartă">
        <li><span className="map-legend__swatch map-legend__swatch--route" aria-hidden="true" />Traseu estimat</li>
        <li><span className="map-legend__swatch map-legend__swatch--corridor" aria-hidden="true" />Legătură scanată</li>
        <li><span className="map-legend__swatch map-legend__swatch--closed" aria-hidden="true" />Închis temporar</li>
      </ul>
    </section>
  );
}
