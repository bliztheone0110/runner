import { settings } from '../config/settings';

export interface MovementInput {
  forward: number;
  right: number;
  yawDelta: number;
  pitchDelta: number;
  jumpPressed: boolean;
  resetPressed: boolean;
  firePressed: boolean;
}

export const emptyInput = (): MovementInput => ({
  forward: 0,
  right: 0,
  yawDelta: 0,
  pitchDelta: 0,
  jumpPressed: false,
  resetPressed: false,
  firePressed: false,
});

/** Buffers edges and distributes mouse motion exactly once across physics ticks. */
export class InputState {
  private keys = new Set<string>();
  private edges = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private samples: Array<{ duration: number; yaw: number; pitch: number }> = [];

  press(code: string, repeat = false): void {
    if (!repeat && !this.keys.has(code)) {
      this.edges.add(code);
    }
    this.keys.add(code);
  }
  release(code: string): void {
    this.keys.delete(code);
  }
  look(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch += pitch;
  }
  beginFrame(steps: number, elapsed = steps * settings.simulation.step): void {
    if (elapsed <= 0) {
      return;
    }
    // Preserve the remaining fractional frame rather than assigning all input
    // to the next tick. This avoids rate spikes on displays faster than physics.
    this.samples.push({ duration: elapsed, yaw: this.yaw, pitch: this.pitch });
    this.yaw = this.pitch = 0;
  }
  consume(bindings: {
    forward: string;
    backward: string;
    left: string;
    right: string;
    jump: string;
    reset: string;
  }): MovementInput {
    let remaining = settings.simulation.step;
    let yawDelta = 0;
    let pitchDelta = 0;
    while (remaining > 1e-10 && this.samples.length > 0) {
      const sample = this.samples[0];
      const duration = Math.min(remaining, sample.duration);
      const fraction = duration / sample.duration;
      const yaw = sample.yaw * fraction;
      const pitch = sample.pitch * fraction;
      yawDelta += yaw;
      pitchDelta += pitch;
      sample.duration -= duration;
      sample.yaw -= yaw;
      sample.pitch -= pitch;
      remaining -= duration;
      if (sample.duration < 1e-10) {
        this.samples.shift();
      }
    }
    const input = {
      forward: Number(this.keys.has(bindings.forward)) - Number(this.keys.has(bindings.backward)),
      right: Number(this.keys.has(bindings.right)) - Number(this.keys.has(bindings.left)),
      yawDelta,
      pitchDelta,
      jumpPressed: this.edges.has(bindings.jump),
      resetPressed: this.edges.has(bindings.reset),
      firePressed: this.edges.has('Mouse0'),
    };
    this.edges.clear();
    return input;
  }
  clear(): void {
    this.keys.clear();
    this.edges.clear();
    this.yaw = this.pitch = 0;
    this.samples.length = 0;
  }
}
