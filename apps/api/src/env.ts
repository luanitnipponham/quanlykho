// Loads the shared .env at the repo root before anything reads process.env.
// Imported first by main.ts and seed.ts so DATABASE_URL and JWT_SECRET are always present.
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as dotenv from 'dotenv';

const ROOT_ENV = path.resolve(__dirname, '../../../.env');

if (fs.existsSync(ROOT_ENV)) {
  dotenv.config({ path: ROOT_ENV, quiet: true });
} else {
  // Fall back to a local .env so the API can run standalone.
  dotenv.config({ quiet: true });
}

if (!process.env.DATABASE_URL) {
  console.error(`[env] Thiếu DATABASE_URL. Kiểm tra file .env tại: ${ROOT_ENV}`);
  process.exit(1);
}

export const ENV_FILE = ROOT_ENV;
