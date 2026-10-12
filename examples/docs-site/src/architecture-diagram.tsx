// "How The Pieces Fit" from docs/golden-path.md, drawn for the site. The
// Markdown keeps its text diagram; the site swaps in this one. Two layouts of
// the same graph: a wide one, and a narrow one for phones. Colors come from
// the theme tokens, so it follows light and dark.

interface DiagramNode {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly title: string;
  readonly detail: string;
  readonly kind?: "core" | "effect";
}

interface DiagramEdge {
  /** Polyline points; the arrowhead is at the last point. */
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly labels: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly anchor?: "start" | "middle" | "end";
  }>;
}

interface DiagramBand {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string;
  readonly detail: string;
  readonly dashed?: boolean;
}

interface DiagramLayout {
  readonly width: number;
  readonly height: number;
  readonly nodeHeight: number;
  readonly nodes: ReadonlyArray<DiagramNode>;
  readonly edges: ReadonlyArray<DiagramEdge>;
  readonly bands: ReadonlyArray<DiagramBand>;
  /** Bands put their detail under the title instead of beside it. */
  readonly stackedBands?: boolean;
}

// prettier-ignore
const wide: DiagramLayout = {
  width: 720,
  height: 516,
  nodeHeight: 54,
  nodes: [
    { x: 40, y: 20, w: 150, title: "Layer", detail: "one per host", kind: "effect" },
    { x: 270, y: 20, w: 180, title: "Effect service", detail: "ProjectStore", kind: "effect" },
    { x: 60, y: 152, w: 230, title: "Resource", detail: "named, cached, typed reads", kind: "core" },
    { x: 430, y: 152, w: 230, title: "Action", detail: "named mutations", kind: "core" },
    { x: 40, y: 292, w: 130, title: "Route", detail: "URL + preload", kind: "core" },
    { x: 230, y: 292, w: 260, title: "Component", detail: "resource · state · action · callback", kind: "core" },
  ],
  edges: [
    { points: [[190, 47], [268, 47]], labels: [{ x: 229, y: 38, text: "provides" }] },
    { points: [[280, 152], [280, 76]], labels: [{ x: 288, y: 118, text: "load", anchor: "start" }] },
    { points: [[440, 152], [440, 76]], labels: [{ x: 432, y: 118, text: "run", anchor: "end" }] },
    {
      points: [[430, 179], [292, 179]],
      labels: [{ x: 360, y: 170, text: "invalidates tags" }, { x: 360, y: 197, text: "optimistic patches" }],
    },
    { points: [[105, 292], [105, 208]], labels: [{ x: 99, y: 254, text: "preload", anchor: "end" }] },
    { points: [[250, 292], [250, 208]], labels: [{ x: 244, y: 254, text: "reads", anchor: "end" }] },
    { points: [[470, 292], [470, 208]], labels: [{ x: 478, y: 254, text: "submits", anchor: "start" }] },
    { points: [[230, 319], [172, 319]], labels: [{ x: 201, y: 310, text: "router" }] },
    { points: [[360, 346], [360, 398]], labels: [{ x: 368, y: 376, text: "root", anchor: "start" }] },
  ],
  bands: [
    {
      x: 40, y: 400, w: 640, h: 46,
      title: "App.define",
      detail: "createRequestHandler on the server · App.launch in the browser",
    },
    {
      x: 40, y: 462, w: 640, h: 40,
      title: "Timeline.record",
      detail: "observes every named commit underneath all of it",
      dashed: true,
    },
  ],
};

