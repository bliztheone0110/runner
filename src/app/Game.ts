import { GameLoop } from '../core/GameLoop';
import { settings } from '../config/settings';
import { BrowserInput } from '../input/BrowserInput';
import { InputSystem } from '../input/InputSystem';
import { StaticCollisionWorld } from '../physics/CollisionWorld';
import { PlayerState } from '../features/player/PlayerState';
import { MovementController } from '../features/player/MovementController';
import { PlayerSystem } from '../features/player/PlayerSystem';
import { FirstPersonCamera } from '../features/player/FirstPersonCamera';
import { GameRenderer } from '../rendering/GameRenderer';
import { Hud } from '../ui/Hud';
import { HealthState } from '../features/health/HealthState';
import { HealthSystem } from '../features/health/HealthSystem';
import { WeaponSystem } from '../features/weapons/WeaponSystem';
import { WeaponVisuals } from '../features/weapons/WeaponVisuals';
import { RespawnSystem } from './RespawnSystem';
import { GameEvents } from '../core/GameEvents';
import { AudioSystem } from '../audio/AudioSystem';
import { BrowserAudioOutput } from '../audio/BrowserAudioOutput';
import { AudioListenerSystem } from '../audio/AudioListenerSystem';
import { ChunkRenderer } from '../world/ChunkRenderer';
import { WorldStreamSystem } from '../world/WorldStreamSystem';
import { FallingSystem } from '../features/player/FallingSystem';
import { WorldSession } from './WorldSession';
import { TrainingWorld } from '../world/TrainingWorld';
import { CheckpointTimer } from '../features/timer/CheckpointTimer';

export class Game {
  private readonly loop: GameLoop;
  private readonly abort = new AbortController();
  private disposed = false;

  constructor(container: HTMLElement) {
    const state = new PlayerState();
    const camera = new FirstPersonCamera(state);
    const graphics = new GameRenderer(container, camera.camera);
    const world = new StaticCollisionWorld();
    const events = new GameEvents();
    const audio = new AudioSystem(events, new BrowserAudioOutput());
    const audioListener = new AudioListenerSystem(camera.camera, audio);
    const movement = new MovementController(state, world, settings.movement, events);
    const session = new WorldSession((mode) =>
      mode === 'training'
        ? new TrainingWorld(world, new ChunkRenderer(graphics.scene))
        : new WorldStreamSystem(
            state,
            world,
            Math.floor(Math.random() * 0xffffffff),
            new ChunkRenderer(graphics.scene),
            (delta) => {
              weapons.shiftOrigin(delta);
              events.shiftOrigin(delta);
              audio.shiftOrigin(delta);
            },
          ),
    );
    const spawn = session.getSpawn();
    movement.reset(spawn.position, spawn.yaw);
    const health = new HealthState();
    let runEnded = false;
    const checkpointTimer = new CheckpointTimer(session, events, () => {
      runEnded = true;
      audio.stopAll();
      input.pause();
      hud.showTimerEnd(Math.max(0, session.checkpoint - 1));
    });
    let hasStarted = false;
    const hud = new Hud(
      container,
      state,
      health,
      (mode) => {
        if (session.select(mode)) {
          audio.stopAll();
          respawn.reset(false);
          checkpointTimer.reset();
          hud.setMode(mode);
        }
        void audio.unlock();
        void input.lock();
      },
      {
        setVolume: (volume) => audio.setVolume(volume),
        setMuted: (muted) => audio.setMuted(muted),
      },
      session,
      checkpointTimer,
      () => {
        runEnded = false;
        session.restart();
        audio.stopAll();
        respawn.reset(false);
        checkpointTimer.reset();
        hud.clearTimerEnd();
        void audio.unlock();
        void input.lock();
      },
    );
    const input = new BrowserInput(
      graphics.renderer.domElement,
      (active) => {
        // The final sound is played after simulation stops, while the result window is open.
        if (runEnded) {
          this.loop.setPaused(true);
          return;
        }
        this.loop.setPaused(!active);
        hud.setActive(active);
        audio.setActive(active);
        if (active && !hasStarted) {
          hasStarted = true;
          events.emit({ type: 'game.started' });
        }
      },
      (message) => hud.showError(message),
    );
    const inputSystem = new InputSystem(input.state);
    const player = new PlayerSystem(movement, inputSystem);
    const weapons = new WeaponSystem(
      state,
      movement,
      health,
      inputSystem,
      world,
      events,
      (position) => session.contains(position),
    );
    const visuals = new WeaponVisuals(graphics.scene, weapons);
    const respawn = new RespawnSystem(
      movement,
      health,
      weapons,
      inputSystem,
      session,
      () => {
        visuals.reset();
        falling.reset();
      },
      events,
    );
    const falling = new FallingSystem(state, events, () => respawn.reset());
    const healthSystem = new HealthSystem(health, () => respawn.reset());
    // Physics runs in registration order; presentation follows state, then rendering.
    this.loop = new GameLoop(
      [
        input,
        inputSystem,
        session,
        respawn,
        player,
        { fixedUpdate: () => session.afterMovement() },
        weapons,
        falling,
        healthSystem,
        checkpointTimer,
        audio,
        camera,
        audioListener,
        visuals,
        graphics,
        hud,
      ],
      (count, elapsed) => input.state.beginFrame(count, elapsed),
    );
    window.addEventListener('pagehide', () => this.dispose(), { signal: this.abort.signal });
  }
  start(): void {
    this.loop.start();
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abort.abort();
    this.loop.dispose();
  }
}
