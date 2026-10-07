import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Scene } from 'three';
import { settings } from '../src/config/settings.ts';
import { WorldSession } from '../src/app/WorldSession.ts';
import { RespawnSystem } from '../src/app/RespawnSystem.ts';
import { GameEvents } from '../src/core/GameEvents.ts';
import { GameLoop } from '../src/core/GameLoop.ts';
import { StaticCollisionWorld } from '../src/physics/CollisionWorld.ts';
import { createTrainingRoom, TrainingWorld } from '../src/world/TrainingWorld.ts';
import { WorldStreamSystem } from '../src/world/WorldStreamSystem.ts';
import { ChunkRenderer } from '../src/world/ChunkRenderer.ts';
import { levelColliders } from '../src/world/trainingLevel.ts';
import { PlayerState } from '../src/features/player/PlayerState.ts';
import { MovementController } from '../src/features/player/MovementController.ts';
import { HealthState } from '../src/features/health/HealthState.ts';
import { HealthSystem } from '../src/features/health/HealthSystem.ts';
import { WeaponSystem } from '../src/features/weapons/WeaponSystem.ts';
import { FallingSystem } from '../src/features/player/FallingSystem.ts';
import { InputSystem } from '../src/input/InputSystem.ts';
import { emptyInput, InputState } from '../src/input/InputState.ts';

const dt = settings.simulation.step;
function fixture() {
  const scene = new Scene();
  const collisions = new StaticCollisionWorld();
  const player = new PlayerState();
  const events = new GameEvents();
  const health = new HealthState();
  const inputState = new InputState();
  const input = new InputSystem(inputState);
  const movement = new MovementController(player, collisions, settings.movement, events);
  const seeds: number[] = [];
  const session = new WorldSession((mode) => {
    const presentation = new ChunkRenderer(scene);
    if (mode === 'training') return new TrainingWorld(collisions, presentation);
    const seed = seeds.length + 42;
    seeds.push(seed);
    return new WorldStreamSystem(player, collisions, seed, presentation);
  });
  const spawn = session.getSpawn();
  movement.reset(spawn.position, spawn.yaw);
  const weapons = new WeaponSystem(player, movement, health, input, collisions, events, (point) =>
    session.contains(point),
  );
  let falling: FallingSystem;
  const respawn = new RespawnSystem(
    movement,
    health,
    weapons,
    input,
    session,
    () => falling.reset(),
    events,
  );
  falling = new FallingSystem(player, events, () => respawn.reset());
  function selectTraining() {
    assert.equal(session.select('training'), true);
    events.clear();
    respawn.reset(false);
  }
  return {
    scene,
    collisions,
    player,
    movement,
    events,
    health,
    input,
    inputState,
    session,
    weapons,
    respawn,
    falling,
    selectTraining,
    seeds,
  };
}

test('Training room has an 80m square floor, four 32m walls, grid markings and no ceiling or obstacles', () => {
  const room = createTrainingRoom();
  const floor = room.boxes.find((box) => box.kind === 'floor')!;
  assert.deepEqual(floor.size, { x: 80, y: 2, z: 80 });
  assert.equal(room.boxes.filter((box) => box.kind === 'wall').length, 4);
  assert.ok(room.boxes.filter((box) => box.kind === 'wall').every((box) => box.size.y === 32));
  assert.ok(room.boxes.some((box) => box.kind === 'marker'));
  assert.equal(room.boxes.filter((box) => box.kind === 'obstacle').length, 0);
  assert.deepEqual(room.spawn, { x: 0, y: 0.00001, z: 0 });
  const world = new StaticCollisionWorld(levelColliders(room));
  assert.equal(world.colliderCount, 5);
  assert.equal(world.traceSegment({ x: 0, y: 2, z: 0 }, { x: 0, y: 100, z: 0 }), undefined);
  assert.equal(world.traceSegment({ x: 0, y: 2, z: 0 }, { x: 0, y: -3, z: 0 })!.point.y, 0);
  for (const [x, z] of [
    [100, 0],
    [-100, 0],
    [0, 100],
    [0, -100],
  ]) {
    assert.ok(world.traceSegment({ x: 0, y: 2, z: 0 }, { x, y: 2, z }));
  }
});

test('Default mode is corridor; selecting the current mode preserves its route and progress', () => {
  const game = fixture();
  assert.equal(game.session.mode, 'corridor');
  const spawn = game.session.getSpawn();
  game.player.position.z -= 10;
  game.session.afterMovement();
  const progress = game.session.distance;
  const count = game.collisions.colliderCount;
  assert.equal(game.session.select('corridor'), false);
  assert.equal(game.session.distance, progress);
  assert.equal(game.collisions.colliderCount, count);
  assert.deepEqual(game.session.getSpawn(), spawn);
  assert.equal(game.seeds.length, 1);
  game.session.dispose();
});

