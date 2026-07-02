import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import { fmtDate } from "../lib/format";

interface Noti { id: string; type: string; title: string; body: string | null; read: boolean; createdAt: string }

const ICON: Record<string, string> = { lead: "💬", purchase: "🎉", line_down: "🔌", line_quality: "⚠️", system: "🔔" };

export default function NotificationBell() {
  const [items, setItems] = useState<Noti[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get<{ items: Noti[]; unread: number }>("/api/notifications");
      setItems(data.items);
      setUnread(data.unread);
    } catch { /* noop */ }
  };

  useEffect(() => {
    void load();
    const s = getSocket();
    const onNoti = (n: Noti) => {
      setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 30)));
      setUnread((u) => u + 1);
    };
    s.on("notification", onNoti);
    return () => { s.off("notification", onNoti); };
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try { await api.post("/api/notifications/read", { all: true }); } catch { /* noop */ }
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  return (
    <div className="relative">
      <button onClick={() => void toggle()} title="Notificaciones" className="relative rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed left-3 top-16 z-50 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2.5">
              <span className="text-sm font-semibold">Notificaciones</span>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            {items.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Sin notificaciones todavía.</p>
            ) : (
              items.map((n) => (
                <div key={n.id} className="flex gap-2 border-b border-slate-800/60 px-4 py-2.5">
                  <span className="text-lg leading-none">{ICON[n.type] ?? "🔔"}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100">{n.title}</div>
                    {n.body && <div className="text-xs text-slate-400">{n.body}</div>}
                    <div className="mt-0.5 text-[10px] text-slate-500">{fmtDate(n.createdAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
