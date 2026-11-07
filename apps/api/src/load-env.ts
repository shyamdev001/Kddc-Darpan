// Loads the single root .env (D:\Claude code\kdcc-signage\.env) for every entry point.
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
