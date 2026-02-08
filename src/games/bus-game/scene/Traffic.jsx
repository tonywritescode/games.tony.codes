import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ROUTE } from '../data/routeData';
import { dd } from '../data/mathUtils';
import { useBusGameStore } from '../store/busGameStore';

const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x88bbdd, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.5 });
const carWhMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.75, metalness: 0.1 });
const carTailMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 0.4, roughness: 0.2 });
const carHeadMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffaa, emissiveIntensity: 0.5, roughness: 0.1 });
const carDarkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.2 });
const carColors = [0xcc3333, 0x3366cc, 0x33aa55, 0xeeeeee, 0x222222, 0x888888, 0xdd8800, 0x6633aa, 0x44aaaa, 0xaa3366];

const NUM_TRAFFIC = 12;

// Car body profile shapes (extruded cross-sections) — created once
// Type 0: Sedan — lower body + cabin with sloped hood/trunk
function createSedanGeo() {
  // Lower body: rounded rectangle
  const bodyShape = new THREE.Shape();
  const bw = 1.0, bh = 0.7, br = 0.12;
  bodyShape.moveTo(-bw + br, 0);
  bodyShape.lineTo(bw - br, 0);
  bodyShape.quadraticCurveTo(bw, 0, bw, br);
  bodyShape.lineTo(bw, bh);
  bodyShape.lineTo(-bw, bh);
  bodyShape.lineTo(-bw, br);
  bodyShape.quadraticCurveTo(-bw, 0, -bw + br, 0);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 4.0, bevelEnabled: false });
  bodyGeo.translate(0, 0, -2.0);
  bodyGeo.computeVertexNormals();

  // Cabin: trapezoidal cross-section (narrower at top)
  const cabShape = new THREE.Shape();
  cabShape.moveTo(-0.9, 0);
  cabShape.lineTo(0.9, 0);
  cabShape.lineTo(0.75, 0.75);
  cabShape.quadraticCurveTo(0, 0.82, -0.75, 0.75);
  cabShape.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: 2.2, bevelEnabled: false });
  cabGeo.translate(0, 0, -1.0);
  cabGeo.computeVertexNormals();

  return { bodyGeo, cabGeo };
}

// Type 1: SUV/Van — taller, boxier but still with rounded edges
function createSUVGeo() {
  const bodyShape = new THREE.Shape();
  const bw = 1.05, bh = 0.9, br = 0.15;
  bodyShape.moveTo(-bw + br, 0);
  bodyShape.lineTo(bw - br, 0);
  bodyShape.quadraticCurveTo(bw, 0, bw, br);
  bodyShape.lineTo(bw, bh);
  bodyShape.lineTo(-bw, bh);
  bodyShape.lineTo(-bw, br);
  bodyShape.quadraticCurveTo(-bw, 0, -bw + br, 0);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 4.5, bevelEnabled: false });
  bodyGeo.translate(0, 0, -2.25);
  bodyGeo.computeVertexNormals();

  // Taller cabin with slight taper
  const cabShape = new THREE.Shape();
  cabShape.moveTo(-0.95, 0);
  cabShape.lineTo(0.95, 0);
  cabShape.lineTo(0.88, 0.85);
  cabShape.quadraticCurveTo(0, 0.92, -0.88, 0.85);
  cabShape.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: 3.0, bevelEnabled: false });
  cabGeo.translate(0, 0, -1.3);
  cabGeo.computeVertexNormals();

  return { bodyGeo, cabGeo };
}

// Type 2: Compact — small, rounded
function createCompactGeo() {
  const bodyShape = new THREE.Shape();
  const bw = 0.85, bh = 0.6, br = 0.1;
  bodyShape.moveTo(-bw + br, 0);
  bodyShape.lineTo(bw - br, 0);
  bodyShape.quadraticCurveTo(bw, 0, bw, br);
  bodyShape.lineTo(bw, bh);
  bodyShape.lineTo(-bw, bh);
  bodyShape.lineTo(-bw, br);
  bodyShape.quadraticCurveTo(-bw, 0, -bw + br, 0);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 3.2, bevelEnabled: false });
  bodyGeo.translate(0, 0, -1.6);
  bodyGeo.computeVertexNormals();

  // Bubbly cabin
  const cabShape = new THREE.Shape();
  cabShape.moveTo(-0.75, 0);
  cabShape.lineTo(0.75, 0);
  cabShape.lineTo(0.6, 0.65);
  cabShape.quadraticCurveTo(0, 0.72, -0.6, 0.65);
  cabShape.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: 1.8, bevelEnabled: false });
  cabGeo.translate(0, 0, -0.75);
  cabGeo.computeVertexNormals();

  return { bodyGeo, cabGeo };
}

