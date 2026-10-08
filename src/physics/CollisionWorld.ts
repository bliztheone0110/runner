import type { Vec3 } from '../core/types';

export interface BoxCollider {
  kind?: 'box';
  min: Vec3;
  max: Vec3;
}
export interface RampCollider {
  kind: 'ramp';
  start: Vec3;
  yaw: number;
  width: number;
  length: number;
  rise: number;
  landingLength: number;
}
export type WorldCollider = BoxCollider | RampCollider;
export interface PlayerBody {
  position: Vec3;
  velocity: Vec3;
  radius: number;
  height: number;
}
export interface CollisionResult {
  grounded: boolean;
  ramp?: RampContact;
  rampTakeoff?: RampTakeoff;
}
export interface RampContact {
  normal: Vec3;
  downhill: Vec3;
  slope: number;
}
export interface RampTakeoff {
  direction: Vec3;
  speed: number;
  uphillSpeed: number;
  angle: number;
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
  private readonly chunks = new Map<string, readonly WorldCollider[]>();
  private boxes: readonly WorldCollider[];
  constructor(boxes: readonly WorldCollider[] = []) {
    this.boxes = boxes;
    this.chunks.set('base', boxes);
  }
  setChunk(id: string, boxes: readonly WorldCollider[]): void {
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
    let first: SegmentHit | undefined;
    for (const collider of this.boxes) {
      if (collider.kind === 'ramp') {
        const hit = traceRamp(from, delta, collider, radius);
        if (hit && (!first || hit.fraction < first.fraction)) {
          first = hit;
        }
        continue;
      }
      const min = {
        x: collider.min.x - radius,
        y: collider.min.y - radius,
        z: collider.min.z - radius,
      };
      const max = { x: collider.max.x + radius, y: collider.max.y + radius, z: collider.max.z + radius };
      let hit = sweepPoint(from, delta, min, max);
      if (!hit && axes.every((axis) => from[axis] > min[axis] && from[axis] < max[axis])) {
        const axis = axes.reduce(
          (largest, candidate) =>
            Math.abs(delta[candidate]) > Math.abs(delta[largest]) ? candidate : largest,
          'x',
        );
        hit = { time: 0, axis, sign: delta[axis] > 0 ? -1 : 1 };
      }
      if (hit && (!first || hit.time < first.fraction)) {
        const normal = { x: 0, y: 0, z: 0 };
        normal[hit.axis] = hit.sign;
        first = {
          fraction: hit.time,
          normal,
          point: {
            x: from.x + delta.x * hit.time - normal.x * radius,
            y: from.y + delta.y * hit.time - normal.y * radius,
            z: from.z + delta.z * hit.time - normal.z * radius,
          },
        };
      }
    }
    return first;
  }

