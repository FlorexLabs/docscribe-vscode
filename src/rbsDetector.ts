import * as fs from 'fs';
import * as path from 'path';

/**
 * RBS auto-detection for a project (port of RubyMine `RbsDetector`).
 *
 * Detection order:
 * 1. explicit `rbs.enabled` in `docscribe.yml` (or `.docscribe.yml`) wins;
 * 2. `sig/` tree contains `.rbs` files;
 * 3. `rbs` in `Gemfile.lock`;
 * 4. `gem "rbs"` in `Gemfile`;
 * 5. otherwise RBS is off.
 */

/** Read a text file, return `null` on any error. */
function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Find the docscribe config file (`docscribe.yml` or `.docscribe.yml`).
 *
 * @param projectRoot - Absolute project root.
 * @returns Absolute config path, or `null` if neither exists.
 */
export function findDocscribeYml(projectRoot: string): string | null {
  for (const name of ['docscribe.yml', '.docscribe.yml']) {
    const candidate = path.join(projectRoot, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Read explicit `rbs.enabled` from the docscribe config.
 *
 * Mirrors RubyMine `parseRbsEnabled`: looks at the `rbs:` section tail
 * for `enabled: true|false`.
 *
 * @param projectRoot - Absolute project root.
 * @returns Explicit value, or `null` when not configured.
 */
export function readExplicitRbsEnabled(projectRoot: string): boolean | null {
  const ymlPath = findDocscribeYml(projectRoot);
  if (!ymlPath) return null;
  const content = readFileOrNull(ymlPath);
  if (!content) return null;
  const rbsIndex = content.indexOf('rbs:');
  if (rbsIndex < 0) return null;
  const tail = content.slice(rbsIndex, rbsIndex + 2000);
  const match = tail.match(/enabled\s*:\s*["']?(true|false)/);
  if (!match) return null;
  return match[1] === 'true';
}

/**
 * Whether `sig/` contains any `.rbs` files.
 *
 * @param projectRoot - Absolute project root.
 */
export function hasSigFiles(projectRoot: string): boolean {
  const sigDir = path.join(projectRoot, 'sig');
  try {
    if (!fs.statSync(sigDir).isDirectory()) return false;
  } catch {
    return false;
  }
  const stack: string[] = [sigDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.rbs')) return true;
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(full);
    }
  }
  return false;
}

/**
 * Whether a Gemfile lists the `rbs` gem.
 *
 * Reads the file synchronously and tests for a line matching
 * `gem "rbs"` or `gem 'rbs'`.
 *
 * @param gemfilePath - Absolute path to the Gemfile.
 * @returns `true` if found, `false` otherwise or on read error.
 */
export function gemfileHasRbs(gemfilePath: string): boolean {
  const content = readFileOrNull(gemfilePath);
  if (!content) return false;
  return /gem\s+['"]rbs['"]/.test(content);
}

/**
 * Whether `Gemfile.lock` mentions the `rbs` gem.
 *
 * @param projectRoot - Absolute project root.
 */
export function hasRbsInLock(projectRoot: string): boolean {
  const content = readFileOrNull(path.join(projectRoot, 'Gemfile.lock'));
  if (!content) return false;
  return /^\s+rbs\s\(/m.test(content);
}

/**
 * Whether `rbs_collection.lock.yaml` exists (RBS collection available).
 *
 * @param projectRoot - Absolute project root.
 */
export function hasCollection(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, 'rbs_collection.lock.yaml')).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether RBS types should be used for a project.
 *
 * Explicit `docscribe.yml` `rbs.enabled` wins; otherwise auto-detect
 * via `sig/`, `Gemfile.lock`, `Gemfile` (in that order).
 *
 * @param projectRoot - Absolute project root.
 * @param gemfileHasRbs - Precomputed `gem "rbs"` check for the Gemfile.
 */
export function shouldUseRbs(projectRoot: string, gemfileHasRbs: boolean): boolean {
  const explicit = readExplicitRbsEnabled(projectRoot);
  if (explicit !== null) return explicit;
  if (hasSigFiles(projectRoot)) return true;
  if (hasRbsInLock(projectRoot)) return true;
  return gemfileHasRbs;
}

/**
 * Hash of the RBS inputs for a project (for invalidation).
 *
 * Covers the effective `useRbs` flag, collection presence, config mtime
 * and every `.rbs` file under `sig/` (name + mtime + size).
 *
 * @param projectRoot - Absolute project root.
 * @param gemfileHasRbs - Precomputed `gem "rbs"` check for the Gemfile.
 * @returns Stable string hash.
 */
export function rbsHash(projectRoot: string, gemfileHasRbs: boolean): string {
  const useRbs = shouldUseRbs(projectRoot, gemfileHasRbs);
  const parts: string[] = [`useRbs:${useRbs}`, `collection:${hasCollection(projectRoot)}`];
  const ymlPath = findDocscribeYml(projectRoot);
  if (ymlPath) {
    try {
      parts.push(`yml:${fs.statSync(ymlPath).mtimeMs}`);
    } catch {
      // ignore
    }
  }
  const sigDir = path.join(projectRoot, 'sig');
  const stack: string[] = [sigDir];
  const sigFiles: string[] = [];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.rbs')) sigFiles.push(full);
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(full);
    }
  }
  sigFiles.sort();
  for (const file of sigFiles) {
    try {
      const stat = fs.statSync(file);
      parts.push(`${path.relative(projectRoot, file)}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      // ignore
    }
  }
  let hash = 0;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i++) {
    hash = (Math.imul(hash, 31) + joined.charCodeAt(i)) | 0;
  }
  return `rbs-${(hash >>> 0).toString(16)}`;
}

/**
 * CLI overrides for daemon RPC calls (mirrors RubyMine `buildRbsCliOverrides`).
 *
 * Sends `rbs: true` (+ `rbs_collection: true` when the lock exists) when RBS
 * is in use, and `validate_types: true` when YARD validation is enabled.
 * Returns `undefined` when empty (sender drops empty overrides).
 *
 * @param useRbs - Effective RBS flag for the project.
 * @param collection - Whether `rbs_collection.lock.yaml` exists.
 * @param validateTypes - Whether YARD type validation is enabled.
 */
export function buildRbsCliOverrides(
  useRbs: boolean,
  collection: boolean,
  validateTypes: boolean,
): Record<string, boolean> | undefined {
  const overrides: Record<string, boolean> = {};
  if (useRbs) {
    overrides['rbs'] = true;
    if (collection) overrides['rbs_collection'] = true;
  }
  if (validateTypes) overrides['validate_types'] = true;
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
