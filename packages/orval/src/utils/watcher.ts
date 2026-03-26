import type { FSWatcher } from 'chokidar';
import { isBoolean, log, logError } from '@orval/core';

/**
 * Start a file watcher and invoke an async callback on file changes.
 *
 * If `watchOptions` is falsy the watcher is not started. Supported shapes:
 *  - boolean: when true the `defaultTarget` is watched
 *  - string: a single path to watch
 *  - string[]: an array of paths to watch
 *
 * @param watchOptions - false to disable watching, or a path/paths to watch
 * @param watchFn - async callback executed on change events
 * @param defaultTarget - path(s) to watch when `watchOptions` is `true` (default: '.')
 * @returns The FSWatcher instance if watching is enabled, or undefined if disabled
 *
 * @example
 * const watcher = await startWatcher(true, async () => { await buildProject(); }, 'src');
 */
export async function startWatcher(
  watchOptions: boolean | string | string[],
  watchFn: () => Promise<void>,
  defaultTarget: string | string[] = '.',
): Promise<FSWatcher | undefined> {
  if (!watchOptions) return;
  const { watch } = await import('chokidar');

  const ignored = ['**/{.git,node_modules}/**'];

  const watchPaths = isBoolean(watchOptions) ? defaultTarget : watchOptions;

  log(
    `Watching for changes in ${
      Array.isArray(watchPaths)
        ? watchPaths.map((v) => '"' + v + '"').join(' | ')
        : '"' + watchPaths + '"'
    }`,
  );

  const watcher = watch(watchPaths, {
    ignorePermissionErrors: true,
    ignored,
  });
  watcher.on('all', (type, file) => {
    log(`Change detected: ${type} ${file}`);

    watchFn().catch((error: unknown) => {
      logError(error);
    });
  });

  return watcher;
}
