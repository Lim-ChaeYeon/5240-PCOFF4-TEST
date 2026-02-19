/**
 * assets/tray-icon.png 생성 (16x16 템플릿 아이콘, 맥 메뉴 막대용)
 * Node 내장 zlib/fs만 사용. 빌드 전 또는 수동 실행: node scripts/create-tray-icon.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPath = join(root, "assets", "tray-icon.png");

function writeU32BE(buf, offset, value) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function makeChunk(type, data) {
  const typeAndData = Buffer.alloc(4 + (data?.length ?? 0));
  typeAndData.write(type, 0, 4, "ascii");
  if (data && data.length) data.copy(typeAndData, 4);
  const len = Buffer.alloc(4);
  writeU32BE(len, 0, data?.length ?? 0);
  const c = Buffer.alloc(4);
  writeU32BE(c, 0, crc32(typeAndData) >>> 0);
  return Buffer.concat([len, typeAndData, c]);
}

const W = 16;
const H = 16;
// PNG raw: each row = 1 filter byte (0) + W bytes (0 = black for template)
const raw = Buffer.alloc((1 + W) * H);
// filter 0, pixel 0 (black) — template용
const compressed = deflateRawSync(raw, { level: 9 });

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdrData = Buffer.alloc(13);
writeU32BE(ihdrData, 0, W);
writeU32BE(ihdrData, 4, H);
ihdrData[8] = 8;   // bit depth
ihdrData[9] = 0;   // color type: grayscale
ihdrData[10] = 0;  // compression
ihdrData[11] = 0;  // filter
ihdrData[12] = 0;  // interlace

const ihdr = makeChunk("IHDR", ihdrData);
const idat = makeChunk("IDAT", compressed);
const iend = makeChunk("IEND", null);

mkdirSync(join(root, "assets"), { recursive: true });
writeFileSync(outPath, Buffer.concat([signature, ihdr, idat, iend]));
console.log("[create-tray-icon] wrote", outPath);
