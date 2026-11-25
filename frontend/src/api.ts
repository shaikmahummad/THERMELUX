import type { Config, SimulationEnvelope, SimulationResult } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("Cannot reach the simulation API. Start the backend at localhost:8000 and retry.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (${response.status}).`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const api = {
  run: (config: Config) =>
    request<SimulationEnvelope>("/api/simulations/run", { method: "POST", body: JSON.stringify(config) }),
  save: (config: Config) =>
    request<SimulationEnvelope>("/api/simulations/save", { method: "POST", body: JSON.stringify(config) }),
  list: () => request<{ id: string; created_at: string; config: Config; result: SimulationResult }[]>("/api/simulations"),
  validate: (config: Config) =>
    request<{
      reference_heat_flux_w_m2: number;
      results: { grid_nodes: number; heat_flux_w_m2: number; relative_error_percent: number; passed: boolean }[];
      passed: boolean;
      tolerance_percent: number;
      energy_balance: { stored_energy_change_j_m2: number; net_boundary_heat_j_m2: number; relative_error_percent: number; tolerance_percent: number; passed: boolean };
    }>(
      "/api/simulations/validate",
      { method: "POST", body: JSON.stringify(config) },
    ),
  estimate: (config: Config) =>
    request<{ reference_heat_flux_w_m2: number; gradient_heat_flux_w_m2: number[]; sensor_interval_heat_flux_w_m2: SimulationResult["sensor_interval_heat_flux_w_m2"] }>(
      "/api/simulations/estimate-heat-flux",
      { method: "POST", body: JSON.stringify(config) },
    ),
  materials: () =>
    request<{ name: string; conductivity_w_mk: number; density_kg_m3: number; specific_heat_j_kgk: number; range_c: string; source_note: string }[]>("/api/materials"),
  pdf: async (config: Config) => {
    const response = await fetch(`${API_URL}/api/reports/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(typeof body?.detail === "string" ? body.detail : `PDF generation failed (${response.status}).`);
    }
    return response.blob();
  },
  health: () => request<{ status: string }>("/api/health"),
};
