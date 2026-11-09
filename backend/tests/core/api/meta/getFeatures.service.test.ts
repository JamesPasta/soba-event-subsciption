import { FeatureStatus } from '../../../../src/core/db/codes';

jest.mock('../../../../src/core/services/roleService', () => ({
  roleService: {
    listRoles: jest.fn(),
    getRole: jest.fn(),
  },
}));

jest.mock('../../../../src/core/db/repos/featureRepo', () => {
  const { FeatureStatus: Status } = jest.requireActual<
    typeof import('../../../../src/core/db/codes')
  >('../../../../src/core/db/codes');
  return {
    listFeatures: jest.fn(),
    getFeatureByCode: jest.fn(),
    isFeatureEnabled: (status: string) => status === Status.enabled,
  };
});

import { metaApiService } from '../../../../src/core/api/meta/service';
import * as featureRepo from '../../../../src/core/db/repos/featureRepo';

describe('MetaApiService.getFeatures', () => {
  it('maps rows to platformAllowed from status', async () => {
    jest.mocked(featureRepo.listFeatures).mockResolvedValue([
      {
        code: 'design-mode',
        name: 'Design mode',
        description: null,
        version: null,
        status: FeatureStatus.enabled,
        availability: 'fixed',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
      },
      {
        code: 'x-off',
        name: 'X',
        description: null,
        version: null,
        status: FeatureStatus.disabled,
        availability: 'scoped',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
      },
    ]);

    const result = await metaApiService.getFeatures();

    expect(result.features).toHaveLength(2);
    const design = result.features.find((f) => f.code === 'design-mode');
    expect(design?.platformAllowed).toBe(true);
    expect(design?.availability).toBe('fixed');
    expect(design).not.toHaveProperty('enabled');
    const off = result.features.find((f) => f.code === 'x-off');
    expect(off?.platformAllowed).toBe(false);
    expect(off?.availability).toBe('scoped');
  });
});
