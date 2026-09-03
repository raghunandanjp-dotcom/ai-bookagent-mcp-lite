import { rm } from "node:fs/promises";

type RemoveDirectory = (directory: string) => Promise<void>;
type Pause = (milliseconds: number) => Promise<void>;

function retryableWindowsCleanupError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
}

/**
 * Windows can retain a freshly-written directory entry briefly after a native
 * rasterization call returns. Keep the retry narrow, short, and test-only.
 */
export async function removeTemporaryDirectory(
  directory: string,
  platform = process.platform,
  remove: RemoveDirectory = async (target) => rm(target, { recursive: true, force: true }),
  pause: Pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<void> {
  const attempts = platform === "win32" ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await remove(directory);
      return;
    } catch (error) {
      if (attempt === attempts - 1 || !retryableWindowsCleanupError(error)) throw error;
      await pause(50 * (attempt + 1));
    }
  }
}
