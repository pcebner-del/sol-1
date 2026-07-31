import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * HTML labels pinned to 3D positions. Kept as DOM (rather than sprites) so the
 * type stays crisp at any zoom and can carry real interaction.
 */
export class LabelLayer {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'label-layer';
    container.appendChild(this.root);
    this.items = [];
  }

  add({ id, title, sub, className = '', anchor, onClick, onHover }) {
    const el = document.createElement('div');
    el.className = `label ${className}`;
    el.innerHTML = `
      <span class="label-tick"></span>
      <span class="label-body">
        <span class="label-title">${title}</span>
        ${sub ? `<span class="label-sub">${sub}</span>` : ''}
      </span>`;
    if (onClick) {
      el.classList.add('is-clickable');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(id);
      });
    }
    if (onHover) {
      el.addEventListener('pointerenter', () => onHover(id, true));
      el.addEventListener('pointerleave', () => onHover(id, false));
    }
    this.root.appendChild(el);

    const item = { id, el, anchor, opacity: 0, target: 0, visible: true, offset: [0, 0] };
    this.items.push(item);
    return item;
  }




  update(dt, camera, w, h, insets = { top: 46, bottom: 40 }) {
    const placed = this.project(dt, camera, w, h, insets);
    deCollide(placed, h, insets);
    apply(placed);
  }

  /**
   * Project this layer's items to screen space without committing the result,
   * so several layers can be de-collided against each other as one set.
   */
  project(dt, camera, w, h, insets = { top: 46, bottom: 40 }) {
    const placed = [];

    for (const it of this.items) {
      it.opacity += (it.target - it.opacity) * Math.min(1, dt * 5.5);

      if (it.opacity < 0.01) {
        if (it.el.style.display !== 'none') it.el.style.display = 'none';
        continue;
      }
      if (it.el.style.display === 'none') it.el.style.display = '';

      it.anchor(_v);
      _v.project(camera);

      if (_v.z > 1) {
        it.el.style.opacity = '0';
        it.el.style.pointerEvents = 'none';
        continue;
      }

      let x = (_v.x * 0.5 + 0.5) * w + it.offset[0];
      let y = (-_v.y * 0.5 + 0.5) * h + it.offset[1];

      // Measure once the label is actually laid out, then keep it on screen —
      // near the right edge it flips so the text runs back toward the anchor.
      if (!it.width) it.width = it.el.offsetWidth || 0;
      const flip = it.width > 0 && x + it.width + 18 > w;
      if (flip !== it.flipped) {
        it.flipped = flip;
        it.el.classList.toggle('is-flipped', flip);
      }
      if (flip) x -= it.width;
      x = Math.max(10, Math.min(x, w - 10 - (it.width || 0)));
      y = Math.max(insets.top, Math.min(y, h - insets.bottom));

      it._x = x;
      it._y = y;
      placed.push(it);
    }

    return placed;
  }
}

/**
 * Lay out several layers as one set.
 *
 * Each layer used to de-collide only against itself, so labels from different
 * layers could land squarely on top of each other — they were simply invisible
 * to one another. Everything competing for the same screen has to be resolved
 * together.
 */
export function updateLabelLayers(layers, dt, camera, w, h, insets) {
  const placed = [];
  for (const layer of layers) {
    for (const it of layer.project(dt, camera, w, h, insets)) placed.push(it);
  }
  deCollide(placed, h, insets);
  apply(placed);
}

function apply(placed) {
  for (const it of placed) {
    it.el.style.transform = `translate3d(${it._x.toFixed(1)}px, ${it._y.toFixed(1)}px, 0)`;
    it.el.style.opacity = it.opacity.toFixed(3);
    it.el.style.pointerEvents = it.opacity > 0.55 ? 'auto' : 'none';
  }
}

/**
 * Nudge labels apart vertically when their boxes would overlap. The leader
 * still points at the true anchor, so a small offset reads as intent.
 */
function deCollide(items, h, insets) {
  if (items.length < 2) return;
  const GAP = 34;
  items.sort((a, b) => a._y - b._y);

  for (let i = 1; i < items.length; i++) {
    const cur = items[i];
    const bL = cur._x;
    const bR = cur._x + (cur.width || 120);

    // Against every label already placed, not just the one directly above.
    // Horizontal overlap isn't transitive: A and B can miss each other while
    // both hit C, and a neighbour-only sweep never sees that — which is how
    // labels ended up stacked on a narrow screen, where far more of them
    // share a column.
    for (let j = 0; j < i; j++) {
      const prev = items[j];
      const aL = prev._x;
      const aR = prev._x + (prev.width || 120);
      if (bL > aR || bR < aL) continue;
      if (cur._y - prev._y < GAP) cur._y = prev._y + GAP;
    }
  }

  // If pushing down ran us off the bottom, shift the whole stack back up.
  const last = items[items.length - 1];
  const overflow = last._y - (h - insets.bottom);
  if (overflow > 0) for (const it of items) it._y -= overflow;
}
