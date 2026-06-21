import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { apiError } from "../lib/api";
import { Button, Input, ErrorMsg } from "../components/ui";

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [capiToken, setCapiToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        await register({
          email,
          password,
          name: name || undefined,
          pixelId: pixelId || undefined,
          capiToken: capiToken || undefined,
        });
      } else {
        await login(email, password);
      }
      navigate("/leads");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-800/60 p-6 shadow-xl">
        <h1 className="mb-1 text-center text-2xl font-bold">
          Publi<span className="text-wa-green">.lat</span>
        </h1>
        <p className="mb-5 text-center text-sm text-slate-400">
          Atribución WhatsApp → Meta Ads
        </p>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-slate-900 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded py-1.5 font-medium transition ${
              !isRegister ? "bg-wa-green text-slate-900" : "text-slate-300"
            }`}
          >
            Ingresar
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`rounded py-1.5 font-medium transition ${
              isRegister ? "bg-wa-green text-slate-900" : "text-slate-300"
            }`}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {isRegister && (
            <Input
              type="text"
              placeholder="Nombre (opcional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Contraseña"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {isRegister && (
            <>
              <Input
                type="text"
                placeholder="Pixel ID (opcional)"
                value={pixelId}
                onChange={(e) => setPixelId(e.target.value)}
              />
              <Input
                type="text"
                placeholder="CAPI Token (opcional)"
                value={capiToken}
                onChange={(e) => setCapiToken(e.target.value)}
              />
              <p className="text-xs text-slate-500">
                Opcional, para enviar eventos con tu propio Pixel.
              </p>
            </>
          )}

          {error && <ErrorMsg>{error}</ErrorMsg>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Procesando…" : isRegister ? "Crear cuenta" : "Ingresar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
