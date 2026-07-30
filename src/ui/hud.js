import { SUN_FACTS, FLARE_PRESETS } from '../data.js';
import { QUALITY } from '../quality.js';

const fmtNumber = (v, dec = 0) =>
  v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const MODES = [
  { id: 'surface', label: 'SURFACE', hint: 'Photosphere · live plasma' },
  { id: 'section', label: 'CROSS-SECTION', hint: 'Interior structure' },
  { id: 'system', label: 'SYSTEM VIEW', hint: 'Sol + 8 planets' },
];

export class HUD {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.mode = 'surface';
    this._logLines = [];
    this._build();
    this._startTickers();
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud-chrome">
      <div class="corner tl"></div>
      <div class="corner tr"></div>
      <div class="corner bl"></div>
      <div class="corner br"></div>

      <header class="hud-top">
        <div class="brand">
          <div class="brand-mark"><span></span></div>
          <div class="brand-text">
            <div class="brand-title">SOL&#8211;1</div>
            <div class="brand-sub">HELIOPHYSICS OBSERVATORY</div>
          </div>
        </div>
        <div class="top-meta">
          <div class="chip chip-live"><i></i><span>LIVE</span></div>
          <div class="chip" data-el="mode-chip">SURFACE</div>
          <div class="clock" data-el="clock">--:--:--</div>
        </div>
      </header>

      <section class="panel panel-telemetry">
        <div class="panel-head"><span>STELLAR TELEMETRY</span><em>SDO/HMI</em></div>
        <ul class="readouts" data-el="readouts"></ul>
      </section>

      <aside class="panel panel-modes">
        <div class="panel-head"><span>VIEW MODE</span></div>
        <div class="mode-list" data-el="modes"></div>
        <div class="nav-tools" data-el="navtools">
          <div class="seg" role="group" aria-label="Camera control">
            <button class="seg-btn is-active" data-nav="orbit">ORBIT</button>
            <button class="seg-btn" data-nav="pan">MOVE</button>
          </div>
          <button class="reset-btn" data-el="reset" hidden>&#8635; RESET VIEW</button>
          <button class="eclipse-btn" data-el="eclipse" hidden>&#9788; SOLAR ECLIPSE</button>
        </div>
        <button class="audio-toggle" data-el="audio" aria-pressed="false">
          <span class="audio-icon">
            <span class="wave"><i></i><i></i><i></i><i></i><i></i></span>
          </span>
          <span class="audio-text">
            <strong data-el="audio-label">SOUND ON</strong>
            <em>Sonic interpretation</em>
          </span>
        </button>
      </aside>

      <section class="panel panel-flares">
        <div class="panel-head"><span>FLARE INJECTOR</span><em>GOES CLASS</em></div>
        <div class="flare-list" data-el="flares"></div>
      </section>

      <div class="log" data-el="log"></div>

      <div class="info-card" data-el="card" aria-hidden="true"></div>

      <div class="hint" data-el="hint">DRAG TO ORBIT &middot; SCROLL OR PINCH TO ZOOM</div>
      </div>

