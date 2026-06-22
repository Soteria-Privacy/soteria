/**
 * Signature element. A small transaction graph stays fully visible — edges,
 * senders, recipients — making the point that Soteria does NOT break the graph.
 * One node pulses violet: its payload (amount / identity) is shielded while the
 * link itself remains auditable.
 */
export function Shield() {
  const nodes = [
    { id: 0, x: 40, y: 60 },
    { id: 1, x: 120, y: 30 },
    { id: 2, x: 120, y: 100 },
    { id: 3, x: 200, y: 60 },
    { id: 4, x: 270, y: 30 },
    { id: 5, x: 270, y: 100 },
  ];
  const edges = [
    [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5],
  ];
  const shielded = 3;

  return (
    <div className="figure" aria-hidden="true">
      <svg viewBox="0 0 310 140" width="100%" style={{ maxWidth: 360 }}>
        <defs>
          <radialGradient id="ag-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#9d7bff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#9d7bff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {edges.map(([a, b], i) => (
          <line
            key={i}
            x1={nodes[a].x} y1={nodes[a].y}
            x2={nodes[b].x} y2={nodes[b].y}
            stroke="#2a3040" strokeWidth="1.5"
          />
        ))}
        {nodes.map((n) =>
          n.id === shielded ? (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r="20" fill="url(#ag-glow)">
                <animate attributeName="r" values="14;22;14" dur="3.2s" repeatCount="indefinite" />
              </circle>
              <circle cx={n.x} cy={n.y} r="7" fill="#9d7bff" />
            </g>
          ) : (
            <circle key={n.id} cx={n.x} cy={n.y} r="5.5" fill="#5b8cff" />
          )
        )}
      </svg>
    </div>
  );
}
