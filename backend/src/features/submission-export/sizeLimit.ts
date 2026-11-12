import { Transform } from 'node:stream';
import { JobFailedError } from '../../core/jobs/settlement';

/** Recorded as the job's error; the export routes read it as the size limit. */
export const EXPORT_TOO_LARGE = 'Result over the size limit';

/** The export is over `maxBytes`; a retry would fail the same way. */
export const tooLarge = (maxBytes: number): JobFailedError =>
  new JobFailedError(`${EXPORT_TOO_LARGE} of ${maxBytes} bytes`);

/** Stops the write once it passes `maxBytes`. */
export const sizeLimit = (maxBytes: number): Transform => {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        callback(tooLarge(maxBytes));
        return;
      }
      callback(null, chunk);
    },
  });
};
