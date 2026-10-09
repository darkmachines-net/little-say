/** @file Validates bundled prompt resources and substitutes named fields once without interpreting data. */

/** Load required nonempty strings from imported JSON, preserving their exact whitespace and bytes. */
export function loadPromptResource<K extends string>(resource: unknown, keys: readonly K[], name: string): Record<K, string> {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error(`Invalid prompt resource: ${name}`);
  const result = {} as Record<K, string>;
  for (const key of keys) {
    const value = (resource as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing or invalid prompt: ${name}.${key}`);
    result[key] = value;
  }
  return result;
}

/** Validate a template's exact field set at initialization; returned substitution never rescans values. */
export function loadPromptTemplate<K extends string>(template: string, fields: readonly K[], name: string): (values: Record<K, string>) => string {
  const tokens = /\{\{([^{}]*)\}\}/g;
  const found = Array.from(template.matchAll(tokens), match => match[1]);
  if (fields.some(field => !found.includes(field)) || found.some(field => !fields.includes(field as K))) throw new Error(`Invalid prompt fields: ${name}`);
  return values => template.replace(tokens, (_token, field: K) => {
    if (typeof values[field] !== 'string') throw new Error(`Missing prompt value: ${name}.${field}`);
    return values[field];
  });
}
