import { settings } from '../config/settings';
import type { Vec3 } from '../core/types';
import type { PlayerState } from '../features/player/PlayerState';
import type { StaticCollisionWorld } from '../physics/CollisionWorld';
import { levelColliders } from './trainingLevel';
import {
  CorridorGenerator,
  corridorBox,
  pathPoint,
  projectOnChunk,
  shiftChunk,
  translate,
  type CorridorChunk,
  type GeneratorSnapshot,
  type SpawnPoint,
} from './CorridorGenerator';
import type { ChunkPresentation, ChunkView } from './ChunkRenderer';
import type { GameWorld } from './GameWorld';
export type { WorldStats } from './GameWorld';

interface ActiveChunk {
  data: CorridorChunk;
  view?: ChunkView;
}
interface Checkpoint {
  index: number;
  spawn: SpawnPoint;
  snapshot: GeneratorSnapshot;
}

export class WorldStreamSystem implements GameWorld {
  readonly deathHeight = settings.corridor.deathHeight;
  private readonly generator: CorridorGenerator;
  private readonly active = new Map<number, ActiveChunk>();
  private checkpointData: Checkpoint;
  private current = 0;
  private progress: number = settings.corridor.checkpointOffset;
  private bestDistance = 0;
  private gate?: ChunkView;
  private gateIndex = -1;
  private disposed = false;

  constructor(
    private readonly player: PlayerState,
    private readonly collisions: StaticCollisionWorld,
    seed = 1,
    private readonly presentation?: ChunkPresentation,
    private readonly onShift: (delta: Vec3) => void = () => {},
  ) {
    this.generator = new CorridorGenerator(seed);
    const first = this.generator.next();
    this.checkpointData = this.makeCheckpoint(first);
    this.add(first);
    this.ensureAhead();
    this.updateGate();
  }
  get distance(): number {
    return this.bestDistance;
  }
  get checkpoint(): number {
    return Math.floor(this.checkpointData.index / settings.corridor.checkpointInterval) + 1;
  }
  get activeChunks(): number {
    return this.active.size;
  }
  get chunks(): readonly CorridorChunk[] {
    return [...this.active.values()].map((chunk) => chunk.data);
  }
  get currentIndex(): number {
    return this.current;
  }
  get oldestIndex(): number {
    return Math.min(...this.active.keys());
  }
  getSpawn(): SpawnPoint {
    return structuredClone(this.checkpointData.spawn);
  }

  /** Registered before movement so the next six chunks already have colliders. */
  fixedUpdate(): void {
    this.ensureAhead();
  }

  /** Registered immediately after movement, before rockets and presentation. */
  afterMovement(): void {
    if (this.disposed) {
      return;
    }
    let located = this.progress;
    for (const { data } of this.active.values()) {
      const distance = projectOnChunk(data, this.player.position);
      if (distance !== undefined) {
        located = Math.max(located, data.index * settings.corridor.length + distance);
      }
    }
    this.progress = located;
    const reached = Math.floor((located + 1e-8) / settings.corridor.length);
    this.current = Math.min(reached, Math.max(...this.active.keys()));
    this.bestDistance = Math.max(this.bestDistance, located - settings.corridor.checkpointOffset);
    // Checkpoints crossed in a single fast tick are still saved before pruning.
    if (this.player.position.y >= settings.corridor.fallingHeight) {
      for (const { data } of this.active.values()) {
        if (
          data.index > this.checkpointData.index &&
          data.index % settings.corridor.checkpointInterval === 0 &&
          located >= data.index * settings.corridor.length + settings.corridor.checkpointOffset
        ) {
          this.checkpointData = this.makeCheckpoint(data);
        }
      }
    }
    const oldest = Math.max(0, this.current - settings.corridor.behind);
    for (const [index, chunk] of this.active) {
      if (index < oldest) {
        chunk.view?.dispose();
        this.active.delete(index);
        this.collisions.removeChunk(`corridor:${index}`);
      }
    }
    this.ensureAhead();
    this.updateGate();
    if (
      Math.hypot(this.player.position.x, this.player.position.z) > settings.corridor.rebaseDistance
    ) {
      this.shiftOrigin({ x: this.player.position.x, y: 0, z: this.player.position.z });
    }
  }

  contains(position: Vec3): boolean {
    return [...this.active.values()].some(
      ({ data }) => projectOnChunk(data, position) !== undefined,
    );
  }
  restoreCheckpoint(): void {
    this.clear();
    this.generator.restore(this.checkpointData.snapshot);
    this.current = this.checkpointData.index;
    this.progress = this.current * settings.corridor.length + settings.corridor.checkpointOffset;
    this.ensureAhead();
    this.updateGate();
  }
  shiftOrigin(delta: Vec3): void {
    translate(this.player.position, delta);
    translate(this.player.previousPosition, delta);
    translate(this.checkpointData.spawn.position, delta);
    translate(this.checkpointData.snapshot.start, delta);
    this.generator.shiftOrigin(delta);
    for (const [index, chunk] of this.active) {
      shiftChunk(chunk.data, delta);
      chunk.view?.shiftOrigin(delta);
      this.collisions.setChunk(`corridor:${index}`, levelColliders(chunk.data));
    }
    this.gate?.shiftOrigin(delta);
    // Recreate just the gate's collider at its new local position.
    this.gateIndex = -1;
    this.updateGate();
    this.onShift(delta);
  }

  private makeCheckpoint(chunk: CorridorChunk): Checkpoint {
    return {
      index: chunk.index,
      spawn: { position: { ...chunk.spawn }, yaw: chunk.yaw },
      snapshot: structuredClone(chunk.snapshot),
    };
  }
  private add(data: CorridorChunk): void {
    this.active.set(data.index, { data, view: this.presentation?.create(data.boxes) });
    this.collisions.setChunk(`corridor:${data.index}`, levelColliders(data));
  }
  private ensureAhead(): void {
    if (this.disposed) {
      return;
    }
    while (this.generator.nextIndex <= this.current + settings.corridor.ahead) {
      this.add(this.generator.next());
    }
  }
  private updateGate(): void {
    const oldest = this.oldestIndex;
    if (this.gateIndex === oldest) {
      return;
    }
    this.gate?.dispose();
    const oldestChunk = this.active.get(oldest);
    if (!oldestChunk) {
      throw new Error(`Не найден активный участок ${oldest} для закрывающей стены`);
    }
    const chunk = oldestChunk.data;
    const start = chunk.legs[0].start;
    const box = corridorBox(
      start,
      chunk.yaw,
      0,
      -0.5,
      settings.corridor.width + 2,
      1,
      start.y + settings.corridor.height / 2,
      settings.corridor.height,
      'wall',
      0x6c8078,
    );
    this.collisions.setChunk(
      'corridor:gate',
      levelColliders({ spawn: pathPoint(start, chunk.yaw, 0), boxes: [box] }),
    );
    this.gate = this.presentation?.create([box]);
    this.gateIndex = oldest;
  }
  private clear(): void {
    for (const [index, chunk] of this.active) {
      chunk.view?.dispose();
      this.collisions.removeChunk(`corridor:${index}`);
    }
    this.active.clear();
    this.gate?.dispose();
    this.gate = undefined;
    this.gateIndex = -1;
    this.collisions.removeChunk('corridor:gate');
  }
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.clear();
      this.presentation?.dispose();
    }
  }
}
