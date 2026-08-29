// Alta de cliente en UN formulario: cuenta + días + marca + datos de pago + bot + casino.
// Reemplaza la vuelta larga de hoy (crear la cuenta acá, entrar como el cliente para la marca y el
// bot, y un script por SSH para la key del casino). Es una pantalla NUEVA: no toca "Clientes".
import { useState, type FormEvent, type ReactNode } from "react";
import { api, apiError } from "../../lib/api";
import { Button, Input, Card, ErrorMsg } from "../../components/ui";

interface ReadinessItem { key: string; ok: boolean; detalle: string }
interface Estado {
  listo: boolean;
  items: ReadinessItem[];
  casino: { keyPropia: boolean; autoCredit: boolean | null };
  links: { registro: string; chatDirecto: string };
}
interface ProvisionResp {
  client: { id: string; email: string; slug: string; name: string | null };
  credenciales: { email: string; password: string; panel: string };
  aplicado: string[];
  chatDayActivado: boolean;
  estado: Estado | null;
}

const ETIQUETAS: Record<string, string> = {
  dias: "Días de saldo",
  canal_activo: "Canal encendido",
  marca: "Marca",
  bot: "Bot de carga/descarga",
  datos_de_pago: "Datos de pago",
  plataforma_de_juego: "Link de la plataforma",
  pixel: "Pixel de Meta",
};

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <div>
        <h3 className="font-semibold text-slate-100">{titulo}</h3>
        {ayuda && <p className="text-xs text-slate-400 mt-0.5">{ayuda}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export default function AdminProvision() {
  // Cuenta
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState(""); // vacío = la genera el server
  const [days, setDays] = useState("2");
  // Marca
  const [brandName, setBrandName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#00a884");
  const [accentColor, setAccentColor] = useState("#128c7e");
  const [chatTheme, setChatTheme] = useState("whatsapp");
  const [welcomeMsgText, setWelcomeMsgText] = useState("");
  const [chatPlatformUrl, setChatPlatformUrl] = useState("");
  // Pagos
  const [chatPayCbu, setChatPayCbu] = useState("");
  const [chatPayAlias, setChatPayAlias] = useState("");
  const [chatPayTitular, setChatPayTitular] = useState("");
  // Bot
  const [botEnabled, setBotEnabled] = useState(true);
  const [botWelcome, setBotWelcome] = useState("");
  // Casino
  const [casinoApiKey, setCasinoApiKey] = useState("");
  const [autoCredit, setAutoCredit] = useState<"global" | "auto" | "manual">("global");
  // Canal
  const [activarChatDay, setActivarChatDay] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ProvisionResp | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setRes(null);
    try {
      const body = {
        email: email.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        days: Number(days) || 0,
        activarChatDay,
        config: {
          brandName: brandName.trim() || null,
          primaryColor, accentColor, chatTheme,
          welcomeMsgText: welcomeMsgText.trim() || null,
          chatPlatformUrl: chatPlatformUrl.trim() || null,
          chatPayCbu: chatPayCbu.trim() || null,
          chatPayAlias: chatPayAlias.trim() || null,
          chatPayTitular: chatPayTitular.trim() || null,
          botEnabled,
          botWelcome: botWelcome.trim() || null,
          ...(casinoApiKey.trim() ? { casinoApiKey: casinoApiKey.trim() } : {}),
          // "global" = que lo decida el server como hasta ahora (no mandamos el campo).
          ...(autoCredit === "global" ? {} : { casinoAutoCredit: autoCredit === "auto" }),
        },
      };
      const { data } = await api.post<ProvisionResp>("/api/admin/clients/provision", body);
      setRes(data);
    } catch (e) { setError(apiError(e)); }
    finally { setBusy(false); }
  };

  if (res) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-xl font-bold text-slate-100">✅ Cliente creado</h1>
        <Card className="space-y-3">
          <h3 className="font-semibold text-slate-100">Credenciales para pasarle al cliente</h3>
          <p className="text-xs text-amber-300">La contraseña se muestra una sola vez: copiala ahora.</p>
          <pre className="bg-slate-900 rounded p-3 text-sm text-slate-200 whitespace-pre-wrap break-all">
{`Panel: ${res.credenciales.panel}
Usuario: ${res.credenciales.email}
Contraseña: ${res.credenciales.password}`}
          </pre>
          <Button type="button" onClick={() => void navigator.clipboard.writeText(
            `Panel: ${res.credenciales.panel}\nUsuario: ${res.credenciales.email}\nContraseña: ${res.credenciales.password}`
          )}>📋 Copiar credenciales</Button>
        </Card>

        {res.estado && (
          <>
            <Card className="space-y-3">
              <h3 className="font-semibold text-slate-100">Links del jugador</h3>
              <pre className="bg-slate-900 rounded p-3 text-sm text-slate-200 whitespace-pre-wrap break-all">
{`Registro:     ${res.estado.links.registro}
Chat directo: ${res.estado.links.chatDirecto}`}
              </pre>
            </Card>
            <Card className="space-y-2">
              <h3 className="font-semibold text-slate-100">
                {res.estado.listo ? "Listo para operar" : "Falta completar"}
              </h3>
              {res.estado.items.map((i) => (
                <div key={i.key} className="flex items-start gap-2 text-sm">
                  <span>{i.ok ? "✅" : "⚠️"}</span>
                  <span className="text-slate-300">
                    <b>{ETIQUETAS[i.key] ?? i.key}:</b> <span className="text-slate-400">{i.detalle}</span>
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}
        <Button type="button" variant="secondary" onClick={() => setRes(null)}>Dar de alta otro cliente</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Alta de cliente</h1>
        <p className="text-sm text-slate-400">Cargá todo acá y la cuenta queda configurada y lista para operar.</p>
      </div>
      {error && <ErrorMsg>{error}</ErrorMsg>}

      <Seccion titulo="Cuenta" ayuda="Con lo que el cliente entra al panel.">
        <Campo label="Email *"><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="cliente@mail.com" /></Campo>
        <Campo label="Nombre / marca comercial"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ganamos Online" /></Campo>
        <Campo label="WhatsApp"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5491122334455" /></Campo>
        <Campo label="Contraseña (vacío = se genera sola)"><Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="se genera automáticamente" /></Campo>
        <Campo label="Días de saldo iniciales"><Input value={days} onChange={(e) => setDays(e.target.value)} type="number" min="0" /></Campo>
        <Campo label="Encender el canal ahora">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={activarChatDay} onChange={(e) => setActivarChatDay(e.target.checked)} />
            Activar el día de Chat App (consume 1 día)
          </label>
        </Campo>
      </Seccion>

      <Seccion titulo="Marca" ayuda="Lo que ve el jugador en la app.">
        <Campo label="Nombre de marca"><Input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Ganamos Online" /></Campo>
        <Campo label="Link de la plataforma de juego"><Input value={chatPlatformUrl} onChange={(e) => setChatPlatformUrl(e.target.value)} placeholder="https://..." /></Campo>
        <Campo label="Color principal"><Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} type="color" className="h-10 w-20 p-1" /></Campo>
        <Campo label="Color de acento"><Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} type="color" className="h-10 w-20 p-1" /></Campo>
        <Campo label="Diseño del chat">
          <select value={chatTheme} onChange={(e) => setChatTheme(e.target.value)} className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100">
            <option value="whatsapp">WhatsApp</option>
            <option value="midnight">Midnight</option>
            <option value="redblack">Red/Black</option>
          </select>
        </Campo>
        <Campo label="Primer mensaje del chat"><Input value={welcomeMsgText} onChange={(e) => setWelcomeMsgText(e.target.value)} placeholder="¡Hola! ¿En qué te ayudo?" /></Campo>
      </Seccion>

      <Seccion titulo="Datos de pago" ayuda="A dónde transfiere el jugador. Si la cuenta usa la recaudadora del casino, el CVU lo pone el sistema y esto queda de respaldo.">
        <Campo label="CBU / CVU"><Input value={chatPayCbu} onChange={(e) => setChatPayCbu(e.target.value)} /></Campo>
        <Campo label="Alias"><Input value={chatPayAlias} onChange={(e) => setChatPayAlias(e.target.value)} /></Campo>
        <Campo label="Titular"><Input value={chatPayTitular} onChange={(e) => setChatPayTitular(e.target.value)} /></Campo>
      </Seccion>

      <Seccion titulo="Bot de carga y descarga">
        <Campo label="Bot">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={botEnabled} onChange={(e) => setBotEnabled(e.target.checked)} />
            Prendido
          </label>
        </Campo>
        <Campo label="Saludo del bot"><Input value={botWelcome} onChange={(e) => setBotWelcome(e.target.value)} placeholder="¡Bienvenido! ¿Qué querés hacer?" /></Campo>
      </Seccion>

      <Seccion titulo="Casino" ayuda="Solo si el cliente opera con la API del casino. Sin esto el cajero acredita a mano.">
        <Campo label="API key del casino (se guarda cifrada)"><Input value={casinoApiKey} onChange={(e) => setCasinoApiKey(e.target.value)} placeholder="ptk_..." /></Campo>
        <Campo label="Acreditación de las cargas">
          <select value={autoCredit} onChange={(e) => setAutoCredit(e.target.value as typeof autoCredit)} className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100">
            <option value="global">Como el resto (configuración del servidor)</option>
            <option value="auto">Automática (la acredita el casino)</option>
            <option value="manual">Manual (la aprueba el cajero)</option>
          </select>
        </Campo>
      </Seccion>

      <Button type="submit" disabled={busy || !email.trim()}>{busy ? "Creando…" : "Crear cliente"}</Button>
    </form>
  );
}
