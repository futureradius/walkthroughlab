import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

/** Room size in metres. North is -Z, east is +X, up is +Y. */
export const ROOM = { width: 10, depth: 8, height: 3 };

const PIXELS_PER_METRE = 128;
const LINE_PIXELS = 4;
const SURFACE = "#ffffff";
const GRID = "#9a9a9a";

function canvas(widthMetres: number, heightMetres: number) {
  const element = document.createElement("canvas");
  element.width = widthMetres * PIXELS_PER_METRE;
  element.height = heightMetres * PIXELS_PER_METRE;
  const context = element.getContext("2d")!;
  context.fillStyle = SURFACE;
  context.fillRect(0, 0, element.width, element.height);
  return { element, context };
}

/** Draw a 1 m grid over the whole canvas, with lines on the outer edges too. */
function drawGrid(
  context: CanvasRenderingContext2D,
  widthMetres: number,
  heightMetres: number,
  colour: string,
) {
  context.fillStyle = colour;
  const half = LINE_PIXELS / 2;
  for (let x = 0; x <= widthMetres; x++) {
    context.fillRect(x * PIXELS_PER_METRE - half, 0, LINE_PIXELS, heightMetres * PIXELS_PER_METRE);
  }
  for (let y = 0; y <= heightMetres; y++) {
    context.fillRect(0, y * PIXELS_PER_METRE - half, widthMetres * PIXELS_PER_METRE, LINE_PIXELS);
  }
}

function texture(element: HTMLCanvasElement, anisotropy: number) {
  const result = new CanvasTexture(element);
  result.colorSpace = SRGBColorSpace;
  result.anisotropy = anisotropy;
  return result;
}

/** One square metre of grid, repeated across the floor and ceiling. */
function tiledSurface(widthMetres: number, depthMetres: number, anisotropy: number) {
  const { element, context } = canvas(1, 1);
  drawGrid(context, 1, 1, GRID);
  const map = texture(element, anisotropy);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.repeat.set(widthMetres, depthMetres);
  return new Mesh(
    new PlaneGeometry(widthMetres, depthMetres),
    new MeshBasicMaterial({ map }),
  );
}

/** A wall with its own grid colour and a compass letter in the middle. */
function wall(widthMetres: number, letter: string, colour: string, anisotropy: number) {
  const { element, context } = canvas(widthMetres, ROOM.height);
  drawGrid(context, widthMetres, ROOM.height, colour);
  context.fillStyle = colour;
  context.font = `bold ${1.4 * PIXELS_PER_METRE}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(letter, element.width / 2, element.height / 2);
  return new Mesh(
    new PlaneGeometry(widthMetres, ROOM.height),
    new MeshBasicMaterial({ map: texture(element, anisotropy) }),
  );
}

/**
 * The empty test room: evenly lit, gridded at 1 m, each wall marked with its
 * compass letter. Materials are unlit so no lights or shadows are needed.
 */
export function buildRoom(anisotropy: number): Group {
  const room = new Group();
  const { width, depth, height } = ROOM;

  const floor = tiledSurface(width, depth, anisotropy);
  floor.rotation.x = -Math.PI / 2;

  const ceiling = tiledSurface(width, depth, anisotropy);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;

  const north = wall(width, "N", "#d64545", anisotropy);
  north.position.set(0, height / 2, -depth / 2);

  const south = wall(width, "S", "#3b6fd6", anisotropy);
  south.position.set(0, height / 2, depth / 2);
  south.rotation.y = Math.PI;

  const east = wall(depth, "E", "#2f9e5b", anisotropy);
  east.position.set(width / 2, height / 2, 0);
  east.rotation.y = -Math.PI / 2;

  const west = wall(depth, "W", "#e08a1e", anisotropy);
  west.position.set(-width / 2, height / 2, 0);
  west.rotation.y = Math.PI / 2;

  room.add(floor, ceiling, north, south, east, west);
  return room;
}
