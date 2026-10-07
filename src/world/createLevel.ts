import {
  BoxGeometry,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type { LevelDefinition } from './trainingLevel';

export function createLevel(definition: LevelDefinition): { root: Group; dispose(): void } {
  const root = new Group();
  const disposables: Array<{ dispose(): void }> = [];
  for (const box of definition.boxes) {
    const geometry = new BoxGeometry(box.size.x, box.size.y, box.size.z);
    const material = new MeshStandardMaterial({ color: box.color, roughness: 0.85 });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(box.center.x, box.center.y, box.center.z);
    root.add(mesh);
    disposables.push(geometry, material);
    if (box.kind === 'obstacle') {
      const edges = new EdgesGeometry(geometry);
      const lineMaterial = new LineBasicMaterial({
        color: 0xf1eee4,
        transparent: true,
        opacity: 0.45,
      });
      mesh.add(new LineSegments(edges, lineMaterial));
      disposables.push(edges, lineMaterial);
    }
  }
  const grid = new GridHelper(158, 79, 0x64b5aa, 0x466067);
  grid.position.y = 0.002;
  root.add(grid);
  disposables.push(grid.geometry);
  disposables.push(...(Array.isArray(grid.material) ? grid.material : [grid.material]));
  return {
    root,
    dispose() {
      root.removeFromParent();
      disposables.forEach((resource) => resource.dispose());
      root.clear();
    },
  };
}
