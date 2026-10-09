"use client";

import "@xyflow/react/dist/base.css";
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, type WheelEvent } from "react";
import { extensionOf } from "@/lib/map/category";
import type { Folding } from "@/lib/map/fold";
import { layout } from "@/lib/map/layout";
import {
  HEADER_H,
  ROW_H,
  categoryFocus,
  deriveView,
  type CategoryFocus,
  highlight,
  type Endpoint,
  type FoldedItem,
  type HandleId,
  type Highlight,
  type Hover,
  type PanelItem,
  type Selection,
} from "@/lib/map/view";
import type { Edge, FileNode } from "@/parser/types";
import { TypeSwatch } from "./FileType";

export interface MapActions {
  open: (id: string) => void;
  close: (id: string) => void;
  /** Moves a panel's window by whole rows; negative is up. */
  scroll: (id: string, rows: number) => void;
  selectFile: (path: string, group: string) => void;
  clear: () => void;
  hover: (h: Hover | null) => void;
}

// Each node gets the highlight state it needs to draw itself; null means
// nothing is selected and everything is at full strength. `marked` is what the
// pointer is over in the detail pane, shown here so the two can be matched up.
// `matched` is how many of its files are in the category picked in the rail,
// null when none is; the selection and the category each dim on their own.
type FoldedData = {
  item: FoldedItem;
  lit: boolean;
  selected: boolean;
  marked: boolean;
  matched: number | null;
  actions: MapActions;
};
type PanelData = {
  item: PanelItem;
  lit: boolean;
  hl: Highlight | null;
  focus: CategoryFocus | null;
  matched: number | null;
  selection: Selection | null;
  marked: Endpoint | null;
  actions: MapActions;
};
type FoldedNode = FlowNode<FoldedData, "folded">;
type PanelNode = FlowNode<PanelData, "panel">;

const DIM = "opacity-25";
// Inset so marking a row never changes its size.
const MARK = "ring-1 ring-inset ring-accent";
// Handles are where edges attach, not something to grab: nothing on this map
// is connectable, so they're invisible.
const handle = "!h-px !min-h-0 !w-px !min-w-0 !border-0 !bg-transparent";

function Folded({ data }: NodeProps<FoldedNode>) {
  const { item, lit, selected, marked, matched, actions } = data;
  // Opening is handled by the canvas's onNodeClick, not here; see Canvas.
  return (
    <div
      title={`${item.id} — ${item.files} files, ${item.fanIn} in, ${item.fanOut} out`}
      onMouseEnter={() => actions.hover({ kind: "group", id: item.id })}
      onMouseLeave={() => actions.hover(null)}
      className={`flex h-full w-full cursor-pointer flex-col justify-center rounded border bg-surface px-2.5 text-left hover:border-muted ${
        selected ? "border-accent" : "border-border"
      } ${marked ? MARK : ""} ${lit || marked ? "" : DIM}`}
    >
      <SlotHandles id="node" />
      <span className="truncate font-mono text-[12px] leading-4">{item.label}</span>
      <span className="flex items-center gap-2 text-[11px] leading-4">
        <FileCount files={item.files} matched={matched} />
        <Fans fanIn={item.fanIn} fanOut={item.fanOut} />
      </span>
    </div>
  );
}

// With a category picked, how many of the folder's files are in it, in the
// accent the rail marks the category with.
function FileCount({ files, matched }: { files: number; matched: number | null }) {
  return (
    <span className="text-[11px] text-muted tabular-nums">
      {matched !== null && <span className="text-accent">{matched}/</span>}
      {files} files
    </span>
  );
}

// Incoming on the left, outgoing on the right, matching where those edges
// attach and the colors they take when something is selected.
function Fans({ fanIn, fanOut }: { fanIn: number; fanOut: number }) {
  return (
    <span className="flex gap-2 whitespace-nowrap font-mono text-[11px] tabular-nums">
      <span className="text-incoming" title={`${fanIn} files import from here`}>
        ←{fanIn}
      </span>
      <span className="text-outgoing" title={`imports ${fanOut} files`}>
        {fanOut}→
      </span>
    </span>
  );
}

// Incoming edges attach on the left, outgoing on the right.
function SlotHandles({ id }: { id: HandleId }) {
  return (
    <>
      <Handle type="target" position={Position.Left} id={id} className={handle} isConnectable={false} />
      <Handle type="source" position={Position.Right} id={id} className={handle} isConnectable={false} />
    </>
  );
}

