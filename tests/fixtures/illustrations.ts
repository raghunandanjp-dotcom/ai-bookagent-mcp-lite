import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type { IllustrationAsset } from "../../src/domain.ts";
import type { ApprovedIllustrationSet, ResolvedIllustrationAsset } from "../../src/illustrations.ts";

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}

function fixturePng(seed: number, width = 640, height = 360): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 3;
      const wave = Math.sin((x + seed * 13) / 25) * 24 + Math.cos((y + seed * 7) / 18) * 18;
      row[offset] = Math.max(0, Math.min(255, 40 + seed * 23 + wave));
      row[offset + 1] = Math.max(0, Math.min(255, 130 + y / 3 + wave));
      row[offset + 2] = Math.max(0, Math.min(255, 190 + x / 8 - wave));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export async function fixtureIllustrations(directory: string, creatureIds: string[]): Promise<{ set: ApprovedIllustrationSet; assets: IllustrationAsset[] }> {
  const createdAt = "2026-08-04T00:00:00.000Z";
  const create = async (assetId: string, role: "cover" | "creature", creatureId: string | undefined, seed: number): Promise<ResolvedIllustrationAsset> => {
    const data = fixturePng(seed);
    const absolutePath = path.join(directory, `${assetId}.png`);
    await writeFile(absolutePath, data);
    const sha256 = createHash("sha256").update(data).digest("hex");
    return {
      assetId,
      role,
      creatureId,
      approvalStatus: "approved",
      relativePath: path.basename(absolutePath),
      absolutePath,
      mimeType: "image/png",
      width: 640,
      height: 360,
      bytes: data.byteLength,
      sha256,
      altText: role === "cover" ? "A colorful scene introducing the creatures." : `${creatureId} in a colorful habitat.`,
      source: "user_supplied",
      provenance: { importedAt: createdAt, createdBy: "Automated fixture" },
      license: { name: "Test fixture only" },
      approvedAt: createdAt,
      approvedBy: "Automated fixture"
    };
  };
  const cover = await create("cover", "cover", undefined, 1);
  const creatures = new Map<string, ResolvedIllustrationAsset>();
  for (const [index, creatureId] of creatureIds.entries()) creatures.set(creatureId, await create(`creature-${creatureId}`, "creature", creatureId, index + 2));
  return { set: { cover, creatures }, assets: [cover, ...creatures.values()].map(({ absolutePath: _absolutePath, ...asset }) => asset) };
}
