'use client';
import { useState } from 'react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Form,
  Heading,
} from '@bcgov/design-system-react-components';

import type { Dictionary } from '@/src/types/dictionary';
import type { TeamMember } from '@/src/types/formTeam';
import type { UserSearchUser } from '@/src/types/userSearch';
import { SecondaryText } from '@/src/components/SecondaryText';
import { useNotificationStore } from '@/lib/hooks/useNotificationStore';
import { useFormTeamWriter, useTeamGroups } from '@/src/features/designer/data/useFormTeam';
import { UserSearchPicker } from '@/src/features/user-search/ui/UserSearchPicker';

interface FormTeamMemberFormProps {
  dict: Dictionary;
  formId: string;
  /** The member whose groups are being edited. Left out, the form searches for a user to add. */
  member?: TeamMember;
  onDone: () => void;
}

export default function FormTeamMemberForm({
  dict,
  formId,
  member,
  onDone,
}: Readonly<FormTeamMemberFormProps>) {
  const t = dict.team;
  const groups = useTeamGroups();
  const teamWriter = useFormTeamWriter(formId);
  const { addNotification } = useNotificationStore();
  const [selectedUser, setSelectedUser] = useState<UserSearchUser | null>(null);
  const [selectedGroups, setSelectedGroups] = useState(member?.groups ?? []);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (member) await teamWriter.setGroups(member.id, selectedGroups);
      if (selectedUser) await teamWriter.add(selectedUser, selectedGroups);
      addNotification({ text: member ? t.editSuccess : t.addSuccess, type: 'success' });
      onDone();
    } catch (e: unknown) {
      addNotification({
        text: member ? t.editFailure : t.addFailure,
        type: 'error',
        consoleError: e,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="team-member-form">
      <Heading level={2}>{member ? t.editMember : t.addMember}</Heading>
      {member && (
        <p className="d-flex flex-column mb-4">
          <span>{member.name}</span>
          <SecondaryText>{member.email}</SecondaryText>
        </p>
      )}
      {!member && (
        <>
          <p>{t.searchStep}</p>
          <UserSearchPicker scope={{ kind: 'form', id: formId }} onSelect={setSelectedUser} />
        </>
      )}
      <Form
        className="d-flex flex-column gap-4 my-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <CheckboxGroup
          label={member ? t.groups : t.groupsStep}
          value={selectedGroups}
          onChange={setSelectedGroups}
          isRequired
          errorMessage={t.groupsRequired}
        >
          {groups.map((group) => (
            <Checkbox key={group.id} value={group.id} data-testid={`team-group-${group.id}`}>
              {group.name}
            </Checkbox>
          ))}
        </CheckboxGroup>
        <div className="d-flex gap-3">
          <Button
            variant="primary"
            data-testid="team-save-button"
            isDisabled={saving || !(member || selectedUser)}
            type="submit"
          >
            {member ? t.saveMember : t.addMember}
          </Button>
          <Button variant="secondary" data-testid="team-cancel-button" onPress={onDone}>
            {dict.general.cancel}
          </Button>
        </div>
      </Form>
    </div>
  );
}
