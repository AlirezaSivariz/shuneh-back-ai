import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { config } from '../config/env';
import { ImageAsset, ImageKind } from '../models/ImageAsset';

/**
 * Storage abstraction so the disk implementation can be swapped for MongoDB
 * (current test-phase default) or, later, object storage (S3/MinIO) by adding a
 * provider — without touching controllers/services. Selected via STORAGE_DRIVER.
 */
export interface StoredFile {
  /** Opaque key the caller persists; meaningless outside the provider. */
  path: string;
}

export interface StoredImage {
  data: Buffer;
  mime: string;
}

export interface SaveMeta {
  ownerType?: string;
  ownerId?: string;
  kind?: ImageKind;
}

export interface StorageProvider {
  /** Persist a PUBLIC image and return its key. */
  save(file: Express.Multer.File, meta?: SaveMeta): Promise<StoredFile>;
  /** Persist a PRIVATE image (e.g. ID documents) and return its key. */
  savePrivate(file: Express.Multer.File, meta?: SaveMeta): Promise<StoredFile>;
  /** Public, stable URL for a key (independent of where the bytes actually live). */
  getUrl(storedPath: string): string;
  /** Best-effort delete of a stored image. */
  delete(storedPath: string): Promise<void>;
  /** Read a PUBLIC image (for the /images/:id route). null if missing/private. */
  getImage(key: string): Promise<StoredImage | null>;
  /** Read a PUBLIC image's thumbnail. Falls back to the full image. */
  getThumbnail(key: string): Promise<StoredImage | null>;
  /** Read a PRIVATE image (for auth-gated streaming). null if missing/public. */
  getPrivateImage(key: string): Promise<StoredImage | null>;
}

function mimeFromExt(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

// ───────────────────────────── Local (disk) ─────────────────────────────
export class LocalStorageProvider implements StorageProvider {
  async save(file: Express.Multer.File): Promise<StoredFile> {
    const relative = path
      .relative(path.resolve(config.uploadDir), file.path)
      .split(path.sep)
      .join('/');
    return { path: relative };
  }

  async savePrivate(file: Express.Multer.File): Promise<StoredFile> {
    const relative = path
      .relative(path.resolve(config.privateUploadDir), file.path)
      .split(path.sep)
      .join('/');
    return { path: relative };
  }

  getUrl(storedPath: string): string {
    const normalized = storedPath.split(path.sep).join('/');
    return `${config.baseUrl}/uploads/${normalized}`;
  }

  async delete(storedPath: string): Promise<void> {
    const resolved = this.safeResolve(config.uploadDir, storedPath);
    if (resolved) await fs.promises.rm(resolved, { force: true }).catch(() => undefined);
  }

  async getImage(key: string): Promise<StoredImage | null> {
    return this.readFrom(config.uploadDir, key);
  }

  async getThumbnail(key: string): Promise<StoredImage | null> {
    // Disk storage keeps no separate thumbnail — serve the full image.
    return this.readFrom(config.uploadDir, key);
  }

  async getPrivateImage(key: string): Promise<StoredImage | null> {
    return this.readFrom(config.privateUploadDir, key);
  }

  private safeResolve(root: string, key: string): string | null {
    const base = path.resolve(root);
    const resolved = path.resolve(base, key);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    return resolved;
  }

  private async readFrom(root: string, key: string): Promise<StoredImage | null> {
    const resolved = this.safeResolve(root, key);
    if (!resolved) return null;
    const data = await fs.promises.readFile(resolved).catch(() => null);
    return data ? { data, mime: mimeFromExt(key) } : null;
  }
}

// ───────────────────── Mongo (BinData, webp via sharp) ─────────────────────
const MAX_LONG_EDGE = 1600; // cap the long side of the stored image
const THUMB_EDGE = 400; // thumbnail long side

/** Coerce a value read from Mongo (lean Binary or Buffer) to a Node Buffer. */
function asBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  const inner = (value as { buffer?: unknown }).buffer;
  return Buffer.isBuffer(inner) ? inner : null;
}

export class MongoStorageProvider implements StorageProvider {
  private async store(
    file: Express.Multer.File,
    isPrivate: boolean,
    meta?: SaveMeta,
  ): Promise<StoredFile> {
    if (!file.buffer) {
      throw new Error('MongoStorageProvider requires in-memory uploads (multer memoryStorage)');
    }

    // Re-encode to webp, downscaling the long edge. EXIF rotation is applied.
    const main = await sharp(file.buffer)
      .rotate()
      .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const thumbnailData = await sharp(file.buffer)
      .rotate()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();

    const doc = await ImageAsset.create({
      ownerType: meta?.ownerType,
      ownerId: meta?.ownerId && Types.ObjectId.isValid(meta.ownerId)
        ? new Types.ObjectId(meta.ownerId)
        : undefined,
      kind: meta?.kind,
      mime: 'image/webp',
      width: main.info.width,
      height: main.info.height,
      sizeBytes: main.data.length,
      data: main.data,
      thumbnailData,
      isPrivate,
    });
    return { path: String(doc._id) };
  }

  save(file: Express.Multer.File, meta?: SaveMeta): Promise<StoredFile> {
    return this.store(file, false, meta);
  }

  savePrivate(file: Express.Multer.File, meta?: SaveMeta): Promise<StoredFile> {
    return this.store(file, true, { ...meta, kind: meta?.kind ?? 'national_card' });
  }

  getUrl(storedPath: string): string {
    // Stable logical URL — independent of the underlying store.
    return `${config.baseUrl}/images/${storedPath}`;
  }

  async delete(storedPath: string): Promise<void> {
    if (Types.ObjectId.isValid(storedPath)) {
      await ImageAsset.deleteOne({ _id: storedPath }).catch(() => undefined);
    }
  }

  async getImage(key: string): Promise<StoredImage | null> {
    if (!Types.ObjectId.isValid(key)) return null;
    const doc = await ImageAsset.findOne({ _id: key, isPrivate: false })
      .select('data mime')
      .lean();
    const data = asBuffer(doc?.data);
    return data ? { data, mime: doc!.mime } : null;
  }

  async getThumbnail(key: string): Promise<StoredImage | null> {
    if (!Types.ObjectId.isValid(key)) return null;
    const doc = await ImageAsset.findOne({ _id: key, isPrivate: false })
      .select('thumbnailData data mime')
      .lean();
    const data = asBuffer(doc?.thumbnailData) ?? asBuffer(doc?.data);
    return data ? { data, mime: doc!.mime } : null;
  }

  async getPrivateImage(key: string): Promise<StoredImage | null> {
    if (!Types.ObjectId.isValid(key)) return null;
    const doc = await ImageAsset.findOne({ _id: key, isPrivate: true })
      .select('data mime')
      .lean();
    const data = asBuffer(doc?.data);
    return data ? { data, mime: doc!.mime } : null;
  }
}

function buildProvider(): StorageProvider {
  switch (config.storageDriver) {
    case 'mongo':
      return new MongoStorageProvider();
    case 's3':
      // Not implemented yet — the seam exists so adding it is a drop-in.
      throw new Error('STORAGE_DRIVER=s3 is not implemented yet');
    default:
      return new LocalStorageProvider();
  }
}

export const storageProvider: StorageProvider = buildProvider();