test('Mode changes reset gameplay without a respawn event and renew the corridor seed', () => {
  const game = fixture();
  game.input.snapshot.firePressed = true;
  game.weapons.fixedUpdate(dt);
  game.inputState.press('Mouse0');
  game.player.velocity.x = 99;
  game.player.peakSpeed = 99;
  game.player.jumps = 8;
  game.health.damage(80);
  game.selectTraining();
  assert.deepEqual(game.player.position, { x: 0, y: 0.00001, z: 0 });
  assert.equal(game.player.speed, 0);
  assert.equal(game.player.jumps, 0);
  assert.equal(game.player.peakSpeed, 0);
  assert.equal(game.health.current, 100);
  assert.equal(game.weapons.rockets.length, 0);
  assert.equal(game.weapons.explosions.length, 0);
  assert.deepEqual(game.input.snapshot, emptyInput());
  game.inputState.beginFrame(1);
  assert.equal(game.inputState.consume(settings.keys).firePressed, false);
  assert.deepEqual(game.events.drain(), []);
  assert.equal(game.collisions.colliderCount, 5);
  assert.equal(game.session.select('corridor'), true);
  game.respawn.reset(false);
  assert.equal(game.seeds.length, 2);
  assert.notEqual(game.seeds[0], game.seeds[1]);
  assert.equal(game.session.distance, 0);
  assert.equal(game.session.checkpoint, 1);
  assert.equal(game.events.drain().length, 0);
  game.session.dispose();
});

test('Training supports movement, normal jumps, rocket jumps, damage and regeneration', () => {
  const game = fixture();
  game.selectTraining();
  game.movement.step(dt, { ...emptyInput(), jumpPressed: true, forward: 1 });
  assert.ok(game.player.velocity.y > 0);
  assert.ok(game.player.velocity.z < 0);
  assert.deepEqual(game.events.drain(), [{ type: 'player.jumped' }]);
  const normalJumpVelocity = game.player.velocity.y;
  game.player.pitch = -settings.camera.pitchLimit;
  game.input.snapshot.firePressed = true;
  for (let i = 0; i < 10; i++) {
    game.weapons.fixedUpdate(dt);
    game.input.snapshot.firePressed = false;
  }
  assert.ok(game.player.velocity.y > normalJumpVelocity);
  assert.ok(game.health.current < 100);
  assert.deepEqual(
    game.events.drain().map((event) => event.type),
    ['rocket.fired', 'rocket.exploded'],
  );
  const hp = game.health.current;
  new HealthSystem(game.health, () => game.respawn.reset()).fixedUpdate(1);
  assert.ok(Math.abs(game.health.current - Math.min(100, hp + 5)) < 1e-6);
  game.session.dispose();
});

test('Training R, death and falling return to the center with one respawn event each', () => {
  const game = fixture();
  game.selectTraining();
  game.player.position.x = 12;
  game.input.snapshot.resetPressed = true;
  game.respawn.fixedUpdate();
  assert.deepEqual(game.player.position, game.session.getSpawn().position);
  assert.deepEqual(game.events.drain(), [{ type: 'player.respawned' }]);
  game.health.damage(100);
  new HealthSystem(game.health, () => game.respawn.reset()).fixedUpdate(dt);
  assert.deepEqual(game.events.drain(), [{ type: 'player.respawned' }]);
  assert.equal(game.health.current, 100);
  game.player.grounded = false;
  game.player.position.y = -3;
  game.player.velocity.y = -4;
  game.falling.fixedUpdate();
  game.falling.fixedUpdate();
  assert.deepEqual(game.events.drain(), [{ type: 'player.falling' }]);
  game.player.position.y = -12;
  game.falling.fixedUpdate();
  game.falling.fixedUpdate();
  assert.deepEqual(game.events.drain(), [{ type: 'player.respawned' }]);
  assert.deepEqual(game.player.position, game.session.getSpawn().position);
  game.session.dispose();
});

test('Repeated switches remove old meshes, colliders and shared GPU resources; disposal is idempotent', () => {
  const game = fixture();
  let tracked = 0;
  let released = 0;
  function trackResources() {
    const resources = new Set<{ addEventListener(type: 'dispose', callback: () => void): void }>();
    game.scene.traverse((object) => {
      if (object instanceof Mesh) {
        resources.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          resources.add(material);
      }
    });
    for (const resource of resources) {
      tracked++;
      resource.addEventListener('dispose', () => released++);
    }
  }
  for (let i = 0; i < 100; i++) {
    trackResources();
    assert.equal(game.session.select(i % 2 === 0 ? 'training' : 'corridor'), true);
    assert.equal(released, tracked);
    assert.ok(game.scene.children.length <= 8);
    assert.ok(game.collisions.colliderCount < 100);
    if (game.session.mode === 'training') {
      assert.equal(game.scene.children.length, 1);
      assert.equal(game.collisions.colliderCount, 5);
    }
  }
  trackResources();
  game.session.dispose();
  game.session.dispose();
  assert.equal(released, tracked);
  assert.equal(game.scene.children.length, 0);
  assert.equal(game.collisions.colliderCount, 0);
});

test('Pause does not advance the selected world or training gameplay', () => {
  const game = fixture();
  game.selectTraining();
  game.input.snapshot.firePressed = true;
  game.weapons.fixedUpdate(dt);
  const rocket = structuredClone(game.weapons.rockets[0]);
  const loop = new GameLoop([game.session, game.weapons]);
  loop.advance(1);
  assert.deepEqual(game.weapons.rockets[0], rocket);
  assert.equal(game.session.mode, 'training');
  game.weapons.dispose();
  game.session.dispose();
});
