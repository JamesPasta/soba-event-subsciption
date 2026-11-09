/** Argument errors, exit codes and pool shutdown shared by the dev data commands. */
import { pool } from '../../core/db/client';
import { AppError } from '../../core/errors';

/** A bad command line. An empty message prints the usage text alone. */
export class UsageError extends Error {}

/** parseArgs throws its own error type for a bad flag. Surface it like the rest. */
export function parseOrUsage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : 'Invalid arguments');
  }
}

/** Usage problems print the usage text; an AppError prints its message; anything else its stack. */
function exitCodeFor(error: unknown, usage: string): number {
  if (error instanceof UsageError) {
    if (error.message) console.error(`${error.message}\n`);
    console.log(usage);
    return error.message ? 2 : 0;
  }
  if (error instanceof AppError) {
    console.error(error.message);
    return 1;
  }
  console.error(error);
  return 1;
}

/** Runs a command to completion, then sets the exit code and closes the pool. */
export function runCli(main: () => Promise<void>, usage: string): void {
  // Ends the chain: every failure is turned into an exit code, and the pool close catches its own.
  void main()
    .then(() => 0)
    .catch((error: unknown) => exitCodeFor(error, usage))
    .then(async (code) => {
      // exitCode rather than exit(): lets stdout flush when the output is piped. A failure closing
      // the pool must not overwrite the code the command earned.
      process.exitCode = code;
      try {
        await pool.end();
      } catch (error) {
        console.error(error);
      }
    });
}
