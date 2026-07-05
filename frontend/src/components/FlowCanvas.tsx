// Canvas visual de una automatización (estilo ManyChat, con React Flow).
// Dibuja el árbol de pasos con layout automático: la secuencia baja en columna y las
// ramas de cada menú se abren a la derecha. Click en un nodo -> se edita en el panel.
import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type StepType = "message" | "delay" | "wait_reply" | "menu" | "link" | "set_stage";
interface Option { id: string; label: string; keywords?: string[]; steps: Step[] }
interface Step { id: string; type: StepType; text?: string; minutes?: number; options?: Option[]; url?: string; urlLabel?: string; stage?: string }
interface LinkStat { stepId: string; sent: number; clicked: number }

const COL_W = 320;
const ROW_H = 130;
const NODE_W = 250;

const META: Record<StepType, { emoji: string; title: string; border: string; chip: string }> = {
  message: { emoji: "💬", title: "Mensaje", border: "border-emerald-500/50", chip: "bg-emerald-500/15 text-emerald-300" },
  link: { emoji: "🔗", title: "Botón con link", border: "border-teal-400/50", chip: "bg-teal-500/15 text-teal-300" },
  delay: { emoji: "⏱️", title: "Espera", border: "border-amber-500/50", chip: "bg-amber-500/15 text-amber-300" },
  wait_reply: { emoji: "↩️", title: "Esperar respuesta", border: "border-sky-500/50", chip: "bg-sky-500/15 text-sky-300" },
  menu: { emoji: "🔀", title: "Menú", border: "border-violet-500/50", chip: "bg-violet-500/15 text-violet-300" },
  set_stage: { emoji: "📋", title: "Mover etapa", border: "border-rose-500/50", chip: "bg-rose-500/15 text-rose-300" },
};

function preview(s: Step): string {
  if (s.type === "message") return s.text?.slice(0, 90) || "(sin texto)";
  if (s.type === "link") return `${s.urlLabel ?? "Abrir link"} → ${s.url?.slice(0, 50) || "(sin URL)"}`;
  if (s.type === "delay") return `Esperar ${s.minutes ?? 0} min`;
  if (s.type === "wait_reply") return "Pausa hasta que el cliente responda";
  if (s.type === "menu") return s.text?.slice(0, 80) || "Elegí una opción:";
  if (s.type === "set_stage") return `→ ${s.stage ?? "?"}`;
  return "";
}

function NodeCard({ step, selected, ls }: { step: Step; selected: boolean; ls?: LinkStat }) {
  const m = META[step.type];
  return (
    <div className={`w-[250px] cursor-pointer rounded-xl border-2 bg-slate-900 p-3 text-left shadow-lg transition ${m.border} ${selected ? "ring-2 ring-wa-green" : ""}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m.chip}`}>{m.emoji} {m.title}</span>
        {ls && ls.sent > 0 && (
          <span className="rounded-full bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">
            {ls.clicked}/{ls.sent} · {Math.round((ls.clicked / ls.sent) * 100)}%
          </span>
        )}
      </div>
      <div className="text-xs leading-snug text-slate-300">{preview(step)}</div>
      {step.type === "menu" && (
        <div className="mt-1.5 space-y-0.5">
          {(step.options ?? []).map((o, i) => (
            <div key={o.id} className="truncate text-[11px] text-violet-300/90">{i + 1}️⃣ {o.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CanvasProps {
  steps: Step[];
  linkStats?: LinkStat[];
  selected: string | null; // path tipo "2" | "2:1:0" | "opt|2:1" (rama vacía)
  onSelect: (path: string) => void;
}

export default function FlowCanvas({ steps, linkStats, selected, onSelect }: CanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Recorre la lista; devuelve filas ocupadas. Las ramas de un menú van a col+1.
    const walk = (list: Step[], col: number, row: number, base: string): number => {
      let r = row;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const path = base ? `${base}:${i}` : String(i);
        const ls = s.type === "link" ? linkStats?.find((l) => l.stepId === s.id) : undefined;
        nodes.push({
          id: path,
          position: { x: col * COL_W, y: r * ROW_H },
          data: { label: <NodeCard step={s} selected={selected === path} ls={ls} /> },
          style: { width: NODE_W, padding: 0, border: "none", background: "transparent" },
        });

        let used = 1;
        if (s.type === "menu") {
          let branchRow = r;
          (s.options ?? []).forEach((o, k) => {
            const branchBase = `${path}:${k}`;
            if ((o.steps ?? []).length > 0) {
              const childPath = `${branchBase}:0`;
              edges.push({ id: `e-${path}-${k}`, source: path, target: childPath, label: `${k + 1}️⃣ ${o.label.slice(0, 18)}`, type: "smoothstep", animated: true, labelStyle: { fill: "#c4b5fd", fontSize: 10 }, labelBgStyle: { fill: "#1e1b4b" } });
              branchRow += walk(o.steps, col + 1, branchRow, branchBase);
            } else {
              const phId = `opt|${branchBase}`;
              nodes.push({
                id: phId,
                position: { x: (col + 1) * COL_W, y: branchRow * ROW_H },
                data: { label: <div className={`w-[250px] cursor-pointer rounded-xl border-2 border-dashed border-slate-600 bg-slate-900/60 p-3 text-center text-xs text-slate-400 ${selected === phId ? "ring-2 ring-wa-green" : ""}`}>＋ rama vacía — click para agregar pasos</div> },
                style: { width: NODE_W, padding: 0, border: "none", background: "transparent" },
              });
              edges.push({ id: `e-${path}-${k}`, source: path, target: phId, label: `${k + 1}️⃣ ${o.label.slice(0, 18)}`, type: "smoothstep", labelStyle: { fill: "#c4b5fd", fontSize: 10 }, labelBgStyle: { fill: "#1e1b4b" } });
              branchRow += 1;
            }
          });
          used = Math.max(1, branchRow - r);
        }

        const next = i + 1 < list.length ? (base ? `${base}:${i + 1}` : String(i + 1)) : null;
        if (next) edges.push({ id: `e-${path}-next`, source: path, target: next, type: "smoothstep" });
        r += used;
      }
      return r - row;
    };

    walk(steps, 0, 0, "");
    return { nodes, edges };
  }, [steps, linkStats, selected]);

  return (
    <div className="h-[540px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={24} color="#1e293b" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