// Windshield shapes per type (trapezoidal)
function createWindshieldGeo(type) {
  const shape = new THREE.Shape();
  if (type === 0) {
    shape.moveTo(-0.8, 0); shape.lineTo(0.8, 0);
    shape.lineTo(0.65, 0.65); shape.lineTo(-0.65, 0.65);
  } else if (type === 1) {
    shape.moveTo(-0.85, 0); shape.lineTo(0.85, 0);
    shape.lineTo(0.78, 0.75); shape.lineTo(-0.78, 0.75);
  } else {
    shape.moveTo(-0.65, 0); shape.lineTo(0.65, 0);
    shape.lineTo(0.52, 0.55); shape.lineTo(-0.52, 0.55);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// Pre-create shared geometries
const sedanGeos = createSedanGeo();
const suvGeos = createSUVGeo();
const compactGeos = createCompactGeo();
const windshieldGeos = [createWindshieldGeo(0), createWindshieldGeo(1), createWindshieldGeo(2)];

const typeGeos = [sedanGeos, suvGeos, compactGeos];
const typeDims = [
  { cabY: 0.7, cabZ: 0.1, frontZ: -2.01, rearZ: 2.01, hlW: 0.7, wZ: 1.3, wR: 0.35, wX: 1.05, wsY: 1.05, wsZ: -0.98 },
  { cabY: 0.9, cabZ: 0.2, frontZ: -2.26, rearZ: 2.26, hlW: 0.8, wZ: 1.5, wR: 0.4, wX: 1.1, wsY: 1.35, wsZ: -1.28 },
  { cabY: 0.6, cabZ: 0.15, frontZ: -1.61, rearZ: 1.61, hlW: 0.6, wZ: 1.0, wR: 0.35, wX: 0.9, wsY: 0.9, wsZ: -0.73 },
];

function positionOnSegment(tv) {
  const R = ROUTE;
  let s = tv.seg;
  if (s < 0) s = 0; if (s >= R.length - 1) s = R.length - 2;
  const ax = R[s][0], az = R[s][1], bx = R[s + 1][0], bz = R[s + 1][1];
  const dx = bx - ax, dz = bz - az;
  let posX = ax + dx * tv.segT;
  let posZ = az + dz * tv.segT;
  const segAng = Math.atan2(dx, dz);
  const carAng = tv.dir === 1 ? segAng : segAng + Math.PI;
  const side = tv.dir;
  posX += Math.cos(segAng) * side * tv.laneOff;
  posZ += -Math.sin(segAng) * side * tv.laneOff;
  tv.wx = posX; tv.wz = posZ; tv.ang = carAng;
  return { posX, posZ, carAng };
}

export default function Traffic({ trafficRef }) {
  const meshRefs = useRef([]);

  const initData = useMemo(() => {
    const vehicles = [];
    for (let i = 0; i < NUM_TRAFFIC; i++) {
      const carType = Math.floor(Math.random() * 3);
      const seg = Math.floor(Math.random() * (ROUTE.length - 1));
      const segT = Math.random();
      const dir = Math.random() > 0.5 ? 1 : -1;
      let baseSpd = 6 + Math.random() * 8;
      if (carType === 1) baseSpd *= 0.85;
      if (carType === 2) baseSpd *= 1.1;
      const color = carColors[Math.floor(Math.random() * carColors.length)];

      const tv = {
        seg, segT, dir, laneOff: 3.5, speed: baseSpd, baseSpeed: baseSpd,
        type: carType, waiting: 0,
        halfLen: carType === 1 ? 2.3 : carType === 0 ? 2.0 : 1.6,
        halfWid: carType === 1 ? 1.1 : carType === 0 ? 1.05 : 0.9,
        wx: 0, wz: 0, ang: 0, color,
      };
      positionOnSegment(tv);
      vehicles.push(tv);
    }
    return vehicles;
  }, []);

  if (trafficRef) {
    trafficRef.current = initData;
  }

  useFrame((_, dt) => {
    const R = ROUTE;
    const traffic = trafficRef.current;
    if (!traffic) return;

    const s = useBusGameStore.getState();
    const busX = s.posX, busZ = s.posZ;

    for (let ti = 0; ti < traffic.length; ti++) {
      const tv = traffic[ti];
      let tSeg = tv.seg;
      let segLen = dd(R[tSeg][0], R[tSeg][1], R[tSeg + 1][0], R[tSeg + 1][1]);
      if (segLen < 0.1) segLen = 0.1;

      let curSpd = tv.baseSpeed;
      for (let tj = 0; tj < traffic.length; tj++) {
        if (ti === tj) continue;
        const ot = traffic[tj];
        const dToOther = dd(tv.wx, tv.wz, ot.wx, ot.wz);
        if (dToOther < 12) {
          const toOtherX = ot.wx - tv.wx, toOtherZ = ot.wz - tv.wz;
          const fwdX = -Math.sin(tv.ang), fwdZ = -Math.cos(tv.ang);
          const dot = toOtherX * fwdX + toOtherZ * fwdZ;
          if (dot > 0 && dToOther < 10) {
            curSpd = Math.min(curSpd, Math.max(dToOther * 0.8, 1));
          }
        }
      }

      const dToBus = dd(tv.wx, tv.wz, busX, busZ);
      if (dToBus < 14) {
        const toBusX = busX - tv.wx, toBusZ = busZ - tv.wz;
        const fwdX2 = -Math.sin(tv.ang), fwdZ2 = -Math.cos(tv.ang);
        const dot2 = toBusX * fwdX2 + toBusZ * fwdZ2;
        if (dot2 > 0 && dToBus < 12) {
          curSpd = Math.min(curSpd, Math.max(dToBus * 0.6, 0.5));
        }
      }

      tv.speed = tv.speed + (curSpd - tv.speed) * dt * 3;

      const advance = tv.speed * dt / segLen;
      if (tv.dir === 1) {
        tv.segT += advance;
        while (tv.segT >= 1) {
          tv.segT -= 1; tv.seg++;
          if (tv.seg >= R.length - 1) { tv.seg = 0; tv.segT = 0; }
          tSeg = tv.seg;
          segLen = dd(R[tSeg][0], R[tSeg][1], R[tSeg + 1][0], R[tSeg + 1][1]);
          if (segLen < 0.1) segLen = 0.1;
        }
      } else {
        tv.segT -= advance;
        while (tv.segT < 0) {
          tv.segT += 1; tv.seg--;
          if (tv.seg < 0) { tv.seg = R.length - 2; tv.segT = 1; }
          tSeg = tv.seg;
          segLen = dd(R[tSeg][0], R[tSeg][1], R[tSeg + 1][0], R[tSeg + 1][1]);
          if (segLen < 0.1) segLen = 0.1;
        }
      }

      const p = positionOnSegment(tv);
      const mesh = meshRefs.current[ti];
      if (mesh) {
        mesh.position.set(p.posX, 0, p.posZ);
        mesh.rotation.y = p.carAng;
      }
    }
  });

  return (
    <group>
      {initData.map((tv, i) => {
        const bodyMat = new THREE.MeshStandardMaterial({ color: tv.color, roughness: 0.35, metalness: 0.2 });
        const type = tv.type;
        const geos = typeGeos[type];
        const dims = typeDims[type];
        return (
          <group key={i} ref={(el) => { meshRefs.current[i] = el; }} position={[tv.wx, 0, tv.wz]} rotation={[0, tv.ang, 0]}>
            {/* Lower body — extruded rounded profile */}
            <mesh position={[0, 0.3, 0]} castShadow geometry={geos.bodyGeo} material={bodyMat} />
            {/* Cabin — extruded tapered profile */}
            <mesh position={[0, 0.3 + dims.cabY, dims.cabZ]} castShadow geometry={geos.cabGeo} material={bodyMat} />
            {/* Windshield */}
            <mesh
              position={[0, dims.wsY, dims.wsZ]}
              rotation={[0.15, 0, 0]}
              geometry={windshieldGeos[type]}
              material={carGlassMat}
            />
            {/* Rear window */}
            <mesh
              position={[0, dims.wsY, -dims.wsZ]}
              rotation={[-0.1, Math.PI, 0]}
              geometry={windshieldGeos[type]}
              material={carGlassMat}
            />
            {/* Front bumper */}
            <mesh position={[0, 0.25, dims.frontZ]} material={carDarkMat}>
              <boxGeometry args={[dims.hlW * 2.6, 0.18, 0.12]} />
            </mesh>
            {/* Headlights */}
            {[-1, 1].map(hs => (
              <mesh key={`hl-${hs}`} position={[hs * dims.hlW, 0.55, dims.frontZ]} material={carHeadMat}>
                <sphereGeometry args={[0.12, 6, 4]} />
              </mesh>
            ))}
            {/* Tail lights */}
            {[-1, 1].map(ts => (
              <mesh key={`tl-${ts}`} position={[ts * dims.hlW, 0.55, dims.rearZ]} material={carTailMat}>
                <sphereGeometry args={[0.1, 6, 4]} />
              </mesh>
            ))}
            {/* Wheels — torus tires */}
            {[-1, 1].map(wside =>
              [-1, 1].map(wend => (
                <group key={`wh-${wside}-${wend}`}>
                  <mesh position={[wside * dims.wX, dims.wR, wend * dims.wZ]} rotation={[0, 0, Math.PI / 2]} castShadow material={carWhMat}>
                    <torusGeometry args={[dims.wR * 0.65, dims.wR * 0.4, 6, 10]} />
                  </mesh>
                  <mesh position={[wside * dims.wX, dims.wR, wend * dims.wZ]} rotation={[0, 0, Math.PI / 2]} material={carDarkMat}>
                    <cylinderGeometry args={[dims.wR * 0.3, dims.wR * 0.3, 0.15, 6]} />
                  </mesh>
                </group>
              ))
            )}
          </group>
        );
      })}
    </group>
  );
}
