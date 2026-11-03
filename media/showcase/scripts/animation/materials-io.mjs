// Reading and writing v3/materials.json (D97): one canonical layout, so an edit that changes a value and a later edit that changes it back leave the same bytes
// (the bible server rewrites the file from its parsed form, as it does the beat ledger). One line per property: `"mass": {"value": 1, "intent": "weighted", "ref": null},`.
// The ranges live in v3/materials.schema.json (read by probe-materials.py, the bible page and the server); this module holds layout only.
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const MATERIALS_FILE = path.join(root, 'v3/materials.json');
export const SCHEMA_FILE = path.join(root, 'v3/materials.schema.json');

/** `{"value":1,"intent":"x","ref":null}` with the spaces after `:` and `,` that the layout carries. */
export const ratedText = (rated) => (rated === null ? 'null' : `{"value": ${JSON.stringify(rated.value)}, "intent": ${JSON.stringify(rated.intent)}, "ref": ${JSON.stringify(rated.ref)}}`);

export const layout = (data) => {
  const blocks = Object.entries(data).map(([id, material]) => {
    const rows = Object.entries(material).map(([field, rated]) => `    ${JSON.stringify(field)}: ${ratedText(rated)}`);
    return `  ${JSON.stringify(id)}: {\n${rows.join(',\n')}\n  }`;
  });
  return `{\n${blocks.join(',\n')}\n}\n`;
};

export const readMaterialsText = (file = MATERIALS_FILE) => fs.readFileSync(file, 'utf8');

/** Parsed materials, refusing a file the canonical layout would not reproduce (rewriting it would reformat the whole file). */
export const loadMaterials = (file = MATERIALS_FILE) => {
  const text = readMaterialsText(file);
  const data = JSON.parse(text);
  if (layout(data) !== text) throw new Error(`${path.relative(root, file)} is not in the canonical materials layout (one property per line), so rewriting it would reformat the whole file; edit it by hand`);
  return data;
};

export const writeMaterials = (data, file = MATERIALS_FILE) => fs.writeFileSync(file, layout(data));

export const loadSchema = (file = SCHEMA_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The non-null branch of a property's schema and whether null is allowed: `{nullable, value: {type, minimum, ...}}`. */
export const propertyShape = (schema, field) => {
  const prop = schema.$defs.material.properties[field];
  const branches = prop.anyOf ?? [prop];
  const object = branches.find((b) => b.type === 'object');
  return {nullable: branches.some((b) => b.type === 'null'), value: object.properties.value, description: prop.description ?? ''};
};
