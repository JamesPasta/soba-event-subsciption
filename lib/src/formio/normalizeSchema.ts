type Node = Record<string, unknown>;

/**
 * Legacy CHEFS-1 type fix: strips the `simple…` prefix / `…advanced` suffix from component
 * `type` values. No-op for current Form.io v5 schemas. Operates on the JSON string form to
 * match the original client-side behaviour. Structured so a fuller CHEFS-1 importer can
 * replace it later.
 */
function transformChefs1Types(schema: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(schema)
    .replace(/"type"\s*:\s*"simple([^"]*?)advanced"/g, '"type": "$1"')
    .replace(/"type"\s*:\s*"simple([^"]*)"/g, '"type": "$1"')
    .replace(/"type"\s*:\s*"phonenumber"/g, '"type": "phoneNumber"');
  return JSON.parse(json) as Record<string, unknown>;
}

/** Form-definition fields the Form.io builder needs; everything else is engine/document metadata. */
const KEEP_FIELDS = ['display', 'type', 'title', 'settings', 'components'];

function isPlainObject(v: unknown): v is Node {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Strip a non-object `widget` (`""` / `null` / string) and any flattened `widget.*` keys from a
 *  single component, so the builder falls back to its default widget. Mutates in place. */
function repairComponentWidget(c: Node): void {
  if ('widget' in c && !isPlainObject(c.widget)) delete c.widget;
  for (const key of Object.keys(c)) {
    if (key.startsWith('widget.')) delete c[key];
  }
}

/** Repair widgets in each component of a table row (a row is an array of cells). */
function repairWidgetsInRow(row: unknown[]): void {
  for (const cell of row) {
    if (isPlainObject(cell)) repairWidgets(cell.components);
  }
}

/** Recurse widget repair into every nested component container a component may carry:
 *  direct `components`, `columns[].components`, and table `rows[][].components`. */
function repairNestedComponents(c: Node): void {
  repairWidgets(c.components);
  if (Array.isArray(c.columns)) {
    for (const col of c.columns) {
      if (isPlainObject(col)) repairWidgets(col.components);
    }
  }
  if (Array.isArray(c.rows)) {
    for (const row of c.rows) {
      if (Array.isArray(row)) repairWidgetsInRow(row);
    }
  }
}

/**
 * Drop component `widget`s that aren't a valid object (`""` / `null` / string) plus any
 * flattened `widget.*` keys, so the builder falls back to each component's default widget.
 * A non-object widget crashes the builder's component-edit dialog. Recurses through nested
 * components, columns, and table rows. Mutates in place.
 */
function repairWidgets(comps: unknown): void {
  if (!Array.isArray(comps)) return;
  for (const c of comps) {
    if (!isPlainObject(c)) continue;
    repairComponentWidget(c);
    repairNestedComponents(c);
  }
}

/**
 * Normalize a Form.io schema — for both import (file upload) and export (download) — into a
 * clean, portable, builder-ready form definition:
 *  1. apply the legacy CHEFS-1 type fix (no-op for current schemas),
 *  2. keep only form-definition fields, dropping engine/document metadata (`name`, `path`,
 *     `tags`, `access`, `submissionAccess`, `properties`, `_id`, `machineName`, `pdfComponents`, …),
 *  3. repair malformed component widgets.
 * Idempotent.
 */
export function normalizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const fixed = transformChefs1Types(schema);
  const out: Node = {};
  for (const f of KEEP_FIELDS) {
    if (fixed[f] !== undefined) out[f] = fixed[f];
  }
  if (out.type === undefined) out.type = 'form';
  if (out.display === undefined) out.display = 'form';
  repairWidgets(out.components);
  return out;
}
