import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Readable } from 'stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

async function processImage(buffer: Buffer) {
  const main = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  const thumbnailData = await sharp(buffer)
    .rotate()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  return { main, thumbnailData };
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

    const { main, thumbnailData } = await processImage(file.buffer);

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

// ───────────────────── S3 / MinIO (webp via sharp) ─────────────────────
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  /** Memoized one-time bucket existence check / creation. */
  private bucketsReady?: Promise<void>;

  constructor() {
    const { endpoint, region, accessKeyId, secretAccessKey, publicBucket, privateBucket } = config.s3;
    const missing = [
      ['S3_ENDPOINT', endpoint],
      ['S3_ACCESS_KEY_ID', accessKeyId],
      ['S3_SECRET_ACCESS_KEY', secretAccessKey],
      ['S3_PUBLIC_BUCKET', publicBucket],
      ['S3_PRIVATE_BUCKET', privateBucket],
    ].filter(([, value]) => !value).map(([key]) => key);

    if (missing.length) {
      throw new Error(`Missing S3 environment variables: ${missing.join(', ')}`);
    }

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: config.s3.forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  save(file: Express.Multer.File, meta?: SaveMeta): Promise<StoredFile> {
    return this.store(file, false, meta);
  }

  savePrivate(file: Express.Multer.File, meta?: SaveMeta): Promise<StoredFile> {
    return this.store(file, true, { ...meta, kind: meta?.kind ?? 'national_card' });
  }

  getUrl(storedPath: string): string {
    return `${config.baseUrl}/images/${encodeURIComponent(storedPath)}`;
  }

  async delete(storedPath: string): Promise<void> {
    const parsed = this.parseKey(storedPath);
    if (!parsed) return;
    await Promise.all([
      this.client.send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key })).catch(() => undefined),
      this.client.send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: this.thumbKey(parsed.key) })).catch(() => undefined),
    ]);
  }

  getImage(key: string): Promise<StoredImage | null> {
    const parsed = this.parseKey(key);
    if (!parsed || parsed.isPrivate) return Promise.resolve(null);
    return this.read(parsed.bucket, parsed.key);
  }

  async getThumbnail(key: string): Promise<StoredImage | null> {
    const parsed = this.parseKey(key);
    if (!parsed || parsed.isPrivate) return null;
    return (await this.read(parsed.bucket, this.thumbKey(parsed.key))) ?? this.read(parsed.bucket, parsed.key);
  }

  getPrivateImage(key: string): Promise<StoredImage | null> {
    const parsed = this.parseKey(key);
    if (!parsed || !parsed.isPrivate) return Promise.resolve(null);
    return this.read(parsed.bucket, parsed.key);
  }

  /**
   * Ensure the public + private buckets exist (idempotent, memoized). A fresh
   * S3/MinIO endpoint has no buckets yet, so the first upload would 500 with
   * "The specified bucket does not exist" — we create them on demand instead.
   */
  ensureBuckets(): Promise<void> {
    if (!this.bucketsReady) {
      const buckets = [...new Set([config.s3.publicBucket, config.s3.privateBucket])];
      this.bucketsReady = Promise.all(buckets.map((b) => this.ensureBucket(b)))
        .then(() => undefined)
        .catch((err) => {
          // Reset so a later attempt can retry (e.g. transient endpoint error).
          this.bucketsReady = undefined;
          throw err;
        });
    }
    return this.bucketsReady;
  }

  private async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return; // already exists
    } catch {
      // Fall through to create — missing, or no head permission.
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      // Created concurrently / already ours → success.
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
      throw err;
    }
  }

  private async store(file: Express.Multer.File, isPrivate: boolean, meta?: SaveMeta): Promise<StoredFile> {
    if (!file.buffer) throw new Error('S3StorageProvider requires in-memory uploads (multer memoryStorage)');

    await this.ensureBuckets();
    const { main, thumbnailData } = await processImage(file.buffer);
    const id = new Types.ObjectId().toString();
    const kind = meta?.kind ?? (isPrivate ? 'national_card' : 'profile');
    const owner = meta?.ownerType && meta?.ownerId ? `${meta.ownerType}/${meta.ownerId}` : 'unowned';
    const bucket = isPrivate ? config.s3.privateBucket : config.s3.publicBucket;
    const prefix = isPrivate ? 'private' : 'public';
    const key = `${prefix}/${owner}/${kind}/${id}.webp`;

    await Promise.all([
      this.put(bucket, key, main.data, meta, isPrivate),
      this.put(bucket, this.thumbKey(key), thumbnailData, meta, isPrivate),
    ]);

    return { path: `${isPrivate ? 'private' : 'public'}:${key}` };
  }

  private put(bucket: string, key: string, body: Buffer, meta: SaveMeta | undefined, isPrivate: boolean) {
    return this.client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: isPrivate ? 'private, max-age=0, no-store' : 'public, max-age=31536000, immutable',
      Metadata: {
        ...(meta?.ownerType ? { ownerType: meta.ownerType } : {}),
        ...(meta?.ownerId ? { ownerId: meta.ownerId } : {}),
        ...(meta?.kind ? { kind: meta.kind } : {}),
        isPrivate: String(isPrivate),
      },
    }));
  }

  private async read(bucket: string, key: string): Promise<StoredImage | null> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch(() => null);
    if (!result?.Body) return null;
    const data = await this.toBuffer(result.Body as Readable);
    return { data, mime: result.ContentType || 'image/webp' };
  }

  private async toBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  private parseKey(storedPath: string): { bucket: string; key: string; isPrivate: boolean } | null {
    const separator = storedPath.indexOf(':');
    if (separator < 0) return null;
    const scope = storedPath.slice(0, separator);
    const key = storedPath.slice(separator + 1);
    if (scope !== 'public' && scope !== 'private') return null;
    return {
      bucket: scope === 'private' ? config.s3.privateBucket : config.s3.publicBucket,
      key,
      isPrivate: scope === 'private',
    };
  }

  private thumbKey(key: string): string {
    return key.replace(/\.webp$/, '-thumb.webp');
  }
}

function buildProvider(): StorageProvider {
  switch (config.storageDriver) {
    case 'mongo':
      return new MongoStorageProvider();
    case 's3':
      return new S3StorageProvider();
    default:
      return new LocalStorageProvider();
  }
}

export const storageProvider: StorageProvider = buildProvider();

/**
 * Best-effort: pre-create S3/MinIO buckets at boot so the first image upload
 * doesn't fail with "bucket does not exist". No-op for local/mongo drivers.
 */
export async function ensureStorageReady(): Promise<void> {
  if (storageProvider instanceof S3StorageProvider) {
    await storageProvider.ensureBuckets();
  }
}
