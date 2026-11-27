import * as spec from '@jsii/spec';

/**
 * The jsii stability of a type: its own `docs.stability` when set, otherwise the owning assembly's. The same
 * fallback order the version-history fingerprint uses, so the page and the ledger never disagree about a type.
 *
 * Its own module so the page header and the metadata block can both read it without importing each other.
 */
export function typeStability(type: spec.Type, assembly: spec.Assembly): spec.Stability | undefined {
  return type.docs?.stability ?? assembly.docs?.stability;
}
