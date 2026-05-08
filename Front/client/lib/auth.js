import { request } from "./api";

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

// ── Observations API ──

export async function createObservation(payload) {
    return request("/api/observations", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function getObservations() {
    return request("/api/observations");
}

export async function getObservationStats() {
    return request("/api/observations/stats");
}

export async function deleteObservation(id) {
    return request(`/api/observations/${id}`, {
        method: "DELETE",
    });
}
