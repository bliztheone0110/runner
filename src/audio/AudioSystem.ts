import { settings } from '../config/settings';
import type { GameSystem } from '../core/types';
import type { GameEvent, GameEvents } from '../core/GameEvents';
import type { AudioClip, AudioOutput, ListenerPose } from './AudioOutput';

export class AudioSystem implements GameSystem {
  readonly ready: Promise<void>;
  private readonly abort = new AbortController();
  private readonly loaded = new Set<AudioClip>();
  private active = false;
  private unlocked = false;
  private outputRunning = false;
  private disposed = false;
  private prepareRequested = false;
  private pendingPrepare = false;
  private failedPrepare = false;
  private volume: number = settings.audio.volume;
  private muted = false;

  constructor(
    private readonly events: GameEvents,
    private readonly output: AudioOutput,
    private readonly random: () => number = Math.random,
    private readonly warn: (message: string, error: unknown) => void = console.warn,
  ) {
    this.output.setVolume(this.volume);
    this.ready = Promise.all(
      (Object.keys(settings.audio.files) as AudioClip[]).map(async (clip) => {
        try {
          await output.load(clip, settings.audio.files[clip], this.abort.signal);
          if (this.disposed) {
            return;
          }
          this.loaded.add(clip);
          this.tryPrepare();
        } catch (error) {
          if (this.disposed || this.abort.signal.aborted) {
            return;
          }
          if (clip === 'prepare') {
            this.failedPrepare = true;
            this.pendingPrepare = false;
          }
          this.warn(`Не удалось загрузить звук ${clip}.`, error);
        }
      }),
    ).then(() => {});
  }

  /** Called directly from the Start/Continue click, before awaiting pointer lock. */
  async unlock(): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      await this.output.resume();
      if (this.disposed) {
        return;
      }
      this.unlocked = true;
      if (!this.active) {
        this.output.pause();
      } else {
        this.outputRunning = true;
        this.tryPrepare();
      }
    } catch (error) {
      if (!this.disposed) {
        this.warn('Не удалось включить звук.', error);
      }
    }
  }
  setActive(active: boolean): void {
    if (this.disposed) {
      return;
    }
    this.active = active;
    if (!active) {
      this.outputRunning = false;
      this.output.pause();
      this.events.clear();
    } else if (this.unlocked) {
      this.outputRunning = false;
      void this.output
        .resume()
        .then(() => {
          if (this.disposed) {
            return;
          }
          if (this.active) {
            this.outputRunning = true;
            this.tryPrepare();
          } else {
            this.output.pause();
          }
        })
        .catch((error) => this.warn('Не удалось продолжить звук.', error));
    }
  }
  fixedUpdate(): void {
    for (const event of this.events.drain()) {
      this.handle(event);
    }
  }
  private handle(event: GameEvent): void {
    if (this.disposed) {
      return;
    }
    if (event.type === 'game.started') {
      if (!this.prepareRequested) {
        this.prepareRequested = true;
        this.pendingPrepare = !this.failedPrepare;
        this.tryPrepare();
      }
      return;
    }
    if (event.type === 'player.respawned') {
      this.output.stopAll();
    }
    if (!this.active || !this.unlocked || !this.outputRunning) {
      return;
    }
    let clip: AudioClip;
    switch (event.type) {
      case 'player.jumped':
        clip = this.random() < 0.5 ? 'jump' : 'jump2';
        break;
      case 'rocket.fired':
        clip = 'fire';
        break;
      case 'rocket.exploded':
        clip = 'explosion';
        break;
      case 'player.falling':
        clip = 'falling';
        break;
      case 'timer.expired':
        clip = 'timerEnd';
        break;
      case 'player.respawned':
        clip = 'respawn';
        break;
    }
    if (this.loaded.has(clip)) {
      this.output.play(
        clip,
        settings.audio.gains[clip],
        event.type === 'rocket.exploded' ? event.position : undefined,
      );
    }
  }
  private tryPrepare(): void {
    if (
      !this.pendingPrepare ||
      !this.active ||
      !this.unlocked ||
      !this.outputRunning ||
      !this.loaded.has('prepare') ||
      this.disposed
    ) {
      return;
    }
    this.pendingPrepare = false;
    this.output.play('prepare', settings.audio.gains.prepare);
  }
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.syncVolume();
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncVolume();
  }
  private syncVolume(): void {
    this.output.setVolume(this.muted ? 0 : this.volume);
  }
  setListener(pose: ListenerPose): void {
    if (!this.disposed) {
      this.output.setListener(pose);
    }
  }
  stopAll(): void {
    if (!this.disposed) {
      this.output.stopAll();
      this.events.clear();
    }
  }
  shiftOrigin(delta: ListenerPose['position']): void {
    if (!this.disposed) {
      this.output.shiftOrigin?.(delta);
    }
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abort.abort();
    this.events.clear();
    this.loaded.clear();
    this.pendingPrepare = false;
    this.output.dispose();
  }
}
