import { type settings } from '../config/settings';
import type { Vec3 } from '../core/types';

export type AudioClip = keyof typeof settings.audio.files;
export interface ListenerPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

/** Backend can be replaced by a test double without a browser. */
export interface AudioOutput {
  load(clip: AudioClip, url: string, signal: AbortSignal): Promise<void>;
  resume(): Promise<void>;
  pause(): void;
  stopAll(): void;
  play(clip: AudioClip, gain: number, position?: Vec3): void;
  setVolume(volume: number): void;
  setListener(pose: ListenerPose): void;
  shiftOrigin?(delta: Vec3): void;
  dispose(): void;
}
