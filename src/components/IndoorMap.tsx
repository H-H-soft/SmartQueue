import { useId } from 'react';
import type { Building, Route } from '../types';

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
  const floor = building.floors.find((item) => item.id === floorId);

  if (!floor) return null;

  const nodes = building.nodes.filter((node) => node.floor === floorId);
  const byId = new Map(building.nodes.map((node) => [node.id, node]));

  const corridors = building.edges.filter((edge) => {
    return (
      byId.get(edge.from)?.floor === floorId &&
      byId.get(edge.to)?.floor === floorId
    );
  });

  // Only join consecutive route nodes on this floor.
  // Never draw a line across a floor transition.
  const segments = (route?.nodePath ?? []).flatMap((id, index, path) => {
    if (index === 0) return [];

    const from = byId.get(path[index - 1]);
    const to = byId.get(id);

    if (!from || !to || from.floor !== floorId || to.floor !== floorId) {
      return [];
    }

    return [{ from, to }];
  });

  return (
    <div className="map-scroll">
      <svg
        viewBox={`0 0 ${floor.width} ${floor.height}`}
        role="img"
        aria-labelledby={titleId}
        className="indoor-map"
      >
        <title id={titleId}>
          {floor.name}: schematic map of corridors and the selected route.
          Written directions are available below the map.
        </title>

        <rect
          x="8"
          y="8"
          width={floor.width - 16}
          height={floor.height - 16}
          rx="20"
          fill="#f8fafc"
          stroke="#cbd5e1"
          strokeWidth="2"
        />

        {corridors.map((edge) => {
          const from = byId.get(edge.from)!;
          const to = byId.get(edge.to)!;

          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={edge.status === 'out_of_service' ? '#b91c1c' : '#cbd5e1'}
              strokeWidth="22"
              strokeLinecap="round"
              strokeDasharray={
                edge.status === 'out_of_service' ? '5 10' : undefined
              }
            />
          );
        })}

        {segments.map(({ from, to }, index) => (
          <line
            key={`${from.id}-${to.id}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="#1d4ed8"
            strokeWidth="7"
            strokeLinecap="round"
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
                  cx={node.x}
                  cy={node.y}
                  r="19"
                  fill="none"
                  stroke="#a16207"
                  strokeWidth="4"
                />
              )}

              <circle
                cx={node.x}
                cy={node.y}
                r={node.label ? 10 : 5}
                fill={isEnd ? '#166534' : isStart ? '#1d4ed8' : '#fff'}
                stroke="#0f172a"
                strokeWidth="2"
              />

              {node.label && (
                <text
                  x={node.x}
                  y={node.y - 26}
                  textAnchor={anchor}
                  fontSize="12"
                  fontWeight="700"
                  fill="#0f172a"
                  stroke="#f8fafc"
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  {node.label}
                </text>
              )}

              {(isStart || isEnd) && (
                <text
                  x={node.x}
                  y={node.y + 30}
                  textAnchor={anchor}
                  fontSize="12"
                  fontWeight="700"
                  fill="#0f172a"
                >
                  {isStart && isEnd ? 'Start / Finish' : isStart ? 'Start' : 'Finish'}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}