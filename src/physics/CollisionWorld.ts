import type { Vec3 } from '../core/types';

export interface BoxCollider {
  min: Vec3;
  max: Vec3;
}
export interface PlayerBody {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  height: number;
}
export interface CollisionResult {
  grounded: boolean;
}
export interface SegmentHit {
  fraction: number;
  point: Vec3;
  normal: Vec3;
}
export interface CollisionWorld {
  move(body: PlayerBody, displacement: Vec3): CollisionResult;
  traceSegment(from: Vec3, to: Vec3, radius?: number): SegmentHit | undefined;
}

interface Hit {
  time: number;
  axis: 'x' | 'y' | 'z';
  sign: number;
}
const axes = ['x', 'y', 'z'] as const;
const skin = 1e-5;

/** Swept player AABB against static boxes; position is the center of the feet. */
export class StaticCollisionWorld implements CollisionWorld {
  private readonly chunks = new Map<string, readonly BoxCollider[]>();
  private boxes: readonly BoxCollider[];
  constructor(boxes: readonly BoxCollider[] = []) {
    this.boxes = boxes;
    this.chunks.set('base', boxes);
  }
  setChunk(id: string, boxes: readonly BoxCollider[]): void {
    this.chunks.set(id, boxes);
    this.rebuild();
  }
  removeChunk(id: string): void {
    this.chunks.delete(id);
    this.rebuild();
  }
  clearChunks(): void {
    this.chunks.clear();
    this.rebuild();
  }
  get colliderCount(): number {
    return this.boxes.length;
  }
  private rebuild(): void {
    this.boxes = [...this.chunks.values()].flat();
  }

  traceSegment(from: Vec3, to: Vec3, radius = 0): SegmentHit | undefined {
    const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    let first: Hit | undefined;
    for (const box of this.boxes) {
      const min = { x: box.min.x - radius, y: box.min.y - radius, z: box.min.z - radius };
      const max = { x: box.max.x + radius, y: box.max.y + radius, z: box.max.z + radius };
      let hit = sweepPoint(from, delta, min, max);
      if (!hit && axes.every((axis) => from[axis] > min[axis] && from[axis] < max[axis])) {
        const axis = axes.reduce(
          (largest, candidate) =>
            Math.abs(delta[candidate]) > Math.abs(delta[largest]) ? candidate : largest,
          'x',
        );
        hit = { time: 0, axis, sign: delta[axis] > 0 ? -1 : 1 };
      }
      if (hit && (!first || hit.time < first.time)) {
        first = hit;
      }
    }
    if (!first) {
      return;
    }
    const normal = { x: 0, y: 0, z: 0 };
    normal[first.axis] = first.sign;
    return {
      fraction: first.time,
      normal,
      point: {
        x: from.x + delta.x * first.time - normal.x * radius,
        y: from.y + delta.y * first.time - normal.y * radius,
        z: from.z + delta.z * first.time - normal.z * radius,
      },
    };
  }

  move(body: PlayerBody, displacement: Vec3): CollisionResult {
    const remaining = { ...displacement };
    let grounded = false;
    for (let iteration = 0; iteration < 6; iteration++) {
      let first: Hit | undefined;
      for (const box of this.boxes) {
        const hit = sweep(body, remaining, box);
        if (hit && (!first || hit.time < first.time)) {
          first = hit;
        }
      }
      if (!first) {
        for (const axis of axes) {
          body.position[axis] += remaining[axis];
        }
        break;
      }
      for (const axis of axes) {
        body.position[axis] += remaining[axis] * first.time;
        remaining[axis] *= 1 - first.time;
      }
      body.position[first.axis] += first.sign * skin;
      remaining[first.axis] = 0;
      if (body.velocity[first.axis] * first.sign < 0) {
        body.velocity[first.axis] = 0;
      }
      if (first.axis === 'y' && first.sign > 0) {
        grounded = true;
      }
    }
    return { grounded };
  }
}

function sweep(body: PlayerBody, delta: Vec3, box: BoxCollider): Hit | undefined {
  const min = {
    x: box.min.x - body.radius,
    y: box.min.y - body.height,
    z: box.min.z - body.radius,
  };
  const max = { x: box.max.x + body.radius, y: box.max.y, z: box.max.z + body.radius };
  return sweepPoint(body.position, delta, min, max);
}

function sweepPoint(position: Vec3, delta: Vec3, min: Vec3, max: Vec3): Hit | undefined {
  let enter = -Infinity;
  let exit = Infinity;
  let hitAxis: Hit['axis'] = 'x';
  let sign = 1;
  for (const axis of axes) {
    const origin = position[axis];
    const direction = delta[axis];
    if (Math.abs(direction) < 1e-12) {
      if (origin < min[axis] || origin > max[axis]) {
        return;
      }
      continue;
    }
    const t1 = (min[axis] - origin) / direction;
    const t2 = (max[axis] - origin) / direction;
    const near = Math.min(t1, t2);
    if (near > enter) {
      enter = near;
      hitAxis = axis;
      sign = direction > 0 ? -1 : 1;
    }
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) {
      return;
    }
  }
  if (enter < -1e-8 || enter > 1 || exit < 0) {
    return;
  }
  return { time: Math.max(0, enter), axis: hitAxis, sign };
}