      <div class="boot" data-el="boot">
        <div class="boot-inner">
          <div class="boot-title">SOL&#8211;1</div>
          <div class="boot-sub">INTERACTIVE HELIOPHYSICS OBSERVATORY</div>
          <div class="boot-rule"></div>
          <p class="boot-copy">
            A real-time model of our star &mdash; its plasma surface, its flares,
            its interior, and the eight worlds it holds.
          </p>
          <button class="boot-btn" data-el="boot-btn">INITIATE OBSERVATION</button>
          <div class="boot-audio">SOUND ON &middot; MUTE ANY TIME FROM THE PANEL</div>
          <div class="boot-note">RENDER TIER &middot; <span data-el="tier">${QUALITY.tier.toUpperCase()}</span></div>
        </div>
      </div>
    `;

    this.el = {};
    for (const node of this.root.querySelectorAll('[data-el]')) {
      this.el[node.dataset.el] = node;
    }

    this._buildReadouts();
    this._buildModes();
    this._buildFlares();

    // The card is a live control, not a floating caption: hovering it keeps
    // the layer selected, and clicking it pins that layer.
    this.el.card.addEventListener('pointerenter', () => this.h.onCardHover?.(true));
    this.el.card.addEventListener('pointerleave', () => this.h.onCardHover?.(false));
    this.el.card.addEventListener('click', () => this.h.onCardClick?.());

    this.el.audio.addEventListener('click', () => this.h.onAudio?.());
    this.el.reset.addEventListener('click', () => this.h.onReset?.());
    this.el.eclipse.addEventListener('click', () => this.h.onEclipse?.());
    for (const b of this.root.querySelectorAll('.seg-btn')) {
      b.addEventListener('click', () => {
        this.setNavMode(b.dataset.nav);
        this.h.onNavMode?.(b.dataset.nav);
      });
    }
    this.el['boot-btn'].addEventListener('click', () => this.dismissBoot());
  }

  _buildReadouts() {
    this.el.readouts.innerHTML = SUN_FACTS.map(
      (f, i) => `
      <li${f.jitter ? ' class="is-live"' : ''}>
        <span class="r-key">${f.key}</span>
        <span class="r-val" data-row="${i}">${f.text ?? fmtNumber(f.base, f.dec)}</span>
        <span class="r-unit">${f.unit}</span>
      </li>`,
    ).join('');
    this._rows = [...this.el.readouts.querySelectorAll('.r-val')];
  }

  _buildModes() {
    this.el.modes.innerHTML = MODES.map(
      (m) => `
      <button class="mode-btn${m.id === 'surface' ? ' is-active' : ''}" data-mode="${m.id}">
        <span class="mode-dot"></span>
        <span class="mode-label">${m.label}</span>
        <span class="mode-hint">${m.hint}</span>
      </button>`,
    ).join('');
    for (const b of this.el.modes.querySelectorAll('.mode-btn')) {
      b.addEventListener('click', () => this.h.onMode?.(b.dataset.mode));
    }
  }

  _buildFlares() {
    this.el.flares.innerHTML = Object.entries(FLARE_PRESETS)
      .map(
        ([id, f]) => `
        <button class="flare-btn flare-${id}" data-flare="${id}">
          <span class="flare-class">${f.label}</span>
          <span class="flare-sub">${f.sub}</span>
          <span class="flare-bar"><i></i></span>
        </button>`,
      )
      .join('');
    for (const b of this.el.flares.querySelectorAll('.flare-btn')) {
      b.addEventListener('click', () => {
        b.classList.remove('is-firing');
        void b.offsetWidth; // restart the CSS animation
        b.classList.add('is-firing');
        this.h.onFlare?.(b.dataset.flare);
      });
    }
  }

  /* --------------------------------------------------------------- tickers */

  _startTickers() {
    this._telemetryTimer = setInterval(() => {
      SUN_FACTS.forEach((f, i) => {
        if (!f.jitter) return;
        const v = f.base + (Math.random() - 0.5) * 2 * f.jitter;
        this._rows[i].textContent = fmtNumber(v, f.dec);
      });
    }, 900);

    const tick = () => {
      const d = new Date();
      this.el.clock.textContent = d.toISOString().slice(11, 19) + ' UTC';
    };
    tick();
    this._clockTimer = setInterval(tick, 1000);
  }

  /* ----------------------------------------------------------------- state */

  setMode(mode) {
    this.mode = mode;
    for (const b of this.el.modes.querySelectorAll('.mode-btn')) {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    }
    const m = MODES.find((x) => x.id === mode);
    this.el['mode-chip'].textContent = m ? m.label : mode.toUpperCase();
    this.root.dataset.mode = mode;

    this.el.hint.textContent =
      mode === 'system'
        ? 'CLICK A PLANET TO TRACK · DRAG TO ORBIT'
        : mode === 'section'
          ? 'HOVER OR TAP A LAYER FOR DETAIL'
          : 'DRAG TO ORBIT · SCROLL OR PINCH TO ZOOM';
  }

  setNavMode(navMode) {
    for (const b of this.root.querySelectorAll('.seg-btn')) {
      b.classList.toggle('is-active', b.dataset.nav === navMode);
    }
  }

  /** The reset button only means anything once you've flown to something. */
  setResetVisible(v) {
    this.el.reset.hidden = !v;
  }

  setEclipseVisible(v) {
    this.el.eclipse.hidden = !v;
  }

  setEclipseActive(v) {
    this.el.eclipse.classList.toggle('is-active', v);
    this.el.eclipse.innerHTML = v ? '&#9788; END ECLIPSE' : '&#9788; SOLAR ECLIPSE';
  }

  setAudio(on) {
    this.el.audio.classList.toggle('is-on', on);
    this.el.audio.setAttribute('aria-pressed', String(on));
    this.el['audio-label'].textContent = on ? 'SOUND ON' : 'SOUND OFF';
  }

  /** Info card for interior layers, planets and the eclipse. */
  showCard({ name, desc, stats = [], accent = '#ffb648' }) {
    this.el.card.style.setProperty('--card-accent', accent);
    this.el.card.innerHTML = `
      <div class="card-head">
        <span class="card-name">${name}</span>
        <button class="card-close" aria-label="Close">&times;</button>
      </div>
      <p class="card-desc">${desc}</p>
      <dl class="card-stats">
        ${stats.map((s) => `<div><dt>${s[0]}</dt><dd>${s[1]}</dd></div>`).join('')}
      </dl>`;
    this.el.card.classList.add('is-open');
    this.el.card.setAttribute('aria-hidden', 'false');
    this.el.card.querySelector('.card-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideCard();
      this.h.onCardClose?.();
    });
  }

  hideCard() {
    this.el.card.classList.remove('is-open');
    this.el.card.setAttribute('aria-hidden', 'true');
  }

  log(text, kind = '') {
    const time = new Date().toISOString().slice(11, 19);
    this._logLines.unshift(`<span class="log-t">${time}</span> <span class="log-m ${kind}">${text}</span>`);
    this._logLines = this._logLines.slice(0, 4);
    this.el.log.innerHTML = this._logLines
      .map((l, i) => `<div style="opacity:${1 - i * 0.26}">${l}</div>`)
      .join('');
  }

  dismissBoot() {
    if (this._booted) return;
    this._booted = true;
    this.el.boot.classList.add('is-gone');
    this.root.classList.add('is-live');
    setTimeout(() => this.el.boot.remove(), 1400);
    this.h.onBoot?.();
  }
}
