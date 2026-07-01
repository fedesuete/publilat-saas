import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { api } from "./api";
import { USER_KEY } from "./config";
import { disconnectSocket } from "./socket";
import type { User } from "./types";

export interface RegisterPayload {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean; // true mientras validamos la sesión (cookie) con /me
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // El JWT vive en una cookie httpOnly (no accesible por JS). En localStorage sólo
  // guardamos el usuario (dato no sensible) para pintar la UI al instante; /me valida.
  const [user, setUser] = useState<User | null>(() => readUser());
  const [loading, setLoading] = useState(true);

  const setSession = useCallback((nextUser: User) => {
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<{ user: User }>("/api/auth/login", { email, password });
      setSession(data.user);
    },
    [setSession]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const { data } = await api.post<{ user: User }>("/api/auth/register", payload);
      setSession(data.user);
    },
    [setSession]
  );

  // Al cargar, validamos la sesión con la cookie (/me). Si es válida, refresca el usuario;
  // si no, quedamos deslogueados (el interceptor 401 ya limpia y redirige donde corresponde).
  useEffect(() => {
    api
      .get<{ user: User }>("/api/auth/me")
      .then(({ data }) => setSession(data.user))
      .catch(() => {
        localStorage.removeItem(USER_KEY);
        setUser(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(() => {
    void api.post("/api/auth/logout").catch(() => undefined); // borra la cookie httpOnly
    localStorage.removeItem(USER_KEY);
    setUser(null);
    disconnectSocket();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
