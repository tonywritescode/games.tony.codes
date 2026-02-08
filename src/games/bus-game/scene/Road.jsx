import { useMemo } from 'react';
import * as THREE from 'three';
import { ROUTE, JUNCTIONS, SIDE_ROADS } from '../data/routeData';
import { createAsphaltTexture } from './proceduralTextures';

const asphaltTex = createAsphaltTexture();
const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.85, metalness: 0.05 });
const swalkMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.75, metalness: 0.02 });
const dashMat = new THREE.MeshStandardMaterial({ color: 0xcccc44, roughness: 0.5, emissive: 0x333300, emissiveIntensity: 0.1 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
const curbMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.7 });
const arMat = new THREE.MeshStandardMaterial({ color: 0x00aaff, transparent: true, opacity: 0.3, emissive: 0x0066aa, emissiveIntensity: 0.3 });
const islandMat = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.9, metalness: 0 });

export default function Road() {
  const elements = useMemo(() => {
    const items = [];
    const R = ROUTE;

    for (let i = 0; i < R.length - 1; i++) {
      const a = R[i], b = R[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      const ang = Math.atan2(dx, dz);

      // Suppress road segments fully inside a roundabout (prevent double asphalt)
      let insideRoundabout = false;
      for (const j of JUNCTIONS) {
        if (Math.hypot(cx - j.x, cz - j.z) < j.radius - 4) {
          insideRoundabout = true;
          break;
        }
      }
      if (insideRoundabout) continue;

      // Road surface
      items.push({ type: 'road', pos: [cx, 0.07, cz], rot: ang, size: [14, 0.15, len + 2] });

      // Sidewalks + curbs
      for (const s of [-1, 1]) {
        items.push({
          type: 'swalk', pos: [cx + Math.cos(ang) * s * 8.5, 0.14, cz - Math.sin(ang) * s * 8.5],
          rot: ang, size: [2.5, 0.28, len + 2],
        });
        items.push({
          type: 'curb', pos: [cx + Math.cos(ang) * s * 7.2, 0.12, cz - Math.sin(ang) * s * 7.2],
          rot: ang, size: [0.3, 0.25, len + 2],
        });
        // Edge lines
        items.push({
          type: 'edge', pos: [cx + Math.cos(ang) * s * 6, 0.16, cz - Math.sin(ang) * s * 6],
          rot: ang, size: [0.2, 0.16, len + 1],
        });
      }

      // Center dashes
      const dc = Math.floor(len / 7);
      for (let d = 0; d < dc; d++) {
        const t = (d + 0.5) / dc;
        items.push({
          type: 'dash', pos: [a[0] + dx * t, 0.16, a[1] + dz * t],
          rot: ang, size: [0.3, 0.16, 2.2],
        });
      }

      // Route arrows
      const steps = Math.floor(len / 14);
      for (let d = 0; d < steps; d++) {
        const t = (d + 0.5) / steps;
        items.push({
          type: 'arrow', pos: [a[0] + dx * t, 0.25, a[1] + dz * t],
          rotX: Math.PI / 2, rotZ: -Math.atan2(dx, dz),
        });
      }
    }

    // Junction circles — suppress inside roundabout zones, enlarge at side-road intersections
    for (let i = 0; i < R.length; i++) {
      let inRoundabout = false;
      for (const j of JUNCTIONS) {
        if (Math.hypot(R[i][0] - j.x, R[i][1] - j.z) < j.radius + 5) {
          inRoundabout = true;
          break;
        }
      }
      if (inRoundabout) continue;

      // Check if a side-road stub is near this waypoint
      let nearStub = false;
      for (const s of SIDE_ROADS) {
        if (Math.hypot(R[i][0] - s.x, R[i][1] - s.z) < 12) {
          nearStub = true;
          break;
        }
      }
      const jRadius = nearStub ? 9 : 7;
      items.push({ type: 'junction', pos: [R[i][0], 0.07, R[i][1]], radius: jRadius });
    }

    // Roundabout ring roads + central islands
    for (const j of JUNCTIONS) {
      const ringR = j.radius; // outer radius of ring road
      const ringInner = j.radius - 7; // inner radius of ring road
      const segments = 20;

      // Ring road segments (boxes arranged in a circle)
      for (let s = 0; s < segments; s++) {
        const a1 = (s / segments) * Math.PI * 2;
        const a2 = ((s + 1) / segments) * Math.PI * 2;
        const midA = (a1 + a2) / 2;
        const midR = (ringR + ringInner) / 2;
        const sx = j.x + Math.cos(midA) * midR;
        const sz = j.z + Math.sin(midA) * midR;
        const segLen = midR * (a2 - a1) + 1.5; // slight overlap for seamless look
        items.push({
          type: 'road',
          pos: [sx, 0.07, sz],
          rot: -midA + Math.PI / 2,
          size: [ringR - ringInner, 0.15, segLen],
        });
      }

      // Central green island
      items.push({ type: 'island', pos: [j.x, 0.15, j.z], radius: ringInner - 1 });

      // Outer sidewalk ring
      items.push({ type: 'outerSwalk', pos: [j.x, 0.14, j.z], outerR: ringR + 2, innerR: ringR + 0.2 });

      // Inner curb ring (around island)
      items.push({ type: 'innerCurb', pos: [j.x, 0.18, j.z], radius: ringInner - 0.5 });
    }

    // Side-road stubs — offset origin to road edge for flush T-junctions
    const HALF_ROAD = 7;
    for (const s of SIDE_ROADS) {
      const ang = s.angle;

      // Find nearest route segment to get road tangent
      let bestDist = Infinity, bestSeg = 0;
      for (let i = 0; i < R.length - 1; i++) {
        const dx = R[i + 1][0] - R[i][0], dz = R[i + 1][1] - R[i][1];
        const len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((s.x - R[i][0]) * dx + (s.z - R[i][1]) * dz) / len2)) : 0;
        const px = R[i][0] + t * dx, pz = R[i][1] + t * dz;
        const d = Math.hypot(s.x - px, s.z - pz);
        if (d < bestDist) { bestDist = d; bestSeg = i; }
      }

      // Road tangent from nearest segment (forward direction: sin/cos convention)
      const rdx = R[bestSeg + 1][0] - R[bestSeg][0];
      const rdz = R[bestSeg + 1][1] - R[bestSeg][1];
      const rLen = Math.hypot(rdx, rdz) || 1;
      const tanX = rdx / rLen, tanZ = rdz / rLen;

      // Stub direction unit vector
      const stubDirX = Math.sin(ang), stubDirZ = Math.cos(ang);

      // Cross product to determine which side of the road the stub exits
      // tanX*stubDirZ - tanZ*stubDirX: positive = stub goes right, negative = left
      const cross = tanX * stubDirZ - tanZ * stubDirX;
      const side = cross > 0 ? 1 : -1;

      // Perpendicular to road tangent, pointing toward stub side
      // Road perp right: (tanZ, -tanX), left: (-tanZ, tanX)
      // Using the road's angle convention: perp is (cos(roadAng), -sin(roadAng)) for side=1
      const perpX = side * tanZ;
      const perpZ = side * -tanX;

      // Offset origin from road center to road edge
      const ox = s.x + perpX * HALF_ROAD;
      const oz = s.z + perpZ * HALF_ROAD;

      const halfLen = s.length / 2;
      const mx = ox + stubDirX * halfLen;
      const mz = oz + stubDirZ * halfLen;

      // Road surface
      items.push({ type: 'road', pos: [mx, 0.07, mz], rot: ang, size: [14, 0.15, s.length] });

      // Sidewalks + curbs on both sides
      for (const sw of [-1, 1]) {
        items.push({
          type: 'swalk',
          pos: [mx + Math.cos(ang) * sw * 8.5, 0.14, mz - Math.sin(ang) * sw * 8.5],
          rot: ang, size: [2.5, 0.28, s.length],
        });
        items.push({
          type: 'curb',
          pos: [mx + Math.cos(ang) * sw * 7.2, 0.12, mz - Math.sin(ang) * sw * 7.2],
          rot: ang, size: [0.3, 0.25, s.length],
        });
      }

      // Dead-end cap at the far end
      const endX = ox + stubDirX * s.length;
      const endZ = oz + stubDirZ * s.length;
      items.push({
        type: 'swalk',
        pos: [endX, 0.14, endZ],
        rot: ang + Math.PI / 2, size: [14, 0.28, 3],
      });
      items.push({
        type: 'curb',
        pos: [endX, 0.16, endZ],
        rot: ang + Math.PI / 2, size: [16, 0.3, 0.4],
      });
    }

    return items;
  }, []);

  return (
    <group>
      {elements.map((el, i) => {
        if (el.type === 'road') {
          return (
            <mesh key={i} position={el.pos} rotation={[0, el.rot, 0]} material={roadMat} receiveShadow>
              <boxGeometry args={el.size} />
            </mesh>
          );
        }
        if (el.type === 'swalk') {
          return (
            <mesh key={i} position={el.pos} rotation={[0, el.rot, 0]} material={swalkMat} receiveShadow castShadow>
              <boxGeometry args={el.size} />
            </mesh>
          );
        }
        if (el.type === 'curb') {
          return (
            <mesh key={i} position={el.pos} rotation={[0, el.rot, 0]} material={curbMat}>
              <boxGeometry args={el.size} />
            </mesh>
          );
        }
        if (el.type === 'dash') {
          return (
            <mesh key={i} position={el.pos} rotation={[0, el.rot, 0]} material={dashMat}>
              <boxGeometry args={el.size} />
            </mesh>
          );
        }
        if (el.type === 'edge') {
          return (
            <mesh key={i} position={el.pos} rotation={[0, el.rot, 0]} material={edgeMat}>
              <boxGeometry args={el.size} />
            </mesh>
          );
        }
        if (el.type === 'arrow') {
          return (
            <mesh key={i} position={el.pos} rotation={[el.rotX, 0, el.rotZ]} material={arMat}>
              <coneGeometry args={[0.5, 1.2, 4]} />
            </mesh>
          );
        }
        if (el.type === 'junction') {
          return (
            <mesh key={i} position={el.pos} material={roadMat} receiveShadow>
              <cylinderGeometry args={[el.radius, el.radius, 0.15, 16]} />
            </mesh>
          );
        }
        if (el.type === 'island') {
          return (
            <mesh key={i} position={el.pos} material={islandMat} receiveShadow>
              <cylinderGeometry args={[el.radius, el.radius, 0.3, 24]} />
            </mesh>
          );
        }
        if (el.type === 'outerSwalk') {
          return (
            <mesh key={i} position={el.pos} rotation={[-Math.PI / 2, 0, 0]} material={swalkMat} receiveShadow>
              <ringGeometry args={[el.innerR, el.outerR, 24]} />
            </mesh>
          );
        }
        if (el.type === 'innerCurb') {
          return (
            <mesh key={i} position={el.pos} rotation={[-Math.PI / 2, 0, 0]} material={curbMat}>
              <torusGeometry args={[el.radius, 0.2, 8, 24]} />
            </mesh>
          );
        }
        return null;
      })}
    </group>
  );
}
