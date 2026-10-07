import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Scene } from 'three';
import { settings } from '../src/config/settings.ts';
import { GameEvents } from '../src/core/GameEvents.ts';
import { emptyInput, InputState } from '../src/input/InputState.ts';
import { InputSystem } from '../src/input/InputSystem.ts';
import { StaticCollisionWorld } from '../src/physics/CollisionWorld.ts';
import { PlayerState } from '../src/features/player/PlayerState.ts';
import { MovementController } from '../src/features/player/MovementController.ts';
import { FallingSystem } from '../src/features/player/FallingSystem.ts';
import { HealthState } from '../src/features/health/HealthState.ts';
import { WeaponSystem } from '../src/features/weapons/WeaponSystem.ts';
import { RespawnSystem } from '../src/app/RespawnSystem.ts';
import {
  CorridorGenerator,
  forward,
  pathPoint,
  projectOnChunk,
  type CorridorChunk,
  type CorridorTemplate,
} from '../src/world/CorridorGenerator.ts';
import { WorldStreamSystem } from '../src/world/WorldStreamSystem.ts';
import { ChunkRenderer, type ChunkPresentation } from '../src/world/ChunkRenderer.ts';
import { levelColliders } from '../src/world/trainingLevel.ts';

const dt = settings.simulation.step;
const close = (actual: number, expected: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
function chunks(seed: number, count: number): CorridorChunk[] {
  const generator = new CorridorGenerator(seed);
  return Array.from({ length: count }, () => generator.next());
}
function streamFixture(seed = 42, presentation?: ChunkPresentation) {
  const player = new PlayerState();
  const collisions = new StaticCollisionWorld();
  const events = new GameEvents();
  const movement = new MovementController(player, collisions, settings.movement, events);
  const health = new HealthState();
  const input = new InputSystem(new InputState());
  let weapons: WeaponSystem;
  const stream = new WorldStreamSystem(player, collisions, seed, presentation, (delta) => {
    weapons?.shiftOrigin(delta);
    events.shiftOrigin(delta);
  });
  const spawn = stream.getSpawn();
  movement.reset(spawn.position, spawn.yaw);
  weapons = new WeaponSystem(player, movement, health, input, collisions, events, (point) =>
    stream.contains(point),
  );
  const respawn = new RespawnSystem(movement, health, weapons, input, stream, undefined, events);
  return { player, collisions, events, movement, health, input, weapons, stream, respawn };
}
function reachNext(game: ReturnType<typeof streamFixture>) {
  const next = game.stream.chunks.find((chunk) => chunk.index === game.stream.currentIndex + 1)!;
  Object.assign(game.player.position, next.spawn);
  Object.assign(game.player.previousPosition, next.spawn);
  game.stream.afterMovement();
}

test('Seeds reproduce the route and restoring a generator snapshot reproduces the same chunks', () => {
  assert.deepEqual(chunks(123, 100), chunks(123, 100));
  assert.notDeepEqual(chunks(123, 100), chunks(321, 100));
  const generator = new CorridorGenerator(99);
  for (let i = 0; i < 18; i++) generator.next();
  const snapshot = generator.save();
  const expected = Array.from({ length: 10 }, () => generator.next());
  generator.restore(snapshot);
  assert.deepEqual(
    Array.from({ length: 10 }, () => generator.next()),
    expected,
  );
});

test('Chunks connect exactly, bends return to the north axis, and separated chunks do not overlap', () => {
  for (const seed of [1, 42, 9876]) {
    const route = chunks(seed, 80);
    for (let i = 1; i < route.length; i++) {
      assert.deepEqual(route[i].legs[0].start, route[i - 1].exit);
      close(route[i].yaw, route[i - 1].exitYaw);
      if (i % 5 === 0) close(route[i].exitYaw, 0);
    }
    for (let i = 0; i < route.length; i++)
      for (let j = i + 2; j < route.length; j++) {
        for (const a of route[i].boxes.filter((box) => box.kind === 'floor'))
          for (const b of route[j].boxes.filter((box) => box.kind === 'floor')) {
            const overlapX =
              Math.min(a.center.x + a.size.x / 2, b.center.x + b.size.x / 2) -
              Math.max(a.center.x - a.size.x / 2, b.center.x - b.size.x / 2);
            const overlapZ =
              Math.min(a.center.z + a.size.z / 2, b.center.z + b.size.z / 2) -
              Math.max(a.center.z - a.size.z / 2, b.center.z - b.size.z / 2);
            assert.ok(overlapX <= 1e-6 || overlapZ <= 1e-6, `Overlapping route chunks ${i}, ${j}`);
          }
      }
  }
});

test('Training templates and difficulty dimensions stay in validated ranges with no consecutive hard obstacles', () => {
  const route = chunks(999, 500);
  assert.deepEqual(
    route.slice(0, 3).map((chunk) => chunk.template),
    ['run', 'blocks', 'gap'],
  );
  let previousHard = false;
  for (const chunk of route) {
    const hard = chunk.template.startsWith('rocket-');
    assert.ok(!(hard && previousHard));
    previousHard = hard;
    if (chunk.template === 'blocks')
      assert.ok(chunk.obstacleSize >= 0.8 && chunk.obstacleSize <= 1.2);
    if (chunk.template === 'gap') assert.ok(chunk.obstacleSize >= 2 && chunk.obstacleSize <= 3);
    if (chunk.template === 'rocket-gap')
      assert.ok(chunk.obstacleSize >= 6.5 && chunk.obstacleSize <= 8);
    if (chunk.template === 'rocket-block') assert.equal(chunk.obstacleSize, 3);
    if (chunk.template.includes('gap')) assert.ok((48 - chunk.obstacleSize) / 2 >= 8);
  }
});

test('Only real floor sections collide: gaps have no invisible floor, but ceiling and walls remain solid', () => {
  const gap = chunks(42, 3)[2];
  const world = new StaticCollisionWorld(levelColliders(gap));
  const center = pathPoint(gap.legs[0].start, gap.yaw, 24);
  assert.equal(world.traceSegment({ ...center, y: 2 }, { ...center, y: -11 }), undefined);
  close(world.traceSegment({ ...center, y: 2 }, { ...center, y: 20 })!.point.y, 12);
  const left = pathPoint(gap.legs[0].start, gap.yaw, 24, -10);
  assert.ok(world.traceSegment({ ...center, y: 2 }, { ...left, y: 2 }));
});

test('Every sampled template is passable with actual movement and rockets where required', () => {
  const examples = new Map<CorridorTemplate, CorridorChunk>();
  for (const chunk of chunks(8756, 200)) {
    const previous = examples.get(chunk.template);
    if (!previous || chunk.obstacleSize > previous.obstacleSize)
      examples.set(chunk.template, chunk);
  }
  assert.equal(examples.size, 6);
  for (const [kind, chunk] of examples) {
    const world = new StaticCollisionWorld(levelColliders(chunk));
    const state = new PlayerState();
    const movement = new MovementController(state, world);
    const health = new HealthState();
    const input = new InputSystem(new InputState());
    const weapons = new WeaponSystem(state, movement, health, input, world);
    if (kind === 'turn') {
      const point = pathPoint(chunk.legs[0].start, chunk.yaw, 2);
      point.y = 0.00001;
      movement.reset(point, chunk.yaw);
      for (const [index, leg] of chunk.legs.entries()) {
        state.yaw = leg.yaw;
        const end = index === 0 ? 24 : 22;
        for (let i = 0; i < 600; i++) {
          movement.step(dt, { ...emptyInput(), forward: 1 });
          const f = forward(leg.yaw);
          const distance =
            (state.position.x - leg.start.x) * f.x + (state.position.z - leg.start.z) * f.z;
          if (distance >= end - 0.02) break;
          assert.ok(i < 599, 'Blocked at a bend');
        }
      }
      assert.ok(projectOnChunk(chunk, state.position)! >= 45);
      continue;
    }
    const gap = kind.includes('gap');
    const rocket = kind.startsWith('rocket-');
    const startDistance = gap ? (48 - chunk.obstacleSize) / 2 - (rocket ? 2 : 1) : 20;
    const point = pathPoint(chunk.legs[0].start, chunk.yaw, startDistance);
    point.y = 0.00001;
    movement.reset(point, chunk.yaw);
    const f = forward(chunk.yaw);
    state.velocity.x = f.x * 6;
    state.velocity.z = f.z * 6;
    if (rocket) state.pitch = -settings.camera.pitchLimit;
    let passed = false;
    for (let i = 0; i < 600; i++) {
      movement.step(dt, { ...emptyInput(), forward: 1, jumpPressed: i === 0 && kind !== 'run' });
      input.snapshot.firePressed = i === 0 && rocket;
      weapons.fixedUpdate(dt);
      const distance = projectOnChunk(chunk, state.position);
      if (distance !== undefined && distance >= 34 && state.position.y >= -0.01) {
        passed = true;
        break;
      }
      if (state.position.y < -12) break;
    }
    assert.ok(
      passed,
      `Unpassable ${kind}, size ${chunk.obstacleSize}, player ${JSON.stringify(state.position)}`,
    );
  }
});

test('Streaming thousands of chunks keeps a fixed-size window and releases removed colliders and views', () => {
  let liveViews = 0;
  let peakViews = 0;
  let disposed = false;
  const presentation: ChunkPresentation = {
    create() {
      liveViews++;
      peakViews = Math.max(peakViews, liveViews);
      let alive = true;
      return {
        shiftOrigin() {},
        dispose() {
          if (alive) {
            alive = false;
            liveViews--;
          }
        },
      };
    },
    dispose() {
      disposed = true;
    },
  };
  const game = streamFixture(10, presentation);
  for (let i = 0; i < 3000; i++) {
    reachNext(game);
    assert.ok(game.stream.activeChunks <= 9);
    assert.ok(liveViews <= 10);
    assert.ok(game.collisions.colliderCount < 120);
    assert.ok(Math.hypot(game.player.position.x, game.player.position.z) <= 1024);
  }
  assert.ok(peakViews <= 11);
  assert.ok(game.stream.distance > 100000);
  game.stream.dispose();
  assert.equal(liveViews, 0);
  assert.equal(game.collisions.colliderCount, 0);
  assert.equal(disposed, true);
});

test('The rear gate stops backtracking and never blocks the checkpoint spawn after restore', () => {
  const game = streamFixture();
  for (let i = 0; i < 12; i++) reachNext(game);
  const oldest = game.stream.chunks.find((chunk) => chunk.index === game.stream.oldestIndex)!;
  const before = pathPoint(oldest.legs[0].start, oldest.yaw, 2);
  const behind = pathPoint(oldest.legs[0].start, oldest.yaw, -2);
  assert.ok(game.collisions.traceSegment({ ...before, y: 1 }, { ...behind, y: 1 }));
  game.respawn.reset();
  const spawn = game.stream.getSpawn();
  const ahead = pathPoint(spawn.position, spawn.yaw, 2);
  ahead.y = 1;
  assert.equal(game.collisions.traceSegment({ ...spawn.position, y: 1 }, ahead), undefined);
  assert.ok(game.stream.contains(game.player.position));
});

test('Respawning restores the same checkpoint route and its forward facing direction', () => {
  const game = streamFixture();
  for (let i = 0; i < 4; i++) reachNext(game);
  const spawn = game.stream.getSpawn();
  assert.equal(game.stream.checkpoint, 2);
  const expected = game.stream.chunks.filter((chunk) => chunk.index >= 3 && chunk.index <= 7);
  game.player.velocity.x = 100;
  game.health.damage(80);
  game.respawn.reset();
  close(game.player.yaw, spawn.yaw);
  assert.deepEqual(game.player.position, spawn.position);
  close(game.player.speed, 0);
  close(game.health.current, 100);
  assert.deepEqual(
    game.stream.chunks.filter((chunk) => chunk.index <= 7),
    expected,
  );
  assert.deepEqual(game.events.drain(), [{ type: 'player.respawned' }]);
});

test('The six-chunk collision buffer catches a very fast player before an unloaded turn', () => {
  const game = streamFixture();
  game.player.velocity.z = -100000;
  game.player.grounded = false;
  game.player.position.y = 1;
  game.stream.fixedUpdate();
  game.movement.step(dt, emptyInput());
  game.stream.afterMovement();
  assert.ok(game.stream.contains(game.player.position));
  assert.ok(game.stream.currentIndex <= 3);
  assert.ok(game.player.position.z > -175);
  assert.ok(game.stream.activeChunks <= 9);
});

test('Origin shifting preserves player interpolation, velocity, projectile paths, explosions and logical distance', () => {
  const game = streamFixture();
  game.player.velocity.x = 9;
  game.player.previousPosition.x = game.player.position.x - 0.02;
  const old = structuredClone(game.player.position);
  const previous = structuredClone(game.player.previousPosition);
  game.input.snapshot.firePressed = true;
  game.weapons.fixedUpdate(dt);
  const rocket = structuredClone(game.weapons.rockets[0]);
  game.weapons.explosions.push({
    id: 999,
    age: 0.1,
    position: { x: 3, y: 0, z: -10 },
    normal: { x: 0, y: 1, z: 0 },
  });
  game.events.clear();
  game.events.emit({ type: 'rocket.exploded', position: { x: 3, y: 0, z: -10 } });
  const distance = game.stream.distance;
  const delta = { x: 500, y: 0, z: -1000 };
  game.stream.shiftOrigin(delta);
  close(game.player.position.x, old.x - delta.x);
  close(game.player.previousPosition.x, previous.x - delta.x);
  close(game.player.position.z, old.z - delta.z);
  close(game.player.velocity.x, 9);
  close(game.weapons.rockets[0].position.z, rocket.position.z - delta.z);
  close(game.weapons.rockets[0].previousPosition.z, rocket.previousPosition.z - delta.z);
  close(game.weapons.explosions[0].position.z, 990);
  close(game.stream.distance, distance);
  assert.deepEqual(game.events.drain(), [
    { type: 'rocket.exploded', position: { x: -497, y: 0, z: 990 } },
  ]);
  assert.ok(game.stream.contains(game.player.position));
});

test('Rockets outside the active world expire silently instead of hitting discarded geometry', () => {
  const game = streamFixture();
  game.input.snapshot.firePressed = true;
  game.weapons.fixedUpdate(dt);
  assert.equal(game.weapons.rockets.length, 1);
  game.events.clear();
  game.weapons.rockets[0].position.x = 10000;
  game.weapons.fixedUpdate(dt);
  assert.equal(game.weapons.rockets.length, 0);
  assert.equal(game.weapons.explosions.length, 0);
  assert.equal(game.events.drain().length, 0);
});

test('Falling sound occurs once per fall, resets on landing, and death emits a single respawn', () => {
  const game = streamFixture();
  let falling: FallingSystem;
  const fallingRespawn = new RespawnSystem(
    game.movement,
    game.health,
    game.weapons,
    game.input,
    game.stream,
    () => falling.reset(),
    game.events,
  );
  falling = new FallingSystem(game.player, game.events, () => fallingRespawn.reset());
  game.player.grounded = false;
  game.player.position.y = -3;
  game.player.velocity.y = -5;
  falling.fixedUpdate();
  falling.fixedUpdate();
  assert.deepEqual(game.events.drain(), [{ type: 'player.falling' }]);
  game.player.position.y = 0;
  game.player.grounded = true;
  falling.fixedUpdate();
  game.player.grounded = false;
  game.player.position.y = -3;
  falling.fixedUpdate();
  assert.deepEqual(game.events.drain(), [{ type: 'player.falling' }]);
  game.player.position.y = -13;
  falling.fixedUpdate();
  falling.fixedUpdate();
  assert.deepEqual(game.events.drain(), [{ type: 'player.respawned' }]);
  close(game.player.position.y, 0.00001);
});

test('Chunk meshes share a bounded set of resources and dispose them with the world', () => {
  const scene = new Scene();
  const presentation = new ChunkRenderer(scene);
  const game = streamFixture(12, presentation);
  for (let i = 0; i < 100; i++) {
    reachNext(game);
    assert.ok(scene.children.length <= 10);
  }
  const geometries = new Set<Mesh['geometry']>();
  scene.traverse((object) => {
    if (object instanceof Mesh) geometries.add(object.geometry);
  });
  assert.equal(geometries.size, 1);
  let disposed = 0;
  for (const geometry of geometries) geometry.addEventListener('dispose', () => disposed++);
  game.stream.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, 1);
});
