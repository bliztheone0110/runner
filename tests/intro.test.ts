import test from 'node:test';
import assert from 'node:assert/strict';
import { IntroSequence } from '../src/ui/IntroSequence.ts';

/** Minimal DOM fixture: image completion is controlled without network or WebGL. */
class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent?: ElementStub;
  attributes = new Map<string, string>();
  className = '';
  textContent = '';
  disabled = false;
  type = '';
  src = '';
  alt = '';
  draggable = true;
  animate?: (frames: Keyframe[], options: KeyframeAnimationOptions) => Animation;
  constructor(
    readonly tag: string,
    private readonly onFocus: (element: ElementStub) => void,
  ) {
    super();
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'src') this.src = '';
  }
  append(...children: ElementStub[]): void {
    for (const child of children) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: ElementStub[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...children);
  }
  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = undefined;
    }
  }
  focus(): void {
    this.onFocus(this);
  }
}

function withDOM<T>(
  run: (fixture: {
    container: HTMLElement;
    nodes: ElementStub[];
    focused: () => ElementStub | undefined;
  }) => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes: ElementStub[] = [];
  let active: ElementStub | undefined;
  const doc = {
    createElement(tag: string) {
      const node = new ElementStub(tag, (element) => {
        active = element;
      });
      nodes.push(node);
      return node;
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const container = doc.createElement('div') as unknown as HTMLElement;
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  };
  try {
    const result = run({ container, nodes, focused: () => active });
    if (result instanceof Promise) return result.finally(restore) as T;
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

class AnimationStub {
  readonly finished: Promise<void>;
  private resolve!: () => void;
  private reject!: (error: Error) => void;
  cancelled = false;
  constructor(
    readonly frames: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {
    this.finished = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  finish(): void {
    this.resolve();
  }
  cancel(): void {
    this.cancelled = true;
    this.reject(new Error('Cancelled'));
  }
}
function enableAnimations(images: ElementStub[]): AnimationStub[] {
  const animations: AnimationStub[] = [];
  for (const image of images)
    image.animate = (frames, options) => {
      const animation = new AnimationStub(frames, options);
      animations.push(animation);
      return animation as unknown as Animation;
    };
  return animations;
}
const flushAnimations = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

test('All three images preload; sequence starts at intro1 and completion requires three clicks', () =>
  withDOM(({ container, nodes, focused }) => {
    let started = 0;
    const intro = new IntroSequence(container, () => {
      started++;
    });
    const images = nodes.filter((node) => node.tag === 'img');
    const button = nodes.find((node) => node.tag === 'button')!;
    const frame = nodes.find((node) => node.className === 'intro-sequence-frame')!;
    assert.deepEqual(
      images.map((image) => image.src),
      ['/assets/images/intro1.png', '/assets/images/intro2.png', '/assets/images/intro3.png'],
    );
    assert.equal(button.textContent, 'Далее');
    assert.equal(button.type, 'button');
    assert.equal(button.disabled, true);
    assert.equal(started, 0);
    button.dispatchEvent(new Event('click'));
    assert.equal(started, 0);
    for (const image of images) image.dispatchEvent(new Event('load'));
    assert.equal(button.disabled, false);
    assert.equal(focused(), button);
    assert.deepEqual(frame.children, [images[0]]);
    button.dispatchEvent(new Event('click'));
    assert.equal(started, 0);
    assert.deepEqual(frame.children, [images[1]]);
    button.dispatchEvent(new Event('click'));
    assert.equal(started, 0);
    assert.deepEqual(frame.children, [images[2]]);
    button.dispatchEvent(new Event('click'));
    assert.equal(started, 1);
    button.dispatchEvent(new Event('click'));
    intro.dispose();
    assert.equal(started, 1);
    assert.equal((container as unknown as ElementStub).children.length, 0);
  }));

test('A pending current image blocks further clicks and a later preload never advances the slide', () =>
  withDOM(({ container, nodes }) => {
    const intro = new IntroSequence(container, () => assert.fail('Too early'));
    const images = nodes.filter((node) => node.tag === 'img');
    const button = nodes.find((node) => node.tag === 'button')!;
    const frame = nodes.find((node) => node.className === 'intro-sequence-frame')!;
    images[2].dispatchEvent(new Event('load'));
    assert.equal(button.disabled, true);
    assert.equal(frame.children.length, 0);
    images[0].dispatchEvent(new Event('load'));
    button.dispatchEvent(new Event('click'));
    assert.equal(button.disabled, true);
    assert.equal(frame.attributes.get('aria-busy'), 'true');
    button.dispatchEvent(new Event('click'));
    images[1].dispatchEvent(new Event('load'));
    assert.equal(button.disabled, false);
    assert.deepEqual(frame.children, [images[1]]);
    intro.dispose();
  }));

test('An image error shows an accessible message and permits continuing through failed slides', () =>
  withDOM(({ container, nodes }) => {
    let completed = 0;
    new IntroSequence(container, () => {
      completed++;
    });
    const images = nodes.filter((node) => node.tag === 'img');
    const button = nodes.find((node) => node.tag === 'button')!;
    const status = nodes.find((node) => node.tag === 'p')!;
    for (const image of images) image.dispatchEvent(new Event('error'));
    assert.equal(status.attributes.get('role'), 'status');
    assert.match(status.textContent, /Не удалось загрузить/);
    assert.equal(button.disabled, false);
    for (let i = 0; i < 3; i++) button.dispatchEvent(new Event('click'));
    assert.equal(completed, 1);
  }));

test('Dispose removes DOM and callbacks; late loads, errors and clicks cannot finish the sequence', () =>
  withDOM(({ container, nodes }) => {
    let completed = 0;
    const intro = new IntroSequence(container, () => {
      completed++;
    });
    const images = nodes.filter((node) => node.tag === 'img');
    const button = nodes.find((node) => node.tag === 'button')!;
    intro.dispose();
    intro.dispose();
    for (const image of images) {
      assert.equal(image.src, '');
      image.dispatchEvent(new Event('load'));
      image.dispatchEvent(new Event('error'));
    }
    for (let i = 0; i < 5; i++) button.dispatchEvent(new Event('click'));
    assert.equal(completed, 0);
    assert.equal((container as unknown as ElementStub).children.length, 0);
  }));

test('A fresh page bootstrap creates a fresh sequence rather than retaining completion', () =>
  withDOM(({ container, nodes }) => {
    new IntroSequence(container, () => {});
    const firstImages = nodes.filter((node) => node.tag === 'img');
    const firstButton = nodes.find((node) => node.tag === 'button')!;
    for (const image of firstImages) image.dispatchEvent(new Event('load'));
    for (let i = 0; i < 3; i++) firstButton.dispatchEvent(new Event('click'));
    const fresh = new IntroSequence(container, () => assert.fail('No click yet'));
    const images = nodes.filter((node) => node.tag === 'img').slice(3);
    assert.equal(images[0].src, '/assets/images/intro1.png');
    assert.equal((container as unknown as ElementStub).children.length, 1);
    fresh.dispose();
  }));

test('Both fades run together for 200ms; rapid clicks are blocked until both finish', () =>
  withDOM(async ({ container, nodes, focused }) => {
    let completed = 0;
    const intro = new IntroSequence(container, () => {
      completed++;
    });
    const images = nodes.filter((node) => node.tag === 'img');
    const animations = enableAnimations(images);
    const button = nodes.find((node) => node.tag === 'button')!;
    const frame = nodes.find((node) => node.className === 'intro-sequence-frame')!;
    for (const image of images) image.dispatchEvent(new Event('load'));
    button.dispatchEvent(new Event('click'));
    assert.deepEqual(frame.children, [images[0], images[1]]);
    assert.equal(button.disabled, true);
    assert.equal(images[0].attributes.get('aria-hidden'), 'true');
    assert.deepEqual(
      animations.map((animation) => animation.frames),
      [
        [{ opacity: 1 }, { opacity: 0 }],
        [{ opacity: 0 }, { opacity: 1 }],
      ],
    );
    assert.ok(animations.every((animation) => animation.options.duration === 200));
    for (let i = 0; i < 5; i++) button.dispatchEvent(new Event('click'));
    assert.equal(animations.length, 2);
    assert.equal(completed, 0);
    animations[0].finish();
    await flushAnimations();
    assert.equal(button.disabled, true);
    animations[1].finish();
    await flushAnimations();
    assert.equal(button.disabled, false);
    assert.equal(focused(), button);
    assert.deepEqual(frame.children, [images[1]]);
    assert.ok(animations.every((animation) => animation.cancelled));
    button.dispatchEvent(new Event('click'));
    assert.deepEqual(frame.children, [images[1], images[2]]);
    animations[2].finish();
    animations[3].finish();
    await flushAnimations();
    button.dispatchEvent(new Event('click'));
    assert.equal(completed, 1);
    intro.dispose();
  }));

test('The old image remains while the next loads, then fades when loading succeeds', () =>
  withDOM(async ({ container, nodes }) => {
    const intro = new IntroSequence(container, () => assert.fail('Too early'));
    const images = nodes.filter((node) => node.tag === 'img');
    const animations = enableAnimations(images);
    const button = nodes.find((node) => node.tag === 'button')!;
    const frame = nodes.find((node) => node.className === 'intro-sequence-frame')!;
    images[0].dispatchEvent(new Event('load'));
    button.dispatchEvent(new Event('click'));
    assert.deepEqual(frame.children, [images[0]]);
    assert.equal(button.disabled, true);
    assert.equal(animations.length, 0);
    images[1].dispatchEvent(new Event('load'));
    assert.equal(animations.length, 2);
    animations.forEach((animation) => animation.finish());
    await flushAnimations();
    assert.deepEqual(frame.children, [images[1]]);
    assert.equal(button.disabled, false);
    button.dispatchEvent(new Event('click'));
    images[2].dispatchEvent(new Event('error'));
    assert.equal(button.disabled, false);
    assert.equal(frame.children.length, 0);
    intro.dispose();
  }));

test('Dispose cancels both animations and late completion cannot restore DOM or call completion', () =>
  withDOM(async ({ container, nodes }) => {
    let completed = 0;
    const intro = new IntroSequence(container, () => {
      completed++;
    });
    const images = nodes.filter((node) => node.tag === 'img');
    const animations = enableAnimations(images);
    const button = nodes.find((node) => node.tag === 'button')!;
    for (const image of images) image.dispatchEvent(new Event('load'));
    button.dispatchEvent(new Event('click'));
    intro.dispose();
    assert.ok(animations.every((animation) => animation.cancelled));
    animations.forEach((animation) => animation.finish());
    await flushAnimations();
    button.dispatchEvent(new Event('click'));
    assert.equal(completed, 0);
    assert.equal((container as unknown as ElementStub).children.length, 0);
  }));

test('Reduced-motion preference makes loaded images switch instantly without animation', () =>
  withDOM(({ container, nodes }) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        assert.equal(query, '(prefers-reduced-motion: reduce)');
        return { matches: true };
      },
    });
    const intro = new IntroSequence(container, () => {});
    try {
      const images = nodes.filter((node) => node.tag === 'img');
      const animations = enableAnimations(images);
      const button = nodes.find((node) => node.tag === 'button')!;
      const frame = nodes.find((node) => node.className === 'intro-sequence-frame')!;
      for (const image of images) image.dispatchEvent(new Event('load'));
      button.dispatchEvent(new Event('click'));
      assert.deepEqual(frame.children, [images[1]]);
      assert.equal(button.disabled, false);
      assert.equal(animations.length, 0);
    } finally {
      intro.dispose();
      if (previous) Object.defineProperty(globalThis, 'matchMedia', previous);
      else Reflect.deleteProperty(globalThis, 'matchMedia');
    }
  }));
