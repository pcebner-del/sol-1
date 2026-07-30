import * as THREE from 'three';

/**
 * Earth's landmasses as coarse lat/lon outlines, rasterised to an
 * equirectangular land mask at load.
 *
 * These are hand-simplified coastlines — enough vertices that Africa reads as
 * Africa and the Americas as the Americas, but nowhere near survey accuracy.
 * Doing it this way keeps the project dependency-free and offline: no texture
 * download, no CORS, no binary asset in the repo.
 *
 * Coordinates are [longitude, latitude] in degrees.
 */
const LANDMASSES = [
  // --- Africa
  [
    [-17, 14], [-16, 20], [-13, 27], [-9, 30], [-6, 36], [1, 37], [10, 37], [19, 31],
    [25, 32], [32, 31], [35, 28], [37, 22], [39, 15], [43, 12], [51, 12], [48, 5],
    [42, -1], [40, -10], [35, -20], [33, -26], [28, -33], [20, -35], [16, -29],
    [12, -18], [9, -6], [9, -1], [9, 4], [3, 6], [-4, 5], [-8, 4], [-13, 8], [-17, 14],
  ],
  // --- Eurasia
  [
    [-10, 43], [-9, 37], [-6, 36], [-1, 36], [3, 42], [5, 43], [12, 44], [16, 41],
    [19, 40], [24, 40], [27, 40], [30, 41], [36, 36], [36, 33], [35, 29], [39, 21],
    [43, 13], [48, 13], [52, 17], [57, 22], [56, 26], [60, 25], [66, 25], [69, 22],
    [73, 16], [77, 8], [80, 13], [82, 17], [87, 21], [90, 22], [93, 20], [97, 16],
    [99, 10], [104, 1], [106, 10], [109, 12], [108, 19], [113, 22], [118, 24],
    [121, 31], [122, 37], [126, 40], [130, 43], [135, 44], [140, 46], [143, 53],
    [141, 59], [150, 59], [160, 61], [170, 66], [180, 66], [180, 71], [160, 70],
    [140, 73], [128, 73], [110, 76], [100, 77], [80, 73], [70, 73], [60, 71],
    [50, 69], [40, 68], [32, 70], [28, 71], [20, 70], [15, 68], [10, 63], [5, 62],
    [8, 58], [4, 53], [0, 51], [-2, 51], [-5, 48], [-2, 47], [-1, 46], [-2, 43], [-10, 43],
  ],
  // --- North America
  [
    [-168, 65], [-165, 60], [-155, 58], [-150, 60], [-140, 60], [-130, 54], [-125, 48],
    [-124, 40], [-120, 34], [-117, 32], [-110, 24], [-105, 20], [-97, 16], [-94, 18],
    [-91, 19], [-90, 25], [-88, 30], [-84, 30], [-81, 25], [-80, 27], [-76, 35],
    [-70, 42], [-66, 45], [-60, 47], [-55, 52], [-64, 60], [-78, 62], [-80, 70],
    [-90, 70], [-95, 68], [-110, 68], [-125, 70], [-140, 70], [-155, 71], [-165, 68], [-168, 65],
  ],
  // --- South America
  [
    [-81, 6], [-77, 8], [-72, 11], [-62, 10], [-52, 5], [-50, 0], [-44, -2], [-38, -5],
    [-35, -8], [-39, -15], [-42, -23], [-48, -25], [-53, -34], [-57, -38], [-62, -40],
    [-65, -45], [-68, -52], [-75, -52], [-73, -45], [-71, -35], [-70, -20], [-75, -14],
    [-81, -6], [-80, 0], [-78, 2], [-81, 6],
  ],
  // --- Australia
  [
    [113, -22], [114, -34], [118, -35], [129, -32], [135, -35], [138, -35], [141, -38],
    [147, -38], [150, -37], [153, -28], [153, -25], [146, -19], [142, -11], [136, -12],
    [130, -12], [127, -14], [122, -17], [113, -22],
  ],
  // --- Greenland
  [[-45, 60], [-50, 65], [-55, 70], [-58, 75], [-50, 80], [-30, 83], [-20, 78], [-22, 70], [-30, 65], [-45, 60]],
  // --- Antarctica (a ring; the shader also ices anything this far south)
  [[-180, -63], [-120, -73], [-60, -78], [0, -70], [60, -68], [120, -66], [180, -63], [180, -90], [-180, -90]],
  // --- Madagascar
  [[43, -12], [50, -15], [50, -25], [45, -25], [43, -12]],
  // --- Japan
  [[130, 31], [135, 34], [140, 36], [142, 40], [141, 45], [138, 37], [133, 34], [130, 31]],
  // --- British Isles
  [[-10, 51], [-6, 55], [-3, 58], [-2, 55], [0, 52], [-5, 50], [-10, 51]],
  // --- New Zealand
  [[166, -46], [174, -41], [178, -38], [173, -35], [170, -43], [166, -46]],
  // --- Indonesia / New Guinea
  [
    [95, 5], [100, 2], [105, -6], [115, -8], [120, -9], [126, -9], [131, -8], [141, -9],
    [150, -10], [147, -6], [140, -3], [132, -1], [125, 1], [117, 4], [110, 2], [102, 3], [95, 5],
  ],
  // --- Sri Lanka, Borneo fill, Philippines, Caribbean
  [[80, 9], [82, 7], [81, 6], [80, 9]],
  [[120, 18], [124, 13], [126, 8], [122, 7], [120, 12], [120, 18]],
  [[-78, 22], [-74, 20], [-77, 20], [-84, 22], [-78, 22]],
];

const W = 2048;
const H = 1024;

const lonToX = (lon) => ((lon + 180) / 360) * W;
const latToY = (lat) => ((90 - lat) / 180) * H;

/**
 * Rasterise the outlines into a texture.
 *
 * Red channel = land mask, green channel = a cheap distance-from-coast proxy
 * built by stroking the outline repeatedly, which the shader uses to place
 * continental shelves and to keep mountains inland.
 */
export function buildEarthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  const drawPath = (poly, wrapOffset = 0) => {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => {
      const x = lonToX(lon) + wrapOffset;
      const y = latToY(lat);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  // Land mask into red. Draw each landmass three times, offset by ±360°, so
  // shapes that straddle the antimeridian survive the wrap.
  ctx.fillStyle = '#ff0000';
  for (const poly of LANDMASSES) {
    for (const off of [-W, 0, W]) {
      drawPath(poly, off);
      ctx.fill();
    }
  }

  // Coast proximity into green: successively thinner strokes inside the
  // coastline build a crude inland gradient.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = 'rgba(0, 52, 0, 1)';
    ctx.lineWidth = 46 - i * 9;
    ctx.lineJoin = 'round';
    for (const poly of LANDMASSES) {
      for (const off of [-W, 0, W]) {
        drawPath(poly, off);
        ctx.stroke();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // this is data, not colour
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // No mipmaps: the equirect seam would otherwise pick the wrong LOD and
  // draw a visible line down the antimeridian.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
