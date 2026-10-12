import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { get, getToken, setToken, type Role } from "./api";

type Me = { id: string; role: Role } | null;
const Ctx = createContext<{ me: Me; loading: boolean; login: (t: string) => Promise<void>; logout: () => void }>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me>(null);
  const [loading, setLoading] = useState(!!getToken());
  const load = async () => { try { setMe(await get("/api/auth/me")); } catch { setMe(null); } finally { setLoading(false); } };
  useEffect(() => { if (getToken()) void load(); }, []);
  return (
    <Ctx.Provider value={{ me, loading, login: async (t) => { setToken(t); await load(); }, logout: () => { setToken(null); setMe(null); } }}>
      {children}
    </Ctx.Provider>
  );
}

export const canEdit = (r?: Role) => r === "operator" || r === "admin";
export const isAdmin = (r?: Role) => r === "admin";
