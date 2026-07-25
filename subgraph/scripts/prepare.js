#!/usr/bin/env node
// Generates subgraph.yaml from subgraph.template.yaml.
// Address source of truth: contracts/deployments/<chainId>.json (written by
// DeployPassportKit.s.sol). Falls back to config/<network>.json (zeros) so the
// build stays green before the deploy lands.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const network = process.argv[2] ?? 'sepolia';
const fallback = JSON.parse(readFileSync(path.join(root, 'config', `${network}.json`), 'utf8'));

const deploymentsFile = path.resolve(root, '../contracts/deployments', `${fallback.chainId}.json`);
const deployed = existsSync(deploymentsFile) ? JSON.parse(readFileSync(deploymentsFile, 'utf8')) : null;

const cfg = { ...fallback, ...(deployed ?? {}) };
if (!deployed) {
  console.warn(`[prepare] ${deploymentsFile} not found — using ${network}.json fallback (zero addresses)`);
} else {
  console.log(`[prepare] addresses from ${deploymentsFile} (startBlock ${cfg.startBlock})`);
}

const template = readFileSync(path.join(root, 'subgraph.template.yaml'), 'utf8');
const out = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (cfg[key] === undefined) throw new Error(`missing config key: ${key}`);
  return String(cfg[key]);
});
writeFileSync(path.join(root, 'subgraph.yaml'), out);
console.log(`[prepare] wrote subgraph.yaml for ${cfg.network ?? network}`);
