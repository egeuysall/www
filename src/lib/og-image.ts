import sharp from "sharp";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const FRAME_INSET = 24;
const FRAME_BORDER_WIDTH = 2;
const FRAME_PADDING = 32;
const FRAME_RADIUS = 4;
const IMAGE_RADIUS = 4;
const ZOOM_SCALE = 1.5;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

function isSafeRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function getLayout() {
  const frameX = FRAME_INSET;
  const frameY = FRAME_INSET;
  const frameWidth = OG_WIDTH - FRAME_INSET * 2;
  const frameHeight = OG_HEIGHT - FRAME_INSET * 2;

  const viewportX = frameX + FRAME_BORDER_WIDTH + FRAME_PADDING;
  const viewportY = frameY + FRAME_BORDER_WIDTH + FRAME_PADDING;
  const viewportWidth = frameWidth - (FRAME_BORDER_WIDTH + FRAME_PADDING) * 2;
  const viewportHeight = frameHeight - (FRAME_BORDER_WIDTH + FRAME_PADDING) * 2;

  return {
    frameX,
    frameY,
    frameWidth,
    frameHeight,
    viewportX,
    viewportY,
    viewportWidth,
    viewportHeight,
  };
}

function borderOverlaySvg(): Buffer {
  const { frameX, frameY, frameWidth, frameHeight } = getLayout();

  const svg = `
    <svg width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#F5EAD6" />
      <rect
        x="${frameX}"
        y="${frameY}"
        width="${frameWidth}"
        height="${frameHeight}"
        rx="${FRAME_RADIUS}"
        ry="${FRAME_RADIUS}"
        fill="none"
        stroke="#404040"
        stroke-width="${FRAME_BORDER_WIDTH}"
      />
    </svg>
  `;

  return Buffer.from(svg);
}

function roundedMaskSvg(width: number, height: number, radius: number): Buffer {
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white" />
    </svg>
  `;

  return Buffer.from(svg);
}

function placeholderSvg(): Buffer {
  const svg = `
    <svg width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#F5EAD6" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#525252" font-size="42" font-family="ui-monospace, Menlo, Monaco, 'Courier New', monospace">
        egeuysal.com
      </text>
    </svg>
  `;

  return Buffer.from(svg);
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (!isSafeRemoteUrl(url)) {
    throw new Error("Unsupported OG source image URL.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error("OG source is not an image.");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES) {
      throw new Error("OG source image is too large.");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("OG source image is too large.");
    }

    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function buildCreamStyleOgImage(sourceBuffer: Buffer): Promise<Buffer> {
  const { viewportX, viewportY, viewportWidth, viewportHeight } = getLayout();
  const scaledWidth = Math.ceil(viewportWidth * ZOOM_SCALE);
  const scaledHeight = Math.ceil(viewportHeight * ZOOM_SCALE);

  const covered = await sharp(sourceBuffer)
    .resize(scaledWidth, scaledHeight, {
      fit: "cover",
      position: "northwest",
    })
    .toBuffer();

  const cropped = await sharp(covered)
    .extract({
      left: 0,
      top: 0,
      width: viewportWidth,
      height: viewportHeight,
    })
    .ensureAlpha()
    .composite([
      {
        input: roundedMaskSvg(viewportWidth, viewportHeight, IMAGE_RADIUS),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 4,
      background: "#F5EAD6",
    },
  })
    .composite([
      { input: cropped, left: viewportX, top: viewportY },
      { input: borderOverlaySvg(), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

export async function buildCreamCardOgImage(sourceUrl: string): Promise<Buffer> {
  try {
    const sourceBuffer = await fetchImageBuffer(sourceUrl);
    return await buildCreamStyleOgImage(sourceBuffer);
  } catch {
    return sharp(placeholderSvg()).png().toBuffer();
  }
}
