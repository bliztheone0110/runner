import { settings } from '../config/settings';
import type { Vec3 } from '../core/types';
import type { StaticCollisionWorld } from '../physics/CollisionWorld';
import type { ChunkPresentation, ChunkView } from './ChunkRenderer';
import type { GameWorld } from './GameWorld';
import { levelColliders, type LevelBox, type LevelDefinition } from './trainingLevel';

export function createTrainingRoom(): LevelDefinition {
  const { size, wallHeight, gridSpacing } = settings.training;
  const half = size / 2;
  const boxes: LevelBox[] = [
    {
      center: { x: 0, y: -1, z: 0 },
      size: { x: size, y: 2, z: size },
      color: 0x28383f,
      kind: 'floor',
    },
  ];
  for (const side of [-1, 1]) {
    boxes.push({
      center: { x: side * (half + 0.5), y: wallHeight / 2, z: 0 },
      size: { x: 1, y: wallHeight, z: size + 2 },
      color: 0x40565c,
      kind: 'wall',
    });
    boxes.push({
      center: { x: 0, y: wallHeight / 2, z: side * (half + 0.5) },
      size: { x: size, y: wallHeight, z: 1 },
      color: 0x40565c,
      kind: 'wall',
    });
  }
  for (let line = -half + gridSpacing; line < half; line += gridSpacing) {
    const color = line === 0 ? 0x64b5aa : 0x466067;
    boxes.push({
      center: { x: line, y: 0.006, z: 0 },
      size: { x: 0.04, y: 0.01, z: size },
      color,
      kind: 'marker',
      collidable: false,
    });
    boxes.push({
      center: { x: 0, y: 0.006, z: line },
      size: { x: size, y: 0.01, z: 0.04 },
      color,
      kind: 'marker',
      collidable: false,
    });
  }
  return { spawn: { x: 0, y: 0.00001, z: 0 }, boxes };
}

export class TrainingWorld implements GameWorld {
  readonly deathHeight = settings.corridor.deathHeight;
  readonly distance = 0;
  readonly checkpoint = 0;
  readonly activeChunks = 1;
  private readonly definition = createTrainingRoom();
  private readonly view?: ChunkView;
  private disposed = false;
  constructor(
    private readonly collisions: StaticCollisionWorld,
    private readonly presentation?: ChunkPresentation,
  ) {
    collisions.setChunk('training', levelColliders(this.definition));
    this.view = presentation?.create(this.definition.boxes);
  }
  getSpawn() {
    return { position: { ...this.definition.spawn }, yaw: 0 };
  }
  restoreCheckpoint(): void {}
  afterMovement(): void {}
  contains(position: Vec3): boolean {
    const limit = settings.training.size / 2 + 1;
    return (
      Math.abs(position.x) <= limit &&
      Math.abs(position.z) <= limit &&
      position.y >= this.deathHeight
    );
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.collisions.removeChunk('training');
    this.view?.dispose();
    this.presentation?.dispose();
  }
}
