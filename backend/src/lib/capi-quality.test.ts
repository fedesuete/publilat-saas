import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import axios from "axios";

// Mocks mínimos: axios (no pegarle a Meta) + módulos con side-effects (DB/socket/IA).
vi.mock("axios", () => ({
  default: { post: vi.fn(async () => ({ data: { events_received: 1 } })), isAxiosError: () => false },
}));
vi.mock("./pixel.js", () => ({
  resolveUserPixel: vi.fn(async () => ({ pixelId: "pix-1", capiToken: "tok-1" })),
  resolveShadowPixels: vi.fn(async () => []),
}));
vi.mock("./prisma.js", () => ({
  prisma: {
    metaEvent: {
      create: vi.fn(async () => ({ id: "me-1" })),
      update: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
    },
  },
}));
vi.mock("./capi-guard.js", () => ({ notifyMissingPixel: vi.fn() }));
vi.mock("./io.js", () => ({ emitToUser: vi.fn() }));
vi.mock("./funnel-detect.js", () => ({ looksLikeCredentials: vi.fn(async () => false) }));

import { injectGoTracking, renderTrackedLanding, type LandingConfig } from "./landing-template.js";
import { sendCapiEvent } from "./meta-capi.js";
import { fireMetaEvent } from "./meta-events.js";

const sha = (v: string) => crypto.createHash("sha256").update(v.trim().toLowerCase()).digest("hex");
const lastBody = () =>
  (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as {
    data: Array<{ user_data: Record<string, string> }>;
  };
const FBQ_LEAD = /fbq\(\s*['"]track['"]\s*,\s*['"]Lead['"]/;

// ===== El pixel del navegador NO dispara más Lead en el clic =====
// El Lead quedó server-side en el primer inbound (BUG 1 fix, e9b03d6). Mandarlo TAMBIÉN por el
// navegador en cada clic re-mete la señal sucia que ese fix quiso matar (clics que no escriben)
// y genera el warning de cobertura de Meta. eid/fbp/fbc se siguen capturando: los usa el CAPI.
describe("landing sin Lead de navegador", () => {
  const cfg: LandingConfig = {
    pixelId: "123", userSlug: "matias", goBase: "https://app.publi.lat", title: "t",
    headline: "h", subtitle: "s", buttonText: "b", msg: "hola",
  };

  it("injectGoTracking NO dispara fbq Lead en el clic", () => {
    const out = injectGoTracking("<html><body><a href='/go?u=x'>ir</a></body></html>", "https://app.publi.lat");
    expect(out).not.toMatch(FBQ_LEAD);
  });

  it("injectGoTracking sigue capturando eid/fbp/fbc para el Lead server-side", () => {
    const out = injectGoTracking("<html><body></body></html>");
    expect(out).toContain("p.set('eid',id)");
    expect(out).toContain("_fbp");
    expect(out).toContain("_fbc");
  });

  it("renderTrackedLanding (whatsapp y chatapp) NO dispara fbq Lead y conserva PageView + eid", () => {
    for (const destino of [undefined, "chatapp"] as const) {
      const html = renderTrackedLanding({ ...cfg, destino, chatBase: "https://chat.publi.lat" });
      expect(html).not.toMatch(FBQ_LEAD);
      expect(html).toContain("fbq('track', 'PageView')");
      expect(html).toContain("p.set('eid', eid)");
    }
  });
});

// ===== fn/ln: el apellido deja de descartarse =====
describe("sendCapiEvent separa nombre y apellido", () => {
  it("nombre completo → fn=primer nombre, ln=último apellido (ambos sha256)", async () => {
    await sendCapiEvent({
      eventName: "Lead", externalId: "x1", firstName: "Juan Carlos Pérez",
      pixelId: "pix-1", capiToken: "tok-1", eventId: "e1",
    });
    const ud = lastBody().data[0].user_data;
    expect(ud.fn).toBe(sha("Juan"));
    expect(ud.ln).toBe(sha("Pérez"));
  });

  it("un solo nombre → fn sin ln", async () => {
    await sendCapiEvent({
      eventName: "Lead", externalId: "x2", firstName: "Karen",
      pixelId: "pix-1", capiToken: "tok-1", eventId: "e2",
    });
    const ud = lastBody().data[0].user_data;
    expect(ud.fn).toBe(sha("Karen"));
    expect(ud.ln).toBeUndefined();
  });
});

// ===== El Lead del inbound adjunta IP/UA guardados del clic =====
// /go ya persiste clientIp/clientUserAgent en el contacto (e82ec21); el Purchase ya los manda
// (EMQ 7.8 vs 6.4 del Lead). fireMetaEvent tiene que pasarlos igual que el resto del user_data.
describe("fireMetaEvent adjunta IP/UA del contacto", () => {
  it("client_ip_address y client_user_agent van en el user_data del Lead", async () => {
    const r = await fireMetaEvent(
      {
        id: "c1", userId: "u1", externalId: "ext-1", phone: "5491100000000",
        clientIp: "181.10.20.30", clientUserAgent: "Mozilla/5.0 (Linux; Android 14) Prueba",
      },
      "Lead",
    );
    expect(r.ok).toBe(true);
    const ud = lastBody().data[0].user_data;
    expect(ud.client_ip_address).toBe("181.10.20.30");
    expect(ud.client_user_agent).toBe("Mozilla/5.0 (Linux; Android 14) Prueba");
  });

  it("contacto sin IP/UA (pre-captura) → el evento sale igual, sin esos campos", async () => {
    const r = await fireMetaEvent({ id: "c2", userId: "u1", externalId: "ext-2" }, "Lead");
    expect(r.ok).toBe(true);
    const ud = lastBody().data[0].user_data;
    expect(ud.client_ip_address).toBeUndefined();
    expect(ud.client_user_agent).toBeUndefined();
  });
});
