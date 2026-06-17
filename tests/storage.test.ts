import sharp from "sharp";
import { MongoStorageProvider } from "../src/utils/storage";
import { ImageAsset } from "../src/models/ImageAsset";

/** A minimal multer-like file carrying an in-memory buffer. */
function fakeFile(buffer: Buffer): Express.Multer.File {
  return {
    buffer,
    originalname: "x.png",
    mimetype: "image/png",
    fieldname: "file",
    encoding: "7bit",
    size: buffer.length,
  } as unknown as Express.Multer.File;
}

function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 10, g: 120, b: 80 } } })
    .png()
    .toBuffer();
}

/** Coerce a Buffer or a lean BSON Binary to a Node Buffer. */
function toBuf(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  const inner = (v as { buffer?: unknown }).buffer;
  return Buffer.isBuffer(inner) ? inner : Buffer.from(v as ArrayBuffer);
}

function isWebp(v: unknown): boolean {
  const b = toBuf(v);
  return b.length > 12 && b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP";
}

describe("MongoStorageProvider (webp in MongoDB)", () => {
  const provider = new MongoStorageProvider();

  it("save() re-encodes to webp, stores BinData + a thumbnail, and serves both", async () => {
    const png = await samplePng();
    const { path: key } = await provider.save(fakeFile(png), { ownerType: "user", kind: "profile" });

    const doc = await ImageAsset.findById(key).lean();
    expect(doc?.mime).toBe("image/webp");
    expect(doc?.isPrivate).toBe(false);
    expect(doc?.kind).toBe("profile");
    expect(isWebp(doc!.data as unknown as Buffer)).toBe(true);

    const img = await provider.getImage(key);
    expect(img?.mime).toBe("image/webp");
    expect(isWebp(img!.data)).toBe(true);
    // webp is far smaller than the source png — important for the Atlas quota.
    expect(img!.data.length).toBeLessThan(png.length);

    const thumb = await provider.getThumbnail(key);
    expect(isWebp(thumb!.data)).toBe(true);
    expect(thumb!.data.length).toBeLessThanOrEqual(img!.data.length);
  });

  it("getUrl() returns a stable /images/:id URL", async () => {
    const { path: key } = await provider.save(fakeFile(await samplePng()));
    expect(provider.getUrl(key)).toContain(`/images/${key}`);
  });

  it("private images are NOT servable via the public route; getPrivateImage works", async () => {
    const { path: key } = await provider.savePrivate(fakeFile(await samplePng()), { kind: "national_card" });
    const doc = await ImageAsset.findById(key).lean();
    expect(doc?.isPrivate).toBe(true);

    expect(await provider.getImage(key)).toBeNull(); // never public
    const priv = await provider.getPrivateImage(key);
    expect(isWebp(priv!.data)).toBe(true);
  });

  it("delete() removes the asset", async () => {
    const { path: key } = await provider.save(fakeFile(await samplePng()));
    await provider.delete(key);
    expect(await provider.getImage(key)).toBeNull();
    expect(await ImageAsset.findById(key)).toBeNull();
  });

  it("getImage(invalid id) → null, never throws", async () => {
    expect(await provider.getImage("not-a-valid-objectid")).toBeNull();
  });
});
