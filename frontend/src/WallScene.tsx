import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { RotateCcw, Square, View } from "lucide-react";
import type { Config, SimulationResult } from "./types";

function temperatureColor(value: number, min: number, max: number) {
  const stops = [
    new THREE.Color("#174a94"),
    new THREE.Color("#27b8d5"),
    new THREE.Color("#e7cc45"),
    new THREE.Color("#f17737"),
    new THREE.Color("#fff3d4"),
  ];
  const ratio = THREE.MathUtils.clamp((value - min) / (max - min || 1), 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(ratio), stops.length - 2);
  return stops[index].clone().lerp(stops[index + 1], ratio - index);
}

function LayerMeshes({ config, result, selected, onSelect }: {
  config: Config;
  result: SimulationResult | null;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const total = config.layers.reduce((sum, layer) => sum + layer.thickness_m, 0) || 1;
  const minimum = result ? Math.min(...result.temperatures_c) : config.outer_temperature_c;
  const maximum = result ? Math.max(...result.temperatures_c) : config.inner_temperature_c;
  const heatDirection = config.inner_temperature_c >= config.outer_temperature_c ? 1 : -1;
  let cursor = -2.65;
  return (
    <group>
      {config.layers.map((layer, index) => {
        const width = Math.max(0.13, 5.3 * layer.thickness_m / total);
        const center = cursor + width / 2;
        const midpoint = cursor + width / 2 + 2.65;
        cursor += width;
        const temperature = result
          ? Number(THREE.MathUtils.clamp(
            result.temperatures_c[Math.round((midpoint / 5.3) * (result.temperatures_c.length - 1))] ?? maximum,
            minimum,
            maximum,
          ))
          : maximum - ((maximum - minimum) * (index + 0.5)) / config.layers.length;
        const active = selected === index;
        return (
          <group key={`${index}-${layer.name}`} position={[center, 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect(index); }}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[width, 1.15, 0.72]} />
              <meshStandardMaterial
                color={temperatureColor(temperature, minimum, maximum)}
                roughness={0.78}
                metalness={index === config.layers.length - 1 ? 0.32 : 0.06}
                emissive={active ? "#a34625" : "#000000"}
                emissiveIntensity={active ? 0.16 : 0}
              />
            </mesh>
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(width, 1.15, 0.72)]} />
              <lineBasicMaterial color={active ? "#fff0d9" : "#222833"} />
            </lineSegments>
            <Html position={[0, 0, 0.39]} center distanceFactor={7} style={{ pointerEvents: "none", whiteSpace: "nowrap" }}>
              <div className="scene-layer-label"><b>{layer.name}</b><span>{(layer.thickness_m * 1000).toFixed(0)} mm</span></div>
            </Html>
          </group>
        );
      })}
      <arrowHelper args={[new THREE.Vector3(heatDirection, 0, 0), new THREE.Vector3(-3.05 * heatDirection, 0.9, 0), 0.76, 0xff7448, 0.16, 0.11]} />
      {result?.sensor_measurements.map((sensor) => (
        <group key={sensor.id} position={[-2.65 + 5.3 * sensor.position_m / total, 0.7, 0.42]}>
          <mesh>
            <sphereGeometry args={[0.055, 12, 12]} />
            <meshBasicMaterial color="#5fe0cf" />
          </mesh>
          <Html position={[0, 0.12, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
            <span className="scene-sensor-label">{sensor.id}</span>
          </Html>
        </group>
      ))}
    </group>
  );
}

