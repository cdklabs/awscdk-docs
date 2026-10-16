/**
 * Log hygiene for externally sourced text.
 *
 * Package names, registry and upstream listing fields, and plan-file
 * strings reach job output verbatim. Stripping C0 control characters and
 * DEL leaves such a value unable to carry a terminal escape sequence or
 * invent line structure in the log, while ordinary Unicode text is
 * untouched. Apply it at the sink only: the parsed values, the plans and
 * the workflow outputs stay exactly as read.
 */

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

/** One external string, safe to write to a log. */
export function sanitizeLogText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, '');
}

/** Every external string in a list, safe to write to a log. */
export function sanitizeLogList(values: readonly string[]): string[] {
  return values.map(sanitizeLogText);
}
