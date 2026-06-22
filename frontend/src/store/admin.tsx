import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { api, setAdminToken as setApiToken } from "@/src/api";
import { storage } from "@/src/utils/storage";

const KEY = "admin_token_v1";

type AdminCtx = {
  ready: boolean;
  isAuthenticated: boolean;
  login: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AdminCtx | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const t = (await storage.getItem(KEY, "")) as string;
      if (t) {
        setToken(t);
        setApiToken(t);
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (pin: string) => {
    const res = await api.adminLogin(pin);
    setToken(res.access_token);
    setApiToken(res.access_token);
    await storage.setItem(KEY, res.access_token);
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    setApiToken(null);
    await storage.removeItem(KEY);
  }, []);

  return (
    <Ctx.Provider value={{ ready, isAuthenticated: !!token, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdmin(): AdminCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
