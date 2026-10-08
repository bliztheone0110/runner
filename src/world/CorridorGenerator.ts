import { settings } from '../config/settings';
import type { Vec3 } from '../core/types';
import type { LevelBox, LevelDefinition } from './trainingLevel';

export type CorridorTemplate =
  'run' | 'blocks' | 'gap' | 'rocket-block' | 'rocket-gap' | 'elevation' | 'turn';
export interface GeneratorSnapshot {
  index: number;
  random: number;
  start: Vec3;
  yaw: number;
  returnTurn: number;
  previousHard: boolean;
}
export interface PathLeg {
  start: Vec3;
  yaw: number;
  length: number;
}
export interface CorridorChunk extends LevelDefinition {
  index: number;
  template: CorridorTemplate;
  yaw: number;
  exit: Vec3;
  exitYaw: number;
  legs: PathLeg[];
  snapshot: GeneratorSnapshot;
  obstacleSize: number;
}
export interface SpawnPoint {
  position: Vec3;
  yaw: number;
}
export interface SpawnProvider {
  getSpawn(): SpawnPoint;
  restoreCheckpoint(): void;
  deathHeight: number;
}

export const forward = (yaw: number): Vec3 => ({
  x: Math.round(-Math.sin(yaw)),
  y: 0,
  z: Math.round(-Math.cos(yaw)),
});
export const right = (yaw: number): Vec3 => ({
  x: Math.round(Math.cos(yaw)),
  y: 0,
  z: Math.round(-Math.sin(yaw)),
});
export function pathPoint(start: Vec3, yaw: number, distance: number, lateral = 0): Vec3 {
  const f = forward(yaw);
  const r = right(yaw);
  return {
    x: start.x + f.x * distance + r.x * lateral,
    y: start.y,
    z: start.z + f.z * distance + r.z * lateral,
  };
}
export function corridorBox(
  start: Vec3,
  yaw: number,
  lateral: number,
  distance: number,
  width: number,
  depth: number,
  y: number,
  height: number,
  kind: LevelBox['kind'],
  color: number,
): LevelBox {
  const center = pathPoint(start, yaw, distance, lateral);
  center.y = y;
  const f = forward(yaw);
  return {
    center,
    size: { x: f.x === 0 ? width : depth, y: height, z: f.x === 0 ? depth : width },
    kind,
    color,
    collidable: kind !== 'marker' && kind !== 'checkpoint',
  };
}