function Panel({ data }: NodeProps<PanelNode>) {
  const { item, lit, hl, focus, matched, selection, marked, actions } = data;
  const rowLit = (end: Endpoint) =>
    end === marked || ((!hl || hl.endpoints.has(end)) && (!focus || focus.endpoints.has(end)));
  const above: Endpoint = `u:${item.id}`;
  const below: Endpoint = `d:${item.id}`;

  // The window moves in whole rows, so every slot stays where its edges
  // attach. Wheel deltas are pooled until they add up to a row, which keeps a
  // trackpad's many small deltas from each jumping a full row.
  const pooled = useRef(0);
  const onWheel = (e: WheelEvent) => {
    pooled.current += e.deltaY;
    const rows = Math.trunc(pooled.current / ROW_H);
    if (rows === 0) return;
    pooled.current -= rows * ROW_H;
    actions.scroll(item.id, rows);
  };

  return (
    <div
      // nowheel tells React Flow to leave the wheel to the panel, but only on a
      // panel that scrolls; over a short one the wheel still pans the canvas.
      onWheel={item.scrolls ? onWheel : undefined}
      className={`flex h-full w-full flex-col overflow-hidden rounded border bg-background ${
        item.scrolls ? "nowheel" : ""
      } ${selection?.kind === "group" && selection.id === item.id ? "border-accent" : "border-muted"} ${lit ? "" : DIM}`}
    >
      <button
        type="button"
        onClick={() => actions.close(item.id)}
        onMouseEnter={() => actions.hover({ kind: "group", id: item.id })}
        onMouseLeave={() => actions.hover(null)}
        title={`Close ${item.id}`}
        style={{ height: HEADER_H }}
        className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-border bg-surface px-2.5 text-left"
      >
        <span className="truncate font-mono text-[12px]">{item.label}</span>
        <FileCount files={item.files} matched={matched} />
        <span className="ml-auto">
          <Fans fanIn={item.fanIn} fanOut={item.fanOut} />
        </span>
      </button>
      {item.scrolls && (
        <Overflow id="above" count={item.above} arrow="↑" word="above" lit={rowLit(above)} marked={marked === above} />
      )}
      {item.rows.map((row, slot) => {
        const end: Endpoint = `f:${row.path}`;
        const selected = selection?.kind === "file" && selection.path === row.path;
        return (
          <button
            // Keyed by slot, not file: the slot and its handles stay put while
            // the file in it changes with the scroll.
            key={slot}
            type="button"
            onClick={() => actions.selectFile(row.path, item.id)}
            onMouseEnter={() => actions.hover({ kind: "file", path: row.path })}
            onMouseLeave={() => actions.hover(null)}
            title={`${row.path} — ${row.fanIn} in, ${row.fanOut} out`}
            style={{ height: ROW_H }}
            className={`relative flex shrink-0 cursor-pointer items-center gap-2 px-2.5 text-left hover:bg-surface ${
              selected ? "bg-accent/10 text-accent" : ""
            } ${marked === end ? MARK : ""} ${rowLit(end) ? "" : DIM}`}
          >
            <SlotHandles id={`row-${slot}`} />
            <TypeSwatch ext={extensionOf(row.path)} />
            <span className="truncate font-mono text-[12px]">{row.label}</span>
            <span className="ml-auto">
              <Fans fanIn={row.fanIn} fanOut={row.fanOut} />
            </span>
          </button>
        );
      })}
      {item.scrolls && (
        <Overflow id="below" count={item.below} arrow="↓" word="below" lit={rowLit(below)} marked={marked === below} />
      )}
    </div>
  );
}

// Stands in for the files scrolled out of a panel's window, and carries their
// edges. Shown even at zero so the panel's height never changes. Marked when
// the pane points at a file scrolled behind it.
function Overflow({
  id,
  count,
  arrow,
  word,
  lit,
  marked,
}: {
  id: HandleId;
  count: number;
  arrow: string;
  word: string;
  lit: boolean;
  marked: boolean;
}) {
  return (
    <div
      style={{ height: ROW_H }}
      className={`relative flex shrink-0 items-center gap-2 px-2.5 text-[11px] text-muted tabular-nums ${
        id === "above" ? "border-b" : "border-t"
      } border-border ${marked ? MARK : ""} ${lit ? "" : DIM}`}
    >
      <SlotHandles id={id} />
      {arrow} {count} {word}
    </div>
  );
}

const nodeTypes = { folded: Folded, panel: Panel };

// Nodes sit above every edge, so a line passing a panel goes under it rather
// than across its file names, and only shows where it meets a row's side.
const EDGE_LIT_Z = 1;
const NODE_Z = 2;

// The most a fit will magnify, so a small repository doesn't arrive blown up
// past the point labels are comfortable to read. Also the canvas's zoom limit.
const MAX_ZOOM = 2;
const FIT_PADDING = 24;

export interface MapProps {
  files: readonly FileNode[];
  edges: readonly Edge[];
  folding: Folding;
  /** Open folders, each with the first file its window shows. */
  open: ReadonlyMap<string, number>;
  selection: Selection | null;
  hover: Hover | null;
  /** The file category picked in the rail, or null. */
  category: string | null;
  actions: MapActions;
}

