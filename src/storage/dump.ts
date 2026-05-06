import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openDb } from './sqlite.js';

interface ManifestTotals {
  predictions: number;
  traces: number;
  tweets: number;
}

function writeJsonl(path: string, rows: unknown[]): void {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  for (const row of rows) {
    stream.write(JSON.stringify(row) + '\n');
  }
  stream.end();
}

export async function dumpToJsonl(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const db = openDb();

  // Predictions — all columns, no secrets
  const predictions = db.prepare('SELECT * FROM predictions ORDER BY id ASC').all();
  writeJsonl(join(outputDir, 'predictions.jsonl'), predictions);

  // Traces — all columns
  const traces = db.prepare('SELECT * FROM traces ORDER BY id ASC').all();
  writeJsonl(join(outputDir, 'traces.jsonl'), traces);

  // Tweets — no token data (separate table); include all columns in tweets table
  const tweets = db.prepare('SELECT * FROM tweets ORDER BY id ASC').all();
  writeJsonl(join(outputDir, 'tweets.jsonl'), tweets);

  // Manifest
  const totals: ManifestTotals = {
    predictions: predictions.length,
    traces: traces.length,
    tweets: tweets.length,
  };

  const manifest = {
    schemaVersion: '0002',
    dumpTimestamp: new Date().toISOString(),
    totals,
    note: 'twitter_tokens table excluded — contains OAuth secrets.',
  };

  const manifestStream = createWriteStream(join(outputDir, 'manifest.json'), { encoding: 'utf8' });
  manifestStream.write(JSON.stringify(manifest, null, 2) + '\n');
  manifestStream.end();

  console.log(`Dumped to ${outputDir}:`);
  console.log(`  predictions.jsonl  — ${totals.predictions} rows`);
  console.log(`  traces.jsonl       — ${totals.traces} rows`);
  console.log(`  tweets.jsonl       — ${totals.tweets} rows`);
  console.log(`  manifest.json`);
}