/** Serializable bounded state; paired bends always return to the north axis. */
export class CorridorGenerator {
  private cursor: GeneratorSnapshot;
  constructor(seed = 1) {
    this.cursor = {
      index: 0,
      random: seed >>> 0 || 1,
      start: { x: 0, y: 0, z: 0 },
      yaw: 0,
      returnTurn: 0,
      previousHard: false,
    };
  }
  save(): GeneratorSnapshot {
    return structuredClone(this.cursor);
  }
  get nextIndex(): number {
    return this.cursor.index;
  }
  restore(snapshot: GeneratorSnapshot): void {
    this.cursor = structuredClone(snapshot);
  }
  shiftOrigin(delta: Vec3): void {
    translate(this.cursor.start, delta);
  }
  private random(): number {
    let value = this.cursor.random;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.cursor.random = value >>> 0;
    return this.cursor.random / 0x100000000;
  }
  next(): CorridorChunk {
    const snapshot = this.save();
    const index = this.cursor.index;
    const start = { ...this.cursor.start };
    const yaw = this.cursor.yaw;
    let turn = 0;
    if (index % 5 === 3) {
      turn = this.random() < 0.5 ? -1 : 1;
      this.cursor.returnTurn = -turn;
    } else if (index > 0 && index % 5 === 0) {
      turn = this.cursor.returnTurn;
      this.cursor.returnTurn = 0;
    }
    let template: CorridorTemplate;
    if (turn) {
      template = 'turn';
    } else if (index < 3) {
      template = (['run', 'blocks', 'gap'] as const)[index];
    } else {
      const choices: CorridorTemplate[] = this.cursor.previousHard
        ? ['run', 'blocks', 'gap']
        : ['run', 'blocks', 'gap', 'rocket-block', 'rocket-gap'];
      template = choices[Math.floor(this.random() * choices.length)];
      if (this.random() < settings.corridor.elevationChance) {
        template = 'elevation';
      }
    }
    let obstacleSize = 0;
    switch (template) {
      case 'blocks':
        obstacleSize = 0.8 + this.random() * 0.4;
        break;
      case 'gap':
        obstacleSize = 2 + this.random();
        break;
      case 'rocket-block':
        obstacleSize = 3;
        break;
      case 'rocket-gap':
        obstacleSize = 6.5 + this.random() * 1.5;
        break;
    }
    const length = settings.corridor.length;
    const width = settings.corridor.width;
    const half = width / 2;
    const rise =
      settings.corridor.elevationFraction *
      (settings.weapons.blastImpulse ** 2 / (2 * settings.movement.gravity));
    const rampLength = rise / Math.tan((settings.corridor.elevationAngleDegrees * Math.PI) / 180);
    const chunkRise = template === 'elevation' ? rise : 0;
    const wallHeight = settings.corridor.height - settings.corridor.deathHeight + chunkRise;
    const wallY = (settings.corridor.height + settings.corridor.deathHeight + chunkRise) / 2;
    const floorY = start.y - 1;
    const roofY = start.y + chunkRise + settings.corridor.height + 0.5;
    const lavaThickness = 0.1;
    const boxes: LevelBox[] = [];
    const box = (
      u: number,
      s: number,
      w: number,
      d: number,
      y: number,
      h: number,
      kind: LevelBox['kind'],
      color: number,
    ) => {
      const generatedBox = corridorBox(start, yaw, u, s, w, d, y, h, kind, color);
      if (kind === 'wall' || kind === 'obstacle') {
        generatedBox.texture = 'wallRock';
      }
      if (kind === 'lava') {
        generatedBox.texture = 'lava';
        generatedBox.collidable = false;
      }
      boxes.push(generatedBox);
    };
    const floorColor = index % 3 === 0 ? 0x314c50 : 0x2a3b43;
    const legs: PathLeg[] = [{ start: { ...start }, yaw, length: turn ? length / 2 : length }];
    let exitYaw = yaw;
    let exit: Vec3;
    if (turn) {
      const direction = -turn;
      const middle = length / 2;
      const joint = pathPoint(start, yaw, middle);
      exitYaw = Math.atan2(
        Math.sin(yaw + (turn * Math.PI) / 2),
        Math.cos(yaw + (turn * Math.PI) / 2),
      );
      legs.push({ start: joint, yaw: exitYaw, length: middle });
      exit = pathPoint(joint, exitYaw, middle);
      for (const [u, s, w, d] of [
        [0, middle / 2, width, middle],
        [(direction * middle) / 2, middle, middle, width],
        [0, middle, width, width],
      ]) {
        box(u, s, w, d, floorY, 2, 'floor', floorColor);
        box(
          u,
          s,
          w,
          d,
          start.y + settings.corridor.deathHeight - lavaThickness / 2,
          lavaThickness,
          'lava',
          0xffffff,
        );
        box(u, s, w, d, roofY, 1, 'wall', 0x27373e);
      }
      box(
        -direction * (half + 0.5),
        (middle + half) / 2,
        1,
        middle + half,
        start.y + wallY,
        wallHeight,
        'wall',
        0x40565c,
      );
      box(
        direction * (half + 0.5),
        (middle - half) / 2,
        1,
        middle - half,
        start.y + wallY,
        wallHeight,
        'wall',
        0x40565c,
      );
      box(
        (direction * (middle - half)) / 2,
        middle + half + 0.5,
        middle + half,
        1,
        start.y + wallY,
        wallHeight,
        'wall',
        0x40565c,
      );
      box(
        (direction * (middle + half)) / 2,
        middle - half - 0.5,
        middle - half,
        1,
        start.y + wallY,
        wallHeight,
        'wall',
        0x40565c,
      );
    } else {
      exit = pathPoint(start, yaw, length);
      if (template === 'elevation') {
        const rampCenter = pathPoint(start, yaw, rampLength / 2);
        rampCenter.y = start.y + rise / 2;
        boxes.push({
          center: rampCenter,
          size: { x: width, y: rise, z: rampLength },
          kind: 'ramp',
          color: floorColor,
          texture: 'floorStone',
          yaw,
          landingLength: length - rampLength,
        });
        const upperFloorLength = length - rampLength;
        const upperFloor = corridorBox(
          start,
          yaw,
          0,
          rampLength + upperFloorLength / 2,
          width,
          upperFloorLength,
          start.y + rise - 1,
          2,
          'floor',
          floorColor,
        );
        upperFloor.texture = 'floorStone';
        upperFloor.collidable = false;
        boxes.push(upperFloor);
        const rampRoofCenter = pathPoint(start, yaw, rampLength / 2);
        rampRoofCenter.y = start.y + settings.corridor.height + rise / 2 + 0.5;
        boxes.push({
          center: rampRoofCenter,
          size: { x: width, y: 1, z: rampLength },
          colliderSize: { x: width, y: rise + 1, z: rampLength },
          kind: 'rampRoof',
          color: 0x27373e,
          texture: 'wallRock',
          yaw,
          pitch: (settings.corridor.elevationAngleDegrees * Math.PI) / 180,
        });
        const upperRoof = corridorBox(
          start,
          yaw,
          0,
          rampLength + upperFloorLength / 2,
          width,
          upperFloorLength,
          start.y + rise + settings.corridor.height + 0.5,
          1,
          'wall',
          0x27373e,
        );
        upperRoof.texture = 'wallRock';
        boxes.push(upperRoof);
        exit.y += rise;
      } else if (template === 'gap' || template === 'rocket-gap') {
        const solid = (length - obstacleSize) / 2;
        box(0, solid / 2, width, solid, floorY, 2, 'floor', floorColor);
        box(0, length - solid / 2, width, solid, floorY, 2, 'floor', floorColor);
        for (const s of [solid - 0.2, length - solid + 0.2]) {
          box(0, s, width, 0.2, start.y + 0.009, 0.015, 'marker', 0xf0a047);
        }
      } else {
        box(0, length / 2, width, length, floorY, 2, 'floor', floorColor);
        if (template === 'blocks' || template === 'rocket-block') {
          box(
            0,
            length / 2,
            width,
            2.5,
            start.y + obstacleSize / 2,
            obstacleSize,
            'obstacle',
            template === 'rocket-block' ? 0xe59648 : 0x3bb9a6,
          );
        }
      }
      box(
        0,
        length / 2,
        width,
        length,
        start.y + settings.corridor.deathHeight - lavaThickness / 2,
        lavaThickness,
        'lava',
        0xffffff,
      );
      if (template !== 'elevation') {
        box(0, length / 2, width, length, roofY, 1, 'wall', 0x27373e);
      }
      for (const side of [-1, 1]) {
        box(
          side * (half + 0.5),
          length / 2,
          1,
          length,
          start.y + wallY,
          wallHeight,
          'wall',
          0x40565c,
        );
      }
    }
    // Local floor markings do not bridge gaps or add physics colliders.
    for (const s of [4, 8, 12, 36, 40, 44]) {
      if (!turn && template !== 'elevation') {
        box(0, s, width - 1, 0.05, start.y + 0.006, 0.01, 'marker', 0x536f75);
      }
    }
    const spawnHeight =
      template === 'elevation'
        ? Math.min(rise, (settings.corridor.checkpointOffset / rampLength) * rise)
        : 0;
    if (index > 0 && index % settings.corridor.checkpointInterval === 0) {
      box(
        0,
        settings.corridor.checkpointOffset,
        width - 0.5,
        0.16,
        start.y + spawnHeight + settings.corridor.height / 2,
        settings.corridor.height,
        'checkpoint',
        0xb9f87c,
      );
    }
    const spawn = pathPoint(start, yaw, settings.corridor.checkpointOffset);
    spawn.y = start.y + spawnHeight + 0.00001;
    this.cursor.index++;
    this.cursor.start = { ...exit };
    this.cursor.yaw = exitYaw;
    this.cursor.previousHard = template === 'rocket-block' || template === 'rocket-gap';
    return { index, template, yaw, exit, exitYaw, spawn, boxes, legs, snapshot, obstacleSize };
  }
}

