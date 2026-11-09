const selectMock = jest.fn();

jest.mock('../../../../src/core/db/client', () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

import { listFormsForWorkspace } from '../../../../src/core/db/repos/formRepo';
import {
  listFormVersionsForWorkspace,
  lookupFormVersions,
} from '../../../../src/core/db/repos/formVersionRepo';
import { listSubmissionsForWorkspace } from '../../../../src/core/db/repos/submissionRepo';
import type { FormAccessGrant } from '../../../../src/core/db/repos/formAccessRepo';

const FORM_ACCESS: FormAccessGrant = {
  workspaceIds: ['ws1'],
  overriddenFormIds: [],
  includedFormIds: [],
};

const listCalls = {
  listFormsForWorkspace: (workspaceIds: string[], formAccess: FormAccessGrant) =>
    listFormsForWorkspace({
      workspaceIds,
      formAccess,
      offset: 0,
      limit: 20,
      sort: 'createdAt:desc',
      locale: 'en',
    }),
  listFormVersionsForWorkspace: (workspaceIds: string[], formAccess: FormAccessGrant) =>
    listFormVersionsForWorkspace({
      workspaceIds,
      formAccess,
      offset: 0,
      limit: 20,
      sort: 'versionNo:desc',
    }),
  listSubmissionsForWorkspace: (workspaceIds: string[], formAccess: FormAccessGrant) =>
    listSubmissionsForWorkspace({
      workspaceIds,
      formAccess,
      offset: 0,
      limit: 20,
      sort: 'updatedAt:desc',
      locale: 'en',
    }),
};

describe('list repos return nothing without querying', () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it.each(Object.entries(listCalls))(
    '%s returns nothing for no workspace, without querying',
    async (_name, list) => {
      await expect(list([], FORM_ACCESS)).resolves.toEqual({ items: [], total: 0 });
      expect(selectMock).not.toHaveBeenCalled();
    },
  );

  it.each(Object.entries(listCalls))(
    '%s returns nothing for a grant that allows no form, without querying',
    async (_name, list) => {
      const nothing = { workspaceIds: [], overriddenFormIds: ['f1'], includedFormIds: [] };
      await expect(list(['ws1'], nothing)).resolves.toEqual({ items: [], total: 0 });
      expect(selectMock).not.toHaveBeenCalled();
    },
  );

  it.each(Object.entries(listCalls))(
    '%s returns nothing without an access grant, without querying',
    async (_name, list) => {
      await expect(list(['ws1'], undefined)).resolves.toEqual({ items: [], total: 0 });
      expect(selectMock).not.toHaveBeenCalled();
    },
  );

  it('lookupFormVersions returns nothing for no workspace, without querying', async () => {
    await expect(
      lookupFormVersions({ workspaceIds: [], formId: 'form1', limit: 501 }),
    ).resolves.toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
