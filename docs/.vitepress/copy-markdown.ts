// Pure copy action for the "Copy Markdown" control. No VitePress or DOM imports, so the theme component passes
// the browser's `fetch` and clipboard in and Jest can drive it with fakes.

export type CopyResult = "copied" | "failed";

export interface CopyDeps {
  fetch: (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;
  clipboard: {
    writeText: (text: string) => Promise<void>;
    /** Present where `ClipboardItem` exists. Takes the items built by `item`. */
    write?: (items: unknown[]) => Promise<void>;
  };
  /** Builds a clipboard item that resolves to the text later. Needed with `write`; absent where unsupported. */
  item?: (text: Promise<string>) => unknown;
}

/**
 * Fetches the Markdown file at `url` and writes its text to the clipboard. Never throws: any failure is `failed`.
 *
 * Call it straight from the click handler. Where `write` and `item` exist, the clipboard write starts before the
 * fetch finishes and is handed a promise for the text, so a slow fetch cannot outlast the click's user activation
 * (WebKit rejects the write otherwise). Elsewhere it falls back to `writeText` after the text arrives.
 */
export async function copyMarkdownFrom(url: string, deps: CopyDeps): Promise<CopyResult> {
  try {
    const text = deps.fetch(url).then((response) => {
      if (!response.ok) throw new Error("Markdown fetch failed");
      return response.text();
    });
    // A failed write below is reported as `failed`; this keeps the same rejection from also surfacing unhandled.
    text.catch(() => undefined);
    if (deps.clipboard.write && deps.item) {
      await deps.clipboard.write([deps.item(text)]);
    } else {
      await deps.clipboard.writeText(await text);
    }
    return "copied";
  } catch {
    return "failed";
  }
}
