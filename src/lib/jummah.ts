// The Jumu'ah info record — a single git-backed YAML file (content/jummah.yml
// at the repo root, kept outside src/content/ so Pages CMS's configured path
// keeps working unchanged) edited via Pages CMS. See .pages.yml.
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

export interface JummahData {
  first_time: string;
  first_khutbah_title: string;
  first_khateeb: string;
  second_time: string;
  second_khutbah_title: string;
  second_khateeb: string;
}

// Resolved from the current working directory (always the project root when
// running via `astro dev`/`astro build`) rather than import.meta.url, since
// Vite relocates this module into a bundled chunk at build time and a
// path relative to that chunk's location would no longer point at the repo.
const JUMMAH_PATH = path.join(process.cwd(), 'content/jummah.yml');

export function getJummah(): JummahData {
  return load(fs.readFileSync(JUMMAH_PATH, 'utf8')) as JummahData;
}

// If both Jumu'ahs share the same khutbah title and khateeb, the templates
// show a single combined block instead of duplicating identical info twice.
export function jummahSameTopic(d: JummahData): boolean {
  return d.first_khutbah_title === d.second_khutbah_title && d.first_khateeb === d.second_khateeb;
}
