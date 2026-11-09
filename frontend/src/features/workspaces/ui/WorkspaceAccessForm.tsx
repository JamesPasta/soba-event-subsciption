'use client';

import { useState } from 'react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Form,
  InlineAlert,
} from '@bcgov/design-system-react-components';
import { CenteredProgress } from '@/app/ui/base/CenteredProgress';
import { SecondaryText } from '@/src/components/SecondaryText';
import { useKeycloak } from '@/lib/hooks/useKeycloak';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { apiErrorMessage, messageForDataError } from '@/src/shared/api/dataError';
import { useAuthErrorDefaults } from '@/src/shared/api/useDataErrorNotice';
import { lookupTruncatedNote } from '@/src/shared/list/lookupOptions';
import { useUserFromSearchWriter } from '@/src/features/user-search/data/useUserSearch';
import { UserSearchPicker } from '@/src/features/user-search/ui/UserSearchPicker';
import type { Dictionary } from '@/src/types/dictionary';
import type { UserSearchScope, UserSearchUser } from '@/src/types/userSearch';
import type { WorkspaceAccessGroup, WorkspaceAccessMember } from '@/src/types/workspaceAccess';
import type { WorkspaceGroup } from '@/src/types/workspaceGroups';
import { useWorkspaceAccessMember } from '../data/useWorkspaceAccessMember';
import { useWorkspaceAccessWriter } from '../data/useWorkspaceAccessWriter';
import { useWorkspaceGroups } from '../data/useWorkspaceGroups';
import { TabFormSection, TabFormUnavailable } from './TabForm';
import styles from './WorkspaceForm.module.css';

/** The groups API's largest page; a workspace with more lists only these. */
const GROUP_CHOICES_LIMIT = 100;

export interface WorkspaceAccessFormProps {
  dict: Dictionary;
  workspaceId: string;
  /** The member to edit. Left out, the form finds a person to add. */
  membershipId?: string;
  onDone: () => void;
}

/**
 * Add a person to the workspace in the groups chosen, or change a member's groups. An edit reads
 * the member on their own rather than taking the list's row, so the fields start from their groups
 * as they are now.
 */
export function WorkspaceAccessForm({
  dict,
  workspaceId,
  membershipId,
  onDone,
}: Readonly<WorkspaceAccessFormProps>) {
  const t = dict.workspaces.access;
  const authDefaults = useAuthErrorDefaults();
  const groups = useWorkspaceGroups(workspaceId, {
    offset: 0,
    limit: GROUP_CHOICES_LIMIT,
    sort: 'name:asc',
  });
  const record = useWorkspaceAccessMember(workspaceId, membershipId ?? null);

  let content: React.ReactNode;
  if (record.error) {
    // Editing without the record would start from no groups and replace theirs.
    content = (
      <TabFormUnavailable
        message={messageForDataError(record.error, { ...authDefaults, failed: t.memberLoadError })}
        testId="member-load-error"
        cancelLabel={t.cancel}
        cancelTestId="member-cancel-button"
        onCancel={onDone}
      />
    );
  } else if (groups.error) {
    // Without the group list there is nothing to choose from.
    content = (
      <TabFormUnavailable
        message={messageForDataError(groups.error, { ...authDefaults, failed: t.groupsLoadError })}
        testId="member-groups-error"
        cancelLabel={t.cancel}
        cancelTestId="member-cancel-button"
        onCancel={onDone}
      />
    );
  } else if (groups.total === undefined || (membershipId && !record.member)) {
    // Also covers a read still waiting on the session, which reports no loading of its own.
    content = <CenteredProgress label={dict.general.loading} />;
  } else {
    content = (
      <MemberFields
        key={record.member?.membershipId ?? 'add'}
        dict={dict}
        workspaceId={workspaceId}
        member={record.member}
        groups={groups.rows}
        groupsTruncated={groups.total > groups.rows.length}
        onDone={onDone}
      />
    );
  }

  return (
    <TabFormSection
      heading={membershipId ? t.editMember : t.addMember}
      testId={membershipId ? 'workspace-member-edit-form' : 'workspace-member-add-form'}
    >
      {content}
    </TabFormSection>
  );
}

/**
 * The groups read, plus a member's groups past the last one read. When every group was read, a
 * member's group missing from them has been deleted and is not offered.
 */
function groupChoices(
  groups: WorkspaceGroup[],
  member: WorkspaceAccessMember | null,
  truncated: boolean,
): WorkspaceAccessGroup[] {
  if (!truncated || !member) return groups;
  const listed = new Set(groups.map((group) => group.id));
  return [...groups, ...member.groups.filter((group) => !listed.has(group.id))];
}

