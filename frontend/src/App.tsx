import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity, ArrowDownToLine, ArrowLeftRight, Box, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, Cpu, Database, Download, Flame, Gauge,
  Layers3, LayoutDashboard, LineChart as LineChartIcon, LoaderCircle, Menu, Play, Plus, Radio,
  RotateCcw, Save, Settings2, ShieldCheck, Thermometer, TriangleAlert, X,
} from "lucide-react";
import { api } from "./api";
import { initialConfig } from "./types";
import type { Config, Layer, SimulationEnvelope, SimulationResult } from "./types";
const WallVisualization = lazy(() => import("./WallScene"));

const navigation = [
  { label: "Overview", path: "/", icon: LayoutDashboard },
  { label: "Simulation workspace", path: "/workspace", icon: Settings2 },
  { label: "Temperature analysis", path: "/temperature", icon: Thermometer },
  { label: "Heat flux analysis", path: "/heat-flux", icon: Activity },
  { label: "Material explorer", path: "/materials", icon: Box },
  { label: "Scenario comparison", path: "/compare", icon: ArrowLeftRight },
  { label: "Validation lab", path: "/validation", icon: ShieldCheck },
  { label: "Reports", path: "/reports", icon: ArrowDownToLine },
];

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function useSimulation() {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [envelope, setEnvelope] = useState<SimulationEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const run = useCallback(async (nextConfig = config, save = false) => {
    setBusy(true);
    setMessage("");
    try {
      const response = save ? await api.save(nextConfig) : await api.run(nextConfig);
      setConfig(nextConfig);
      setEnvelope(response);
      if (save) setMessage("Simulation saved to this device.");
      return response;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Simulation could not be completed.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [config]);

  useEffect(() => {
    void run(initialConfig);
  }, []); // Initial deterministic reference case.

  return { config, setConfig, envelope, setEnvelope, busy, message, setMessage, run };
}

function ProfileChart({
  x,
  y,
  color = "#ff7448",
  label,
  unit,
  secondary,
  xSuffix = "m",
}: {
  x: number[];
  y: number[];
  color?: string;
  label: string;
  unit: string;
  secondary?: { x?: number[]; y: number[]; color: string; label: string };
  xSuffix?: string;
}) {
  if (y.length === 0) return <div className="chart-empty">Not enough data points to plot this series.</div>;
  const width = 720;
  const height = 220;
  const pad = { left: 54, right: 18, top: 16, bottom: 34 };
  const values = secondary ? [...y, ...secondary.y] : y;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xStart = x[0] ?? 0;
  const xEnd = x[x.length - 1] ?? 1;
  const makePoints = (series: number[], seriesX: number[] = x) =>
    series.map((value, index) => {
      const position = seriesX[index] ?? x[index] ?? xStart;
      const px = pad.left + ((position - xStart) / (xEnd - xStart || 1)) * (width - pad.left - pad.right);
      const py = pad.top + (1 - (value - min) / span) * (height - pad.top - pad.bottom);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");
  return (
    <div className="chart-wrap" role="img" aria-label={`${label} chart`}>
      <div className="chart-legend">
        <span><i style={{ background: color }} />{label}</span>
        {secondary && <span><i style={{ background: secondary.color }} />{secondary.label}</span>}
        <span className="chart-unit">{unit}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" preserveAspectRatio="none">
        {[0, 1, 2, 3].map((step) => {
          const py = pad.top + step * ((height - pad.top - pad.bottom) / 3);
          const value = max - (step / 3) * span;
          return <g key={step}><line x1={pad.left} y1={py} x2={width - pad.right} y2={py} className="gridline" /><text x={pad.left - 8} y={py + 4} textAnchor="end" className="axis-label">{formatNumber(value, 0)}</text></g>;
        })}
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="axis-line" />
        <polyline points={makePoints(y)} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {secondary && <polyline points={makePoints(secondary.y, secondary.x)} fill="none" stroke={secondary.color} strokeWidth="1.8" strokeDasharray="5 5" />}
        <text x={pad.left} y={height - 8} className="axis-label">{formatNumber(xStart, 2)}</text>
        <text x={width - pad.right} y={height - 8} textAnchor="end" className="axis-label">{formatNumber(xEnd, 2)} {xSuffix}</text>
      </svg>
    </div>
  );
}

function Metric({ label, value, unit, icon: Icon, hint }: { label: string; value: string; unit: string; icon: typeof Gauge; hint?: string }) {
  return (
    <article className="metric">
      <div className="metric-head"><span>{label}</span><Icon size={16} /></div>
      <div className="metric-value">{value}<small>{unit}</small></div>
      {hint && <div className="metric-hint">{hint}</div>}
    </article>
  );
}

function Panel({ title, eyebrow, action, children, className = "" }: { title: string; eyebrow?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{action}</div>{children}</section>;
}

function App() {
  const simulation = useSimulation();
  const { config, setConfig, envelope, busy, message, setMessage, run } = simulation;
  const result = envelope?.result ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const [apiOnline, setApiOnline] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [materials, setMaterials] = useState<Awaited<ReturnType<typeof api.materials>>>([]);
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof api.validate>> | null>(null);
  const [comparison, setComparison] = useState<SimulationResult | null>(null);
  const [saved, setSaved] = useState<{ id: string; created_at: string; config: Config; result: SimulationResult }[]>([]);

  useEffect(() => {
    void api.health().then(() => setApiOnline(true)).catch(() => setApiOnline(false));
    void api.materials().then(setMaterials).catch(() => undefined);
    void api.list().then(setSaved).catch(() => undefined);
  }, []);

  const page = navigation.find((item) => item.path === location.pathname) ?? navigation[0];
  const updateLayer = (index: number, patch: Partial<Layer>) => {
    setConfig((current) => ({ ...current, layers: current.layers.map((layer, i) => i === index ? { ...layer, ...patch } : layer) }));
  };
  const addLayer = () => setConfig((current) => ({
    ...current,
    layers: [...current.layers, { name: "Custom refractory layer", thickness_m: 0.04, conductivity_w_mk: 0.35, density_kg_m3: 800, specific_heat_j_kgk: 950 }],
  }));
  const onRun = () => void run(config);
  const save = async () => {
    const response = await run(config, true);
    if (response) void api.list().then(setSaved);
  };
  const loadSaved = (id: string) => {
    void api.list().then((rows) => {
      const item = rows.find((row) => row.id === id);
      if (item) {
        setConfig(item.config);
        simulation.setEnvelope({ id: item.id, config: item.config, result: item.result });
        setMessage("Saved simulation loaded.");
      }
    }).catch(() => setMessage("Saved simulations could not be loaded."));
  };
  const runValidation = async () => {
    setMessage("");
    try { setValidation(await api.validate(config)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Validation could not be completed."); }
  };
  const runComparison = async () => {
    const changed = { ...config, layers: config.layers.map((layer) => ({ ...layer, thickness_m: layer.thickness_m * 1.25 })) };
    const response = await api.run(changed);
    if (response) setComparison(response.result);
  };
  const exportCsv = () => {
    if (!result) return;
    const interpolate = (x: number, positions: number[], values: number[]) => {
      let right = positions.findIndex((position) => position >= x);
      if (right < 0) right = positions.length - 1;
      const left = Math.max(0, right - 1);
      if (left === right) return values[left];
      const fraction = (x - positions[left]) / (positions[right] - positions[left]);
      return values[left] + fraction * (values[right] - values[left]);
    };
    const rows = ["depth_m,temperature_C,gradient_estimate_W_m2,numerical_solver_flux_W_m2", ...result.heat_flux_positions_m.map((x, index) =>
      `${x},${interpolate(x, result.positions_m, result.temperatures_c)},${interpolate(x, result.positions_m, result.gradient_heat_flux_w_m2)},${result.heat_flux_w_m2[index]}`,
    )];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "thermalux-results.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const title = page.label === "Simulation workspace" ? "Heat transfer workspace" : page.label;

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Flame size={20} fill="currentColor" /></div><div className="brand-copy"><b>THERMALUX</b><span>THERMAL SIMULATION</span></div></div>
        <div className="workspace-switch"><div className="workspace-icon">F</div><div className="workspace-copy"><strong>Furnace wall study</strong><small>Local workspace</small></div><ChevronDown size={15} /></div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={path} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} title={collapsed ? label : undefined}>
              <Icon size={17} /><span>{label}</span>{path === "/workspace" && busy && <LoaderCircle className="spin" size={14} />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="data-status"><span className={apiOnline ? "status-dot good" : "status-dot"} />{apiOnline ? "Local engine connected" : "Engine disconnected"}</div>
          <button className="nav-link" onClick={() => setCollapsed(!collapsed)}><ChevronLeft className={collapsed ? "rotate" : ""} size={17} /><span>Collapse sidebar</span></button>
          <div className="profile"><div className="profile-avatar">TL</div><div><strong>THERMALUX</strong><small>Engineering suite</small></div><CircleHelp size={17} /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>THERMALUX</span><ChevronRight size={14} /><b>{page.label}</b></div>
          <div className="top-actions"><div className="run-status"><span className="status-dot good" />{busy ? "SOLVING" : result ? "READY" : "IDLE"}</div><span className="unit-chip">SI · °C · W/m²</span><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setCollapsed(!collapsed)}><Menu size={18} /></button><button className="avatar-button" aria-label="Workspace profile">TL</button></div>
        </header>

        <div className="page-content">
          {message && <div className={`notice ${message.includes("cannot") || message.includes("could not") ? "notice-error" : ""}`} role="status"><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage("")}><X size={15} /></button></div>}
          <div className="page-title-row"><div><div className="eyebrow">FURNACE WALL · STUDY 001</div><h1>{title}</h1><p className="subheading">One-dimensional conduction model · constant material properties · fixed surface temperatures</p></div><div className="title-actions"><span className="saved-badge"><span className="status-dot good" />Local autosave ready</span><button className="button button-secondary" onClick={() => void save()} disabled={busy || !result}><Save size={15} />Save run</button><button className="button button-primary" onClick={onRun} disabled={busy}><Play size={15} fill="currentColor" />{busy ? "Solving…" : "Run simulation"}</button></div></div>

          <Routes>
            <Route path="/" element={<Overview result={result} config={config} busy={busy} saved={saved} onLoad={loadSaved} onExport={exportCsv} />} />
            <Route path="/workspace" element={<Workspace config={config} setConfig={setConfig} updateLayer={updateLayer} addLayer={addLayer} result={result} busy={busy} run={onRun} materials={materials} />} />
            <Route path="/temperature" element={<Analysis result={result} kind="temperature" onExport={exportCsv} />} />
            <Route path="/heat-flux" element={<Analysis result={result} kind="flux" onExport={exportCsv} />} />
            <Route path="/materials" element={<Materials materials={materials} config={config} updateLayer={updateLayer} />} />
            <Route path="/compare" element={<Compare result={result} comparison={comparison} runComparison={runComparison} busy={busy} />} />
            <Route path="/validation" element={<Validation validation={validation} runValidation={runValidation} busy={busy} result={result} />} />
            <Route path="/reports" element={<Reports result={result} config={config} saved={saved} onExport={exportCsv} onSave={save} setMessage={setMessage} />} />
            <Route path="*" element={<Overview result={result} config={config} busy={busy} saved={saved} onLoad={loadSaved} onExport={exportCsv} />} />
          </Routes>
          <footer className="footnote"><span><Radio size={13} /> VIRTUAL MEASUREMENTS — generated by the mathematical model, not physical instruments.</span><span>THERMALUX 1.0 <i>·</i> Numerical engineering preview</span></footer>
        </div>
      </main>
      <div className={`loading-strip ${busy ? "loading" : ""}`} />
    </div>
  );
}

function Overview({ result, config, busy, saved, onLoad, onExport }: {
  result: SimulationResult | null; config: Config; busy: boolean;
  saved: { id: string; created_at: string; config: Config; result: SimulationResult }[];
  onLoad: (id: string) => void; onExport: () => void;
}) {
  return (
    <>
      <div className="metrics-grid">
        <Metric label="Heat flux estimate" value={result ? formatNumber(result.average_heat_flux_w_m2) : "—"} unit="W/m²" icon={Flame} hint="Steady-state · gradient model" />
        <Metric label="Inner surface" value={formatNumber(config.inner_temperature_c)} unit="°C" icon={Thermometer} hint="Fixed temperature boundary" />
        <Metric label="Outer surface" value={formatNumber(config.outer_temperature_c)} unit="°C" icon={Gauge} hint="Fixed temperature boundary" />
        <Metric label="Wall thickness" value={result ? formatNumber(result.total_thickness_m * 1000, 0) : "—"} unit="mm" icon={Layers3} hint={`${config.layers.length} configured layers`} />
      </div>
      <div className="overview-grid">
        <Panel title="Temperature profile" eyebrow="THROUGH-THICKNESS DISTRIBUTION" action={<button className="text-button" onClick={onExport}><Download size={14} /> Export CSV</button>}>
          {result ? <ProfileChart x={result.positions_m} y={result.temperatures_c} label="Temperature" unit="°C" /> : <div className="chart-empty">{busy ? "Calculating temperature field…" : "Run a simulation to view results."}</div>}
        </Panel>
        <Panel title="Simulation summary" eyebrow="CURRENT CONFIGURATION">
          <div className="summary-list">
            <div><span>Reference heat flux</span><b className="mono">{result ? `${formatNumber(result.reference_heat_flux_w_m2)} W/m²` : "—"}</b></div>
            <div><span>Relative estimation error</span><b className="mono">{result ? `${formatNumber(result.relative_error_percent, 3)}%` : "—"}</b></div>
            <div><span>Spatial grid</span><b className="mono">{result?.grid_nodes ?? config.nodes} nodes</b></div>
            <div><span>Solver mode</span><b><span className="tag">{config.mode.toUpperCase()}</span></b></div>
          </div>
          <div className="summary-divider" />
          <div className="mini-layers">{config.layers.map((layer, i) => <div key={`${layer.name}-${i}`}><span className={`layer-swatch swatch-${i % 4}`} /><span>{layer.name}</span><b>{formatNumber(layer.thickness_m * 1000)} mm</b></div>)}</div>
        </Panel>
      </div>
      <div className="bottom-grid">
        <Panel title="Heat flux across wall" eyebrow="FOURIER GRADIENT ESTIMATE">
          {result && <ProfileChart x={result.positions_m} y={result.gradient_heat_flux_w_m2} label="Estimated q″" unit="W/m²" color="#f0aa59" />}
        </Panel>
        <Panel title="Recent simulations" eyebrow="LOCAL HISTORY" action={<span className="counter">{saved.length} SAVED</span>}>
          {saved.length ? <div className="history-list">{saved.slice(0, 4).map((item) => <button key={item.id} className="history-item" onClick={() => onLoad(item.id)}><span className="history-icon"><Activity size={15} /></span><span className="history-copy"><b>{item.config.layers.length}-layer wall · {formatNumber(item.result.average_heat_flux_w_m2)} W/m²</b><small>{new Date(item.created_at + "Z").toLocaleString()}</small></span><ChevronRight size={15} /></button>)}</div> : <div className="empty-note"><Database size={16} />Saved runs will appear here.</div>}
        </Panel>
      </div>
    </>
  );
}

function Workspace({ config, setConfig, updateLayer, addLayer, result, busy, run, materials }: {
  config: Config; setConfig: React.Dispatch<React.SetStateAction<Config>>; updateLayer: (index: number, patch: Partial<Layer>) => void;
  addLayer: () => void; result: SimulationResult | null; busy: boolean; run: () => void;
  materials: Awaited<ReturnType<typeof api.materials>>;
}) {
  const thickness = useMemo(() => config.layers.reduce((sum, layer) => sum + layer.thickness_m, 0), [config.layers]);
  return (
    <div className="workspace-grid">
      <Panel title="Model configuration" eyebrow="INPUT PARAMETERS" className="configuration-panel" action={<button className="text-button" onClick={() => setConfig(initialConfig)}><RotateCcw size={12} /> Reset defaults</button>}>
        <div className="form-section"><div className="section-title"><span>BOUNDARY CONDITIONS</span><button className="subtle-icon" title="Fixed surface temperatures; not ambient temperatures"><CircleHelp size={14} /></button></div>
          <div className="field-grid"><NumberField label="Hot-side surface" unit="°C" value={config.inner_temperature_c} onChange={(v) => setConfig((c) => ({ ...c, inner_temperature_c: v }))} /><NumberField label="Cold-side surface" unit="°C" value={config.outer_temperature_c} onChange={(v) => setConfig((c) => ({ ...c, outer_temperature_c: v }))} /></div>
          <NumberField label="Initial wall temperature" unit="°C" value={config.initial_temperature_c} onChange={(v) => setConfig((c) => ({ ...c, initial_temperature_c: v }))} />
        </div>
        <div className="form-section"><div className="section-title"><span>WALL LAYERS</span><span className="counter">{config.layers.length} LAYERS</span></div>
          {config.layers.map((layer, i) => <div className="layer-editor" key={`${i}-${layer.name}`}><div className={`layer-swatch swatch-${i % 4}`} /><div className="layer-edit-main"><input aria-label={`Layer ${i + 1} material name`} value={layer.name} onChange={(e) => updateLayer(i, { name: e.target.value })} /><div className="layer-field-row"><label>Thickness <input aria-label={`Layer ${i + 1} thickness`} type="number" min="0.001" step="0.01" value={layer.thickness_m} onChange={(e) => updateLayer(i, { thickness_m: Number(e.target.value) })} /><small>m</small></label><label>Conductivity <input aria-label={`Layer ${i + 1} conductivity`} type="number" min="0.001" step="0.05" value={layer.conductivity_w_mk} onChange={(e) => updateLayer(i, { conductivity_w_mk: Number(e.target.value) })} /><small>W/m·K</small></label></div><div className="layer-field-row"><label>Density <input aria-label={`Layer ${i + 1} density`} type="number" min="1" step="50" value={layer.density_kg_m3} onChange={(e) => updateLayer(i, { density_kg_m3: Number(e.target.value) })} /><small>kg/m³</small></label><label>Specific heat <input aria-label={`Layer ${i + 1} specific heat`} type="number" min="1" step="50" value={layer.specific_heat_j_kgk} onChange={(e) => updateLayer(i, { specific_heat_j_kgk: Number(e.target.value) })} /><small>J/kg·K</small></label></div></div><button className="remove-layer" aria-label={`Remove layer ${i + 1}`} onClick={() => setConfig((c) => ({ ...c, layers: c.layers.filter((_, n) => n !== i) }))} disabled={config.layers.length === 1}><X size={14} /></button></div>)}
          <button className="add-layer" onClick={addLayer}><Plus size={14} /> Add wall layer</button>
        </div>
        <div className="form-section"><div className="section-title"><span>SOLVER SETTINGS</span></div>
          <label className="select-field">Mode<select value={config.mode} onChange={(e) => setConfig((c) => ({ ...c, mode: e.target.value as Config["mode"] }))}><option value="steady">Steady state</option><option value="transient">Transient · implicit Euler</option></select></label>
          <div className="field-grid"><NumberField label="Grid cells" unit="nodes" value={config.nodes} min={5} max={2001} step={4} onChange={(v) => setConfig((c) => ({ ...c, nodes: v }))} /><NumberField label="Sensor noise σ" unit="°C" value={config.noise_std_c} min={0} step={0.1} onChange={(v) => setConfig((c) => ({ ...c, noise_std_c: v }))} /></div>
          {config.mode === "transient" && <div className="field-grid"><NumberField label="Duration" unit="s" value={config.duration_s} min={1} onChange={(v) => setConfig((c) => ({ ...c, duration_s: v }))} /><NumberField label="Time step" unit="s" value={config.time_step_s} min={0.01} onChange={(v) => setConfig((c) => ({ ...c, time_step_s: v }))} /></div>}
        </div>
        <div className="form-section"><div className="section-title"><span>VIRTUAL SENSOR POSITIONS</span><button className="add-sensor" onClick={() => setConfig((current) => {
          const positions = current.sensor_positions_m.length ? [...current.sensor_positions_m] : [0.15, 0.38, 0.62, 0.85].map((fraction) => fraction * thickness);
          const candidate = Array.from({ length: 19 }, (_, i) => (i + 1) * thickness / 20).find((position) => positions.every((existing) => Math.abs(existing - position) > 0.001));
          if (candidate !== undefined && positions.length < 8) positions.push(candidate);
          return { ...current, sensor_positions_m: positions };
        })}><Plus size={12} /> Add sensor</button></div>
          {config.sensor_positions_m.length ? config.sensor_positions_m.map((position, index) => <div className="sensor-position-edit" key={index}><NumberField label={`T${String(index + 1).padStart(2, "0")} position`} unit="m" min={0} max={thickness} step={0.001} value={position} onChange={(value) => setConfig((current) => ({ ...current, sensor_positions_m: current.sensor_positions_m.map((currentValue, n) => n === index ? value : currentValue) }))} /><button className="remove-layer" aria-label={`Remove sensor ${index + 1}`} onClick={() => setConfig((current) => ({ ...current, sensor_positions_m: current.sensor_positions_m.filter((_, n) => n !== index) }))}><X size={14} /></button></div>) : <div className="sensor-help">Four evenly spaced virtual positions are generated automatically. Readings are simulated, not measured.</div>}
        </div>
        <div className="configuration-footer"><div><small>TOTAL THICKNESS</small><strong>{formatNumber(thickness * 1000, 1)} mm</strong></div><button className="button button-primary" onClick={run} disabled={busy || config.layers.some((layer) => layer.thickness_m <= 0 || layer.conductivity_w_mk <= 0)}><Play size={14} fill="currentColor" />{busy ? "Solving…" : "Run model"}</button></div>
      </Panel>
      <div className="workspace-center">
        <Panel title="Wall cross-section" eyebrow="THERMAL FIELD VIEW" action={<span className="tag"><span className="status-dot good" />{busy ? "SOLVING" : "RESULT"}</span>}>
          <Suspense fallback={<div className="chart-empty">Loading interactive wall renderer…</div>}><WallVisualization config={config} result={result} /></Suspense>
        </Panel>
        <Panel title="Computed temperature profile" eyebrow="BACKEND SOLVER OUTPUT">
          {result ? <ProfileChart x={result.positions_m} y={result.temperatures_c} label="Temperature" unit="°C" /> : <div className="chart-empty">Run the model to calculate the temperature field.</div>}
        </Panel>
      </div>
      <aside className="workspace-inspector">
        <Panel title="Live results" eyebrow="ENGINEERING SUMMARY">
          <div className="result-primary"><span>AVERAGE HEAT FLUX</span><b>{result ? formatNumber(result.average_heat_flux_w_m2) : "—"}</b><small>W/m²</small></div>
          <div className="result-table"><div><span>Analytical reference</span><b>{result ? `${formatNumber(result.reference_heat_flux_w_m2)} W/m²` : "—"}</b></div><div><span>Min · max flux</span><b>{result ? `${formatNumber(result.minimum_heat_flux_w_m2)} / ${formatNumber(result.maximum_heat_flux_w_m2)}` : "—"}</b></div><div><span>Relative error</span><b className="success-text">{result ? `${formatNumber(result.relative_error_percent, 4)}%` : "—"}</b></div><div><span>Spatial grid</span><b>{result?.grid_nodes ?? config.nodes} nodes</b></div><div><span>Total resistance</span><b>{formatNumber(config.layers.reduce((r, l) => r + l.thickness_m / l.conductivity_w_mk, 0), 4)} m²·K/W</b></div></div>
        </Panel>
        <Panel title="Virtual sensors" eyebrow="SYNTHETIC READINGS">
          <div className="sensor-caption"><Radio size={14} /> Deterministic simulation data</div>
          {result?.sensor_measurements.map((sensor) => <div className="sensor-row" key={sensor.id}><div><b>{sensor.id}</b><small>x = {formatNumber(sensor.position_m, 3)} m</small></div><strong>{formatNumber(sensor.measured_temperature_c, 1)}<small> °C</small></strong></div>)}
          {!result?.sensor_measurements.length && <div className="empty-note">Run a solve to sample virtual sensors.</div>}
        </Panel>
        <Panel title="Solver status" eyebrow="NUMERICAL METHOD">
          <div className="solver-note"><Cpu size={15} /><div><b>{config.mode === "steady" ? "Analytical resistance profile" : "Backward Euler · finite volume"}</b><span>Piecewise-constant properties · fixed surface temperatures</span></div></div>
          <div className="solver-note"><Clock3 size={15} /><div><b>{result ? `${formatNumber(result.final_time_s)} s completed` : "Ready to compute"}</b><span>{config.mode === "transient" ? `Δt = ${config.time_step_s} s` : "Steady-state solution"}</span></div></div>
        </Panel>
      </aside>
    </div>
  );
}

function NumberField({ label, unit, value, onChange, min = -273, max = 3000, step = 1 }: {
  label: string; unit: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  return <label className="number-field"><span>{label}</span><div><input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><small>{unit}</small></div></label>;
}

function Analysis({ result, kind, onExport }: { result: SimulationResult | null; kind: "temperature" | "flux"; onExport: () => void }) {
  if (!result) return <div className="empty-large"><Activity size={24} /><b>No simulation results yet</b><span>Run a simulation from the workspace before opening analysis.</span></div>;
  const isTemperature = kind === "temperature";
  return <div className="analysis-layout">
    <div className="metrics-grid compact-metrics">
      <Metric label={isTemperature ? "Hot surface" : "Reference flux"} value={formatNumber(isTemperature ? result.temperatures_c[0] : result.reference_heat_flux_w_m2)} unit={isTemperature ? "°C" : "W/m²"} icon={Flame} />
      <Metric label={isTemperature ? "Cold surface" : "Gradient estimate"} value={formatNumber(isTemperature ? result.temperatures_c[result.temperatures_c.length - 1] : result.average_heat_flux_w_m2)} unit={isTemperature ? "°C" : "W/m²"} icon={Gauge} />
      <Metric label={isTemperature ? "Wall thickness" : "Estimation error"} value={formatNumber(isTemperature ? result.total_thickness_m * 1000 : result.relative_error_percent, isTemperature ? 0 : 4)} unit={isTemperature ? "mm" : "%"} icon={LineChartIcon} />
    </div>
    <Panel title={isTemperature ? "Temperature vs wall depth" : "Heat flux vs wall depth"} eyebrow={isTemperature ? "SPATIAL TEMPERATURE FIELD" : "LOCAL FOURIER GRADIENT"} action={<button className="text-button" onClick={onExport}><Download size={14} /> Download CSV</button>}>
      <ProfileChart x={result.positions_m} y={isTemperature ? result.temperatures_c : result.gradient_heat_flux_w_m2} label={isTemperature ? "Temperature" : "Gradient estimate"} unit={isTemperature ? "°C" : "W/m²"} secondary={!isTemperature ? { x: result.heat_flux_positions_m, y: result.heat_flux_w_m2, color: "#6c9bea", label: "Numerical solver" } : undefined} />
    </Panel>
    {!isTemperature && <Panel title="Virtual measurement estimates" eyebrow="FOURIER GRADIENT FROM SENSOR PAIRS">
      {result.sensor_interval_heat_flux_w_m2.length
        ? <ProfileChart
          x={result.sensor_interval_heat_flux_w_m2.map((interval) => (interval.start_m + interval.end_m) / 2)}
          y={result.sensor_interval_heat_flux_w_m2.map((interval) => interval.measured_heat_flux_w_m2)}
          label="Noisy sensor estimate"
          unit="W/m²"
          secondary={{ y: result.sensor_interval_heat_flux_w_m2.map((interval) => interval.ideal_heat_flux_w_m2), color: "#72b7d7", label: "Ideal sensor estimate" }}
        />
        : <div className="empty-note">Add at least two distinct virtual sensor positions to estimate flux from measurement gradients.</div>}
    </Panel>}
    {!isTemperature && <Panel title="Reference comparison" eyebrow="DISTINCT HEAT-FLUX METHODS">
      <div className="comparison-cards"><div><span>Analytical reference</span><b>{formatNumber(result.reference_heat_flux_w_m2)}<small>W/m²</small></b><small>Thermal-resistance solution</small></div><div><span>Numerical solver</span><b>{formatNumber(result.average_heat_flux_w_m2)}<small>W/m²</small></b><small>Finite-volume conductances</small></div><div><span>Gradient estimate</span><b>{formatNumber(result.gradient_heat_flux_w_m2.reduce((a, b) => a + b, 0) / result.gradient_heat_flux_w_m2.length)}<small>W/m²</small></b><small>−k · dT/dx, sampled profile</small></div></div>
    </Panel>}
    {isTemperature && <Panel title="Transient temperature at virtual sensors" eyebrow="TIME HISTORY · NUMERICAL MODEL">
      {result.times_s.length > 1 && result.sensor_measurements.length
        ? <SensorTimeHistory result={result} />
        : <div className="empty-note">Select transient mode and run the simulation to generate sensor time histories.</div>}
    </Panel>}
    {isTemperature && <Panel title="Layer-wise temperature drop" eyebrow="PROFILE BREAKDOWN">
      <div className="layer-drop-list">{result.layers.map((layer, index) => <div key={layer.name} className="drop-row"><span className={`layer-swatch swatch-${index % 4}`} /><div><b>{layer.name}</b><small>{formatNumber(layer.thickness_m * 1000)} mm · k = {layer.conductivity_w_mk} W/m·K</small></div><strong>−{formatNumber(layer.temperature_drop_c, 1)} °C</strong></div>)}</div>
    </Panel>}
  </div>;
}

function SensorTimeHistory({ result }: { result: SimulationResult }) {
  const [sensorIndex, setSensorIndex] = useState(0);
  const sensor = result.sensor_measurements[sensorIndex];
  return <div className="history-chart">
    <label className="select-field">Sensor<select aria-label="Select virtual sensor" value={sensorIndex} onChange={(event) => setSensorIndex(Number(event.target.value))}>
      {result.sensor_measurements.map((item, index) => <option value={index} key={item.id}>{item.id} · {formatNumber(item.position_m, 3)} m</option>)}
    </select></label>
    {sensor && <ProfileChart x={result.times_s.map((time) => time / 60)} y={sensor.temperature_history_c} label={`${sensor.id} temperature`} unit="°C" xSuffix="min" />}
  </div>;
}

function Materials({ materials, config, updateLayer }: {
  materials: Awaited<ReturnType<typeof api.materials>>; config: Config; updateLayer: (index: number, patch: Partial<Layer>) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = materials.filter((material) => material.name.toLowerCase().includes(query.toLowerCase()));
  return <Panel title="Material library" eyebrow="REPRESENTATIVE THERMOPHYSICAL PROPERTIES" className="materials-panel" action={<span className="tag">Illustrative values</span>}>
    <div className="material-toolbar"><label className="search-field"><LineChartIcon size={15} /><input aria-label="Search materials" placeholder="Search materials…" value={query} onChange={(e) => setQuery(e.target.value)} /></label><span>{filtered.length} materials</span></div>
    <div className="materials-table"><div className="materials-header"><span>MATERIAL</span><span>CONDUCTIVITY</span><span>DENSITY</span><span>SPECIFIC HEAT</span><span>RANGE</span><span>ACTION</span></div>
      {filtered.map((material) => <div className="material-row" key={material.name}><div><b>{material.name}</b><small>{material.source_note}</small></div><span>{material.conductivity_w_mk} <small>W/m·K</small></span><span>{material.density_kg_m3} <small>kg/m³</small></span><span>{material.specific_heat_j_kgk} <small>J/kg·K</small></span><span>{material.range_c} °C</span><button className="button button-small" onClick={() => updateLayer(0, { name: material.name, conductivity_w_mk: material.conductivity_w_mk, density_kg_m3: material.density_kg_m3, specific_heat_j_kgk: material.specific_heat_j_kgk })}>Use in layer 1</button></div>)}
      {!filtered.length && <div className="empty-note">No materials match this search.</div>}
    </div>
    <div className="material-disclaimer"><TriangleAlert size={15} /><span>Values are representative for demonstration and are not manufacturer specifications. Verify material properties at the operating temperature before engineering use.</span></div>
    <div className="material-effect"><b>Current wall thermal resistance</b><span>{formatNumber(config.layers.reduce((sum, layer) => sum + layer.thickness_m / layer.conductivity_w_mk, 0), 4)} m²·K/W</span><small>Change a material, then rerun the model to quantify its heat-flux effect.</small></div>
  </Panel>;
}

function Compare({ result, comparison, runComparison, busy }: { result: SimulationResult | null; comparison: SimulationResult | null; runComparison: () => void; busy: boolean }) {
  const reduction = result && comparison && Math.abs(result.average_heat_flux_w_m2) > 1e-12
    ? (result.average_heat_flux_w_m2 - comparison.average_heat_flux_w_m2) / result.average_heat_flux_w_m2 * 100
    : null;
  return <div className="analysis-layout"><Panel title="Wall thickness study" eyebrow="BASELINE VS +25% LAYER THICKNESS" action={<button className="button button-secondary" onClick={runComparison} disabled={busy}><ArrowLeftRight size={14} />Run comparison</button>}>
    <p className="panel-description">Compares the active wall to a second simulation with each material layer increased by 25%. Both cases use the same boundary temperatures and material properties.</p>
    <div className="comparison-cards"><div><span>Baseline heat flux</span><b>{result ? formatNumber(result.average_heat_flux_w_m2) : "—"}<small>W/m²</small></b><small>Current configuration</small></div><div><span>Thicker wall heat flux</span><b>{comparison ? formatNumber(comparison.average_heat_flux_w_m2) : "—"}<small>W/m²</small></b><small>Independent solver result</small></div><div><span>Heat-loss reduction</span><b>{reduction !== null ? `${formatNumber(reduction, 2)}%` : "—"}</b><small>{result && comparison && Math.abs(result.average_heat_flux_w_m2) <= 1e-12 ? "Undefined for a zero-flux baseline" : "Relative to baseline"}</small></div></div>
  </Panel>
  {result && comparison && <Panel title="Temperature profiles" eyebrow="MODEL OUTPUT COMPARISON"><ProfileChart x={result.positions_m} y={result.temperatures_c} label="Baseline" unit="°C" secondary={{ y: comparison.temperatures_c, color: "#74b4d6", label: "25% thicker" }} /></Panel>}
  </div>;
}

function Validation({ validation, runValidation, busy, result }: {
  validation: Awaited<ReturnType<typeof api.validate>> | null; runValidation: () => void; busy: boolean; result: SimulationResult | null;
}) {
  return <div className="analysis-layout">
    <Panel title="Numerical verification" eyebrow="ANALYTICAL RESISTANCE BENCHMARK" action={<button className="button button-primary" onClick={runValidation} disabled={busy}><ShieldCheck size={14} />Run validation</button>}>
      <p className="panel-description">The steady solver is checked against the exact series thermal-resistance solution, q″ = ΔT / Σ(Lᵢ/kᵢ). This benchmark isolates spatial discretization error under fixed surface temperatures.</p>
      {validation ? <><div className="validation-result"><div className={`validation-state ${validation.passed ? "passed" : "failed"}`}>{validation.passed ? <Check size={18} /> : <TriangleAlert size={18} />}{validation.passed ? "PASS" : "FAIL"}<small>All checks · numerical tolerances applied</small></div><div className="validation-table"><div className="validation-head"><span>GRID NODES</span><span>NUMERICAL FLUX</span><span>RELATIVE ERROR</span><span>STATUS</span></div>{validation.results.map((row) => <div className="validation-row" key={row.grid_nodes}><b>{row.grid_nodes}</b><span>{formatNumber(row.heat_flux_w_m2, 5)} W/m²</span><span>{formatNumber(row.relative_error_percent, 8)}%</span><span className={row.passed ? "success-text" : "failed-text"}>{row.passed ? <><Check size={13} /> PASS</> : <><TriangleAlert size={13} /> FAIL</>}</span></div>)}</div></div><div className={`energy-check ${validation.energy_balance.passed ? "success-text" : "failed-text"}`}><span>Transient energy balance</span><b>{validation.energy_balance.passed ? "PASS" : "FAIL"} · error {formatNumber(validation.energy_balance.relative_error_percent, 10)}%</b><small>Stored ΔE {formatNumber(validation.energy_balance.stored_energy_change_j_m2, 5)} J/m² · net boundary heat {formatNumber(validation.energy_balance.net_boundary_heat_j_m2, 5)} J/m² · tolerance {validation.energy_balance.tolerance_percent}%</small></div></> : <div className="empty-note"><ShieldCheck size={16} />Run the test to compare the numerical profile against the analytical reference and evaluate transient energy conservation.</div>}
    </Panel>
    <Panel title="Analytical reference" eyebrow="THERMAL-RESISTANCE SOLUTION">
      <div className="equation-box">q″ = (T<sub>hot</sub> − T<sub>cold</sub>) / Σ (L<sub>i</sub> / k<sub>i</sub>)</div>
      <div className="summary-list"><div><span>Reference flux</span><b className="mono">{result ? `${formatNumber(result.reference_heat_flux_w_m2)} W/m²` : "Run a simulation"}</b></div><div><span>Current grid points</span><b className="mono">{result?.grid_nodes ?? "—"}</b></div><div><span>Reported solve error</span><b className="mono">{result ? `${formatNumber(result.relative_error_percent, 6)}%` : "—"}</b></div></div>
    </Panel>
    <div className="notice notice-info"><TriangleAlert size={15} /><span>Transient grid-convergence refinement is not included; energy conservation is checked for the configured transient run.</span></div>
  </div>;
}

function Reports({ result, config, saved, onExport, onSave, setMessage }: {
  result: SimulationResult | null; config: Config; saved: { id: string }[]; onExport: () => void; onSave: () => Promise<void>; setMessage: (message: string) => void;
}) {
  const jsonDownload = () => {
    const blob = new Blob([JSON.stringify({ configuration: config, result, generated_at: new Date().toISOString(), note: "Numerical simulation with representative constant material properties; not experimental data." }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "thermalux-report-data.json"; anchor.click(); URL.revokeObjectURL(url);
  };
  const pdfDownload = async () => {
    try {
      const blob = await api.pdf(config);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "thermalux-simulation-report.pdf"; anchor.click(); URL.revokeObjectURL(url);
      setMessage("PDF report generated from the current numerical results.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF report could not be generated.");
    }
  };
  return <div className="reports-grid">
    <Panel title="Export simulation data" eyebrow="ACTUAL BACKEND RESULTS">
      <p className="panel-description">Export reproducible results and input assumptions for analysis or inclusion in a project report.</p>
      <button className="button button-primary report-pdf-button" onClick={() => void pdfDownload()} disabled={!result}><Download size={14} />Generate PDF report</button>
      <div className="export-list"><button onClick={onExport} disabled={!result}><span className="export-icon"><LineChartIcon size={17} /></span><span><b>Temperature & heat flux · CSV</b><small>Depth, temperature, and gradient-based flux</small></span><Download size={16} /></button><button onClick={jsonDownload} disabled={!result}><span className="export-icon"><Database size={17} /></span><span><b>Simulation report data · JSON</b><small>Full configuration, results, and model caveat</small></span><Download size={16} /></button><button onClick={() => void onSave()} disabled={!result}><span className="export-icon"><Save size={17} /></span><span><b>Save to local history</b><small>Persist the configuration and computed results in SQLite</small></span><ChevronRight size={16} /></button></div>
    </Panel>
    <Panel title="Report contents" eyebrow="MODEL SUMMARY">
      <div className="report-outline"><div><Check size={15} /><span>Boundary temperatures and wall geometry</span></div><div><Check size={15} /><span>Material layers and representative properties</span></div><div><Check size={15} /><span>Analytical thermal resistance reference</span></div><div><Check size={15} /><span>Temperature profile and heat-flux estimates</span></div><div><Check size={15} /><span>Virtual measurement disclosure</span></div><div className="pending-report"><Clock3 size={15} /><span>Embedded chart artwork and transient energy-balance report — not included</span></div></div>
      <div className="saved-count"><Database size={15} />{saved.length} saved simulation{saved.length === 1 ? "" : "s"} in local database</div>
    </Panel>
    {result && <Panel title="Active report preview" eyebrow="DETERMINISTIC RESULT DATA"><div className="report-preview"><div><span>HEAT FLUX</span><b>{formatNumber(result.average_heat_flux_w_m2)} W/m²</b></div><div><span>WALL THICKNESS</span><b>{formatNumber(result.total_thickness_m * 1000, 1)} mm</b></div><div><span>NUMERICAL METHOD</span><b>{config.mode === "steady" ? "Steady resistance profile" : "Implicit finite volume"}</b></div><div><span>SIMULATED MEASUREMENTS</span><b>{result.sensor_measurements.length} virtual sensors · not experimental</b></div></div></Panel>}
  </div>;
}

export default App;
