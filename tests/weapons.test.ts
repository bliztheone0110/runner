import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { settings } from '../src/config/settings.ts';
import { GameLoop } from '../src/core/GameLoop.ts';
import { InputState } from '../src/input/InputState.ts';
import { InputSystem } from '../src/input/InputSystem.ts';
import { StaticCollisionWorld, type BoxCollider } from '../src/physics/CollisionWorld.ts';
import { PlayerState } from '../src/features/player/PlayerState.ts';
import { MovementController } from '../src/features/player/MovementController.ts';
import { PlayerSystem } from '../src/features/player/PlayerSystem.ts';
import { HealthState } from '../src/features/health/HealthState.ts';
import { HealthSystem } from '../src/features/health/HealthSystem.ts';
import { WeaponSystem } from '../src/features/weapons/WeaponSystem.ts';
import { WeaponVisuals } from '../src/features/weapons/WeaponVisuals.ts';
import { applyExplosion } from '../src/features/weapons/Explosion.ts';
import { RespawnSystem } from '../src/app/RespawnSystem.ts';

const dt = settings.simulation.step;
const floor: BoxCollider = {
  min: { x: -10000, y: -2, z: -10000 },
  max: { x: 10000, y: 0, z: 10000 },
};
const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

function fixture(boxes: BoxCollider[] = [floor]) {
  const player = new PlayerState();
  const world = new StaticCollisionWorld(boxes);
  const movement = new MovementController(player, world);
  const spawn = { x: 0, y: 0.00001, z: 0 };
  movement.reset(spawn);
  const health = new HealthState();
  const keys = new InputState();
  const input = new InputSystem(keys);
  const playerSystem = new PlayerSystem(movement, input);
  const weapons = new WeaponSystem(player, movement, health, input, world);
  const respawn = new RespawnSystem(movement, health, weapons, input, spawn);
  const healthSystem = new HealthSystem(health, () => respawn.reset());
  const systems = [input, respawn, playerSystem, weapons, healthSystem];
  const tick = () => {
    keys.beginFrame(1);
    for (const system of systems) system.fixedUpdate(dt);
  };
  const click = () => {
    keys.release('Mouse0');
    keys.press('Mouse0');
  };
  return {
    player,
    world,
    movement,
    health,
    keys,
    input,
    weapons,
    healthSystem,
    respawn,
    tick,
    click,
    systems,
  };
}

test('One click fires one rocket, holding does not repeat, and cooldown rejects rapid clicks', () => {
  const game = fixture();
  game.click();
  game.tick();
  assert.equal(game.weapons.rockets.length, 1);
  for (let i = 0; i < 10; i++) game.tick();
  assert.equal(game.weapons.rockets.length, 1);
  game.click();
  game.tick();
  assert.equal(game.weapons.rockets.length, 1);
  for (let i = 0; i < 40; i++) game.tick();
  assert.equal(game.weapons.rockets.length, 1);
  game.click();
  game.tick();
  assert.equal(game.weapons.rockets.length, 2);
});

test('Rockets aim with camera yaw and pitch and expire after five simulation seconds', () => {
  const game = fixture([]);
  game.player.yaw = Math.PI / 2;
  game.player.pitch = Math.PI / 6;
  game.click();
  game.tick();
  const rocket = game.weapons.rockets[0];
  close(rocket.direction.x, -Math.cos(Math.PI / 6));
  close(rocket.direction.y, 0.5);
  close(rocket.direction.z, 0);
  game.input.clear();
  for (let i = 0; i < 610; i++) game.weapons.fixedUpdate(dt);
  assert.equal(game.weapons.rockets.length, 0);
  assert.equal(game.weapons.explosions.length, 0);
});

test('Swept projectile queries hit the first thin wall even across a very long segment', () => {
  const wall = { min: { x: 5, y: 0, z: -5 }, max: { x: 5.1, y: 10, z: 5 } };
  const world = new StaticCollisionWorld([wall]);
  const hit = world.traceSegment({ x: 0, y: 2, z: 0 }, { x: 100, y: 2, z: 0 }, 0.08)!;
  close(hit.point.x, 5);
  close(hit.fraction, 0.0492);
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
});

