import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { ROUTE, STOPS } from '../data/routeData';
import { dd } from '../data/mathUtils';
import { useBusGameStore } from '../store/busGameStore';
import { checkBusObstacleCollision, checkBusTrafficCollision } from './CollisionSystem';

export default function GameController({ keysRef, audioRef, obstaclesRef, trafficRef }) {
  // Space and horn key handler
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === ' ') {
        e.preventDefault();
        useBusGameStore.getState().openDoors(audioRef);
      }
      if (e.key === 'h' || e.key === 'H') {
        if (audioRef.current) audioRef.current.playHorn();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [audioRef]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = useBusGameStore.getState();

    if (s.phase !== 'playing') return;

    const keys = keysRef.current;
    let { speed, heading, steer, posX, posZ, crashed, crashTimer, camShake, time, score, damage, nextWp, visited, nearIdx } = s;

    time += dt;

    // Timers
    if (crashTimer > 0) crashTimer = Math.max(crashTimer - dt, 0);
    if (camShake > 0) camShake = Math.max(camShake - dt * 3, 0);

    // Steering
    if (keys['arrowleft'] || keys['a']) steer = Math.min(steer + 2.5 * dt, 0.7);
    else if (keys['arrowright'] || keys['d']) steer = Math.max(steer - 2.5 * dt, -0.7);
    else { if (Math.abs(steer) < 0.02) steer = 0; else steer -= Math.sign(steer) * 3.5 * dt; }

    // Speed
    if (crashed) {
      if (keys['arrowdown'] || keys['s']) speed = Math.max(speed - 18 * dt, -8);
      else if (keys['arrowup'] || keys['w']) speed = Math.min(speed + 6 * dt, 3);
      else { if (speed > 0) speed = Math.max(speed - 5 * dt, 0); else speed = Math.min(speed + 3 * dt, 0); }
    } else {
      if (keys['arrowup'] || keys['w']) speed = Math.min(speed + 14 * dt, 30);
      else if (keys['arrowdown'] || keys['s']) speed = Math.max(speed - 22 * dt, -6);
      else { if (speed > 0) speed = Math.max(speed - 5 * dt, 0); else speed = Math.min(speed + 5 * dt, 0); }
    }

    // Movement
    const prevX = posX, prevZ = posZ;
    const tf = Math.min(Math.abs(speed) / 12, 1) * steer;
    heading += tf * dt * 2;
    posX -= Math.sin(heading) * speed * dt;
    posZ -= Math.cos(heading) * speed * dt;

    // Collect all obstacles
    const allObstacles = [
      ...(obstaclesRef.current.buildings || []),
      ...(obstaclesRef.current.trees || []),
      ...(obstaclesRef.current.stops || []),
    ];

    // Bus vs obstacle collision
    const obsHit = checkBusObstacleCollision(posX, posZ, heading, allObstacles);
    if (obsHit && !crashed) {
      posX = prevX; posZ = prevZ;
      const impactSpd = Math.abs(speed);
      speed = 0; crashed = true; crashTimer = 2.5;
      camShake = Math.min(impactSpd / 15, 1.0);
      score = Math.max(score - Math.round(impactSpd * 2), 0);
      damage++;
      if (audioRef.current) audioRef.current.playCrash(Math.min(impactSpd / 30, 1));
    } else if (crashed && !obsHit) {
      crashed = false;
    }

    // Bus vs traffic collision
    const traffic = trafficRef.current;
    if (traffic && !crashed) {
      const { hit, trafficIdx } = checkBusTrafficCollision(posX, posZ, heading, traffic);
      if (hit) {
        const impSpd = Math.abs(speed);
        posX = prevX; posZ = prevZ;
        speed = 0; crashed = true; crashTimer = 2.5;
        camShake = Math.min(impSpd / 15, 1.0);
        score = Math.max(score - Math.round(impSpd * 3), 0);
        damage++;
        if (audioRef.current) audioRef.current.playCrash(Math.min(impSpd / 30, 1));
        // Push traffic car
        const tv = traffic[trafficIdx];
        tv.speed = -2;
        tv.segT += tv.dir * 0.15;
      }
    }

    // Audio
    if (audioRef.current) {
      audioRef.current.updateEngine(speed, 30);
      audioRef.current.updateMusic(dt);
    }

    // Near stop
    nearIdx = -1;
    for (let si = 0; si < STOPS.length; si++) {
      const ww = ROUTE[STOPS[si].i];
      if (dd(posX, posZ, ww[0], ww[1]) < 10) { nearIdx = si; break; }
    }

    // Waypoint progress
    if (nextWp < ROUTE.length) {
      const nw = ROUTE[nextWp];
      if (dd(posX, posZ, nw[0], nw[1]) < 14) nextWp = Math.min(nextWp + 1, ROUTE.length - 1);
    }

    // Next stop name
    let nextStopName = 'Terminal';
    for (let si = 0; si < STOPS.length; si++) {
      if (!visited[si]) { nextStopName = STOPS[si].n; break; }
    }

    useBusGameStore.setState({
      speed, heading, steer, posX, posZ, prevX, prevZ,
      crashed, crashTimer, camShake, time, score, damage,
      nextWp, nearIdx, nextStopName,
    });
  });

  return null;
}
