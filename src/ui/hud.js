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

      <div class="sheet-scrim" data-el="scrim"></div>


      <section class="panel panel-telemetry">
        <div class="panel-head"><span>STELLAR TELEMETRY</span><em>SDO/HMI</em>
          <button class="sheet-close" data-sheet-close aria-label="Close">&times;</button>
        </div>
        <ul class="readouts" data-el="readouts"></ul>
      </section>

      <aside class="panel panel-modes">
        <div class="panel-head"><span>VIEW MODE</span>
          <button class="sheet-close" data-sheet-close aria-label="Close">&times;</button>
        </div>
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

      <div class="log" data-el="log"></div>

      <!--
        Dock, flare row and info card share a wrapper so the phone layout can
        stack them instead of guessing offsets. It is display:contents
        everywhere else, so every other breakpoint sees exactly the DOM it
        saw before. The card stays last for paint order and is moved to the
        top of the column with the order property on phone.
      -->
      <div class="bottom-stack">
        <nav class="dock" aria-label="Panels">
          <button class="dock-btn" data-sheet="data" aria-expanded="false">
            <span class="dock-ico" aria-hidden="true">&#9670;</span>
            <span class="dock-lbl">DATA</span>
          </button>
          <button class="dock-btn" data-sheet="view" aria-expanded="false">
            <span class="dock-ico" aria-hidden="true">&#9673;</span>
            <span class="dock-lbl">VIEW</span>
          </button>
          <button class="dock-btn dock-reset" data-el="dock-reset" hidden>
            <span class="dock-ico" aria-hidden="true">&#8635;</span>
            <span class="dock-lbl">RESET</span>
          </button>
        </nav>

        <section class="panel panel-flares">
          <div class="panel-head"><span>FLARE INJECTOR</span><em>GOES CLASS</em></div>
          <div class="flare-list" data-el="flares"></div>
        </section>

        <div class="info-card" data-el="card" aria-hidden="true"></div>
      </div>

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

    this.sheet = null;
    this._buildReadouts();
    this._buildModes();
    this._buildFlares();

    // The card is a live control, not a floating caption: hovering it keeps
    // the layer selected, and clicking it pins that layer.
    this.el.card.addEventListener('pointerenter', () => this.h.onCardHover?.(true));
    this.el.card.addEventListener('pointerleave', () => this.h.onCardHover?.(false));
    this.el.card.addEventListener('click', () => this.h.onCardClick?.());

    this.el.audio.addEventListener('click', () => this.h.onAudio?.());

    // Phone dock: the two big panels collapse to chips and open as sheets.
    for (const b of this.root.querySelectorAll('.dock-btn[data-sheet]')) {
      b.addEventListener('click', () => this.toggleSheet(b.dataset.sheet));
    }
    // Reset needs to be reachable without opening a sheet first — on a phone
    // the only way back out of a planet was to dig through the view panel.
    this.el['dock-reset'].addEventListener('click', () => {
      this.setSheet(null);
      this.h.onReset?.();
    });
    for (const b of this.root.querySelectorAll('[data-sheet-close]')) {
      b.addEventListener('click', () => this.setSheet(null));
    }
    // Tapping the scrim (anywhere off the sheet) dismisses it.
    this.el.scrim.addEventListener('pointerdown', () => this.setSheet(null));
    // Every one of these is a completed action — get the sheet out of the way
    // so the result is actually visible instead of sitting behind the panel.
    this.el.reset.addEventListener('click', () => {
      this.setSheet(null);
      this.h.onReset?.();
    });
    this.el.eclipse.addEventListener('click', () => {
      this.setSheet(null);
      this.h.onEclipse?.();
    });
    for (const b of this.root.querySelectorAll('.seg-btn')) {
      b.addEventListener('click', () => {
        this.setNavMode(b.dataset.nav);
        this.h.onNavMode?.(b.dataset.nav);
        this.setSheet(null);
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
      b.addEventListener('click', () => {
        // Choosing a view is a completed action — get the sheet out of the way
        // so the transition is actually visible.
        this.setSheet(null);
        this.h.onMode?.(b.dataset.mode);
      });
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
        this.setSheet(null);
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

  /* ------------------------------------------------------------ phone dock */

  /**
   * Which collapsible panel is open, if any. Purely a state attribute — the
   * phone breakpoint decides what that means visually, so larger screens keep
   * showing both panels permanently and are untouched by this.
   */
  setSheet(name) {
    this.sheet = name ?? null;
    this.root.dataset.sheet = this.sheet ?? '';
    for (const b of this.root.querySelectorAll('.dock-btn[data-sheet]')) {
      b.classList.toggle('is-open', b.dataset.sheet === this.sheet);
      b.setAttribute('aria-expanded', String(b.dataset.sheet === this.sheet));
    }
  }

  toggleSheet(name) {
    this.setSheet(this.sheet === name ? null : name);
  }

  setNavMode(navMode) {
    for (const b of this.root.querySelectorAll('.seg-btn')) {
      b.classList.toggle('is-active', b.dataset.nav === navMode);
    }
  }

  /** The reset button only means anything once you've flown to something. */
  setResetVisible(v) {
    this.el.reset.hidden = !v;
    this.el['dock-reset'].hidden = !v;
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
