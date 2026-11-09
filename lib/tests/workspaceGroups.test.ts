import {
  CreateWorkspaceGroupBodySchema,
  UpdateWorkspaceGroupBodySchema,
  WORKSPACE_GROUP_NAME_MAX_LENGTH,
} from '../src';

describe('workspace group bodies', () => {
  it('limits the name, after trimming it', () => {
    const atLimit = 'x'.repeat(WORKSPACE_GROUP_NAME_MAX_LENGTH);
    expect(CreateWorkspaceGroupBodySchema.safeParse({ name: `  ${atLimit}  ` }).success).toBe(true);
    expect(CreateWorkspaceGroupBodySchema.safeParse({ name: `${atLimit}x` }).success).toBe(false);
    expect(UpdateWorkspaceGroupBodySchema.safeParse({ name: `  ${atLimit}  ` }).success).toBe(true);
    expect(UpdateWorkspaceGroupBodySchema.safeParse({ name: `${atLimit}x` }).success).toBe(false);
  });
});
