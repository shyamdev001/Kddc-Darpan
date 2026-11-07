import { Global, Logger, Module } from '@nestjs/common';
import { LocalStorageDriver } from './local-storage.driver';
import { STORAGE, type StorageDriver } from './storage.types';

function createStorage(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 'local') {
    const dir = process.env.STORAGE_LOCAL_DIR;
    if (!dir) throw new Error('STORAGE_LOCAL_DIR must be set in .env when STORAGE_DRIVER=local');
    Logger.log(`Media storage: local folder ${dir}`, 'Storage');
    return new LocalStorageDriver(dir);
  }
  if (driver === 's3') {
    throw new Error('STORAGE_DRIVER=s3 (Cloudflare R2) is not implemented yet. It is planned for deployment.');
  }
  throw new Error(`Unknown STORAGE_DRIVER "${driver}". Use "local" or "s3".`);
}

@Global()
@Module({
  providers: [{ provide: STORAGE, useFactory: createStorage }],
  exports: [STORAGE],
})
export class StorageModule {}
