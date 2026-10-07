import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { settings } from '../src/config/settings.ts';
import { GameEvents } from '../src/core/GameEvents.ts';
import { GameLoop } from '../src/core/GameLoop.ts';
import type { Vec3 } from '../src/core/types.ts';
import { AudioSystem } from '../src/audio/AudioSystem.ts';
import { AudioListenerSystem } from '../src/audio/AudioListenerSystem.ts';
import type { AudioClip, AudioOutput, ListenerPose } from '../src/audio/AudioOutput.ts';
import { PlayerState } from '../src/features/player/PlayerState.ts';
import { MovementController } from '../src/features/player/MovementController.ts';
import { StaticCollisionWorld } from '../src/physics/CollisionWorld.ts';
import { InputState, emptyInput } from '../src/input/InputState.ts';
import { InputSystem } from '../src/input/InputSystem.ts';
import { HealthState } from '../src/features/health/HealthState.ts';
import { HealthSystem } from '../src/features/health/HealthSystem.ts';
import { WeaponSystem } from '../src/features/weapons/WeaponSystem.ts';
import { RespawnSystem } from '../src/app/RespawnSystem.ts';

const dt = settings.simulation.step;
const floor = { min: { x: -1000, y: -2, z: -1000 }, max: { x: 1000, y: 0, z: 1000 } };

class FakeAudioOutput implements AudioOutput {
  plays: { clip: AudioClip; gain: number; position?: Vec3 }[] = [];
  loads: { clip: AudioClip; url: string; signal: AbortSignal }[] = [];
  volume = 0;
  stops = 0;
  pauses = 0;
  disposed = 0;
  running = false;
  pose?: ListenerPose;
  shifts: Vec3[] = [];
  fail?: AudioClip;
  pending?: AudioClip;
  resolvePending?: () => void;
  rejectResume = false;
  async load(clip: AudioClip, url: string, signal: AbortSignal): Promise<void> {
    this.loads.push({ clip, url, signal });
    if (clip === this.fail) throw new Error('Broken file');
    if (clip === this.pending)
      await new Promise<void>((resolve) => {
        this.resolvePending = resolve;
      });
  }
  async resume(): Promise<void> {
    if (this.rejectResume) throw new Error('Autoplay blocked');
    this.running = true;
  }
  pause(): void {
    this.running = false;
    this.pauses++;
    this.stopAll();
  }
  stopAll(): void {
    this.stops++;
  }
  play(clip: AudioClip, gain: number, position?: Vec3): void {
    assert.equal(this.running, true, 'No playback while audio context is paused');
    this.plays.push({ clip, gain, position: position ? { ...position } : undefined });
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  setListener(pose: ListenerPose): void {
    this.pose = structuredClone(pose);
  }
  shiftOrigin(delta: Vec3): void {
    this.shifts.push({ ...delta });
  }
  dispose(): void {
    this.disposed++;
    this.stopAll();
    this.running = false;
  }
}

async function audioFixture(random = () => 0, output = new FakeAudioOutput()) {
  const events = new GameEvents();
  const warnings: string[] = [];
  const audio = new AudioSystem(events, output, random, (message) => warnings.push(message));
  await audio.ready;
  audio.setActive(true);
  await audio.unlock();
  return { audio, events, output, warnings };
}

function gameplayFixture(events = new GameEvents()) {
  const player = new PlayerState();
  const world = new StaticCollisionWorld([floor]);
  const movement = new MovementController(player, world, settings.movement, events);
  movement.reset({ x: 0, y: 0.00001, z: 0 });
  const health = new HealthState();
  const input = new InputSystem(new InputState());
  const weapons = new WeaponSystem(player, movement, health, input, world, events);
  const respawn = new RespawnSystem(
    movement,
    health,
    weapons,
    input,
    { x: 0, y: 0.00001, z: 0 },
    undefined,
    events,
  );
  return { events, player, movement, health, input, weapons, respawn };
}

test('Preloads each configured MP3 once, including the corridor falling sound', async () => {
  const { output, audio } = await audioFixture();
  assert.equal(output.loads.length, 8);
  assert.equal(new Set(output.loads.map((load) => load.url)).size, 8);
  assert.ok(output.loads.some((load) => load.url.includes('falling')));
  assert.ok(output.loads.some((load) => load.url.endsWith('rocket_fire.mp3')));
  assert.ok(output.loads.some((load) => load.url.endsWith('timer_end.mp3')));
  audio.dispose();
});

test('Random values select both jump variants with a 50/50 threshold and allow repeats', async () => {
  const values = [0.1, 0.49, 0.5, 0.99];
  let index = 0;
  const { audio, output, events } = await audioFixture(() => values[index++]);
  for (let i = 0; i < values.length; i++) events.emit({ type: 'player.jumped' });
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['jump', 'jump', 'jump2', 'jump2'],
  );
  audio.fixedUpdate();
  assert.equal(output.plays.length, 4);
  audio.dispose();
});