interface MemberFieldsProps {
  dict: Dictionary;
  workspaceId: string;
  /** The member as read for this form, or null to add one. Seeds the fields on mount. */
  member: WorkspaceAccessMember | null;
  groups: WorkspaceGroup[];
  groupsTruncated: boolean;
  onDone: () => void;
}

function MemberFields({
  dict,
  workspaceId,
  member,
  groups,
  groupsTruncated,
  onDone,
}: Readonly<MemberFieldsProps>) {
  const t = dict.workspaces.access;
  const { token } = useKeycloak();
  const { addNotification } = useNotificationStore();
  const writer = useWorkspaceAccessWriter(workspaceId);
  const scope: UserSearchScope = { kind: 'workspace', id: workspaceId };
  const userWriter = useUserFromSearchWriter(scope);

  const [picked, setPicked] = useState<UserSearchUser | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>(
    () => member?.groups.map((group) => group.id) ?? [],
  );
  const [saving, setSaving] = useState(false);

  const choices = groupChoices(groups, member, groupsTruncated);
  // A group deleted while the form is open drops out of the choices and of what is saved.
  const chosen = groupIds.filter((id) => choices.some((group) => group.id === id));

  // Someone who has never signed in has no SOBA user; adding them makes one from the directory,
  // which needs the directory's guid for them.
  const userId = picked?.sobaUserId ?? null;
  const notSignedIn = picked !== null && userId === null;
  const directoryGuid = (notSignedIn && picked.guid) || null;
  const hasPerson = member !== null || userId !== null || directoryGuid !== null;
  const canSave = Boolean(token) && hasPerson && chosen.length > 0 && !saving;

  /**
   * The SOBA user to add: the picked person's own, or one made for them. A made user is kept on
   * the pick, so trying again after the add fails goes straight to the add.
   */
  const userIdToAdd = async (activeToken: string): Promise<string> => {
    if (userId) return userId;
    if (!picked || !directoryGuid) throw new Error('No person to add');
    const made = await userWriter.create(activeToken, {
      identityProvider: picked.identityProvider,
      guid: directoryGuid,
    });
    if (made.status !== 'applied') throw new Error('The SOBA user was not made');
    setPicked({ ...picked, sobaUserId: made.value.userId });
    return made.value.userId;
  };

  const save = async () => {
    if (!token || !canSave) return;
    setSaving(true);
    try {
      if (member) {
        await writer.setGroups(token, member.membershipId, chosen);
      } else {
        await writer.add(token, await userIdToAdd(token), chosen);
      }
      addNotification({ text: member ? t.updateSuccess : t.addSuccess, type: 'success' });
      onDone();
    } catch (err: unknown) {
      // A coded refusal, such as a person who already has access, says why; anything else is
      // generic.
      addNotification({
        text: apiErrorMessage(err, dict.apiErrors) ?? (member ? t.updateError : t.addError),
        type: 'error',
        consoleError: err,
      });
    } finally {
      setSaving(false);
    }
  };

  const truncatedNote = lookupTruncatedNote(dict.general.lookupTruncated, {
    truncated: groupsTruncated,
    limit: GROUP_CHOICES_LIMIT,
  });
  let saveLabel = member ? t.save : t.add;
  if (saving) saveLabel = t.saving;

  return (
    <>
      {member ? (
        <p className="d-flex flex-column" data-testid="member-identity">
          <span>{member.displayLabel ?? t.unnamed}</span>
          {member.email && <SecondaryText>{member.email}</SecondaryText>}
        </p>
      ) : (
        // Outside the form: Enter in the search box picks a person rather than submitting.
        <div className="mb-4">
          <p>{t.searchStep}</p>
          <UserSearchPicker scope={scope} onSelect={setPicked} />
        </div>
      )}
      <Form
        className={styles.fieldStack}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {notSignedIn && (
          <InlineAlert
            title={t.notSignedInTitle}
            description={directoryGuid ? t.notSignedIn : t.notSignedInNoId}
            variant="info"
            data-testid="member-not-signed-in"
          />
        )}
        <CheckboxGroup
          label={t.groups}
          description={truncatedNote ? `${t.groupsHelp} ${truncatedNote}` : t.groupsHelp}
          value={chosen}
          onChange={setGroupIds}
          isRequired
          errorMessage={t.groupsRequired}
          isDisabled={saving}
        >
          {choices.map((group) => (
            <Checkbox
              key={group.id}
              value={group.id}
              data-testid={`member-group-checkbox-${group.id}`}
            >
              {group.name}
            </Checkbox>
          ))}
        </CheckboxGroup>
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            isDisabled={!canSave}
            data-testid="member-submit-button"
          >
            {saveLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            isDisabled={saving}
            onPress={onDone}
            data-testid="member-cancel-button"
          >
            {t.cancel}
          </Button>
        </div>
      </Form>
    </>
  );
}

export default WorkspaceAccessForm;