test('Rockets collide with walls and raised obstacle surfaces', () => {
  const wall = { min: { x: -5, y: 0, z: -3 }, max: { x: 5, y: 4, z: -2.9 } };
  const game = fixture([floor, wall]);
  game.click();
  for (let i = 0; i < 12; i++) game.tick();
  assert.equal(game.weapons.rockets.length, 0);
  assert.equal(game.weapons.explosions.length, 1);
  close(game.weapons.explosions[0].position.z, -2.9);
  assert.ok(game.health.current < 100);
  const obstacleHit = game.world.traceSegment({ x: 0, y: 10, z: -3 }, { x: 0, y: 0, z: -3 });
  close(obstacleHit!.point.y, 4);
});

test('A surface between camera and muzzle causes an immediate explosion', () => {
  const wall = { min: { x: -5, y: 0, z: -0.42 }, max: { x: 5, y: 5, z: -0.35 } };
  const game = fixture([wall]);
  game.input.snapshot.firePressed = true;
  game.weapons.fixedUpdate(dt);
  assert.equal(game.weapons.rockets.length, 0);
  assert.equal(game.weapons.explosions.length, 1);
  close(game.weapons.explosions[0].position.z, -0.35);
});

test('A rocket shot at the feet launches the player higher than a normal jump and deals about 30 HP', () => {
  const game = fixture();
  game.player.pitch = -settings.camera.pitchLimit;
  game.click();
  for (let i = 0; i < 10; i++) game.tick();
  assert.equal(game.weapons.rockets.length, 0);
  assert.equal(game.weapons.explosions.length, 1);
  assert.ok(game.health.current > 70 && game.health.current < 71);
  assert.ok(game.player.velocity.y > 14);
  assert.equal(game.player.grounded, false);
  let peak = 0;
  for (let i = 0; i < 220; i++) {
    game.tick();
    peak = Math.max(peak, game.player.position.y);
  }
  assert.ok(peak > 5, `Rocket jump reached only ${peak} m`);
  assert.ok(peak > settings.movement.jumpSpeed ** 2 / (2 * settings.movement.gravity));
});

test('A rocket explodes only once; continuing ticks do not apply damage again', () => {
  const game = fixture();
  game.player.pitch = -settings.camera.pitchLimit;
  game.click();
  for (let i = 0; i < 10; i++) game.tick();
  const before = game.health.current;
  for (let i = 0; i < 15; i++) game.tick();
  close(game.health.current, before + 15 * 5 * dt);
});

test('Impulse adds to jump and bunnyhop velocity and survives the next movement tick', () => {
  const game = fixture();
  game.player.grounded = false;
  game.player.velocity.z = -20;
  game.player.velocity.y = 8;
  applyExplosion(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    game.player,
    game.movement,
    game.health,
    game.world,
  );
  assert.ok(game.player.velocity.y > 23.9);
  close(game.player.speed, 20);
  game.keys.press('KeyW');
  game.tick();
  assert.ok(game.player.velocity.y > 23.7);
  close(game.player.speed, 20);
});

test('A sideways blast produces horizontal momentum that ground input does not immediately redirect', () => {
  const game = fixture();
  applyExplosion(
    { x: -1, y: 0.9, z: 0 },
    { x: 1, y: 0, z: 0 },
    game.player,
    game.movement,
    game.health,
    game.world,
  );
  assert.ok(game.player.velocity.x > 13);
  game.keys.press('KeyW');
  game.tick();
  assert.ok(game.player.velocity.x > 13);
  assert.ok(game.player.position.x > 0.1);
  assert.ok(Math.abs(game.player.velocity.z) < 1);
});

test('Damage and impulse fall off with distance and disappear outside the blast radius', () => {
  const nearby = fixture();
  const distant = fixture();
  const outside = fixture();
  for (const [game, distance] of [
    [nearby, 1],
    [distant, 4],
    [outside, 6],
  ] as const) {
    applyExplosion(
      { x: distance, y: 0.9, z: 0 },
      { x: -1, y: 0, z: 0 },
      game.player,
      game.movement,
      game.health,
      game.world,
    );
  }
  close(nearby.health.current, 100 - 30 * (1 - 0.65 / 5));
  assert.ok(nearby.health.current < distant.health.current);
  assert.ok(nearby.player.speed > distant.player.speed);
  close(outside.health.current, 100);
  close(outside.player.speed, 0);
});

test('Obstacles block explosion damage and impulse to the player', () => {
  const blocker = { min: { x: 1, y: 0, z: -2 }, max: { x: 2, y: 3, z: 2 } };
  const game = fixture([floor, blocker]);
  applyExplosion(
    { x: 2.5, y: 0.9, z: 0 },
    { x: 1, y: 0, z: 0 },
    game.player,
    game.movement,
    game.health,
    game.world,
  );
  close(game.health.current, 100);
  close(game.player.speed, 0);
});

