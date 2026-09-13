import { readFile, writeFile } from 'node:fs/promises';

const output = new URL('../dist/index.js', import.meta.url);
const source = await readFile(output, 'utf8');
const patched = source.replaceAll('from "sqlite"', 'from "node:sqlite"').replaceAll("from 'sqlite'", "from 'node:sqlite'");
await writeFile(output, patched);
