interface Slide {
  image: HTMLImageElement;
  state: 'loading' | 'ready' | 'error';
}

const files = [
  '/assets/images/intro1.png',
  '/assets/images/intro2.png',
  '/assets/images/intro3.png',
];

/** Owns only the introductory DOM; completion hands control to application startup. */
export class IntroSequence {
  private readonly root = document.createElement('section');
  private readonly frame = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly button = document.createElement('button');
  private readonly abort = new AbortController();
  private readonly slides: Slide[];
  private index = 0;
  private disposed = false;
  private displayed?: HTMLImageElement;
  private transitioning = false;
  private animations: Animation[] = [];

  constructor(
    container: HTMLElement,
    private readonly onComplete: () => void,
  ) {
    this.root.className = 'intro-sequence';
    this.root.setAttribute('aria-label', 'Вступление');
    this.frame.className = 'intro-sequence-frame';
    this.status.className = 'intro-sequence-status';
    this.status.setAttribute('role', 'status');
    this.button.className = 'intro-sequence-next';
    this.button.type = 'button';
    this.button.textContent = 'Далее';
    this.button.disabled = true;
    this.root.append(this.frame, this.status, this.button);
    container.append(this.root);
    this.button.addEventListener('click', () => this.next(), { signal: this.abort.signal });
    this.slides = files.map((file, index) => {
      const image = document.createElement('img');
      image.alt = `Вступление: изображение ${index + 1} из ${files.length}`;
      image.draggable = false;
      const slide: Slide = { image, state: 'loading' };
      const settle = (state: 'ready' | 'error') => {
        if (this.disposed || slide.state !== 'loading') {
          return;
        }
        slide.state = state;
        if (this.index === index) {
          this.render();
          this.button.focus();
        }
      };
      image.addEventListener('load', () => settle('ready'), { signal: this.abort.signal });
      image.addEventListener('error', () => settle('error'), { signal: this.abort.signal });
      image.src = file;
      return slide;
    });
    this.render();
  }

  private render(): void {
    const slide = this.slides[this.index];
    this.frame.setAttribute('aria-busy', String(slide.state === 'loading'));
    let status = '';
    if (slide.state === 'loading') {
      status = 'Загрузка изображения…';
    } else if (slide.state === 'error') {
      status = 'Не удалось загрузить изображение. Нажмите «Далее», чтобы продолжить.';
    }
    this.status.textContent = status;
    this.button.disabled = slide.state === 'loading' || this.transitioning;
    // Keep the previous image visible until its replacement finishes loading.
    if (slide.state === 'loading' || this.transitioning) {
      return;
    }
    const image = slide.state === 'ready' ? slide.image : undefined;
    if (image === this.displayed) {
      return;
    }
    const reducedMotion =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.displayed && image && !reducedMotion && typeof image.animate === 'function') {
      this.crossfade(this.displayed, image);
    } else {
      this.frame.replaceChildren(...(image ? [image] : []));
      this.displayed = image;
    }
  }

  private crossfade(previous: HTMLImageElement, next: HTMLImageElement): void {
    this.transitioning = true;
    this.button.disabled = true;
    previous.setAttribute('aria-hidden', 'true');
    next.removeAttribute('aria-hidden');
    this.frame.replaceChildren(previous, next);
    const options: KeyframeAnimationOptions = {
      duration: 200,
      easing: 'ease-out',
      fill: 'forwards',
    };
    try {
      this.animations.push(previous.animate([{ opacity: 1 }, { opacity: 0 }], options));
      this.animations.push(next.animate([{ opacity: 0 }, { opacity: 1 }], options));
      void Promise.allSettled(this.animations.map((animation) => animation.finished)).then(() =>
        this.finishTransition(next),
      );
    } catch {
      // An unavailable animation backend must not trap the introduction.
      this.finishTransition(next);
    }
  }

  private finishTransition(next: HTMLImageElement): void {
    if (this.disposed) {
      return;
    }
    this.frame.replaceChildren(next);
    this.displayed = next;
    this.cancelAnimations();
    this.transitioning = false;
    this.button.disabled = false;
    this.button.focus();
  }

  private cancelAnimations(): void {
    for (const animation of this.animations) {
      // Cancellation rejects finished; also handle a partially created transition.
      void animation.finished.catch(() => {});
      animation.cancel();
    }
    this.animations.length = 0;
  }

  private next(): void {
    if (this.disposed || this.transitioning || this.slides[this.index].state === 'loading') {
      return;
    }
    if (this.index === this.slides.length - 1) {
      this.dispose();
      this.onComplete();
      return;
    }
    this.index++;
    this.render();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abort.abort();
    this.cancelAnimations();
    this.root.remove();
    this.frame.replaceChildren();
    for (const slide of this.slides) {
      slide.image.removeAttribute('src');
    }
  }
}
