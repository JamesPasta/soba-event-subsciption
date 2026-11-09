import type {
  ScanResult,
  VirusScanAdapter,
  VirusScanPluginDefinition,
} from '../../core/integrations/virus-scan/VirusScanAdapter';

const CODE = 'virusscan-noop';

/** No-op scanner: reports everything clean. Default for local dev/tests so they
 *  run without ClamAV. Not for envs where uploads must be scanned. */
function createNoopVirusScanAdapter(): VirusScanAdapter {
  const clean = (): Promise<ScanResult> =>
    Promise.resolve({ verdict: 'clean', viruses: [], scannerCode: CODE });

  return {
    scanStream: clean,
    scanBuffer: clean,
    scanFile: clean,
    ping(): Promise<boolean> {
      return Promise.resolve(true);
    },
  };
}

export const virusScanPluginDefinition: VirusScanPluginDefinition = {
  code: CODE,
  createAdapter: createNoopVirusScanAdapter,
};
