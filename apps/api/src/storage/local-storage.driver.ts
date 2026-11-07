import { copyFile, mkdir, rename, rm, unlink } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { assertSafeKey, type StorageDriver } from './storage.types';

/** Stores files in a folder on this machine (dev: D:\kdcc-data\media). */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private abs(key: string): string {
    assertSafeKey(key);
    return join(this.root, ...key.split('/'));
  }

  async putFile(key: string, sourcePath: string): Promise<void> {
    const target = this.abs(key);
    await mkdir(dirname(target), { recursive: true });
    try {
      await rename(sourcePath, target);
    } catch (err) {
      // Different drive or volume: fall back to copy + delete.
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await copyFile(sourcePath, target);
      await unlink(sourcePath);
    }
  }

  async getLocalCopy(key: string) {
    return { path: this.abs(key), release: async () => undefined };
  }

  localPath(key: string): string {
    return this.abs(key);
  }

  async delete(key: string): Promise<void> {
    await rm(this.abs(key), { force: true });
  }
}
