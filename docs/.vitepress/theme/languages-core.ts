// The language vocabulary: which languages exist, their canonical display
// order, and their labels. DOM-free on purpose — `language-state.ts` (which
// re-exports these for its consumers) touches `window` for persistence, so
// build-time and Node-test code imports the vocabulary from here instead.

export type TabLanguage = 'ts' | 'python' | 'java' | 'dotnet' | 'go';

export const LANGUAGE_ORDER: readonly TabLanguage[] = ['ts', 'python', 'java', 'dotnet', 'go'];

export const LANGUAGE_LABELS: Record<TabLanguage, string> = {
  ts: 'TypeScript',
  python: 'Python',
  java: 'Java',
  dotnet: 'C# / .NET',
  go: 'Golang',
};

/** Badge-width abbreviations for the language slider's segments. */
export const LANGUAGE_SHORT_LABELS: Record<TabLanguage, string> = {
  ts: 'TS',
  python: 'Py',
  java: 'Ja',
  dotnet: 'C#',
  go: 'Go',
};
