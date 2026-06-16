import path from 'path';
import { config } from '../config/env';

/**
 * Abstract storage so the local disk implementation can later be swapped for
 * MinIO/S3 without touching controllers or services.
 */
export interface StoredFile {
  /** Relative path/key under the storage root, e.g. "stylist/abc.jpg". */
  path: string;
}

export interface StorageProvider {
  /**
   * Persist a file already written to disk by multer and return its storage key.
   * (With multer disk storage the bytes are already saved; here we just normalize
   * the key. A remote provider would upload the buffer instead.)
   */
  save(file: Express.Multer.File): Promise<StoredFile>;
  /** Build a publicly servable URL for a stored key. */
  getUrl(storedPath: string): string;
  /** Persist a PRIVATE file (written by a private uploader) → key under the private root. */
  savePrivate(file: Express.Multer.File): Promise<StoredFile>;
  /**
   * Absolute on-disk path for a PRIVATE key, for streaming behind auth. Throws
   * if the resolved path escapes the private root (path-traversal protection).
   * NEVER expose this path or build a public URL from it.
   */
  getPrivateAbsolutePath(key: string): string;
}

export class LocalStorageProvider implements StorageProvider {
  async save(file: Express.Multer.File): Promise<StoredFile> {
    // multer disk storage already wrote the file; derive a relative key.
    const relative = path
      .relative(path.resolve(config.uploadDir), file.path)
      .split(path.sep)
      .join('/');
    return { path: relative };
  }

  getUrl(storedPath: string): string {
    const normalized = storedPath.split(path.sep).join('/');
    return `${config.baseUrl}/uploads/${normalized}`;
  }

  async savePrivate(file: Express.Multer.File): Promise<StoredFile> {
    const relative = path
      .relative(path.resolve(config.privateUploadDir), file.path)
      .split(path.sep)
      .join('/');
    return { path: relative };
  }

  getPrivateAbsolutePath(key: string): string {
    const root = path.resolve(config.privateUploadDir);
    const resolved = path.resolve(root, key);
    // Defense against path traversal (e.g. key = "../../etc/passwd").
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Invalid private storage key');
    }
    return resolved;
  }
}

export const storageProvider: StorageProvider = new LocalStorageProvider();