function Canvas({ files, edges, folding, open, selection, hover, category, actions }: MapProps) {
  const view = useMemo(() => deriveView(files, edges, folding, open), [files, edges, folding, open]);

  // Layout depends on which folders are open, never on how far one is
  // scrolled: sizes and folder-to-folder edges don't change with the scroll.
  // Keying it this way means scrolling can't re-run the layout or the refit.
  const openKey = [...open.keys()].sort().join("\0");
  const placed = useMemo(() => {
    const unscrolled = new Map(openKey === "" ? [] : openKey.split("\0").map((id) => [id, 0] as const));
    return layout(deriveView(files, edges, folding, unscrolled));
  }, [files, edges, folding, openKey]);
  const hl = useMemo(
    () => (selection ? highlight(view, edges, folding, selection) : null),
    [view, edges, folding, selection],
  );
  const focus = useMemo(
    () => (category === null ? null : categoryFocus(view, files, edges, folding, category)),
    [view, files, edges, folding, category],
  );

  // Only a hovered file is marked here; a hovered group came from the map
  // itself, which already shows it. The mark lands wherever the file is drawn
  // right now: its row, the overflow row it's scrolled behind, or its folder.
  const marked = hover?.kind === "file" ? (view.endpoints.get(hover.path) ?? null) : null;

  const nodes = useMemo(
    () =>
      view.items.map((item): FoldedNode | PanelNode => {
        const position = placed.positions.get(item.id) ?? { x: 0, y: 0 };
        const matched = focus ? (focus.matched.get(item.id) ?? 0) : null;
        const lit = (!hl || hl.groups.has(item.id)) && matched !== 0;
        const common = { id: item.id, position, width: item.width, height: item.height, zIndex: NODE_Z };
        if (item.kind === "folded") {
          const selected = selection?.kind === "group" && selection.id === item.id;
          return { ...common, type: "folded", data: { item, lit, selected, marked: marked === `g:${item.id}`, matched, actions } };
        }
        return { ...common, type: "panel", data: { item, lit, hl, focus, matched, selection, marked, actions } };
      }),
    [view, placed, hl, focus, selection, marked, actions],
  );

  const flowEdges = useMemo(
    () =>
      view.edges.map((e): FlowEdge => {
        const direction = hl?.edges.get(e.id);
        const color = direction === "in" ? "var(--incoming)" : direction === "out" ? "var(--outgoing)" : "var(--edge)";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          style: {
            stroke: color,
            strokeWidth: direction ? 1.5 : 1,
            opacity: (hl && !direction) || (focus && !focus.edges.has(e.id)) ? 0.12 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
          // Lit edges draw over dimmed ones, and every edge stays under the nodes.
          zIndex: direction ? EDGE_LIT_Z : 0,
        };
      }),
    [view, hl, focus],
  );

  // The whole graph is fitted as large as the canvas allows: on first load, and
  // whenever the canvas itself changes size, which it can do more than once
  // while the page settles. When a folder opens or closes, the refit runs on the
  // new layout, never the one before the change, and may only zoom out, so
  // opening a panel never zooms into it and loses the rest of the graph.
  const { getViewport, setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const lastFitted = useRef<typeof placed | null>(null);
  useEffect(() => {
    const { bounds } = placed;
    if (!width || !height || bounds.width === 0) return;
    const fit = Math.min(
      (width - 2 * FIT_PADDING) / bounds.width,
      (height - 2 * FIT_PADDING) / bounds.height,
      MAX_ZOOM,
    );
    const layoutChanged = lastFitted.current !== null && lastFitted.current !== placed;
    const zoom = layoutChanged ? Math.min(fit, getViewport().zoom) : fit;
    lastFitted.current = placed;
    void setViewport({
      zoom,
      x: (width - bounds.width * zoom) / 2 - bounds.x * zoom,
      y: (height - bounds.height * zoom) / 2 - bounds.y * zoom,
    });
  }, [placed, width, height, getViewport, setViewport]);

  // React Flow gives a node `pointer-events: none` unless it's selectable,
  // draggable, or the canvas has a node click handler. Nodes here are neither
  // of the first two, so this handler is what makes any node clickable at all,
  // including the header and rows inside a panel.
  const onNodeClick = useCallback<NodeMouseHandler<FoldedNode | PanelNode>>(
    (_, node) => {
      if (node.type === "folded") actions.open(node.id);
    },
    [actions],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      zoomOnDoubleClick={false}
      // Scrolling moves the canvas in any direction; pinch or Ctrl+scroll zooms.
      // React Flow's default spends the wheel on zoom, leaving a trackpad no way to pan.
      panOnScroll
      zoomActivationKeyCode={["Control", "Meta"]}
      onPaneClick={actions.clear}
      onNodeClick={onNodeClick}
      minZoom={0.1}
      maxZoom={MAX_ZOOM}
      className="bg-background"
    />
  );
}

export function DependencyMap(props: MapProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