  move(body: PlayerBody, displacement: Vec3): CollisionResult {
    const initialPosition = { ...body.position };
    const remaining = { ...displacement };
    let grounded = false;
    let rampContact: RampContact | undefined;
    let rampTakeoff: RampTakeoff | undefined;
    for (let iteration = 0; iteration < 6; iteration++) {
      let first: Hit | undefined;
      for (const collider of this.boxes) {
        if (collider.kind === 'ramp') {
          continue;
        }
        const hit = sweep(body, remaining, collider);
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
    for (const collider of this.boxes) {
      if (collider.kind === 'ramp') {
        const resolution = resolveRamp(body, initialPosition, displacement, collider);
        if (resolution) {
          grounded = true;
          rampContact = resolution.contact;
          rampTakeoff = resolution.takeoff;
        }
      }
    }
    return { grounded, ramp: rampContact, rampTakeoff };
  }
}

function rampCoordinates(point: Vec3, ramp: RampCollider): { along: number; lateral: number } {
  const forward = { x: -Math.sin(ramp.yaw), z: -Math.cos(ramp.yaw) };
  const right = { x: Math.cos(ramp.yaw), z: -Math.sin(ramp.yaw) };
  const dx = point.x - ramp.start.x;
  const dz = point.z - ramp.start.z;
  return {
    along: dx * forward.x + dz * forward.z,
    lateral: dx * right.x + dz * right.z,
  };
}

function rampHeight(along: number, ramp: RampCollider): number {
  return ramp.start.y + (along / ramp.length) * ramp.rise;
}

function resolveRamp(
  body: PlayerBody,
  initial: Vec3,
  displacement: Vec3,
  ramp: RampCollider,
): { contact: RampContact; takeoff?: RampTakeoff } | undefined {
  const from = rampCoordinates(initial, ramp);
  const to = rampCoordinates(body.position, ramp);
  const rampEnd = ramp.length + ramp.landingLength;
  const pathStart = Math.min(from.along, to.along);
  const pathEnd = Math.max(from.along, to.along);
  if (
    pathEnd < -skin ||
    pathStart > rampEnd + skin ||
    Math.abs(to.lateral) > ramp.width / 2 - body.radius
  ) {
    return;
  }
  const fromSurface = rampHeight(Math.max(0, Math.min(ramp.length, from.along)), ramp);
  const toSurface = rampHeight(Math.max(0, Math.min(ramp.length, to.along)), ramp);
  const fromClearance = initial.y - fromSurface;
  const toClearance = body.position.y - toSurface;
  const alongTravel = Math.abs(toSurface - fromSurface);
  const closeToSurface =
    fromClearance >= -skin &&
    fromClearance <= Math.abs(displacement.y) + alongTravel + skin;
  const crossedSurface = fromClearance >= -skin && toClearance <= skin;
  const movingAwayFromSurface = fromClearance >= -skin && toClearance > fromClearance + skin;
  if (movingAwayFromSurface || (!closeToSurface && !crossedSurface)) {
    return;
  }
  const slope = ramp.rise / ramp.length;
  const downhill = { x: Math.sin(ramp.yaw), y: 0, z: Math.cos(ramp.yaw) };
  const horizontalSpeed = Math.hypot(body.velocity.x, body.velocity.z);
  const uphillSpeed = -(body.velocity.x * downhill.x + body.velocity.z * downhill.z);
  let takeoff: RampTakeoff | undefined;
  if (
    from.along < ramp.length &&
    to.along >= ramp.length &&
    to.along > from.along &&
    uphillSpeed > 0 &&
    horizontalSpeed > 0
  ) {
    takeoff = {
      direction: {
        x: body.velocity.x / horizontalSpeed,
        y: 0,
        z: body.velocity.z / horizontalSpeed,
      },
      speed: horizontalSpeed,
      uphillSpeed,
      angle: Math.atan(slope),
    };
  }
  body.position.y = toSurface;
  body.velocity.y = 0;
  if (to.along < 0 || to.along >= ramp.length) {
    return {
      contact: {
        normal: { x: 0, y: 1, z: 0 },
        downhill: { x: 0, y: 0, z: 0 },
        slope: 0,
      },
      takeoff,
    };
  }
  const normalLength = Math.hypot(slope, 1);
  return {
    contact: {
      normal: {
        x: (Math.sin(ramp.yaw) * slope) / normalLength,
        y: 1 / normalLength,
        z: (Math.cos(ramp.yaw) * slope) / normalLength,
      },
      downhill,
      slope,
    },
    takeoff,
  };
}

function traceRamp(
  from: Vec3,
  delta: Vec3,
  ramp: RampCollider,
  radius: number,
): SegmentHit | undefined {
  const slope = ramp.rise / ramp.length;
  const slopeHit = traceRampSection(from, delta, ramp, radius, 0, ramp.length, 0, slope);
  const landingHit = traceRampSection(
    from,
    delta,
    ramp,
    radius,
    ramp.length,
    ramp.length + ramp.landingLength,
    ramp.rise,
    0,
  );
  if (!slopeHit || (landingHit && landingHit.fraction < slopeHit.fraction)) {
    return landingHit;
  }
  return slopeHit;
}

function traceRampSection(
  from: Vec3,
  delta: Vec3,
  ramp: RampCollider,
  radius: number,
  minAlong: number,
  maxAlong: number,
  startHeight: number,
  slope: number,
): SegmentHit | undefined {
  const end = { x: from.x + delta.x, y: from.y + delta.y, z: from.z + delta.z };
  const fromCoordinates = rampCoordinates(from, ramp);
  const toCoordinates = rampCoordinates(end, ramp);
  const normalLength = Math.hypot(slope, 1);
  const fromSurface = ramp.start.y + startHeight + (fromCoordinates.along - minAlong) * slope;
  const toSurface = ramp.start.y + startHeight + (toCoordinates.along - minAlong) * slope;
  const fromDistance = (from.y - fromSurface) / normalLength;
  const toDistance = (end.y - toSurface) / normalLength;
  let fraction: number;
  if (Math.abs(fromDistance) <= radius) {
    fraction = 0;
  } else {
    const approachesFromAbove = fromDistance > radius && toDistance <= radius;
    const approachesFromBelow = fromDistance < -radius && toDistance >= -radius;
    if (!approachesFromAbove && !approachesFromBelow) {
      return;
    }
    const threshold = approachesFromAbove ? radius : -radius;
    fraction = (fromDistance - threshold) / (fromDistance - toDistance);
  }
  if (fraction < 0 || fraction > 1) {
    return;
  }
  const center = {
    x: from.x + delta.x * fraction,
    y: from.y + delta.y * fraction,
    z: from.z + delta.z * fraction,
  };
  const coordinates = rampCoordinates(center, ramp);
  if (
    coordinates.along < minAlong - radius ||
    coordinates.along > maxAlong + radius ||
    Math.abs(coordinates.lateral) > ramp.width / 2 + radius
  ) {
    return;
  }
  const side = fromDistance >= 0 ? 1 : -1;
  const normal = {
    x: (Math.sin(ramp.yaw) * slope * side) / normalLength,
    y: side / normalLength,
    z: (Math.cos(ramp.yaw) * slope * side) / normalLength,
  };
  return {
    fraction,
    normal,
    point: {
      x: center.x - normal.x * radius,
      y: center.y - normal.y * radius,
      z: center.z - normal.z * radius,
    },
  };
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
