// Prueba end-to-end del loop de atribución (Fase 1).
// Requiere el backend corriendo (npm run dev) en APP_BASE_URL.
//
//   npm run e2e
//
// Recorre: register -> /go (Lead) -> GET /api/leads -> purchase (Purchase)
// e imprime las respuestas de la CAPI para cruzar con el Test Events Tool de Meta.
import "dotenv/config";
import axios from "axios";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:4000";
const log = (...a: unknown[]) => console.log("•", ...a);

async function main() {
  const stamp = Date.now();
  const email = `e2e+${stamp}@publi.lat`;
  const password = "test1234!";

  // 1) Registro (usa el pixel/token del .env si están presentes, para que el evento matchee).
  const pixelId = process.env.META_PIXEL_ID;
  const capiToken = process.env.META_CAPI_TOKEN;
  const reg = await axios.post(`${BASE}/api/auth/register`, {
    email,
    password,
    name: `E2E ${stamp}`,
    ...(pixelId && capiToken ? { pixelId, capiToken } : {}),
  });
  const { token, user } = reg.data as { token: string; user: { slug: string } };
  log("registrado:", email, "slug:", user.slug);

  // 2) Simular el clic en el link rastreado -> dispara Lead por CAPI.
  const goUrl =
    `${BASE}/go?u=${user.slug}` +
    `&pixel=${pixelId ?? "TESTPIXEL"}` +
    `&msg=${encodeURIComponent("Hola, quiero info")}` +
    `&fbclid=e2e-${stamp}&campaign=cmp-123&src=ig`;
  const go = await axios.get(goUrl, {
    maxRedirects: 0,
    validateStatus: (s) => s === 302,
  });
  const location = go.headers["location"] as string;
  const code = decodeURIComponent(location).match(/ref:\s*([A-F0-9]+)/)?.[1];
  log("/go -> 302", location);
  log("código de re-identificación:", code);

  // Dar tiempo a que el Lead (background) se envíe y loguee.
  await new Promise((r) => setTimeout(r, 1500));

  // 3) Listar leads y tomar el recién creado.
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const list = await axios.get(`${BASE}/api/leads`, auth);
  const lead = (list.data.leads as Array<{ id: string; code: string; stage: string }>).find(
    (l) => l.code === code
  );
  if (!lead) throw new Error("No se encontró el lead recién creado");
  log("lead:", lead.id, "stage:", lead.stage);

  // 4) Marcar la compra -> dispara Purchase con el MISMO externalId/fbp/fbc + value.
  const purchase = await axios.post(
    `${BASE}/api/leads/${lead.id}/purchase`,
    { amount: 1500.0, currency: "ARS" },
    { ...auth, validateStatus: () => true }
  );
  log("purchase status:", purchase.status);
  console.log(JSON.stringify(purchase.data, null, 2));

  console.log("\n— Verificación —");
  if (!pixelId || !capiToken) {
    console.log(
      "META_PIXEL_ID/META_CAPI_TOKEN no configurados: el flujo corrió pero los eventos\n" +
        "a Meta fallaron (esperado). Cargalos en .env + META_TEST_EVENT_CODE y reintentá."
    );
  } else {
    console.log(
      "Revisá el Test Events Tool de Meta: deberías ver Lead y Purchase con el mismo\n" +
        "external_id y un buen Event Match Quality. La respuesta CAPI de arriba trae\n" +
        "events_received y fbtrace_id."
    );
  }
}

main().catch((e) => {
  console.error("E2E falló:", e?.response?.data ?? e?.message ?? e);
  process.exit(1);
});
