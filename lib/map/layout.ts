import dagre from "@dagrejs/dagre";
import type { View } from "./view.ts";

export interface Placed {
  /** Top-left corner. */
  x: number;
  y: number;
}

export interface Layout {
  positions: Map<string, Placed>;
  bounds: { x: number; y: number; width: number; height: number };
}

const NODE_GAP = 14;
const ISOLATED_GAP = 40;
const MIN_WRAP = 480;

// Left to right: importers sit left of what they import, so reading across the
// canvas follows the imports. Panels are laid out as one box, the size of their
// rows, so opening one moves its neighbours rather than overlapping them.
export function layout(view: View): Layout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: 70, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  // Insertion order is the only thing dagre's ordering depends on, and both
  // lists arrive sorted, so the same view always lands the same way.
  const connected = new Set(view.edges.flatMap((e) => [e.source, e.target]));
  for (const item of view.items) {
    if (connected.has(item.id)) g.setNode(item.id, { width: item.width, height: item.height });
  }
  const pairs = new Set<string>();
  for (const e of view.edges) {
    const key = `${e.source}\0${e.target}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const positions = new Map<string, Placed>();
  let maxX = 0;
  let maxY = 0;
  for (const item of view.items) {
    if (!connected.has(item.id)) continue;
    const n = g.node(item.id);
    const x = n.x - item.width / 2;
    const y = n.y - item.height / 2;
    positions.set(item.id, { x, y });
    maxX = Math.max(maxX, x + item.width);
    maxY = Math.max(maxY, y + item.height);
  }

  // dagre stacks every edgeless node in its first column, which turns a wide
  // canvas into a tall strip. They're flowed in rows under the graph instead,
  // in id order, wrapping at the graph's width.
  const wrapAt = Math.max(maxX, MIN_WRAP);
  let x = 0;
  let y = positions.size > 0 ? maxY + ISOLATED_GAP : 0;
  let rowHeight = 0;
  for (const item of view.items) {
    if (connected.has(item.id)) continue;
    if (x > 0 && x + item.width > wrapAt) {
      x = 0;
      y += rowHeight + NODE_GAP;
      rowHeight = 0;
    }
    positions.set(item.id, { x, y });
    maxX = Math.max(maxX, x + item.width);
    maxY = Math.max(maxY, y + item.height);
    x += item.width + NODE_GAP;
    rowHeight = Math.max(rowHeight, item.height);
  }

  return { positions, bounds: { x: 0, y: 0, width: maxX, height: maxY } };
}
