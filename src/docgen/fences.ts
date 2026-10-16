/**
 * The single fence tokenizer shared by every fence-aware README pass, so their
 * notions of "fenced code" cannot disagree. A fence opens on a line carrying a
 * run of three or more backticks or tildes after at most three spaces of
 * indent (optionally inside blockquote markers), and closes only on a run of
 * the SAME marker at least as long, at the same blockquote depth, whose
 * remainder is blank. A four-space-indented marker is an indented code block,
 * not a fence, and a fence opened inside a blockquote ends when the blockquote
 * does.
 */

/** One span of a markdown document. Joining span texts with '\n' reconstructs the input. */
export interface FenceSpan {
  kind: 'code' | 'prose';
  /** Exact source lines of the span; for code spans this includes the fence lines. */
  text: string;
  /** Fence marker character, code spans only. */
  marker?: '`' | '~';
  /** Opening marker run length, code spans only. */
  run?: number;
  /** Length of the opening fence's prefix (indent plus any blockquote markers), code spans only. */
  indent?: number;
  /** Opening fence info string (text after the marker run), code spans only. */
  info?: string;
  /** Blockquote depth of the opening fence (0 = not inside a blockquote), code spans only. */
  depth?: number;
  /**
   * Whether a matching closing fence line was found (and is the span's last
   * line). A fence terminated by its enclosing blockquote ending is NOT
   * closed — it has no closer line to slice off — but does not run to the
   * end of input either.
   */
  closed?: boolean;
}

const FENCE = /^((?: {0,3}> ?)* {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE_PREFIX = /^(?: {0,3}> ?)*/;

/** Number of blockquote markers prefixing the line. */
function quoteDepth(line: string): number {
  const prefix = QUOTE_PREFIX.exec(line)![0];
  return (prefix.match(/>/g) ?? []).length;
}

/** Split markdown into alternating prose and fenced-code spans. */
export function tokenizeFences(markdown: string): FenceSpan[] {
  const spans: FenceSpan[] = [];
  const lines = markdown.split('\n');
  let buffer: string[] = [];
  let open: FenceSpan | undefined;

  const flushProse = () => {
    if (buffer.length) {
      spans.push({ kind: 'prose', text: buffer.join('\n') });
      buffer = [];
    }
  };
  const closeSpan = (closed: boolean) => {
    open!.text = buffer.join('\n');
    open!.closed = closed;
    spans.push(open!);
    open = undefined;
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      // A quoted fence ends with its blockquote; the line is reprocessed.
      // Not `closed`: there is no closer line for a consumer to slice off.
      if (open.depth! > 0 && quoteDepth(line) < open.depth!) {
        closeSpan(false);
        i--;
        continue;
      }
      buffer.push(line);
      const match = FENCE.exec(line);
      if (match && match[2][0] === open.marker && match[2].length >= open.run!
        && match[3].trim() === '' && quoteDepth(line) === open.depth!) {
        closeSpan(true);
      }
      continue;
    }
    const match = FENCE.exec(line);
    if (match) {
      flushProse();
      const [, prefix, run, info] = match;
      open = {
        kind: 'code',
        text: '',
        marker: run[0] as '`' | '~',
        run: run.length,
        indent: prefix.length,
        info,
        closed: false,
        depth: quoteDepth(line),
      };
    }
    buffer.push(line);
  }

  if (open) {
    closeSpan(false);
  }
  flushProse();
  return spans;
}

/**
 * Apply `fn` to the prose of a markdown document, leaving fenced code blocks
 * and inline code spans untouched.
 */
export function mapProse(markdown: string, fn: (prose: string) => string): string {
  return tokenizeFences(markdown)
    .map((span) => (span.kind === 'code'
      ? span.text
      : span.text
        .split(/(`[^`\n]*`)/)
        .map((seg, i) => (i % 2 === 1 ? seg : fn(seg)))
        .join('')))
    .join('\n');
}

/**
 * Wrap `code` in a backtick fence that the code cannot close: the delimiter is one backtick longer than the longest
 * backtick run inside `code`, and never shorter than three. `info` is the info string (`ts`, `ts {1,3}`), emitted
 * as-is after the opening delimiter.
 */
export function codeFence(code: string, info = ''): string[] {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  const delimiter = '`'.repeat(Math.max(3, longest + 1));
  return [`${delimiter}${info}`, code, delimiter];
}
