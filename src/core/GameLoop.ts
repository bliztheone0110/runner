import { settings } from '../config/settings';
import type { GameSystem } from './types';

export class GameLoop {
  private accumulator = 0;
  private lastTime: number | null = null;
  private frameId = 0;
  private started = false;
  private paused = true;

  constructor(
    private readonly systems: readonly GameSystem[],
    private readonly beforeSteps: (count: number, elapsed: number) => void = () => {},
  ) {}

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulator = 0;
    this.lastTime = null;
  }

  /** Also usable without a browser for deterministic simulation checks. */
  advance(elapsed: number): void {
    if (!this.paused) {
      const simulationElapsed = clampElapsed(elapsed);
      this.accumulator += simulationElapsed;
      const steps = Math.min(
        settings.simulation.maxSteps,
        Math.floor((this.accumulator + 1e-10) / settings.simulation.step),
      );
      this.beforeSteps(steps, simulationElapsed);
      for (let index = 0; index < steps && !this.paused; index++) {
        for (const system of this.systems) {
          system.fixedUpdate?.(settings.simulation.step);
        }
        this.accumulator -= settings.simulation.step;
      }
      this.accumulator = Math.max(0, this.accumulator);
    }
    const alpha = this.paused ? 1 : this.accumulator / settings.simulation.step;
    for (const system of this.systems) {
      system.update?.(elapsed, alpha);
    }
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const frame = (now: number): void => {
      if (!this.started) {
        return;
      }
      const elapsed = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.advance(elapsed);
      this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
  }

  dispose(): void {
    this.started = false;
    cancelAnimationFrame(this.frameId);
    for (const system of [...this.systems].reverse()) {
      system.dispose?.();
    }
  }
}

const clampElapsed = (elapsed: number): number =>
  Math.max(0, Math.min(elapsed, settings.simulation.step * settings.simulation.maxSteps));
