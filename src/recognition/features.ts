export interface BinaryGlyph {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface BasicGlyphFeatures {
  foregroundRatio: number;
  aspectRatio: number;
  projectionX: number[];
  projectionY: number[];
  componentCount: number;
  spatialGrid: number[];
}

interface ForegroundBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertValidGlyph(glyph: BinaryGlyph): void {
  if (!Number.isInteger(glyph.width) || !Number.isInteger(glyph.height)) {
    throw new Error("字形サイズは整数で指定してください。");
  }
  if (glyph.width <= 0 || glyph.height <= 0) {
    throw new Error("字形サイズは1以上で指定してください。");
  }
  if (glyph.pixels.length !== glyph.width * glyph.height) {
    throw new Error("字形サイズと画素数が一致しません。");
  }
}

function findForegroundBounds(glyph: BinaryGlyph): ForegroundBounds | null {
  let minX = glyph.width;
  let minY = glyph.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      if (glyph.pixels[y * glyph.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function countSignificantComponents(glyph: BinaryGlyph, foregroundCount: number): number {
  const visited = new Uint8Array(glyph.pixels.length);
  const queue = new Int32Array(glyph.pixels.length);
  const minimumArea = Math.max(2, Math.floor(foregroundCount * 0.015));
  let count = 0;
  for (let start = 0; start < glyph.pixels.length; start += 1) {
    if (glyph.pixels[start] === 0 || visited[start] !== 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % glyph.width;
      const y = Math.floor(index / glyph.width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= glyph.width || nextY < 0 || nextY >= glyph.height) continue;
          const next = nextY * glyph.width + nextX;
          if (glyph.pixels[next] === 0 || visited[next] !== 0) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail >= minimumArea) count += 1;
  }
  return count;
}

export function extractBasicFeatures(glyph: BinaryGlyph): BasicGlyphFeatures {
  assertValidGlyph(glyph);

  const projectionX = Array.from({ length: glyph.width }, () => 0);
  const projectionY = Array.from({ length: glyph.height }, () => 0);
  let foregroundCount = 0;

  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) {
      if (glyph.pixels[y * glyph.width + x] === 0) continue;
      foregroundCount += 1;
      projectionX[x] += 1;
      projectionY[y] += 1;
    }
  }

  const bounds = findForegroundBounds(glyph);
  const gridSize = 4;
  const spatialGrid = Array.from({ length: gridSize * gridSize }, () => 0);
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    const startY = Math.floor((gridY * glyph.height) / gridSize);
    const endY = Math.floor(((gridY + 1) * glyph.height) / gridSize);
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      const startX = Math.floor((gridX * glyph.width) / gridSize);
      const endX = Math.floor(((gridX + 1) * glyph.width) / gridSize);
      let ink = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          if (glyph.pixels[y * glyph.width + x] !== 0) ink += 1;
        }
      }
      const area = Math.max(1, (endX - startX) * (endY - startY));
      spatialGrid[gridY * gridSize + gridX] = ink / area;
    }
  }

  return {
    foregroundRatio: foregroundCount / glyph.pixels.length,
    aspectRatio: bounds ? bounds.width / bounds.height : 0,
    projectionX: projectionX.map((count) => count / glyph.height),
    projectionY: projectionY.map((count) => count / glyph.width),
    componentCount: countSignificantComponents(glyph, foregroundCount),
    spatialGrid,
  };
}
