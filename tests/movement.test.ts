import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/config/settings.ts';
import { GameLoop } from '../src/core/GameLoop.ts';
import { InputState, emptyInput, type MovementInput } from '../src/input/InputState.ts';
import { StaticCollisionWorld } from '../src/physics/CollisionWorld.ts';
import { MovementController } from '../src/features/player/MovementController.ts';
import { PlayerState } from '../src/features/player/PlayerState.ts';

const dt = settings.simulation.step;
const floor = { min: { x: -10000, y: -2, z: -10000 }, max: { x: 10000, y: 0, z: 10000 } };
function fixture() {
  const state = new PlayerState();
  const controller = new MovementController(state, new StaticCollisionWorld([floor]));
  controller.reset({ x: 0, y: 0.00001, z: 0 });
  return { state, controller };
}
function advance(
  controller: MovementController,
  count: number,
  overrides: Partial<MovementInput> = {},
) {
  for (let i = 0; i < count; i++) controller.step(dt, { ...emptyInput(), ...overrides });
}
const close = (actual: number, expected: number, epsilon = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≠ ${expected}`);

test('WASD is camera relative; diagonals do not run faster', () => {
  for (const [forward, right, x, z] of [
    [1, 0, 0, -6],
    [-1, 0, 0, 6],
    [0, 1, 6, 0],
    [0, -1, -6, 0],
    [1, 1, 6 / Math.sqrt(2), -6 / Math.sqrt(2)],
  ]) {
    const { state, controller } = fixture();
    advance(controller, 120, { forward, right });
    close(state.speed, 6);
    close(state.velocity.x, x);
    close(state.velocity.z, z);
  }
  const { state, controller } = fixture();
  state.yaw = Math.PI / 2;
  advance(controller, 120, { forward: 1 });
  close(state.velocity.x, -6);
  close(state.velocity.z, 0);
});

test('Ground turns increase the target to 7.5; sharper turns give no extra bonus', () => {
  for (const rate of [1.5, 5]) {
    const { state, controller } = fixture();
    advance(controller, 120, { forward: 1, yawDelta: rate * dt });
    close(state.speed, 7.5);
  }
});

test('Turning in place or looking up does not provide a speed bonus', () => {
  const idle = fixture();
  advance(idle.controller, 60, { yawDelta: 2 * dt });
  close(idle.state.speed, 0);
  const looking = fixture();
  advance(looking.controller, 120, { forward: 1, pitchDelta: 0.03 });
  close(looking.state.speed, 6);
  assert.ok(looking.state.pitch <= settings.camera.pitchLimit);
});

test('Takeoff and unassisted flight preserve horizontal momentum above base speed', () => {
  const { state, controller } = fixture();
  state.velocity.z = -12;
  controller.step(dt, { ...emptyInput(), forward: 1, jumpPressed: true });
  close(state.speed, 12);
  advance(controller, 30);
  close(state.speed, 12);
  assert.equal(state.jumps, 1);
  assert.equal(state.grounded, false);
});

test('Air turns add up to 3 m/s², with no total speed cap', () => {
  const { state, controller } = fixture();
  state.position.y = 20;
  state.grounded = false;
  state.velocity.z = -100;
  advance(controller, 120, { forward: 1, yawDelta: 1.5 * dt });
  close(state.speed, 103);
});

test('Air direction changes are limited to 2 rad/s while preserving speed', () => {
  const { state, controller } = fixture();
  state.position.y = 10;
  state.grounded = false;
  state.velocity.z = -12;
  controller.step(dt, { ...emptyInput(), right: 1 });
  close(state.speed, 12);
  const headingChange = Math.atan2(state.velocity.x, -state.velocity.z);
  close(headingChange, 2 * dt);
});

test('An airborne jump press cannot produce a double jump', () => {
  const { state, controller } = fixture();
  controller.step(dt, { ...emptyInput(), jumpPressed: true });
  advance(controller, 10);
  const before = state.velocity.y;
  controller.step(dt, { ...emptyInput(), jumpPressed: true });
  close(state.velocity.y, before - settings.movement.gravity * dt);
  assert.equal(state.jumps, 1);
  advance(controller, 120);
  assert.equal(state.jumps, 1);
  assert.equal(state.grounded, true);
});

test('A jump buffered just before landing preserves momentum and immediately takes off', () => {
  const { state, controller } = fixture();
  state.grounded = false;
  state.position.y = 0.1;
  state.velocity.y = -2;
  state.velocity.z = -15;
  controller.step(dt, { ...emptyInput(), jumpPressed: true });
  advance(controller, 5);
  assert.equal(state.jumps, 1);
  assert.equal(state.grounded, false);
  assert.ok(state.velocity.y > 0);
  close(state.speed, 15);
});

test('A missed landing jump brakes excess momentum and releasing input stops the player', () => {
  const { state, controller } = fixture();
  state.velocity.z = -15;
  controller.step(dt, { ...emptyInput(), forward: 1 });
  close(state.speed, 15 - 10 * dt);
  advance(controller, 240, { forward: 1 });
  close(state.speed, 6);
  advance(controller, 60);
  close(state.speed, 0);
});

test('Repeated manual landing jumps with turns gain speed across the chain', () => {
  const { state, controller } = fixture();
  advance(controller, 120, { forward: 1 });
  let lastJumpSpeed = state.speed;
  for (let jump = 0; jump < 4; jump++) {
    controller.step(dt, { ...emptyInput(), forward: 1, jumpPressed: true, yawDelta: 1.5 * dt });
    for (let waiting = 0; state.jumps < jump + 1 && waiting < 20; waiting++) {
      controller.step(dt, { ...emptyInput(), forward: 1, yawDelta: 1.5 * dt });
    }
    assert.equal(state.jumps, jump + 1);
    let ticks = 0;
    while (!(state.velocity.y < 0 && state.position.y < 0.13) && ticks++ < 120) {
      controller.step(dt, { ...emptyInput(), forward: 1, yawDelta: 1.5 * dt });
    }
    assert.ok(ticks < 120);
    assert.ok(state.speed > lastJumpSpeed + 1);
    lastJumpSpeed = state.speed;
  }
  assert.equal(state.jumps, 4);
});

test('A missed bunnyhop landing resets any accumulated speed to base in 0.5 seconds', () => {
  for (const initialSpeed of [12, 30, 100]) {
    const { state, controller } = fixture();
    state.grounded = false;
    state.position.y = 0.001;
    state.velocity.y = -1;
    state.velocity.z = -initialSpeed;
    controller.step(dt, { ...emptyInput(), forward: 1 });
    assert.equal(state.grounded, true);
    close(state.speed, initialSpeed);
    advance(controller, 30, { forward: 1 });
    close(state.speed, 6 + (initialSpeed - 6) / 2);
    advance(controller, 30, { forward: 1 });
    close(state.speed, 6);
  }
});

test('Ground turns cannot prolong the 0.5-second landing reset; releasing keys still stops movement', () => {
  for (const forward of [0, 1]) {
    const { state, controller } = fixture();
    state.grounded = false;
    state.position.y = 0.001;
    state.velocity.y = -1;
    state.velocity.z = -100;
    controller.step(dt, emptyInput());
    advance(controller, 60, { forward, yawDelta: 1.5 * dt });
    assert.ok(state.speed <= 6 + 1e-7);
    if (forward === 0) {
      advance(controller, 60);
      close(state.speed, 0);
    }
  }
});

test('An immediate post-landing jump preserves momentum and cancels the landing reset', () => {
  const { state, controller } = fixture();
  state.grounded = false;
  state.position.y = 0.001;
  state.velocity.y = -1;
  state.velocity.z = -30;
  controller.step(dt, { ...emptyInput(), forward: 1 });
  assert.equal(state.grounded, true);
  controller.step(dt, { ...emptyInput(), forward: 1, jumpPressed: true });
  advance(controller, 30, { forward: 1 });
  close(state.speed, 30);
  assert.equal(state.grounded, false);
});

test('Swept collision blocks high speed movement and preserves tangential sliding', () => {
  const wall = { min: { x: 5, y: 0, z: -100 }, max: { x: 6, y: 10, z: 100 } };
  const world = new StaticCollisionWorld([floor, wall]);
  const body = {
    position: { x: 0, y: 0.00001, z: 0 },
    velocity: { x: 10000, y: -1, z: 12 },
    radius: 0.35,
    height: 1.8,
  };
  const result = world.move(body, { x: 100, y: -0.1, z: 2 });
  assert.ok(body.position.x < 4.65 && body.position.x > 4.64);
  close(body.position.z, 2);
  close(body.velocity.x, 0);
  close(body.velocity.z, 12);
  assert.equal(result.grounded, true);
});

test('Obstacle tops act as ground and undersides stop vertical movement', () => {
  const obstacle = { min: { x: -2, y: 2, z: -2 }, max: { x: 2, y: 3, z: 2 } };
  const world = new StaticCollisionWorld([obstacle]);
  const falling = {
    position: { x: 0, y: 5, z: 0 },
    velocity: { x: 0, y: -50, z: 0 },
    radius: 0.35,
    height: 1.8,
  };
  assert.equal(world.move(falling, { x: 0, y: -4, z: 0 }).grounded, true);
  close(falling.position.y, 3.00001);
  close(falling.velocity.y, 0);
  const rising = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 20, z: 0 },
    radius: 0.35,
    height: 1.8,
  };
  assert.equal(world.move(rising, { x: 0, y: 2, z: 0 }).grounded, false);
  close(rising.position.y, 0.19999);
  close(rising.velocity.y, 0);
});

test('Input edges ignore hold and auto-repeat; a release permits the next jump', () => {
  const input = new InputState();
  input.press('Space');
  input.beginFrame(1);
  assert.equal(input.consume(settings.keys).jumpPressed, true);
  input.press('Space', true);
  input.beginFrame(1);
  assert.equal(input.consume(settings.keys).jumpPressed, false);
  input.release('Space');
  input.press('Space');
  assert.equal(input.consume(settings.keys).jumpPressed, true);
});

test('Mouse deltas and queued jump edges survive zero-step frames and are distributed once', () => {
  const input = new InputState();
  input.look(0.3, 0.15);
  input.press('Space');
  input.beginFrame(0);
  input.beginFrame(3);
  let yaw = 0;
  let pitch = 0;
  let jumps = 0;
  for (let i = 0; i < 3; i++) {
    const frame = input.consume(settings.keys);
    yaw += frame.yawDelta;
    pitch += frame.pitchDelta;
    jumps += Number(frame.jumpPressed);
  }
  close(yaw, 0.3);
  close(pitch, 0.15);
  assert.equal(jumps, 1);
  input.beginFrame(1);
  close(input.consume(settings.keys).yawDelta, 0);
});

test('Clearing input for focus loss removes keys, jump edges and mouse movement', () => {
  const input = new InputState();
  input.press('KeyW');
  input.press('Space');
  input.look(1, 1);
  input.beginFrame(2);
  input.clear();
  input.beginFrame(1);
  assert.deepEqual(input.consume(settings.keys), emptyInput());
});

test('30, 60 and 144 FPS give the same fixed-step state for a turning jump', () => {
  const outcomes = [30, 60, 144].map((fps) => {
    const { state, controller } = fixture();
    const input = new InputState();
    input.press('KeyW');
    input.press('Space');
    const loop = new GameLoop(
      [{ fixedUpdate: (step) => controller.step(step, input.consume(settings.keys)) }],
      (steps, elapsed) => input.beginFrame(steps, elapsed),
    );
    loop.setPaused(false);
    for (let frame = 0; frame < fps * 2; frame++) {
      input.look(1 / fps, 0);
      loop.advance(1 / fps);
    }
    return { position: state.position, speed: state.speed, yaw: state.yaw };
  });
  for (const outcome of outcomes.slice(1)) {
    close(outcome.speed, outcomes[0].speed, 0.03);
    close(outcome.yaw, outcomes[0].yaw, 0.01);
    close(outcome.position.x, outcomes[0].position.x, 0.08);
    close(outcome.position.z, outcomes[0].position.z, 0.08);
  }
});

test('Pausing clears accumulated time and long frames cannot exceed eight ticks', () => {
  let ticks = 0;
  const loop = new GameLoop([
    {
      fixedUpdate: () => {
        ticks++;
      },
    },
  ]);
  loop.setPaused(false);
  loop.advance(dt / 2);
  loop.setPaused(true);
  loop.advance(10);
  assert.equal(ticks, 0);
  loop.setPaused(false);
  loop.advance(dt / 2);
  assert.equal(ticks, 0);
  loop.advance(10);
  assert.equal(ticks, 8);
});

test('Reset clears motion, camera, jump buffer and counters', () => {
  const { state, controller } = fixture();
  controller.step(dt, { ...emptyInput(), jumpPressed: true, forward: 1, yawDelta: 0.3 });
  controller.reset({ x: 1, y: 0.00001, z: 2 });
  assert.deepEqual(state.position, { x: 1, y: 0.00001, z: 2 });
  close(state.speed, 0);
  close(state.yaw, 0);
  assert.equal(state.jumps, 0);
  controller.step(dt, emptyInput());
  assert.equal(state.jumps, 0);
});
