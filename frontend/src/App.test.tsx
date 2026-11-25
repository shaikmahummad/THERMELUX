import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { BrowserRouter } from "react-router-dom";

vi.mock("./WallScene", () => ({ default: () => <div data-testid="wall-scene">Interactive wall view</div> }));

const mockResult = {
  mode: "steady",
  positions_m: [0, 0.1, 0.2],
  temperatures_c: [1000, 500, 100],
  temperature_history_c: [[1000, 500, 100]],
  times_s: [0],
  heat_flux_w_m2: [1000, 1000, 1000],
  heat_flux_positions_m: [0, 0.1, 0.2],
  gradient_heat_flux_w_m2: [1000, 1000, 1000],
  reference_heat_flux_w_m2: 1000,
  average_heat_flux_w_m2: 1000,
  maximum_heat_flux_w_m2: 1000,
  minimum_heat_flux_w_m2: 1000,
  relative_error_percent: 0,
  total_thickness_m: 0.2,
  sensor_measurements: [],
  sensor_interval_heat_flux_w_m2: [],
  interfaces: [],
  layers: [],
  grid_nodes: 3,
  final_time_s: 0,
  energy_balance: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/api/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    if (path.endsWith("/api/materials")) return new Response(JSON.stringify([]), { status: 200 });
    return new Response(JSON.stringify({ id: null, config: {}, result: mockResult }), { status: 200 });
  }));
});

describe("THERMALUX application", () => {
  it("shows navigation and loads a simulation", async () => {
    render(<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></BrowserRouter>);
    fireEvent.click(screen.getByRole("link", { name: /simulation workspace/i }));
    expect(await screen.findByRole("heading", { name: "Heat transfer workspace" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("img", { name: "Temperature chart" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("link", { name: /heat flux analysis/i }));
    expect(screen.getByRole("heading", { level: 1, name: "Heat flux analysis" })).toBeInTheDocument();
  });

  it("provides an actionable material explorer", async () => {
    render(<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App /></BrowserRouter>);
    fireEvent.click(screen.getByRole("link", { name: /material explorer/i }));
    expect(await screen.findByText("Material library")).toBeInTheDocument();
    expect(screen.getByLabelText("Search materials")).toBeInTheDocument();
  });
});
