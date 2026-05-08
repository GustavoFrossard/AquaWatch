import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from "@/lib/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const result = await getMe();
      setUser(result.user);
      localStorage.setItem("userSession", JSON.stringify(result.user));
      return result.user;
    } catch {
      setUser(null);
      localStorage.removeItem("userSession");
      return null;
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (payload) => {
    const result = await apiLogin(payload);
    setUser(result.user);
    localStorage.setItem("userSession", JSON.stringify(result.user));
    return result;
  }, []);

  const register = useCallback(async (payload) => {
    const result = await apiRegister(payload);
    setUser(result.user);
    localStorage.setItem("userSession", JSON.stringify(result.user));
    return result;
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch {}
    setUser(null);
    localStorage.removeItem("userSession");
  }, []);

  const updateUser = useCallback((newUser) => {
    setUser(newUser);
    localStorage.setItem("userSession", JSON.stringify(newUser));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
