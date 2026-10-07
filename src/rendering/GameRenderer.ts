import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Scene,
  WebGLRenderer,
  type PerspectiveCamera,
} from 'three';
import type { GameSystem } from '../core/types';

export class GameRenderer implements GameSystem {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  constructor(
    private readonly container: HTMLElement,
    private readonly camera: PerspectiveCamera,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.append(this.renderer.domElement);
    this.scene.background = new Color(0xa5b9bd);
    this.scene.fog = new Fog(0xa5b9bd, 80, 220);
    this.scene.add(new AmbientLight(0xe1f3f5, 2));
    const sun = new DirectionalLight(0xffecd2, 3);
    sun.position.set(25, 50, 30);
    this.scene.add(sun);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  update(): void {
    this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.clear();
  }
}
