import { settings } from '../config/settings';
import { InputState } from './InputState';

export class BrowserInput {
  readonly state = new InputState();
  private readonly abort = new AbortController();
  private readonly boundCodes = new Set<string>(Object.values(settings.keys));

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onActive: (active: boolean) => void,
    private readonly onError: (message: string) => void,
  ) {
    const options = { signal: this.abort.signal };
    window.addEventListener(
      'keydown',
      (event) => {
        if (!this.active || !this.boundCodes.has(event.code)) {
          return;
        }
        event.preventDefault();
        this.state.press(event.code, event.repeat);
      },
      options,
    );
    window.addEventListener('keyup', (event) => this.state.release(event.code), options);
    document.addEventListener(
      'mousemove',
      (event) => {
        if (this.active) {
          this.state.look(
            -event.movementX * settings.camera.sensitivity,
            -event.movementY * settings.camera.sensitivity,
          );
        }
      },
      options,
    );
    document.addEventListener(
      'mousedown',
      (event) => {
        if (!this.active || event.button !== 0) {
          return;
        }
        event.preventDefault();
        this.state.press('Mouse0');
      },
      options,
    );
    document.addEventListener(
      'mouseup',
      (event) => {
        if (event.button === 0) {
          this.state.release('Mouse0');
        }
      },
      options,
    );
    document.addEventListener(
      'pointerlockchange',
      () => {
        this.state.clear();
        this.onActive(this.active);
      },
      options,
    );
    document.addEventListener(
      'pointerlockerror',
      () => this.onError('Не удалось захватить курсор. Нажмите «Продолжить» ещё раз.'),
      options,
    );
    window.addEventListener('blur', () => this.pause(), options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          this.pause();
        }
      },
      options,
    );
  }

  get active(): boolean {
    return document.pointerLockElement === this.canvas;
  }
  async lock(): Promise<void> {
    try {
      await this.canvas.requestPointerLock();
    } catch {
      this.onError('Браузер отклонил захват курсора. Попробуйте ещё раз.');
    }
  }
  pause(): void {
    this.state.clear();
    if (this.active) {
      document.exitPointerLock();
    }
    this.onActive(false);
  }
  dispose(): void {
    this.abort.abort();
    this.state.clear();
    if (this.active) {
      document.exitPointerLock();
    }
  }
}
