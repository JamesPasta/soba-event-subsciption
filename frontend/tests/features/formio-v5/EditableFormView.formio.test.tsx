import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FormType, Submission } from '@formio/react';
import {
  EditableFormView,
  type EditableFormInstance,
} from '@/src/features/formio-v5/ui/EditableFormView';

// The real Form.io, without the lazy loading and page chrome around it: what it does with the
// submission it is given, and with file components, is what these tests are for.
vi.mock('@/src/features/formio-v5/ui/DynamicForm', async () => {
  const { Form } = await import('@formio/react');
  return { DynamicForm: Form };
});

const FILE = { storage: 'chefs', name: 'a.txt', originalName: 'a.txt', url: 'files/1', size: 1 };

const SCHEMA = {
  display: 'form',
  components: [
    { type: 'textfield', key: 'name', label: 'Name', input: true, validate: { required: true } },
    {
      type: 'columns',
      key: 'layout',
      input: false,
      columns: [
        {
          width: 6,
          components: [{ type: 'bcgov-file', key: 'nestedFile', label: 'Nested', input: true }],
        },
      ],
    },
    { type: 'file', key: 'plainFile', label: 'Plain', input: true, storage: 'url' },
    {
      type: 'datagrid',
      key: 'grid',
      label: 'Grid',
      input: true,
      components: [{ type: 'textfield', key: 'cell', label: 'Cell', input: true }],
    },
  ],
} as unknown as FormType;

type Webform = EditableFormInstance & {
  getComponent: (key: string) => {
    disabled: boolean;
    refs: { removeLink?: unknown[]; fileBrowse?: unknown };
    setValue: (value: unknown) => void;
  };
};

const settle = (ms = 800) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

const renderEditor = async (data: Record<string, unknown>) => {
  let webform: Webform | undefined;
  const onDataChange = vi.fn();
  const onFormReady = vi.fn((instance: EditableFormInstance) => {
    webform = instance as Webform;
  });
  const submission = { data } as Submission;
  const editor = () => (
    <EditableFormView
      schema={SCHEMA}
      submission={submission}
      onDataChange={onDataChange}
      onFormReady={onFormReady}
      testId="editor"
    />
  );
  const view = render(editor());
  await settle();
  if (!webform) throw new Error('The webform did not load');
  return { webform, onDataChange, onFormReady, submission, view, editor };
};

const typeIntoName = async (value: string) => {
  const input = screen.getByTestId('editor').querySelector('input[name="data[name]"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('No name input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};

describe('EditableFormView on the real Form.io', () => {
  beforeAll(async () => {
    const { Formio } = await import('@formio/js');
    const bcgov = (await import('formio-components@0.0.1')) as { default?: unknown };
    (Formio as unknown as { use: (plugin: unknown) => void }).use(bcgov.default ?? bcgov);
  });

  it('reports what the user changes, and nothing for loading the answers', async () => {
    const { onDataChange, view } = await renderEditor({ name: 'original' });
    expect(onDataChange).not.toHaveBeenCalled();

    await typeIntoName('edited');

    expect(onDataChange).toHaveBeenCalled();
    expect(onDataChange.mock.lastCall?.[0]).toMatchObject({ name: 'edited' });
    view.unmount();
  });

  // Form.io changes values itself as a form loads, such as a date's format, with `modified` false.
  it('does not take a change no one made for an edit', async () => {
    const { webform, onDataChange, view } = await renderEditor({ name: 'original' });

    webform.getComponent('name').setValue('normalized');
    await settle();

    expect(webform.data).toMatchObject({ name: 'normalized' });
    expect(onDataChange).not.toHaveBeenCalled();
    view.unmount();
  });

  // Form.io emits this change with `modified` false.
  it('reports a removed grid row', async () => {
    const { onDataChange, view } = await renderEditor({
      name: 'original',
      grid: [{ cell: 'one' }, { cell: 'two' }],
    });
    expect(onDataChange).not.toHaveBeenCalled();

    const remove = view.container.querySelector('button.formio-button-remove-row');
    if (!(remove instanceof HTMLElement)) throw new Error('No remove row button');
    fireEvent.pointerDown(remove);
    remove.click();
    await settle();

    expect(onDataChange.mock.lastCall?.[0]).toMatchObject({ grid: [{ cell: 'two' }] });
    view.unmount();
  });

  it('keeps the webform, and what was typed, across a re-render', async () => {
    const { onFormReady, view, editor } = await renderEditor({ name: 'original' });

    await typeIntoName('edited');
    view.rerender(editor());
    await settle();

    expect(onFormReady).toHaveBeenCalledTimes(1);
    const input = screen.getByTestId('editor').querySelector('input[name="data[name]"]');
    expect(input).toHaveValue('edited');
    view.unmount();
  });

  it('writes to the submission it is given, so a caller must hand it its own copy', async () => {
    const original = { name: 'original' };
    const { submission, view } = await renderEditor(original);

    await typeIntoName('edited');

    expect(submission.data).toMatchObject({ name: 'edited' });
    expect(original.name).toBe('original');
    view.unmount();
  });

  it('shows files without offering to remove or add one, at any depth', async () => {
    const { webform, view } = await renderEditor({
      name: 'original',
      nestedFile: [FILE],
      plainFile: [FILE],
    });

    for (const key of ['nestedFile', 'plainFile']) {
      const component = webform.getComponent(key);
      expect(component.disabled).toBe(true);
      expect(component.refs.removeLink ?? []).toHaveLength(0);
      expect(component.refs.fileBrowse).toBeFalsy();
    }
    expect(view.container).toHaveTextContent('a.txt');
    view.unmount();
  });

  it('marks invalid answers when asked', async () => {
    const { webform, view } = await renderEditor({ name: '' });

    expect(webform.checkValidity(webform.data, true)).toBe(false);
    await settle(100);

    expect(view.container.querySelector('.formio-error-wrapper')).not.toBeNull();
    view.unmount();
  });
});