export function translate(point: Vec3, delta: Vec3): void {
  point.x -= delta.x;
  point.y -= delta.y;
  point.z -= delta.z;
}
export function shiftChunk(chunk: CorridorChunk, delta: Vec3): void {
  translate(chunk.spawn, delta);
  translate(chunk.exit, delta);
  translate(chunk.snapshot.start, delta);
  for (const leg of chunk.legs) {
    translate(leg.start, delta);
  }
  for (const box of chunk.boxes) {
    translate(box.center, delta);
  }
}

/** Logical distance on a chunk centerline, including square bend landings. */
export function projectOnChunk(chunk: CorridorChunk, point: Vec3): number | undefined {
  let offset = 0;
  let best: { distance: number; error: number } | undefined;
  for (const [index, leg] of chunk.legs.entries()) {
    const f = forward(leg.yaw);
    const r = right(leg.yaw);
    const dx = point.x - leg.start.x;
    const dz = point.z - leg.start.z;
    const along = dx * f.x + dz * f.z;
    const lateral = dx * r.x + dz * r.z;
    const minimum = index > 0 ? -settings.corridor.width / 2 : -0.01;
    const maximum =
      index < chunk.legs.length - 1 ? leg.length + settings.corridor.width / 2 : leg.length + 0.01;
    if (
      along >= minimum &&
      along <= maximum &&
      Math.abs(lateral) <= settings.corridor.width / 2 + 0.4
    ) {
      const error = Math.abs(lateral);
      if (!best || error <= best.error) {
        best = { distance: offset + Math.max(0, Math.min(leg.length, along)), error };
      }
    }
    offset += leg.length;
  }
  return best?.distance;
}
