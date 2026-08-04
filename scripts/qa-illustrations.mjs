import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}

function png(seed, width = 640, height = 360) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 3;
      const wave = Math.sin((x + seed * 31) / 38) * 28 + Math.cos((y + seed * 19) / 24) * 20;
      row[offset] = Math.max(0, Math.min(255, 35 + seed * 17 + wave));
      row[offset + 1] = Math.max(0, Math.min(255, 115 + y / 4 + wave));
      row[offset + 2] = Math.max(0, Math.min(255, 205 + x / 14 - wave));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

export async function createQaIllustrations(directory, creatureIds) {
  const make = async (assetId, role, creatureId, seed) => {
    const data = png(seed);
    const absolutePath = path.join(directory, `${assetId}.png`);
    await writeFile(absolutePath, data);
    return {
      assetId, role, creatureId, approvalStatus: "approved", relativePath: path.basename(absolutePath), absolutePath,
      mimeType: "image/png", width: 640, height: 360, bytes: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
      altText: role === "cover" ? "A colorful scene introducing the creatures." : `${creatureId} in a colorful habitat.`,
      source: "user_supplied", provenance: { importedAt: "2026-08-04T00:00:00.000Z", createdBy: "Visual QA fixture" },
      license: { name: "Test fixture only" }, approvedAt: "2026-08-04T00:00:00.000Z", approvedBy: "Visual QA fixture"
    };
  };
  const cover = await make("cover", "cover", undefined, 1);
  const creatures = new Map();
  for (const [index, creatureId] of creatureIds.entries()) creatures.set(creatureId, await make(`creature-${creatureId}`, "creature", creatureId, index + 2));
  return { cover, creatures };
}