test('Only actual jumps emit audio events: no double jump and no explosion-impulse jump sound', () => {
  const game = gameplayFixture();
  assert.equal(game.events.drain().length, 0, 'Initial spawn is not a respawn');
  game.movement.step(dt, { ...emptyInput(), jumpPressed: true });
  assert.deepEqual(game.events.drain(), [{ type: 'player.jumped' }]);
  game.movement.step(dt, { ...emptyInput(), jumpPressed: true });
  assert.equal(game.events.drain().length, 0);
  game.movement.applyImpulse({ x: 0, y: 16, z: 0 });
  assert.equal(game.events.drain().length, 0);
});

test('Buffered landing jumps emit exactly one jump event', () => {
  const game = gameplayFixture();
  game.player.grounded = false;
  game.player.position.y = 0.05;
  game.player.velocity.y = -3;
  game.movement.step(dt, { ...emptyInput(), jumpPressed: true });
  for (let i = 0; i < 3; i++) game.movement.step(dt, emptyInput());
  assert.deepEqual(game.events.drain(), [{ type: 'player.jumped' }]);
});

test('Fire and explosion events play together once; blocked cooldown clicks create no events', async () => {
  const { audio, output, events } = await audioFixture();
  const game = gameplayFixture(events);
  game.player.pitch = -settings.camera.pitchLimit;
  game.input.snapshot.firePressed = true;
  game.weapons.fixedUpdate(dt);
  for (let i = 0; i < 5; i++) game.weapons.fixedUpdate(dt);
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['fire', 'explosion'],
  );
  assert.ok(output.plays[1].position);
  for (let i = 0; i < 10; i++) game.weapons.fixedUpdate(dt);
  audio.fixedUpdate();
  assert.equal(output.plays.length, 2);
  audio.dispose();
});

test('An immediate camera-to-muzzle impact still emits one fire and one explosion', () => {
  const game = gameplayFixture();
  const wall = new StaticCollisionWorld([
    { min: { x: -5, y: 0, z: -0.42 }, max: { x: 5, y: 5, z: -0.35 } },
  ]);
  const weapons = new WeaponSystem(
    game.player,
    game.movement,
    game.health,
    game.input,
    wall,
    game.events,
  );
  game.input.snapshot.firePressed = true;
  weapons.fixedUpdate(dt);
  const events = game.events.drain();
  assert.deepEqual(
    events.map((event) => event.type),
    ['rocket.fired', 'rocket.exploded'],
  );
});

test('Prepare plays once on initial successful start, never on resume or respawn', async () => {
  const { audio, output, events } = await audioFixture();
  assert.equal(output.plays.length, 0);
  events.emit({ type: 'game.started' });
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['prepare'],
  );
  audio.setActive(false);
  audio.setActive(true);
  await audio.unlock();
  events.emit({ type: 'game.started' });
  events.emit({ type: 'player.respawned' });
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['prepare', 'respawn'],
  );
  audio.dispose();
});

test('Late prepare waits for loading and active play; other unloaded effects are discarded', async () => {
  const output = new FakeAudioOutput();
  output.pending = 'prepare';
  const events = new GameEvents();
  const audio = new AudioSystem(events, output);
  audio.setActive(true);
  await audio.unlock();
  events.emit({ type: 'game.started' });
  audio.fixedUpdate();
  assert.equal(output.plays.length, 0);
  audio.setActive(false);
  output.resolvePending!();
  await audio.ready;
  assert.equal(output.plays.length, 0);
  audio.setActive(true);
  await audio.unlock();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['prepare'],
  );
  events.emit({ type: 'game.started' });
  audio.fixedUpdate();
  assert.equal(output.plays.length, 1);
  audio.dispose();

  const lateOutput = new FakeAudioOutput();
  lateOutput.pending = 'fire';
  const lateEvents = new GameEvents();
  const lateAudio = new AudioSystem(lateEvents, lateOutput);
  lateAudio.setActive(true);
  await lateAudio.unlock();
  lateEvents.emit({ type: 'rocket.fired' });
  lateAudio.fixedUpdate();
  lateOutput.resolvePending!();
  await lateAudio.ready;
  lateAudio.fixedUpdate();
  assert.equal(lateOutput.plays.length, 0);
  lateAudio.dispose();
});

test('Pause stops voices, drops queued effects and resume does not replay them', async () => {
  const { audio, output, events } = await audioFixture();
  events.emit({ type: 'rocket.fired' });
  audio.fixedUpdate();
  events.emit({ type: 'player.jumped' });
  audio.setActive(false);
  const stops = output.stops;
  events.emit({ type: 'rocket.fired' });
  audio.fixedUpdate();
  audio.setActive(true);
  await audio.unlock();
  audio.fixedUpdate();
  assert.equal(output.plays.length, 1);
  assert.ok(stops > 0);
  audio.dispose();
});

