import type { GameSystem } from '../core/types';
import type { PlayerState } from '../features/player/PlayerState';
import type { HealthState } from '../features/health/HealthState';
import { settings } from '../config/settings';
import type { GameMode, WorldStats } from '../world/GameWorld';
import type { CheckpointTimerState } from '../features/timer/CheckpointTimer';
import { requireElement } from './dom';

export interface AudioControls {
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
}

export class Hud implements GameSystem {
  private readonly root = document.createElement('div');
  private readonly abort = new AbortController();
  private readonly speed: HTMLElement;
  private readonly status: HTMLElement;
  private readonly peak: HTMLElement;
  private readonly jumps: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly message: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly healthValue: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthTrack: HTMLElement;
  private readonly healthPanel: HTMLElement;
  // private readonly damageIndicator: HTMLElement;
  private readonly damageFlash: HTMLElement;
  private hasStarted = false;
  private readonly distanceValue: HTMLElement;
  private readonly checkpointValue: HTMLElement;
  private readonly modeSelect: HTMLSelectElement;
  private mode: GameMode = 'corridor';
  private readonly timerPanel: HTMLElement;
  private readonly timerValue: HTMLElement;
  private readonly timerMessage: HTMLElement;
  private readonly endOverlay: HTMLElement;
  private readonly completedCheckpoints: HTMLElement;
  private readonly restartButton: HTMLButtonElement;
  private ended = false;

