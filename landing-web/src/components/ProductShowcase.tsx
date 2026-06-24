import { Reveal } from "./ui/Reveal";
import { BrowserFrame } from "./ui/Frame";
import { KanbanMock, InboxMock, PaymentMock } from "./mocks";

const SCREENS = [
  { tag: "CRM kanban", url: "app.publi.lat/kanban", desc: "De Nuevo a Comprado, con el monto.", mock: <KanbanMock /> },
  { tag: "Inbox", url: "app.publi.lat/inbox", desc: "Todos los chats, con su atribución.", mock: <InboxMock /> },
  { tag: "Detección IA", url: "app.publi.lat/leads", desc: "La IA lee el comprobante y el monto.", mock: <PaymentMock /> },
];

export default function ProductShowcase() {
  return (
    <section id="producto" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <Reveal>
        <h2 className="text-center text-3xl font-bold text-white sm:text-4xl">
          Una sola plataforma, <span className="gradient-text">todo a la vista</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Dashboard, CRM e Inbox en el mismo lugar. Mirá el panel por dentro.
        </p>
      </Reveal>

      <div className="mt-12 grid items-start gap-5 lg:grid-cols-3">
        {SCREENS.map((s, i) => (
          <Reveal key={s.tag} delay={i * 0.08}>
            <div>
              <BrowserFrame url={s.url}>
                <div className="flex min-h-[230px] items-center">{s.mock}</div>
              </BrowserFrame>
              <div className="mt-3 px-1">
                <span className="text-sm font-semibold text-white">{s.tag}</span>
                <span className="ml-2 text-sm text-slate-400">{s.desc}</span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
