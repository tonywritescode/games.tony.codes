import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBusGameStore } from '../store/busGameStore';

const busBodyMat = new THREE.MeshStandardMaterial({ color: 0xe8b400, roughness: 0.35, metalness: 0.15 });
const busTrimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.5 });
const busDarkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.2 });
const busGlassMat = new THREE.MeshStandardMaterial({ color: 0x8abbdd, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.4 });
const acMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.3 });
const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.3 });
const tlMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 0.6, roughness: 0.2 });
const tsMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff8800, emissiveIntensity: 0.4, roughness: 0.2 });
const whMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.75, metalness: 0.1 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.7 });
const strMat = new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.4, metalness: 0.1 });
const routeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 0.4, roughness: 0.3 });
const fenderMat = new THREE.MeshStandardMaterial({ color: 0xc09d00, roughness: 0.4, metalness: 0.15 });

// Rounded rectangle shape helper (for cross-section profiles)
function roundedRect(shape, x, y, w, h, rTL, rTR, rBR, rBL) {
  shape.moveTo(x + rBL, y);
  shape.lineTo(x + w - rBR, y);
  if (rBR > 0) shape.quadraticCurveTo(x + w, y, x + w, y + rBR);
  else shape.lineTo(x + w, y);
  shape.lineTo(x + w, y + h - rTR);
  if (rTR > 0) shape.quadraticCurveTo(x + w, y + h, x + w - rTR, y + h);
  else shape.lineTo(x + w, y + h);
  shape.lineTo(x + rTL, y + h);
  if (rTL > 0) shape.quadraticCurveTo(x, y + h, x, y + h - rTL);
  else shape.lineTo(x, y + h);
  shape.lineTo(x, y + rBL);
  if (rBL > 0) shape.quadraticCurveTo(x, y, x + rBL, y);
  else shape.lineTo(x, y);
}