test('Respawns from death, R and leaving the map emit exactly once and stop old voices', async () => {
  const { audio, output, events } = await audioFixture();
  const game = gameplayFixture(events);
  game.health.damage(100);
  new HealthSystem(game.health, () => game.respawn.reset()).fixedUpdate(dt);
  audio.fixedUpdate();
  game.input.snapshot.resetPressed = true;
  game.respawn.fixedUpdate();
  audio.fixedUpdate();
  game.player.position.y = -31;
  game.respawn.fixedUpdate();
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['respawn', 'respawn', 'respawn'],
  );
  assert.equal(output.stops, 3);
  audio.dispose();
});

test('Spatial explosions retain positions; listener follows camera orientation and position', async () => {
  const { audio, output, events } = await audioFixture();
  const point = { x: 20, y: 1, z: -10 };
  events.emit({ type: 'rocket.exploded', position: point });
  audio.fixedUpdate();
  assert.deepEqual(output.plays[0].position, point);
  const camera = new PerspectiveCamera();
  camera.position.set(2, 3, 4);
  camera.rotation.y = Math.PI / 2;
  new AudioListenerSystem(camera, audio).update();
  assert.deepEqual(output.pose!.position, { x: 2, y: 3, z: 4 });
  assert.ok(Math.abs(output.pose!.forward.x + 1) < 1e-6);
  assert.ok(Math.abs(output.pose!.forward.z) < 1e-6);
  audio.dispose();
});

test('Volume and mute persist through pause and restore the chosen gain', async () => {
  const { audio, output } = await audioFixture();
  assert.equal(output.volume, 0.5);
  audio.setVolume(0.3);
  audio.setMuted(true);
  assert.equal(output.volume, 0);
  audio.setActive(false);
  audio.setActive(true);
  await audio.unlock();
  assert.equal(output.volume, 0);
  audio.setMuted(false);
  assert.equal(output.volume, 0.3);
  audio.setVolume(5);
  assert.equal(output.volume, 1);
  audio.setVolume(-2);
  assert.equal(output.volume, 0);
  audio.dispose();
});

test('Falling events play once and rebasing reaches the active spatial audio backend', async () => {
  const { audio, output, events } = await audioFixture();
  events.emit({ type: 'player.falling' });
  audio.fixedUpdate();
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['falling'],
  );
  const delta = { x: 500, y: 0, z: -1000 };
  audio.shiftOrigin(delta);
  assert.deepEqual(output.shifts, [delta]);
  audio.dispose();
  audio.shiftOrigin(delta);
  assert.equal(output.shifts.length, 1);
});

test('Switching modes clears old audio without respawn or repeated prepare and retains volume', async () => {
  const { audio, output, events } = await audioFixture();
  events.emit({ type: 'game.started' });
  audio.fixedUpdate();
  audio.setVolume(0.3);
  audio.setMuted(true);
  events.emit({ type: 'rocket.exploded', position: { x: 0, y: 0, z: 0 } });
  audio.stopAll();
  audio.fixedUpdate();
  events.emit({ type: 'game.started' });
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['prepare'],
  );
  assert.equal(output.stops, 1);
  assert.equal(output.volume, 0);
  audio.setMuted(false);
  assert.equal(output.volume, 0.3);
  audio.dispose();
});

test('Failed files and rejected resume do not throw into gameplay or prevent other sounds', async () => {
  const output = new FakeAudioOutput();
  output.fail = 'fire';
  const { audio, events, warnings } = await audioFixture(() => 0, output);
  events.emit({ type: 'rocket.fired' });
  events.emit({ type: 'player.jumped' });
  audio.fixedUpdate();
  assert.deepEqual(
    output.plays.map((play) => play.clip),
    ['jump'],
  );
  assert.equal(warnings.length, 1);
  audio.setActive(false);
  output.rejectResume = true;
  await audio.unlock();
  assert.equal(warnings.length, 2);
  audio.dispose();
});

test('One event is consumed once even with eight physics ticks in one render frame', async () => {
  const { audio, output, events } = await audioFixture();
  events.emit({ type: 'rocket.fired' });
  const loop = new GameLoop([audio]);
  loop.setPaused(false);
  loop.advance(8 * dt);
  assert.equal(output.plays.length, 1);
  audio.dispose();
});

test('Dispose aborts file requests, releases backend once and ignores late loads', async () => {
  const output = new FakeAudioOutput();
  output.pending = 'prepare';
  const events = new GameEvents();
  const audio = new AudioSystem(events, output);
  audio.dispose();
  audio.dispose();
  assert.equal(output.disposed, 1);
  assert.ok(output.loads.every((load) => load.signal.aborted));
  output.resolvePending!();
  await audio.ready;
  audio.setActive(true);
  await audio.unlock();
  events.emit({ type: 'game.started' });
  audio.fixedUpdate();
  assert.equal(output.plays.length, 0);
});