test('Coincident explosion and player center choose an upward impulse', () => {
  const game = fixture();
  applyExplosion(
    { x: 0, y: game.player.position.y + 0.9, z: 0 },
    { x: 0, y: 1, z: 0 },
    game.player,
    game.movement,
    game.health,
    game.world,
  );
  close(game.player.velocity.y, 16);
  close(game.health.current, 70);
});

test('Health regenerates immediately at 5 HP/s, never exceeds 100, and respawns on zero', () => {
  const game = fixture();
  game.health.damage(30);
  for (let i = 0; i < 120; i++) game.healthSystem.fixedUpdate(dt);
  close(game.health.current, 75);
  for (let i = 0; i < 1200; i++) game.healthSystem.fixedUpdate(dt);
  close(game.health.current, 100);
  game.player.position.x = 10;
  game.player.velocity.x = 20;
  game.health.damage(100);
  game.healthSystem.fixedUpdate(dt);
  close(game.health.current, 100);
  close(game.player.position.x, 0);
  close(game.player.speed, 0);
});

test('Death and R reset rocket states, effects, queued fire, cooldown, health and statistics', () => {
  for (const trigger of ['death', 'reset']) {
    const game = fixture();
    game.click();
    game.tick();
    assert.equal(game.weapons.rockets.length, 1);
    game.player.jumps = 3;
    game.player.peakSpeed = 20;
    game.weapons.explosions.push({
      id: 1000,
      position: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      age: 0,
    });
    if (trigger === 'death') {
      game.health.damage(100);
      game.healthSystem.fixedUpdate(dt);
    } else {
      game.keys.press('KeyR');
      game.click();
      game.tick();
    }
    assert.equal(game.weapons.rockets.length, 0);
    assert.equal(game.weapons.explosions.length, 0);
    close(game.health.current, 100);
    close(game.player.speed, 0);
    assert.equal(game.player.jumps, 0);
    assert.equal(game.input.snapshot.firePressed, false);
    game.click();
    game.tick();
    assert.equal(game.weapons.rockets.length, 1);
  }
});

test('Pause freezes rocket positions, effects and regeneration', () => {
  const game = fixture();
  game.click();
  game.tick();
  game.health.damage(30);
  game.weapons.explosions.push({
    id: 1000,
    position: { x: 1, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    age: 0,
  });
  const before = structuredClone(game.weapons.rockets);
  const loop = new GameLoop(game.systems, (count, elapsed) => game.keys.beginFrame(count, elapsed));
  loop.advance(5);
  assert.deepEqual(game.weapons.rockets, before);
  close(game.health.current, 70);
  close(game.weapons.explosions[0].age, 0);
});

test('Falling off the arena after a rocket jump safely returns the player to spawn', () => {
  const game = fixture();
  game.player.position.y = settings.world.respawnHeight - 1;
  game.player.velocity.y = -40;
  game.tick();
  close(game.player.position.y, 0.00001);
  close(game.player.velocity.y, 0);
  close(game.health.current, 100);
});

test('Rocket jump, damage and health are equivalent at 30, 60 and 144 FPS', () => {
  const outcomes = [30, 60, 144].map((fps) => {
    const game = fixture();
    game.player.pitch = -settings.camera.pitchLimit;
    game.click();
    const loop = new GameLoop(game.systems, (count, elapsed) =>
      game.keys.beginFrame(count, elapsed),
    );
    loop.setPaused(false);
    for (let i = 0; i < fps; i++) loop.advance(1 / fps);
    return {
      position: game.player.position,
      velocity: game.player.velocity,
      hp: game.health.current,
    };
  });
  for (const outcome of outcomes.slice(1)) {
    close(outcome.position.y, outcomes[0].position.y);
    close(outcome.velocity.y, outcomes[0].velocity.y);
    close(outcome.hp, outcomes[0].hp);
  }
});

test('Weapon visuals and simulation release states and resources on reset and dispose', () => {
  const game = fixture();
  const scene = new Scene();
  const visuals = new WeaponVisuals(scene, game.weapons);
  game.click();
  game.tick();
  visuals.update(dt, 1);
  assert.equal(scene.children[0].children.length, 1);
  game.weapons.reset();
  visuals.reset();
  assert.equal(scene.children[0].children.length, 0);
  game.click();
  game.tick();
  visuals.update(dt, 1);
  assert.equal(scene.children[0].children.length, 1);
  visuals.dispose();
  game.weapons.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(game.weapons.rockets.length, 0);
});
