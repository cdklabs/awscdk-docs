/**
 * Editorial data for the top level of the sidebar's Framework section.
 *
 * This file is data, not logic: edit the list to change what readers see first. Every Framework module that is not
 * listed here nests under its package root (`aws-cdk-lib.pipelines` under `aws-cdk-lib`), or under
 * {@link FrameworkNav.defaultParent} when its package root is not listed either (the `@aws-cdk/*` framework
 * packages), so nothing disappears from the nav. A listed module that the build does not document is skipped.
 *
 * `section` is the package-qualified module name the sidebar already uses as the section's identity
 * (`aws-cdk-lib.custom_resources`). `label` only changes what is displayed: links, anchors, collapse memory and
 * group keys keep `section`, and the in-sidebar filter matches both. See
 * docs/adr/2026-10-15-sidebar-navigation.md, "Framework / Services split".
 */

export interface FrameworkNavEntry {
  /** Package-qualified module name, exactly as `frameworkSectionName()` produces it. */
  readonly section: string;
  /** Friendly display label; omit to display the module name. */
  readonly label?: string;
}

export interface FrameworkNav {
  /** Top-level Framework entries, in display order. */
  readonly topLevel: readonly FrameworkNavEntry[];
  /** Section that adopts unlisted modules whose own package root is not listed. Must appear in `topLevel`. */
  readonly defaultParent: string;
}

export const FRAMEWORK_NAV: FrameworkNav = {
  topLevel: [
    { section: 'aws-cdk-lib' },
    { section: 'aws-cdk-lib.custom_resources', label: 'Custom Resources' },
    { section: 'aws-cdk-lib.assertions', label: 'Testing' },
    { section: 'aws-cdk-lib.triggers', label: 'Triggers' },
    { section: 'constructs' },
  ],
  defaultParent: 'aws-cdk-lib',
};