export default function Bus() {
  const ref = useRef();

  // Bus body: extruded rounded cross-section along Z axis
  const bodyGeo = useMemo(() => {
    const shape = new THREE.Shape();
    // Cross-section looking from front: 3.2 wide, 2.8 tall
    // Rounded top corners (0.5), slight rounding on bottom (0.08)
    roundedRect(shape, -1.6, 0, 3.2, 2.8, 0.5, 0.5, 0.08, 0.08);

    // Cut wheel arches into the shape
    const archL1 = new THREE.Path();
    archL1.absarc(-1.6, 0.55, 0.65, 0, Math.PI, false);
    shape.holes.push(archL1);
    const archR1 = new THREE.Path();
    archR1.absarc(1.6, 0.55, 0.65, 0, Math.PI, false);
    shape.holes.push(archR1);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 7.5, bevelEnabled: false });
    // Center along Z and position Y so bottom is at y=0.5
    geo.translate(0, 0.5, -3.75);
    geo.computeVertexNormals();
    return geo;
  }, []);

  // Windshield shape: trapezoidal, wider at bottom
  const windshieldGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-1.4, -0.9);
    shape.lineTo(1.4, -0.9);
    shape.lineTo(1.2, 0.9);
    shape.lineTo(-1.2, 0.9);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);

  // Rear window shape: slightly narrower
  const rearWindowGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-1.1, -0.7);
    shape.lineTo(1.1, -0.7);
    shape.lineTo(1.0, 0.7);
    shape.lineTo(-1.0, 0.7);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);

  // Wheel arch trim geometry (half-circle extrusion for fender)
  const wheelArchGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.72, 0, Math.PI, false);
    shape.lineTo(-0.72, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, -0.06);
    return geo;
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    const s = useBusGameStore.getState();
    ref.current.position.x = s.posX;
    ref.current.position.z = s.posZ;
    ref.current.rotation.y = s.heading;

    const leanZ = -s.steer * Math.min(Math.abs(s.speed) / 30, 1) * 0.04;
    if (s.crashTimer > 0) {
      ref.current.rotation.z = leanZ + Math.sin(s.crashTimer * 25) * s.crashTimer * 0.03;
      ref.current.rotation.x = Math.sin(s.crashTimer * 18) * s.crashTimer * 0.015;
    } else {
      ref.current.rotation.z = leanZ;
      ref.current.rotation.x = 0;
    }
  });

  return (
    <group ref={ref}>
      {/* Main body — extruded rounded profile */}
      <mesh geometry={bodyGeo} castShadow material={busBodyMat} />

      {/* Roof overhang — thin rounded strip */}
      <mesh position={[0, 3.3, 0]} castShadow material={busTrimMat}>
        <boxGeometry args={[3.4, 0.08, 7.7]} />
      </mesh>

      {/* AC unit */}
      <mesh position={[0, 3.55, 0]} material={acMat}>
        <boxGeometry args={[1.8, 0.35, 2.5]} />
      </mesh>

      {/* Front face — angled lower panel below windshield */}
      <mesh position={[0, 1.0, -3.77]} material={busDarkMat}>
        <boxGeometry args={[3.0, 0.8, 0.12]} />
      </mesh>

      {/* Windshield — trapezoidal, slightly raked */}
      <mesh position={[0, 2.35, -3.72]} rotation={[0.08, 0, 0]} geometry={windshieldGeo} material={busGlassMat} />

      {/* Rear window */}
      <mesh position={[0, 2.2, 3.76]} rotation={[0, Math.PI, 0]} geometry={rearWindowGeo} material={busGlassMat} />

      {/* Side windows */}
      {[-1, 1].map(s =>
        [0, 1, 2, 3].map(w => (
          <mesh key={`sw-${s}-${w}`} position={[s * 1.61, 2.3, -2.3 + w * 1.7]} rotation={[0, s * Math.PI / 2, 0]} material={busGlassMat}>
            <planeGeometry args={[1.3, 1.3]} />
          </mesh>
        ))
      )}

      {/* Front bumper — rounded */}
      <mesh position={[0, 0.45, -3.85]} material={busDarkMat}>
        <boxGeometry args={[3.2, 0.35, 0.25]} />
      </mesh>
      {/* Rear bumper — rounded */}
      <mesh position={[0, 0.45, 3.85]} material={busDarkMat}>
        <boxGeometry args={[3.2, 0.35, 0.25]} />
      </mesh>

      {/* Wheel arch trims (front + rear, both sides) */}
      {[-2.2, 2.2].map(zo =>
        [-1, 1].map(s => (
          <mesh
            key={`arch-${zo}-${s}`}
            geometry={wheelArchGeo}
            material={fenderMat}
            position={[s * 1.6, 0.55, zo]}
            rotation={[Math.PI / 2, 0, s === 1 ? 0 : Math.PI]}
          />
        ))
      )}

      {/* Headlights */}
      {[-1, 1].map(s => (
        <mesh key={`hl-${s}`} position={[s * 1.1, 1.1, -3.78]} material={hlMat}>
          <sphereGeometry args={[0.22, 8, 6]} />
        </mesh>
      ))}

      {/* Tail lights — rounded */}
      {[-1, 1].map(s => (
        <mesh key={`tl-${s}`} position={[s * 1.2, 1.1, 3.8]} material={tlMat}>
          <cylinderGeometry args={[0.15, 0.15, 0.06, 8]} />
        </mesh>
      ))}

      {/* Turn signals */}
      {[-1, 1].map(s => (
        <mesh key={`ts-${s}`} position={[s * 1.4, 1.4, -3.8]} material={tsMat}>
          <sphereGeometry args={[0.1, 6, 4]} />
        </mesh>
      ))}

      {/* Wheels — with tire profile */}
      {[-2.2, 2.2].map(zo =>
        [-1, 1].map(s => (
          <group key={`wh-${zo}-${s}`}>
            {/* Tire */}
            <mesh position={[s * 1.7, 0.55, zo]} rotation={[0, 0, Math.PI / 2]} castShadow material={whMat}>
              <torusGeometry args={[0.38, 0.18, 8, 12]} />
            </mesh>
            {/* Hub */}
            <mesh position={[s * 1.7, 0.55, zo]} rotation={[0, 0, Math.PI / 2]} material={hubMat}>
              <cylinderGeometry args={[0.22, 0.22, 0.3, 8]} />
            </mesh>
          </group>
        ))
      )}

      {/* Red stripe */}
      {[-1, 1].map(s => (
        <mesh key={`str-${s}`} position={[s * 1.62, 1.4, 0]} rotation={[0, s * Math.PI / 2, 0]} material={strMat}>
          <planeGeometry args={[7.55, 0.25]} />
        </mesh>
      ))}

      {/* Route display */}
      <mesh position={[0, 3.0, -3.77]} material={routeMat}>
        <planeGeometry args={[1.8, 0.65]} />
      </mesh>

      {/* Side mirrors — rounded */}
      {[-1, 1].map(s => (
        <group key={`mir-${s}`} position={[s * 1.85, 2.0, -3.0]}>
          {/* Arm */}
          <mesh material={busDarkMat}>
            <boxGeometry args={[0.35, 0.06, 0.06]} />
          </mesh>
          {/* Mirror face */}
          <mesh position={[s * 0.15, -0.06, 0]} material={busGlassMat}>
            <boxGeometry args={[0.2, 0.18, 0.12]} />
          </mesh>
        </group>
      ))}

      {/* Running boards / side skirts */}
      {[-1, 1].map(s => (
        <mesh key={`skirt-${s}`} position={[s * 1.55, 0.35, 0]} material={busDarkMat}>
          <boxGeometry args={[0.12, 0.15, 6.8]} />
        </mesh>
      ))}
    </group>
  );
}
