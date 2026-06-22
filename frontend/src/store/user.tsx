import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api, type CurrentUser } from "@/src/api";
import { storage } from "@/src/utils/storage";

const USER_TOKEN_KEY = "user_token_v1";
const USER_INFO_KEY = "user_info_v1";

type UserContextValue = {
  user: CurrentUser | null;
  token: string | null;
  ready: boolean;
  isAuthenticated: boolean;
  signIn: (token: string, user: CurrentUser) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const t = (await storage.getItem(USER_TOKEN_KEY, "")) as string;
      const raw = (await storage.getItem(USER_INFO_KEY, "")) as string;
      if (t) setToken(t);
      if (raw) {
        try {
          setUser(JSON.parse(raw));
        } catch { /* ignore */ }
      }
      setReady(true);
    })();
  }, []);

  // Whenever the token changes, broadcast it to the API client so subsequent
  // requests include the Authorization header.
  useEffect(() => {
    api.setUserToken(token);
  }, [token]);

  const signIn = useCallback(async (newToken: string, newUser: CurrentUser) => {
    await storage.setItem(USER_TOKEN_KEY, newToken);
    await storage.setItem(USER_INFO_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const signOut = useCallback(async () => {
    await storage.removeItem(USER_TOKEN_KEY);
    await storage.removeItem(USER_INFO_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const u = await api.getCurrentUser();
      setUser(u);
      await storage.setItem(USER_INFO_KEY, JSON.stringify(u));
    } catch (e: any) {
      // 401 → token is no longer valid
      if (String(e?.message || "").includes("401") || String(e?.message || "").toLowerCase().includes("non connecté")) {
        await signOut();
      }
    }
  }, [token, signOut]);

  // On mount, validate the existing token by fetching /auth/me
  useEffect(() => {
    if (ready && token && !user) refresh();
  }, [ready, token, user, refresh]);

  const value = useMemo<UserContextValue>(
    () => ({
      user,
      token,
      ready,
      isAuthenticated: !!token && !!user,
      signIn,
      signOut,
      refresh,
    }),
    [user, token, ready, signIn, signOut, refresh],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
