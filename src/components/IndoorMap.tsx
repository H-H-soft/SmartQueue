import { useId, useMemo } from 'react';
import type { Building, Route } from '../types';
import './IndoorMap.css';

interface Props {
  building: Building;
  floorId: string;
  route: Route | null;
  activeNodeId?: string;
}

export default function IndoorMap({
  building,
  floorId,
  route,
  activeNodeId,
}: Props) {
  const titleId = useId();
  const headingId = useId();
  const floor = building.floors.find((item) => item.id === floorId);

  const byId = useMemo(
    () => new Map(building.nodes.map((node) => [node.id, node])),
    [building],
  );
  const nodes = useMemo(
    () => building.nodes.filter((node) => node.floor === floorId),
    [building, floorId],
  );
  const corridors = useMemo(
    () => building.edges.filter((edge) =>
      byId.get(edge.from)?.floor === floorId && byId.get(edge.to)?.floor === floorId,
    ),
    [building, byId, floorId],
  );
  const nodePath = route?.nodePath;

  // Only join consecutive route nodes on this floor.
  // Never draw a line across a floor transition.
  const segments = useMemo(
    () => (nodePath ?? []).flatMap((id, index, path) => {
      if (index === 0) return [];

      const from = byId.get(path[index - 1]);
      const to = byId.get(id);

      if (!from || !to || from.floor !== floorId || to.floor !== floorId) return [];
      return [{ from, to }];
    }),
    [byId, floorId, nodePath],
  );

  if (!floor) return null;

  return (
    <section className="map-panel" aria-labelledby={headingId}>
      <div className="map-panel__heading">
        <div>
          <h3 id={headingId}>{floor.name}</h3>
          <p>{route ? 'Traseul este evidențiat pe etajul selectat.' : 'Alege punctele de plecare și destinația pentru a vedea traseul.'}</p>
        </div>
      </div>
      <div className="map-scroll" role="group" aria-label={`Harta schematică pentru ${floor.name}`}>
      <svg
        viewBox={`0 0 ${floor.width} ${floor.height}`}
        role="img"
        aria-labelledby={titleId}
        className="indoor-map"
      >
        <title id={titleId}>
          {floor.name}: hartă schematică a coridoarelor și traseului selectat.
          Instrucțiunile scrise sunt afișate sub hartă.
        </title>

        <rect
          className="indoor-map__background"
          x="8"
          y="8"
          width={floor.width - 16}
          height={floor.height - 16}
          rx="20"
        />

        {corridors.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;

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

        {nodes.map((node) => {
          const isStart = route?.from === node.id;
          const isEnd = route?.to === node.id;
          const isActive = activeNodeId === node.id;
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
                r={node.label ? 10 : 5}
              />

              {node.label && (
                <text
                  className="indoor-map__label"
                  x={node.x}
                  y={node.y - 26}
                  textAnchor={anchor}
                >
                  {node.label}
                </text>
              )}

              {(isStart || isEnd) && (
                <text
                  className="indoor-map__endpoint"
                  x={node.x}
                  y={node.y + 30}
                  textAnchor={anchor}
                >
                  {isStart && isEnd ? 'Start / Finish' : isStart ? 'Start' : 'Finish'}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>
      <ul className="map-legend" aria-label="Legendă hartă">
        <li><span className="map-legend__swatch map-legend__swatch--route" aria-hidden="true" />Traseu accesibil</li>
        <li><span className="map-legend__swatch map-legend__swatch--corridor" aria-hidden="true" />Coridor</li>
        <li><span className="map-legend__swatch map-legend__swatch--closed" aria-hidden="true" />Închis temporar</li>
      </ul>
    </section>
  );
}
