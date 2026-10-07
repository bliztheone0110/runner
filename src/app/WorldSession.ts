import type { Vec3 } from '../core/types';
import type { GameMode, GameWorld } from '../world/GameWorld';

/** Stable dependency for gameplay systems while the owned world changes. */
export class WorldSession implements GameWorld {
  private world: GameWorld;
  private currentMode: GameMode = 'corridor';
  private disposed = false;
  constructor(private readonly createWorld: (mode: GameMode) => GameWorld) {
    this.world = createWorld(this.currentMode);
  }
  get mode(): GameMode {
    return this.currentMode;
  }
  get deathHeight(): number {
    return this.world.deathHeight;
  }
  get distance(): number {
    return this.world.distance;
  }
  get checkpoint(): number {
    return this.world.checkpoint;
  }
  get activeChunks(): number {
    return this.world.activeChunks;
  }
  select(mode: GameMode): boolean {
    if (this.disposed || mode === this.currentMode) {
      return false;
    }
    this.world.dispose();
    this.world = this.createWorld(mode);
    this.currentMode = mode;
    return true;
  }
  getSpawn() {
    return this.world.getSpawn();
  }
  restart(): void {
    if (this.disposed) {
      return;
    }
    this.world.dispose();
    this.world = this.createWorld(this.currentMode);
  }
  restoreCheckpoint(): void {
    this.world.restoreCheckpoint();
  }
  contains(position: Vec3): boolean {
    return this.world.contains(position);
  }
  fixedUpdate(dt: number): void {
    this.world.fixedUpdate?.(dt);
  }
  afterMovement(): void {
    this.world.afterMovement();
  }
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.world.dispose();
    }
  }
}
