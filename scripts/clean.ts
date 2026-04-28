import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const rootDir = process.cwd();
const packagesDir = join(rootDir, "packages");
const coverageDir = join(rootDir, "coverage");

async function removeDistDirs(dir: string): Promise<void> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = join(dir, entry.name);

        if (entry.name === "dist") {
          await rm(path, { recursive: true, force: true });
          return;
        }

        await removeDistDirs(path);
      }),
  );
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

await Promise.all([removeDistDirs(packagesDir), rm(coverageDir, { recursive: true, force: true })]);
