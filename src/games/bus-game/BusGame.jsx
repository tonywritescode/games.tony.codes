import { useRef, useCallback } from 'react';
import GameShell from '../../shared/components/GameShell';
import TouchControls from '../../shared/components/TouchControls';
import { useInput } from '../../shared/hooks/useInput';
import { useAudio } from '../../shared/hooks/useAudio';
import { createBusAudio } from './audio/BusAudioEngine';
import { useBusGameStore } from './store/busGameStore';

import BusGameScene from './scene/BusGameScene';
import Environment from './scene/Environment';
import Road from './scene/Road';
import Buildings from './scene/Buildings';
import Trees from './scene/Trees';
import StreetLights from './scene/StreetLights';
import BusStops from './scene/BusStops';
import Bus from './scene/Bus';
import Traffic from './scene/Traffic';
import GameCamera from './scene/GameCamera';
import GameController from './systems/GameController';

import BusGameMenu from './ui/BusGameMenu';
import BusGameComplete from './ui/BusGameComplete';
import BusGameHUD from './ui/BusGameHUD';
import StopOverlay from './ui/StopOverlay';
import CrashOverlay from './ui/CrashOverlay';
import DamageIndicator from './ui/DamageIndicator';

export default function BusGame() {
  const { keysRef, press, release } = useInput();
  const { audioRef, ensureAudio } = useAudio(createBusAudio);
  const obstaclesRef = useRef({ buildings: [], trees: [], stops: [] });
  const trafficRef = useRef([]);

  const phase = useBusGameStore((s) => s.phase);

  const handleStart = useCallback(() => {
    ensureAudio();
    useBusGameStore.getState().startPlaying();
  }, [ensureAudio]);

  const handleAction = useCallback((action) => {
    ensureAudio();
    if (action === 'horn' && audioRef.current) {
      audioRef.current.playHorn();
    }
    if (action === 'door') {
      useBusGameStore.getState().openDoors(audioRef);
    }
    if (action === 'gas') {
      // Audio init on first gas press (touch)
    }
  }, [ensureAudio, audioRef]);

  const canvasFilter = phase === 'menu'
    ? 'blur(3px) brightness(0.35)'
    : phase === 'complete'
      ? 'blur(4px) brightness(0.3)'
      : 'none';

  return (
    <GameShell>
      {/* 3D Canvas */}
      <div
        style={{
          width: '100%', height: '100%', position: 'absolute', top: 0, left: 0,
          filter: canvasFilter, transition: 'filter 0.5s',
        }}
      >
        <BusGameScene>
          <Environment />
          <Road />
          <Buildings obstaclesRef={obstaclesRef} />
          <Trees obstaclesRef={obstaclesRef} />
          <StreetLights />
          <BusStops obstaclesRef={obstaclesRef} />
          <Bus />
          <Traffic trafficRef={trafficRef} />
          <GameCamera />
          <GameController
            keysRef={keysRef}
            audioRef={audioRef}
            obstaclesRef={obstaclesRef}
            trafficRef={trafficRef}
          />
        </BusGameScene>
      </div>

      {/* UI Overlays */}
      <BusGameMenu onStart={handleStart} />
      <BusGameComplete onRestart={handleStart} />
      <BusGameHUD />
      <StopOverlay />
      <CrashOverlay />
      <DamageIndicator />

      {/* Touch Controls (shown during gameplay) */}
      {(phase === 'playing' || phase === 'stopped') && (
        <TouchControls
          onPress={press}
          onRelease={release}
          onAction={handleAction}
        />
      )}
    </GameShell>
  );
}
