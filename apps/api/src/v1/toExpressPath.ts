const parameter = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The parameters of an OpenAPI path template, in order: `/devices/{id}` → `["id"]`. */
export function pathParameters(template: string): string[] {
  return [...template.matchAll(parameter)].map((match) => match[1] ?? "");
}

/**
 * An OpenAPI path template as an Express 5 route path: `{id}` becomes `:id`.
 * Express gives braces, colons, parentheses, `*` and the like meanings of its
 * own, so a template using any of them outside a `{param}` is refused rather
 * than matched differently than it is documented.
 */
export function toExpressPath(template: string): string {
  if (/[{}:()[\]?+!*\\]/.test(template.replace(parameter, ""))) {
    throw new Error(`Unsupported route path ${template}: use literal segments and {param}s only`);
  }
  return template.replace(parameter, ":$1");
}
