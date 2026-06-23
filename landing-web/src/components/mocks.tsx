// Mockups con datos de ejemplo (placeholders realistas, listos para reemplazar por
// capturas reales del panel).

export function CajerosMock() {
  const rows = [
    { name: "Caja Norte", cargas: "₲ 4.2M", retiros: "₲ 1.1M", on: true },
    { name: "Caja Sur", cargas: "₲ 3.8M", retiros: "₲ 0.9M", on: true },
    { name: "Caja Turno Noche", cargas: "₲ 2.1M", retiros: "₲ 1.4M", on: false },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="grid grid-cols-4 gap-2 bg-white/[0.04] px-3 py-2 text-[10px] uppercase text-slate-400">
        <span className="col-span-2">Cajero</span>
        <span>Cargas</span>
        <span>Retiros</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-4 items-center gap-2 border-t border-white/5 px-3 py-2.5 text-[11px]">
          <span className="col-span-2 flex items-center gap-2 text-slate-200">
            <span className={`h-1.5 w-1.5 rounded-full ${r.on ? "bg-wa-green" : "bg-slate-600"}`} />
            {r.name}
          </span>
          <span className="text-emerald-300">{r.cargas}</span>
          <span className="text-sky-300">{r.retiros}</span>
        </div>
      ))}
    </div>
  );
}

export function PlayersKanbanMock() {
  const cols: { name: string; tint: string; cards: string[] }[] = [
    { name: "Nuevos", tint: "text-slate-300", cards: ["Jugador #5012", "Jugador #5018"] },
    { name: "Activos", tint: "text-sky-300", cards: ["#4821 · ₲150K"] },
    { name: "VIP", tint: "text-wa-green", cards: ["#3007 · ₲2.4M", "#2990 · ₲1.1M"] },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {cols.map((c) => (
        <div key={c.name} className="rounded-lg bg-white/[0.03] p-2">
          <div className={`mb-2 text-[11px] font-semibold uppercase ${c.tint}`}>{c.name}</div>
          <div className="space-y-2">
            {c.cards.map((t, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-ink2 px-2 py-2 text-[11px] text-slate-200">
                {t}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxMock() {
  const chats = [
    { n: "Jugador #4821", m: "Quiero cargar 150.000", t: "20:41", on: true },
    { n: "Jugador #3007", m: "Ya transferí 🙌", t: "20:12", on: false },
    { n: "Jugador #5018", m: "¿Cómo retiro?", t: "19:58", on: false },
  ];
  return (
    <div className="grid grid-cols-5 gap-2">
      <div className="col-span-2 space-y-1.5">
        {chats.map((c, i) => (
          <div key={i} className={`rounded-md px-2 py-2 ${c.on ? "bg-white/[0.06]" : "bg-white/[0.02]"}`}>
            <div className="truncate text-[11px] font-medium text-slate-100">{c.n}</div>
            <div className="truncate text-[10px] text-slate-500">{c.m}</div>
          </div>
        ))}
      </div>
      <div className="col-span-3 flex flex-col justify-end gap-1.5 rounded-md bg-[#0b141a] p-2">
        <div className="self-start rounded-lg rounded-tl-sm bg-[#202c33] px-2.5 py-1.5 text-[11px] text-slate-100">
          Quiero cargar 150.000
        </div>
        <div className="self-end rounded-lg rounded-tr-sm bg-[#005c4b] px-2.5 py-1.5 text-[11px] text-white">
          Te paso los datos 🙌
        </div>
        <div className="mx-auto rounded-full bg-wa-green/15 px-2 py-0.5 text-[10px] text-wa-green">
          WhatsApp · Telegram
        </div>
      </div>
    </div>
  );
}

export function BotMock() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex h-16 w-12 flex-col items-center justify-center rounded-md bg-gradient-to-br from-slate-700 to-slate-800">
          <span className="text-lg">🧾</span>
        </div>
        <div className="text-[11px]">
          <div className="text-slate-200">Comprobante.jpg</div>
          <div className="text-slate-500">leído por el bot</div>
        </div>
        <span className="ml-auto rounded-full bg-wa-green/15 px-2 py-1 text-[11px] font-semibold text-wa-green">
          ₲ 150.000
        </span>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-[11px]">
        <span className="text-slate-300">Confianza IA</span>
        <span className="font-semibold text-wa-green">98%</span>
      </div>
      <button className="w-full rounded-md bg-gradient-to-r from-wa-green to-emerald-400 py-2 text-[11px] font-semibold text-ink">
        🤖 Acreditar carga automáticamente
      </button>
    </div>
  );
}
