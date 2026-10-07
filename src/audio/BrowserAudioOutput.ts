import { settings } from '../config/settings';
import type { Vec3 } from '../core/types';
import type { AudioClip, AudioOutput, ListenerPose } from './AudioOutput';

export class BrowserAudioOutput implements AudioOutput {
  private readonly context: AudioContext | undefined;
  private readonly master: GainNode | undefined;
  private readonly buffers = new Map<AudioClip, AudioBuffer>();
  private readonly voices = new Map<AudioBufferSourceNode, AudioNode[]>();
  private disposed = false;

  constructor() {
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = settings.audio.volume;
      this.master.connect(this.context.destination);
    } catch (error) {
      console.warn('Web Audio недоступен: игра продолжится без звука.', error);
    }
  }

  async load(clip: AudioClip, url: string, signal: AbortSignal): Promise<void> {
    if (!this.context) {
      throw new Error('Web Audio недоступен');
    }
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    const bytes = await response.arrayBuffer();
    const buffer = await this.context.decodeAudioData(bytes);
    if (!this.disposed && !signal.aborted) {
      this.buffers.set(clip, buffer);
    }
  }

  async resume(): Promise<void> {
    if (!this.context || this.disposed) {
      throw new Error('Аудиоконтекст недоступен');
    }
    if (this.context.state !== 'running') {
      await this.context.resume();
    }
  }
  pause(): void {
    this.stopAll();
    if (this.context && !this.disposed) {
      void this.context
        .suspend()
        .catch((error) => console.warn('Не удалось приостановить звук.', error));
    }
  }
  stopAll(): void {
    for (const source of [...this.voices.keys()]) {
      source.stop();
      this.release(source);
    }
  }

  play(clip: AudioClip, gain: number, position?: Vec3): void {
    const context = this.context;
    const master = this.master;
    const buffer = this.buffers.get(clip);
    if (!context || !master || !buffer || this.disposed || context.state !== 'running') {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const volume = context.createGain();
    volume.gain.value = gain;
    source.connect(volume);
    const nodes: AudioNode[] = [volume];
    if (position) {
      const panner = context.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = settings.audio.spatial.refDistance;
      panner.maxDistance = settings.audio.spatial.maxDistance;
      panner.rolloffFactor = settings.audio.spatial.rolloffFactor;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      volume.connect(panner);
      panner.connect(master);
      nodes.push(panner);
    } else {
      volume.connect(master);
    }
    this.voices.set(source, nodes);
    source.onended = () => this.release(source);
    source.start();
  }

  setVolume(volume: number): void {
    if (this.master && this.context && !this.disposed) {
      this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.01);
    }
  }
  setListener(pose: ListenerPose): void {
    if (!this.context || this.disposed) {
      return;
    }
    const listener = this.context.listener;
    listener.positionX.value = pose.position.x;
    listener.positionY.value = pose.position.y;
    listener.positionZ.value = pose.position.z;
    listener.forwardX.value = pose.forward.x;
    listener.forwardY.value = pose.forward.y;
    listener.forwardZ.value = pose.forward.z;
    listener.upX.value = pose.up.x;
    listener.upY.value = pose.up.y;
    listener.upZ.value = pose.up.z;
  }
  private release(source: AudioBufferSourceNode): void {
    source.onended = null;
    source.disconnect();
    for (const node of this.voices.get(source) ?? []) {
      node.disconnect();
    }
    this.voices.delete(source);
  }
  shiftOrigin(delta: Vec3): void {
    for (const nodes of this.voices.values()) {
      for (const node of nodes) {
        if ('positionX' in node) {
          const panner = node as PannerNode;
          panner.positionX.value -= delta.x;
          panner.positionY.value -= delta.y;
          panner.positionZ.value -= delta.z;
        }
      }
    }
    if (this.context && !this.disposed) {
      this.context.listener.positionX.value -= delta.x;
      this.context.listener.positionY.value -= delta.y;
      this.context.listener.positionZ.value -= delta.z;
    }
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopAll();
    this.master?.disconnect();
    this.buffers.clear();
    if (this.context) {
      void this.context
        .close()
        .catch((error) => console.warn('Не удалось закрыть аудиоконтекст.', error));
    }
  }
}
