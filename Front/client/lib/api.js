const browserHost =
    typeof window !== "undefined" && window.location?.hostname
        ? window.location.hostname
        : "127.0.0.1";

export const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
    `http://${browserHost}:4000`;

export async function request(path, options) {
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
        } catch {
            message = response.statusText || message;
        }
        throw new Error(message);
    }
    if (response.status === 204) {
        return {};
    }
    return await response.json();
}
