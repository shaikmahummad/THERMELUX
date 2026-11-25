export type Layer = {
  name: string;
  thickness_m: number;
  conductivity_w_mk: number;
  density_kg_m3: number;
  specific_heat_j_kgk: number;
};

export type Config = {
  inner_temperature_c: number;
  outer_temperature_c: number;
  initial_temperature_c: number;
  layers: Layer[];
  nodes: number;
  duration_s: number;
  time_step_s: number;
  mode: "steady" | "transient";
  noise_std_c: number;
  sensor_positions_m: number[];
  random_seed: number;
};

export type SimulationResult = {
  mode: string;
  positions_m: number[];
  temperatures_c: number[];
  temperature_history_c: number[][];
  times_s: number[];
  heat_flux_w_m2: number[];
  heat_flux_positions_m: number[];
  gradient_heat_flux_w_m2: number[];
  reference_heat_flux_w_m2: number;
  average_heat_flux_w_m2: number;
  maximum_heat_flux_w_m2: number;
  minimum_heat_flux_w_m2: number;
  relative_error_percent: number;
  total_thickness_m: number;
  sensor_measurements: { id: string; position_m: number; temperature_c: number; measured_temperature_c: number; noise_c: number; temperature_history_c: number[] }[];
  sensor_interval_heat_flux_w_m2: { start_m: number; end_m: number; ideal_heat_flux_w_m2: number; measured_heat_flux_w_m2: number }[];
  interfaces: { position_m: number; temperature_c: number }[];
  layers: { name: string; thickness_m: number; conductivity_w_mk: number; temperature_drop_c: number }[];
  grid_nodes: number;
  final_time_s: number;
  energy_balance: { stored_energy_change_j_m2: number; net_boundary_heat_j_m2: number; relative_error_percent: number } | null;
};

export type SimulationEnvelope = { id: string | null; config: Config; result: SimulationResult };

export const initialConfig: Config = {
  inner_temperature_c: 1000,
  outer_temperature_c: 100,
  initial_temperature_c: 20,
  layers: [
    { name: "Dense fireclay brick", thickness_m: 0.12, conductivity_w_mk: 1.4, density_kg_m3: 2100, specific_heat_j_kgk: 1000 },
    { name: "Ceramic fiber insulation", thickness_m: 0.08, conductivity_w_mk: 0.16, density_kg_m3: 160, specific_heat_j_kgk: 1050 },
    { name: "Steel casing", thickness_m: 0.008, conductivity_w_mk: 45, density_kg_m3: 7850, specific_heat_j_kgk: 480 },
  ],
  nodes: 121,
  duration_s: 3600,
  time_step_s: 60,
  mode: "steady",
  noise_std_c: 0.5,
  sensor_positions_m: [],
  random_seed: 7,
};
