import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ROUTE, BOUNDS } from '../data/routeData';
import { ptSegDist } from '../data/mathUtils';
import { createGrassTexture } from './proceduralTextures';

const GROUND_SIZE = Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxZ - BOUNDS.minZ) * 1.5;
const GROUND_CENTER_X = (BOUNDS.minX + BOUNDS.maxX) / 2;
const GROUND_CENTER_Z = (BOUNDS.minZ + BOUNDS.maxZ) / 2;

function Ground() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 80, 80);
    const verts = g.attributes.position;
    for (let vi = 0; vi < verts.count; vi++) {
      const gx = verts.getX(vi), gy = verts.getY(vi);
      let isNearRoad = false;
      for (let ri = 0; ri < ROUTE.length - 1; ri++) {
        if (ptSegDist(gx, gy, ROUTE[ri][0], ROUTE[ri][1], ROUTE[ri + 1][0], ROUTE[ri + 1][1]) < 25) {
          isNearRoad = true; break;
        }
      }
      if (!isNearRoad) verts.setZ(vi, (Math.sin(gx * 0.03) * Math.cos(gy * 0.03)) * 0.8);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const grassTex = useMemo(() => createGrassTexture(), []);

  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial map={grassTex} roughness={0.95} metalness={0} />
    </mesh>
  );
}

const MOUNTAIN_RADIUS = GROUND_SIZE * 0.4;

function Mountains() {
  const mountains = useMemo(() => {
    const items = [];
    for (let i = 0; i < 14; i++) {
      const aa = (i / 14) * Math.PI * 2;
      const rr = MOUNTAIN_RADIUS + Math.random() * 60;
      const hh = 30 + Math.random() * 50;
      const radius = 32 + Math.random() * 22;
      items.push({ aa, rr, hh, radius, hasSnow: hh > 45 });
    }
    return items;
  }, []);

  return (
    <group>
      {mountains.map((mt, i) => (
        <group key={i}>
          <mesh position={[Math.cos(mt.aa) * mt.rr + GROUND_CENTER_X, mt.hh / 2 - 4, Math.sin(mt.aa) * mt.rr + GROUND_CENTER_Z]}>
            <coneGeometry args={[mt.radius, mt.hh, 6]} />
            <meshStandardMaterial color={0x667788} roughness={0.9} metalness={0} transparent opacity={0.45} />
          </mesh>
          {mt.hasSnow && (
            <mesh position={[Math.cos(mt.aa) * mt.rr + GROUND_CENTER_X, mt.hh * 0.9, Math.sin(mt.aa) * mt.rr + GROUND_CENTER_Z]}>
              <coneGeometry args={[10, mt.hh * 0.2, 6]} />
              <meshStandardMaterial color={0xeeeeff} roughness={0.8} metalness={0} transparent opacity={0.5} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function Clouds() {
  const cloudData = useMemo(() => {
    const items = [];
    for (let i = 0; i < 15; i++) {
      const numPuffs = 3 + Math.floor(Math.random() * 4);
      const puffs = [];
      for (let j = 0; j < numPuffs; j++) {
        puffs.push({
          size: 4 + Math.random() * 7,
          pos: [j * (4 + Math.random() * 7) * 0.8 - numPuffs * 2, Math.random() * 2, Math.random() * 3],
          scaleY: 0.4 + Math.random() * 0.2,
          scaleX: 0.8 + Math.random() * 0.4,
        });
      }
      items.push({
        pos: [BOUNDS.minX + Math.random() * (BOUNDS.maxX - BOUNDS.minX), 52 + Math.random() * 45, BOUNDS.minZ + Math.random() * (BOUNDS.maxZ - BOUNDS.minZ)],
        puffs,
        speedMul: 0.5 + i * 0.05,
      });
    }
    return items;
  }, []);

  const groupRefs = useRef([]);

  useFrame((_, dt) => {
    for (let i = 0; i < groupRefs.current.length; i++) {
      const g = groupRefs.current[i];
      if (!g) continue;
      g.position.x += dt * cloudData[i].speedMul;
      if (g.position.x > BOUNDS.maxX + 100) g.position.x = BOUNDS.minX - 100;
    }
  });

  return (
    <group>
      {cloudData.map((cloud, i) => (
        <group key={i} position={cloud.pos} ref={(el) => { groupRefs.current[i] = el; }}>
          {cloud.puffs.map((puff, j) => (
            <mesh key={j} position={puff.pos} scale={[puff.scaleX, puff.scaleY, 1]}>
              <sphereGeometry args={[puff.size, 8, 6]} />
              <meshStandardMaterial color={0xffffff} roughness={1} metalness={0} transparent opacity={0.55} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export default function Environment() {
  return (
    <group>
      {/* Lighting */}
      <ambientLight color={0xc8dce8} intensity={0.4} />
      <directionalLight
        color={0xfff0d4}
        intensity={1.15}
        position={[GROUND_CENTER_X + 100, 160, GROUND_CENTER_Z + 80]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-GROUND_SIZE / 2}
        shadow-camera-right={GROUND_SIZE / 2}
        shadow-camera-top={GROUND_SIZE / 2}
        shadow-camera-bottom={-GROUND_SIZE / 2}
        shadow-camera-near={10}
        shadow-camera-far={GROUND_SIZE}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <directionalLight color={0xffe8c0} intensity={0.25} position={[-80, 60, -40]} />
      <hemisphereLight args={[0x8ec4e8, 0x4a7a3a, 0.35]} />

      <Ground />
      <Mountains />
      <Clouds />
    </group>
  );
}
