import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserInput } from '../src/input/BrowserInput.ts';
import { settings } from '../src/config/settings.ts';
import { emptyInput } from '../src/input/InputState.ts';
import { GameLoop } from '../src/core/GameLoop.ts';

test('Pointer lock, focus loss, reacquisition and disposal preserve input lifecycle', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    hidden: false,
    exitPointerLock(): void {
      fakeDocument.pointerLockElement = null;
      fakeDocument.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const canvas = {
    requestPointerLock() {
      fakeDocument.pointerLockElement = this;
      fakeDocument.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  const activity: boolean[] = [];
  const errors: string[] = [];
  let input: BrowserInput | undefined;
  try {
    input = new BrowserInput(
      canvas as unknown as HTMLCanvasElement,
      (active) => activity.push(active),
      (message) => errors.push(message),
    );
    const key = (code: string, repeat = false) =>
      fakeWindow.dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), { code, repeat }),
      );
    key('KeyW');
    input.state.beginFrame(1);
    assert.equal(input.state.consume(settings.keys).forward, 0);
    const mouse = (type: string) =>
      fakeDocument.dispatchEvent(
        Object.assign(new Event(type, { cancelable: true }), { button: 0 }),
      );
    mouse('mousedown');
    input.state.beginFrame(1);
    assert.equal(input.state.consume(settings.keys).firePressed, false);
    await input.lock();
    assert.equal(input.active, true);
    assert.equal(activity.at(-1), true);
    input.state.beginFrame(1);
    assert.equal(input.state.consume(settings.keys).firePressed, false);
    mouse('mousedown');
    input.state.beginFrame(1);
    assert.equal(input.state.consume(settings.keys).firePressed, true);
    mouse('mousedown');
    input.state.beginFrame(1);
    assert.equal(input.state.consume(settings.keys).firePressed, false);
    mouse('mouseup');
    mouse('mousedown');
    input.state.beginFrame(1);
    assert.equal(input.state.consume(settings.keys).firePressed, true);
    mouse('mouseup');
    key('KeyW');
    key('Space');
    fakeDocument.dispatchEvent(
      Object.assign(new Event('mousemove'), { movementX: 15, movementY: 2 }),
    );
    input.state.beginFrame(1);
    const frame = input.state.consume(settings.keys);
    assert.equal(frame.forward, 1);
    assert.equal(frame.jumpPressed, true);
    assert.ok(frame.yawDelta < 0);
    fakeWindow.dispatchEvent(new Event('blur'));
    assert.equal(input.active, false);
    assert.equal(activity.at(-1), false);
    input.state.beginFrame(1);
    assert.deepEqual(input.state.consume(settings.keys), emptyInput());
    await input.lock();
    key('KeyW');
    fakeDocument.hidden = true;
    fakeDocument.dispatchEvent(new Event('visibilitychange'));
    assert.equal(input.active, false);
    fakeDocument.hidden = false;
    await input.lock();
    fakeDocument.dispatchEvent(new Event('pointerlockerror'));
    assert.equal(errors.length, 1);
    input.dispose();
    const callbackCount = activity.length;
    fakeDocument.pointerLockElement = canvas;
    fakeDocument.dispatchEvent(new Event('pointerlockchange'));
    key('KeyW');
    assert.equal(activity.length, callbackCount);
    input.state.beginFrame(1);
    assert.deepEqual(input.state.consume(settings.keys), emptyInput());
  } finally {
    input?.dispose();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('Loop cancels its animation request and disposes systems in reverse registration order', () => {
  const previousCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  const disposed: string[] = [];
  const cancelled: number[] = [];
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => cancelled.push(id),
  });
  try {
    const loop = new GameLoop([
      { dispose: () => disposed.push('world') },
      { dispose: () => disposed.push('player') },
      { dispose: () => disposed.push('hud') },
    ]);
    loop.dispose();
    assert.deepEqual(disposed, ['hud', 'player', 'world']);
    assert.deepEqual(cancelled, [0]);
  } finally {
    if (previousCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCancel);
    else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  }
});
