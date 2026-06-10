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
}

export const storageProvider: StorageProvider = new LocalStorageProvider();