// prettier-ignore
const narrow: DiagramLayout = {
  width: 340,
  height: 470,
  nodeHeight: 50,
  stackedBands: true,
  nodes: [
    { x: 10, y: 10, w: 124, title: "Layer", detail: "one per host", kind: "effect" },
    { x: 196, y: 10, w: 134, title: "Effect service", detail: "ProjectStore", kind: "effect" },
    { x: 10, y: 130, w: 120, title: "Resource", detail: "typed reads", kind: "core" },
    { x: 210, y: 130, w: 120, title: "Action", detail: "mutations", kind: "core" },
    { x: 10, y: 262, w: 120, title: "Route", detail: "URL + preload", kind: "core" },
    { x: 172, y: 262, w: 158, title: "Component", detail: "resource · state · action", kind: "core" },
  ],
  edges: [
    { points: [[134, 35], [194, 35]], labels: [{ x: 165, y: 27, text: "provides" }] },
    {
      points: [[100, 130], [100, 100], [226, 100], [226, 62]],
      labels: [{ x: 106, y: 94, text: "load", anchor: "start" }],
    },
    { points: [[300, 130], [300, 62]], labels: [{ x: 306, y: 100, text: "run", anchor: "start" }] },
    {
      points: [[210, 155], [132, 155]],
      labels: [{ x: 170, y: 147, text: "tags" }, { x: 170, y: 171, text: "patches" }],
    },
    { points: [[40, 262], [40, 182]], labels: [{ x: 46, y: 226, text: "preload", anchor: "start" }] },
    {
      points: [[200, 262], [200, 236], [110, 236], [110, 182]],
      labels: [{ x: 116, y: 228, text: "reads", anchor: "start" }],
    },
    { points: [[300, 262], [300, 182]], labels: [{ x: 294, y: 222, text: "submits", anchor: "end" }] },
    { points: [[172, 287], [132, 287]], labels: [{ x: 152, y: 279, text: "router" }] },
    { points: [[251, 312], [251, 346]], labels: [{ x: 258, y: 333, text: "root", anchor: "start" }] },
  ],
  bands: [
    { x: 10, y: 348, w: 320, h: 54, title: "App.define", detail: "createRequestHandler · App.launch" },
    {
      x: 10,
      y: 412,
      w: 320,
      h: 54,
      title: "Timeline.record",
      detail: "observes every named commit",
      dashed: true,
    },
  ],
};

function DiagramSvg(props: {
  readonly layout: DiagramLayout;
  readonly class: string;
  readonly id: string;
}) {
  const layout = props.layout;
  const markerId = `${props.id}-arrow`;
  return (
    <svg
      class={["archDiagram", props.class]}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-labelledby={`${props.id}-title`}
    >
      <title id={`${props.id}-title`}>
        How the pieces fit: a server Layer provides an Effect service; Resources load through it and
        Actions run through it on the server (Resource.implement and Action.implement in server-only
        modules); Actions invalidate and optimistically patch Resources; Routes preload Resources;
        Components read Resources, submit Actions, and drive the router; App.define wires the root
        for server and browser; Timeline.record observes every commit.
      </title>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M1 1.5 9 5 1 8.5" class="archArrowHead" />
        </marker>
      </defs>
      {layout.bands.map((band) => (
        <g class={["archBand", { dashed: band.dashed === true }]}>
          <rect x={band.x} y={band.y} width={band.w} height={band.h} rx="10" />
          <text
            x={band.x + 16}
            y={layout.stackedBands === true ? band.y + 22 : band.y + band.h / 2 + 4.5}
            class="archBandTitle"
          >
            {band.title}
          </text>
          <text
            x={layout.stackedBands === true ? band.x + 16 : band.x + band.w - 16}
            y={layout.stackedBands === true ? band.y + 41 : band.y + band.h / 2 + 4.5}
            class="archBandDetail"
            text-anchor={layout.stackedBands === true ? "start" : "end"}
          >
            {band.detail}
          </text>
        </g>
      ))}
      {layout.edges.map((edge) => (
        <g class="archEdge">
          <polyline
            points={edge.points.map(([x, y]) => `${x},${y}`).join(" ")}
            marker-end={`url(#${markerId})`}
          />
          {edge.labels.map((label) => (
            <text x={label.x} y={label.y} text-anchor={label.anchor ?? "middle"}>
              {label.text}
            </text>
          ))}
        </g>
      ))}
      {layout.nodes.map((node) => (
        <g class={["archNode", node.kind ?? "core"]}>
          <rect x={node.x} y={node.y} width={node.w} height={layout.nodeHeight} rx="10" />
          <text
            x={node.x + node.w / 2}
            y={node.y + layout.nodeHeight / 2 - 3}
            class="archNodeTitle"
            text-anchor="middle"
          >
            {node.title}
          </text>
          <text
            x={node.x + node.w / 2}
            y={node.y + layout.nodeHeight / 2 + 14}
            class="archNodeDetail"
            text-anchor="middle"
          >
            {node.detail}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ArchitectureDiagram() {
  return (
    <figure class="archFigure">
      <DiagramSvg layout={wide} class="archWide" id="arch-wide" />
      <DiagramSvg layout={narrow} class="archNarrow" id="arch-narrow" />
      <figcaption>
        Solid arrows are typed dependencies. The Timeline sits underneath and records every commit,
        whichever definition owns it.
      </figcaption>
    </figure>
  );
}