  constructor(
    container: HTMLElement,
    private readonly state: PlayerState,
    private readonly health: HealthState,
    onStart: (mode: GameMode) => void,
    audioControls?: AudioControls,
    private readonly worldStats?: WorldStats,
    private readonly checkpointTimer?: CheckpointTimerState,
    onRestart: () => void = () => {},
  ) {
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="lab-label">ENDLESS CORRIDOR
        <span><b data-distance>0</b> М · ТОЧКА <b data-checkpoint>1</b></span>
      </div>

      <div class="crosshair" aria-hidden="true"></div>
      <div class="damage-flash" aria-hidden="true"></div>

      <section class="health-panel">
        <div
          class="health-track"
          role="progressbar"
          aria-label="Здоровье"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="100"
        >
          <strong data-health>100 / 100 HP</strong>
          <div data-health-fill></div>
        </div>
      </section>

      <section class="telemetry">
        <div class="eyebrow"> СКОРОСТЬ</div>
        <div class="speed-row">
          <strong data-speed>0.00</strong>
          <span>м/с</span>
        </div>
        <div class="speed-track">
          <div data-meter></div>
          <i></i>
        </div>
        <div class="telemetry-bottom">
          <span data-status>НА ЗЕМЛЕ</span>
          <span>БАЗА 6.00</span>
        </div>
      </section>

      <div class="stats">
        <div>
          МАКС. СКОРОСТЬ
          <strong data-peak>0.00 <small>м/с</small></strong>
        </div>
        <div>
          ПРЫЖКИ
          <strong data-jumps>00</strong>
        </div>
      </div>

      <footer class="controls">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> движение</span>
        <span><kbd>SPACE</kbd> прыжок</span>
        <span><kbd>ЛКМ</kbd> ракета</span>
        <span><kbd>R</kbd> к точке</span>
        <span><kbd>ESC</kbd> пауза</span>
      </footer>

      <div class="overlay">
        <section class="intro">
          <h1>Антизумер<br><em>ранер.</em></h1>
          <p>Покажи этим зумерам как надо делать распрыгу.</p>

          <div class="instructions">
            <div>
              <b>01</b>
              <span>Зажми <kbd>W</kbd> и плавно поверни мышь.</span>
            </div>
            <div>
              <b>02</b>
              <span>Нажми <kbd>SPACE</kbd>, для прыжка.</span>
            </div>
            <div>
              <b>03</b>
              <span>Продолжай поворот в воздухе. Перед приземлением нажми пробел снова.</span>
            </div>
            <div>
              <b>04</b>
              <span>нажми <kbd>ЛКМ</kbd>: для выстрела из ракетницы.</span>
            </div>
          </div>

          <div class="audio-controls">
            <label for="audio-volume">
              Громкость
              <output data-volume>${settings.audio.volume * 100}%</output>
            </label>
            <input
              id="audio-volume"
              type="range"
              min="0"
              max="100"
              value="${settings.audio.volume * 100}"
              aria-label="Громкость звука"
            >
            <label class="mute-control">
              <input type="checkbox" data-mute> Без звука
            </label>
          </div>

          <button type="button">Начать <span>↗</span></button>
          <p class="pointer-note">Мышь управляет камерой · Escape освобождает курсор</p>
          <p class="error-message" role="status"></p>
        </section>
      </div>
    `;
    container.append(this.root);
    const find = <T extends HTMLElement>(selector: string): T =>
      requireElement<T>(this.root, selector);
    this.speed = find('[data-speed]');
    this.status = find('[data-status]');
    this.peak = find('[data-peak]');
    this.jumps = find('[data-jumps]');
    this.meter = find('[data-meter]');
    this.overlay = find('.overlay');
    this.message = find('.error-message');
    this.button = find('button');
    this.healthValue = find('[data-health]');
    this.healthFill = find('[data-health-fill]');
    this.healthPanel = find('.health-panel');
    this.healthTrack = find('.health-track');
    this.damageFlash = find('.damage-flash');
    this.distanceValue = find('[data-distance]');
    this.checkpointValue = find('[data-checkpoint]');
    const modeControl = document.createElement('div');
    modeControl.className = 'mode-control';
    modeControl.innerHTML = `
      <label for="game-mode">Режим игры</label>
      <select id="game-mode">
        <option value="corridor">Бесконечный коридор</option>
        <option value="training">Тренировка</option>
      </select>
      <p>При смене режима текущий забег начинается заново.</p>
    `;
    find('.audio-controls').before(modeControl);
    this.modeSelect = requireElement(modeControl, 'select');
    this.timerPanel = document.createElement('section');
    this.timerPanel.className = 'checkpoint-timer';
    this.timerPanel.innerHTML = `
      <div>ДО СЛЕДУЮЩЕЙ ТОЧКИ</div>
      <strong data-timer>15.00</strong><span> сек</span>
      <p data-timer-message role="status"></p>
    `;
    this.root.append(this.timerPanel);
    this.timerValue = requireElement(this.timerPanel, '[data-timer]');
    this.timerMessage = requireElement(this.timerPanel, '[data-timer-message]');
    this.timerPanel.hidden = !this.checkpointTimer?.enabled;
    this.endOverlay = document.createElement('div');
    this.endOverlay.className = 'overlay run-end-overlay';
    this.endOverlay.hidden = true;
    this.endOverlay.innerHTML = `
      <section
        class="run-end-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-end-title"
      >
        <h2 id="run-end-title">Время вышло!</h2>
        <p>Пройдено чекпоинтов: <strong data-completed-checkpoints>0</strong></p>
        <button type="button">Начать сначала</button>
      </section>
    `;
    this.root.append(this.endOverlay);
    this.completedCheckpoints = requireElement(this.endOverlay, '[data-completed-checkpoints]');
    this.restartButton = requireElement(this.endOverlay, 'button');
    this.restartButton.addEventListener('click', onRestart, { signal: this.abort.signal });
    this.modeSelect.addEventListener('change', () => this.updateStartButton(), {
      signal: this.abort.signal,
    });
    this.button.addEventListener('click', () => onStart(this.modeSelect.value as GameMode), {
      signal: this.abort.signal,
    });
    const volume = find<HTMLInputElement>('#audio-volume');
    const mute = find<HTMLInputElement>('[data-mute]');
    const volumeLabel = find('[data-volume]');
    volume.addEventListener(
      'input',
      () => {
        volumeLabel.textContent = `${volume.value}%`;
        audioControls?.setVolume(Number(volume.value) / 100);
      },
      { signal: this.abort.signal },
    );
    mute.addEventListener('change', () => audioControls?.setMuted(mute.checked), {
      signal: this.abort.signal,
    });
  }
  setActive(active: boolean): void {
    if (this.ended) {
      return;
    }
    if (active) {
      this.hasStarted = true;
    }
    this.overlay.hidden = active;
    this.modeSelect.value = this.mode;
    this.updateStartButton();
    this.message.textContent = '';
  }
  showTimerEnd(completed: number): void {
    this.ended = true;
    this.overlay.hidden = true;
    this.completedCheckpoints.textContent = String(completed);
    this.endOverlay.hidden = false;
    this.restartButton.focus();
  }
  clearTimerEnd(): void {
    this.ended = false;
    this.endOverlay.hidden = true;
    this.overlay.hidden = false;
  }
  setMode(mode: GameMode): void {
    this.mode = mode;
    this.modeSelect.value = mode;
    const title = requireElement(this.root, '.lab-label').firstChild;
    if (!title) {
      throw new Error('Не найден заголовок режима в .lab-label');
    }
    title.textContent = mode === 'training' ? 'ТРЕНИРОВКА' : 'ENDLESS CORRIDOR';
    requireElement(this.root, '.lab-label > span').hidden = mode === 'training';
    requireElement(this.root, '.controls > span:nth-child(4)').innerHTML =
      `<kbd>R</kbd> ${mode === 'training' ? 'в центр' : 'к точке'}`;
    this.updateStartButton();
  }
  private updateStartButton(): void {
    const changed = this.modeSelect.value !== this.mode;
    let label = this.hasStarted ? 'Продолжить' : 'Начать';
    if (changed) {
      label = this.modeSelect.value === 'training' ? 'Начать тренировку' : 'Начать коридор';
    }
    this.button.innerHTML = `${label} <span>↗</span>`;
  }
  showError(message: string): void {
    this.overlay.hidden = false;
    this.message.textContent = message;
  }
  update(): void {
    this.speed.textContent = this.state.speed.toFixed(2);
    this.peak.innerHTML = `${this.state.peakSpeed.toFixed(2)} <small>м/с</small>`;
    this.jumps.textContent = String(this.state.jumps).padStart(2, '0');
    let status = 'В ВОЗДУХЕ';
    if (this.state.grounded) {
      status = 'НА ЗЕМЛЕ';
    } else if (this.state.turnBonus > 0) {
      status = 'В ВОЗДУХЕ / РАЗГОН';
    }
    this.status.textContent = status;
    this.meter.style.width = `${Math.min(100, (this.state.speed / 18) * 100)}%`;
    const hp = Math.ceil(this.health.current);
    // this.healthValue.textContent = `${hp} / ${settings.health.max} HP`;
    this.healthValue.textContent = `${hp}%`;
    this.healthFill.style.width = `${(this.health.current / settings.health.max) * 100}%`;
    this.healthTrack.setAttribute('aria-valuenow', String(hp));
    this.healthPanel.classList.toggle('low-health', this.health.current <= 30);
    // this.damageIndicator.textContent = this.health.damageFlash > 0 ? `−${this.health.lastDamage.toFixed(0)} HP` : '';
    this.damageFlash.style.opacity = String(
      (this.health.damageFlash / settings.health.damageFlashDuration) * 0.45,
    );
    this.distanceValue.textContent = String(Math.floor(this.worldStats?.distance ?? 0));
    this.checkpointValue.textContent = String(this.worldStats?.checkpoint ?? 1);
    const timer = this.checkpointTimer;
    this.timerPanel.hidden = !timer?.enabled;
    if (timer?.enabled) {
      this.timerValue.textContent = (Math.ceil(timer.remaining * 100) / 100).toFixed(2);
      this.timerPanel.classList.toggle('timer-warning', timer.remaining <= 3);
      const message = timer.expired ? 'Время вышло!' : '';
      if (this.timerMessage.textContent !== message) {
        this.timerMessage.textContent = message;
      }
    }
  }
  dispose(): void {
    this.abort.abort();
    this.root.remove();
  }
}
