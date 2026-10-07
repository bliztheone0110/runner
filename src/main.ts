import { Game } from './app/Game';
import { IntroSequence } from './ui/IntroSequence';
import { requireElement } from './ui/dom';
import './ui/styles.css';

const container = requireElement(document, '#app');
const abort = new AbortController();
let game: Game | undefined;
let intro: IntroSequence | undefined;
let disposed = false;

intro = new IntroSequence(container, () => {
  intro = undefined;
  if (disposed || game) {
    return;
  }
  try {
    game = new Game(container);
    game.start();
  } catch (error) {
    game?.dispose();
    container.textContent = 'Не удалось запустить 3D-сцену. Проверьте поддержку WebGL в браузере.';
    console.error(error);
  }
});

function dispose(): void {
  if (disposed) {
    return;
  }
  disposed = true;
  abort.abort();
  intro?.dispose();
  game?.dispose();
}
window.addEventListener('pagehide', dispose, { signal: abort.signal });
if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
