import type { KanaModifier } from "../domain/kana-composition";
import type { BinaryGlyph } from "./features";

interface Component {
  pixels: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ModifierDetection {
  base: BinaryGlyph;
  modifier: KanaModifier | null;
  confidence: number;
}

function assertValidGlyph(glyph: BinaryGlyph): void {
  if (
    !Number.isInteger(glyph.width) ||
    !Number.isInteger(glyph.height) ||
    glyph.width <= 0 ||
    glyph.height <= 0 ||
    glyph.pixels.length !== glyph.width * glyph.height
  )
    throw new Error("修飾記号を検出する二値画像のサイズが不正です。");
}

function connectedComponents(source: BinaryGlyph): Component[] {
  const visited = new Uint8Array(source.pixels.length);
  const queue = new Int32Array(source.pixels.length);
  const components: Component[] = [];

  for (let start = 0; start < source.pixels.length; start += 1) {
    if (source.pixels[start] === 0 || visited[start] !== 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % source.width;
      const y = Math.floor(index / source.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= source.width || nextY < 0 || nextY >= source.height) continue;
          const next = nextY * source.width + nextX;
          if (source.pixels[next] === 0 || visited[next] !== 0) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    components.push({
      pixels: Array.from(queue.slice(0, tail)),
      area: tail,
      minX,
      minY,
      maxX,
      maxY,
    });
  }
  return components;
}

function boundsOf(components: readonly Component[]): Omit<Component, "pixels" | "area"> | null {
  if (components.length === 0) return null;
  return {
    minX: Math.min(...components.map((component) => component.minX)),
    minY: Math.min(...components.map((component) => component.minY)),
    maxX: Math.max(...components.map((component) => component.maxX)),
    maxY: Math.max(...components.map((component) => component.maxY)),
  };
}

function hasEnclosedBackground(source: BinaryGlyph, component: Component): boolean {
  const width = component.maxX - component.minX + 1;
  const height = component.maxY - component.minY + 1;
  if (width < 4 || height < 4) return false;
  const occupied = new Uint8Array(width * height);
  for (const index of component.pixels) {
    const x = (index % source.width) - component.minX;
    const y = Math.floor(index / source.width) - component.minY;
    occupied[y * width + x] = 1;
  }
  const outside = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);
  let head = 0;
  let tail = 0;
  const enqueue = (x: number, y: number): void => {
    const index = y * width + x;
    if (occupied[index] !== 0 || outside[index] !== 0) return;
    outside[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
  return occupied.some((value, index) => value === 0 && outside[index] === 0);
}

function removeAndCrop(source: BinaryGlyph, removed: Component): BinaryGlyph {
  const pixels = source.pixels.slice();
  for (const index of removed.pixels) pixels[index] = 0;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels[y * source.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX) return source;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cropped = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1)
      cropped[y * width + x] = pixels[(minY + y) * source.width + minX + x];
  }
  return { width, height, pixels: cropped };
}

export function detectHorizontalModifier(source: BinaryGlyph): ModifierDetection {
  assertValidGlyph(source);
  const components = connectedComponents(source).filter((component) => component.area >= 2);
  if (components.length < 2) return { base: source, modifier: null, confidence: 0 };

  const largestArea = Math.max(...components.map((component) => component.area));
  const maxMarkSide = Math.max(3, Math.round(source.height * 0.55));
  const candidates = components
    .filter((component) => {
      const width = component.maxX - component.minX + 1;
      const height = component.maxY - component.minY + 1;
      return (
        component.area <= Math.max(16, largestArea * 0.85) &&
        width <= maxMarkSide &&
        height <= maxMarkSide
      );
    })
    .map((component) => {
      const others = components.filter((other) => other !== component);
      const baseBounds = boundsOf(others);
      if (!baseBounds) return null;
      const baseWidth = baseBounds.maxX - baseBounds.minX + 1;
      const baseHeight = baseBounds.maxY - baseBounds.minY + 1;
      const centerX = (component.minX + component.maxX) / 2;
      const centerY = (component.minY + component.maxY) / 2;
      const horizontal = (centerX - (baseBounds.maxX - baseWidth * 0.12)) / baseWidth;
      const vertical = (centerY - (baseBounds.maxY - baseHeight * 0.18)) / baseHeight;
      if (horizontal < -0.05 || vertical < -0.2) return null;
      const distance = Math.hypot(horizontal, vertical);
      return { component, distance };
    })
    .filter(
      (candidate): candidate is { component: Component; distance: number } => candidate !== null,
    )
    .sort((left, right) => left.distance - right.distance);

  const match = candidates[0];
  if (!match || match.distance > 1.25) return { base: source, modifier: null, confidence: 0 };
  const hollow = hasEnclosedBackground(source, match.component);
  return {
    base: removeAndCrop(source, match.component),
    modifier: hollow ? "handakuten" : "dakuten",
    confidence: Math.max(0.55, 0.96 - match.distance * 0.35),
  };
}
