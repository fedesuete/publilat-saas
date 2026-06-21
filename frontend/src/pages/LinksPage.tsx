import { useState } from "react";
import { useAuth } from "../lib/auth";
import { API_BASE } from "../lib/config";
import { Button, Input, Card } from "../components/ui";

function buildDirect(slug: string, msg: string, campaign: string, src: string) {
  const params = new URLSearchParams();
  params.set("u", slug);
  params.set("msg", msg);
  if (campaign) params.set("campaign", campaign);
  if (src) params.set("src", src);
  return `${API_BASE}/go?${params.toString()}`;
}

function buildLanding(slug: string, msg: string, campaign: string) {
  const params = new URLSearchParams();
  params.set("msg", msg);
  params.set("title", campaign || "Promo");
  return `${API_BASE}/l/${slug}?${params.toString()}`;
}

function CopyRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <div className="mb-1 text-sm font-semibold">{label}</div>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-300"
        />
        <Button onClick={() => void copy()}>{copied ? "¡Copiado!" : "Copiar"}</Button>
      </div>
    </Card>
  );
}

export default function LinksPage() {
  const { user } = useAuth();
  const slug = user?.slug ?? "";

  const [msg, setMsg] = useState("Hola, quiero info");
  const [campaign, setCampaign] = useState("");
  const [src, setSrc] = useState("");

  const encodedMsg = encodeURIComponent(msg);
  const direct = buildDirect(slug, encodedMsg, campaign, src);
  const landing = buildLanding(slug, encodedMsg, campaign);

  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-bold">Generador de links</h1>
      <p className="mb-5 text-sm text-slate-400">
        Usá estos links en tus anuncios de Meta. Disparan el evento Lead y redirigen
        a WhatsApp con tu mensaje.
      </p>

      <Card className="mb-6 max-w-lg">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Mensaje</label>
            <Input value={msg} onChange={(e) => setMsg(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Campaña (opcional)</label>
            <Input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="black-friday"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Fuente / src (opcional)</label>
            <Input
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              placeholder="ig-feed"
            />
          </div>
        </div>
      </Card>

      <div className="grid max-w-2xl gap-4">
        <CopyRow
          label="Link directo (redirector)"
          url={direct}
          hint="Dispara el Lead y lleva directo a WhatsApp. Ideal para botón de anuncio."
        />
        <CopyRow
          label="Landing rastreada"
          url={landing}
          hint="Página intermedia que captura fbclid/cookies antes de enviar a WhatsApp."
        />
      </div>
    </div>
  );
}
