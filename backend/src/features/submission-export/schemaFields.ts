/** Column names from a Form.io schema. */
import { SUBMISSION_FIELDS } from './formats';

/** The Form.io component fields the export reads. */
export interface FormComponent {
  key?: string;
  type?: string;
  input?: boolean;
  tree?: boolean;
  multiple?: boolean;
  enableManualMode?: boolean;
  columns?: Array<{ components?: FormComponent[] }>;
  rows?: unknown[];
  components?: FormComponent[];
  dataSrc?: string;
  values?: Array<{ value: string }>;
  questions?: Array<{ value: string }>;
}

// Layout components with no children.
const LAYOUT_TYPES = new Set(['htmlelement', 'content', 'button']);
// Answers keyed by option.
const SUB_VALUE_TYPES = new Set(['selectboxes', 'survey']);
// Containers whose key prefixes their children.
const PREFIX_TYPES = new Set(['datagrid', 'container', 'editgrid']);
const NON_PREFIX_TYPES = new Set(['panel', 'table', 'well', 'columns', 'fieldset', 'tabs', 'form']);

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** The component's own columns. */
const ownPaths = (component: FormComponent, path: string): string[] => {
  const { key, dataSrc } = component;
  if (!key) return [];
  const options = component.type === 'survey' ? component.questions : component.values;
  // Options from elsewhere, or a blank default, do not name the answer's keys.
  const named = !dataSrc || dataSrc === 'values' ? options?.filter((option) => option.value) : [];
  if (SUB_VALUE_TYPES.has(component.type ?? '') && named?.length) {
    return named.map((option) => join(path, `${key}.${option.value}`));
  }
  return [join(path, key)];
};

/** Path for the component's children. */
const childPath = (component: FormComponent, path: string): string => {
  if (!component.key) return path;
  if (component.type === 'form') return `${join(path, component.key)}.data`;
  // Form.io keeps an address's parts under `address`.
  if (component.type === 'address') return `${join(path, component.key)}.address`;
  const type = component.type ?? '';
  if (!NON_PREFIX_TYPES.has(type) && (PREFIX_TYPES.has(type) || component.tree)) {
    return join(path, component.key);
  }
  return path;
};

const childComponents = (component: FormComponent): FormComponent[][] => {
  // Only a manual address has parts; any other holds the provider's result.
  const { type, enableManualMode, multiple } = component;
  if (type === 'address' && (!enableManualMode || multiple)) return [];
  if (Array.isArray(component.columns)) return component.columns.map((c) => c.components ?? []);
  if (Array.isArray(component.rows)) {
    return component.rows.flatMap((row) =>
      Array.isArray(row)
        ? row.map((cell: { components?: FormComponent[] }) => cell?.components ?? [])
        : [],
    );
  }
  return component.components ? [component.components] : [];
};

/** Answer columns in form order. */
export const flattenComponents = (components: FormComponent[] | undefined, path = ''): string[] =>
  (components ?? []).flatMap((component) => {
    if (!component) return [];
    const isLayout =
      Array.isArray(component.columns) ||
      Array.isArray(component.rows) ||
      (Array.isArray(component.components) && !component.input) ||
      LAYOUT_TYPES.has(component.type ?? '');
    const own = component.tree || !isLayout ? ownPaths(component, path) : [];
    const sub = childPath(component, path);
    const children = childComponents(component).flatMap((list) => flattenComponents(list, sub));
    return [...own, ...children];
  });

/**
 * The fields an export can include: the submission's own, then each schema's in form order, once
 * each. Schemas come newest version first, so an older version's fields follow the newest's.
 */
export const exportFieldNames = (schemas: Record<string, unknown>[]): string[] => [
  ...new Set([
    ...Object.keys(SUBMISSION_FIELDS),
    ...schemas.flatMap(({ components }) =>
      flattenComponents(Array.isArray(components) ? components : undefined),
    ),
  ]),
];
