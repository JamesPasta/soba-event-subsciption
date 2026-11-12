import { Transform } from 'node:stream';
import { JobFailedError } from '../../core/jobs/settlement';

/** Recorded as the job's error; the export routes read it as the size limit. */
export const EXPORT_TOO_LARGE = 'Result over the size limit';

/** Stops the write once it passes `maxBytes`; a retry would fail the same way. */
export const sizeLimit = (maxBytes: number): Transform => {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        callback(new JobFailedError(`${EXPORT_TOO_LARGE} of ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
};