function CrossSection({ config, result }: { config: Config; result: SimulationResult | null }) {
  const total = config.layers.reduce((sum, layer) => sum + layer.thickness_m, 0) || 1;
  return <div className="fallback-cross-section">
    <div className="wall-hot"><span>HOT SIDE · {config.inner_temperature_c} °C</span><b>→</b></div>
    <div className="wall-layers">{config.layers.map((layer, index) => <div key={index} className={`wall-layer swatch-bg-${index % 4}`} style={{ flexGrow: layer.thickness_m }}><b>{layer.name}</b><span>{(layer.thickness_m * 1000).toFixed(0)} mm</span><small>{layer.conductivity_w_mk} W/m·K</small></div>)}</div>
    <div className="wall-cold"><span>COLD SIDE · {config.outer_temperature_c} °C</span><b>{result ? `${Math.round(result.average_heat_flux_w_m2)} W/m²` : ""}</b></div>
    <div className="depth-labels"><span>0 m</span><span>WALL DEPTH</span><span>{total.toFixed(3)} m</span></div>
  </div>;
}

export default function WallVisualization({ config, result }: { config: Config; result: SimulationResult | null }) {
  const [view, setView] = useState<"3d" | "section">("3d");
  const [selected, setSelected] = useState(0);
  const [cameraKey, setCameraKey] = useState(0);
  const selectedLayer = config.layers[selected];

  let supportsWebGL = true;
  try {
    const canvas = document.createElement("canvas");
    supportsWebGL = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    supportsWebGL = false;
  }
  if (!supportsWebGL) {
    return <><div className="webgl-fallback"><Square size={14} /> WebGL unavailable — showing a 2D wall cross-section.</div><CrossSection config={config} result={result} /></>;
  }

  return (
    <>
      <div className="visual-toolbar"><span>{view === "3d" ? "INTERACTIVE 3D · DRAG TO ORBIT · SCROLL TO ZOOM" : "2D WALL CROSS-SECTION"}</span><div>
        <button className={`visual-tool ${view === "3d" ? "selected" : ""}`} onClick={() => setView("3d")} aria-label="Show 3D view"><View size={13} /></button>
        <button className={`visual-tool ${view === "section" ? "selected" : ""}`} onClick={() => setView("section")} aria-label="Show 2D cross-section"><Square size={13} /></button>
        {view === "3d" && <button className="visual-tool" onClick={() => setCameraKey((key) => key + 1)} aria-label="Reset camera"><RotateCcw size={13} /></button>}
      </div></div>
      {view === "3d" ? <div className="scene-canvas">
        <Canvas key={cameraKey} camera={{ position: [0, 2.6, 6.3], fov: 40 }} shadows dpr={[1, 1.5]}>
          <color attach="background" args={["#11161d"]} />
          <ambientLight intensity={0.75} />
          <directionalLight position={[3, 5, 4]} intensity={1.5} castShadow />
          <pointLight position={[-3, 1.5, 2]} intensity={12} color="#ff7847" distance={7} />
          <Suspense fallback={null}><LayerMeshes config={config} result={result} selected={selected} onSelect={setSelected} /></Suspense>
          <OrbitControls makeDefault enableDamping minDistance={3.5} maxDistance={12} maxPolarAngle={Math.PI * 0.82} />
        </Canvas>
        <div className="scene-axis-label hot">FURNACE INTERIOR</div><div className="scene-axis-label cold">EXTERIOR</div>
      </div> : <CrossSection config={config} result={result} />}
      <div className="scene-inspector"><span className={`layer-swatch swatch-${selected % 4}`} /><div><b>{selectedLayer?.name ?? "Select a layer"}</b><small>{selectedLayer ? `${selectedLayer.thickness_m} m · k ${selectedLayer.conductivity_w_mk} W/m·K · ρ ${selectedLayer.density_kg_m3} kg/m³ · cp ${selectedLayer.specific_heat_j_kgk} J/kg·K` : ""}</small></div><span className="scene-inspector-temp">{result && selectedLayer ? `ΔT −${result.layers[selected]?.temperature_drop_c.toFixed(1)} °C` : ""}</span></div>
      <div className="visual-legend"><span><i className="legend-hot" />High temperature</span><span><i className="legend-mid" />Thermal barrier</span><span><i className="legend-cold" />Outer casing</span><span><i className="legend-sensor" />Virtual sensors</span></div>
    </>
  );
}
