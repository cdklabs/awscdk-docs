// Pure copy action for the "Copy Markdown" control. No VitePress or DOM imports, so the theme component passes
// the browser's `fetch` and clipboard in and Jest can drive it with fakes.

export type CopyResult = "copied" | "failed";

export interface CopyDeps {
  fetch: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;
  clipboard: { writeText: (text: string) => Promise<void> };
}

/** Fetches the Markdown file at `url` and writes its text to the clipboard. Never throws: any failure is `failed`. */
export async function copyMarkdownFrom(url: string, deps: CopyDeps): Promise<CopyResult> {
  try {
    const response = await deps.fetch(url);
    if (!response.ok) {
      return "failed";
    }
    await deps.clipboard.writeText(await response.text());
    return "copied";
  } catch {
    return "failed";
  }
}
