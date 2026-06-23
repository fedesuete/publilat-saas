import { MousePointerClick, MessageCircle, ShoppingBag, TrendingUp } from "lucide-react";
import { Counter } from "./ui/Counter";

const STATS = [
  { icon: MousePointerClick, label: "Clics", value: 2840, color: "text-sky-400" },
  { icon: MessageCircle, label: "Chats", value: 612, color: "text-emerald-400" },
  { icon: ShoppingBag, label: "Ventas", value: 138, color: "text-lime-400" },
];

// Mini gráfico de barras (SVG) decorativo.
const BARS = [30, 45, 38, 60, 52, 78, 66, 90, 84, 100];

export default function DashboardMock() {
  return (
    <div className="card-border glow relative w-full max-w-xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-400/70" />
          <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
          <span className="h-3 w-3 rounded-full bg-green-400/70" />
        </div>
        <span className="text-xs text-slate-500">app.publi.lat</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="glass rounded-xl p-3">
            <s.icon className={`mb-2 h-5 w-5 ${s.color}`} />
            <div className="text-xl font-bold text-white">
              <Counter to={s.value} />
            </div>
            <div className="text-[11px] text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400">
            <TrendingUp className="h-4 w-4 text-wa-green" />
            <span className="text-[11px]">ROAS</span>
          </div>
          <div className="mt-1 text-2xl font-extrabold gradient-text">
            <Counter to={4.7} decimals={1} suffix="x" />
          </div>
          <div className="text-[11px] text-slate-500">facturación real / inversión</div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-[11px] text-slate-400">Ventas (7 días)</div>
          <div className="mt-2 flex h-12 items-end gap-1">
            {BARS.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-gradient-to-t from-wa-green/40 to-lime-300"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 glass flex items-center justify-between rounded-xl p-3">
        <div>
          <div className="text-xs font-medium text-white">Purchase enviado a Meta</div>
          <div className="text-[11px] text-slate-500">CAPI · mismo external_id · valor $</div>
        </div>
        <span className="rounded-full bg-wa-green/15 px-2.5 py-1 text-[11px] font-semibold text-wa-green">
          ✓ Matcheado
        </span>
      </div>
    </div>
  );
}
