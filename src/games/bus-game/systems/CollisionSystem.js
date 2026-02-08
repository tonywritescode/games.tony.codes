import { dd } from '../data/mathUtils';

export function checkBusObstacleCollision(busX, busZ, heading, obstacles) {
  const sinH = Math.sin(heading), cosH = Math.cos(heading);
  const testPts = [];

  for (let ci = -1; ci <= 1; ci += 2) {
    for (let cj = -1; cj <= 1; cj += 2) {
      testPts.push({
        x: busX - sinH * 4.2 * cj + cosH * 1.8 * ci,
        z: busZ - cosH * 4.2 * cj - sinH * 1.8 * ci,
      });
    }
  }
  testPts.push({ x: busX - sinH * 4.2, z: busZ - cosH * 4.2 });
  testPts.push({ x: busX + sinH * 4.2, z: busZ + cosH * 4.2 });

  for (let oi = 0; oi < obstacles.length; oi++) {
    const ob = obstacles[oi];
    let hit = false;

    if (ob.r !== undefined) {
      const hitR = ob.r + 2.0;
      for (let pi = 0; pi < testPts.length; pi++) {
        if (dd(testPts[pi].x, testPts[pi].z, ob.x, ob.z) < hitR) { hit = true; break; }
      }
      if (!hit && dd(busX, busZ, ob.x, ob.z) < hitR) hit = true;
    } else {
      for (let pi = 0; pi < testPts.length; pi++) {
        const pp = testPts[pi];
        if (pp.x > ob.x - ob.hw && pp.x < ob.x + ob.hw && pp.z > ob.z - ob.hd && pp.z < ob.z + ob.hd) {
          hit = true; break;
        }
      }
      if (!hit && busX > ob.x - ob.hw && busX < ob.x + ob.hw && busZ > ob.z - ob.hd && busZ < ob.z + ob.hd) {
        hit = true;
      }
    }

    if (hit) return true;
  }

  return false;
}

export function checkBusTrafficCollision(busX, busZ, heading, traffic) {
  const bSin = Math.sin(heading), bCos = Math.cos(heading);

  for (let ti = 0; ti < traffic.length; ti++) {
    const tv = traffic[ti];
    const dx = busX - tv.wx;
    const dz = busZ - tv.wz;
    const distBT = Math.sqrt(dx * dx + dz * dz);

    if (distBT < 8) {
      const cAng = tv.ang;
      const cSin = Math.sin(cAng), cCos = Math.cos(cAng);
      let busHits = false;

      for (let bc = -1; bc <= 1; bc += 2) {
        for (let bl = -1; bl <= 1; bl += 2) {
          const bpx = busX - bSin * 4.0 * bl + bCos * 1.7 * bc;
          const bpz = busZ - bCos * 4.0 * bl - bSin * 1.7 * bc;
          const lx = (bpx - tv.wx) * cCos + (bpz - tv.wz) * cSin;
          const lz = -(bpx - tv.wx) * cSin + (bpz - tv.wz) * cCos;
          if (Math.abs(lx) < tv.halfWid + 0.3 && Math.abs(lz) < tv.halfLen + 0.3) {
            busHits = true; break;
          }
        }
        if (busHits) break;
      }

      if (busHits) return { hit: true, trafficIdx: ti };
    }
  }

  return { hit: false, trafficIdx: -1 };
}
