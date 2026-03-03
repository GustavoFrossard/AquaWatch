const browserHost =
    typeof window !== "undefined" && window.location?.hostname
        ? window.location.hostname
        : "127.0.0.1";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
    `http://${browserHost}:4000`;
async function request(path, options) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
        ...options,
    });
    if (!response.ok) {
        let message = "Request failed";
        try {
            const data = await response.json();
            message = data?.detail ?? data?.message ?? message;
        }
        catch {
            message = response.statusText || message;
        }
        throw new Error(message);
    }
    if (response.status === 204) {
        return {};
    }
    return (await response.json());
}
export async function register(payload) {
    return request("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}
export async function login(payload) {
    return request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}
export async function getMe() {
    return request("/api/auth/me");
}
export async function logout() {
    await request("/api/auth/logout", {
        method: "POST",
    });
}
