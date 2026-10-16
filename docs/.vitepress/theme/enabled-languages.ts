// The build-time language gate, resolved by module resolution so a layout
// missing the config fails the build instead of defaulting the gate off.
// A JSON module exposes only a default export, so the key is destructured from it: removing `languages` from
// the config still fails the build (TS2339) instead of silently guessing which languages it documents.
import docgenConfig from '../../../docgen.config.json' with { type: 'json' };
const { languages } = docgenConfig;
import { LANGUAGE_ORDER, type TabLanguage } from './languages-core';

/** Languages this build documents, in canonical display order. */
export const ENABLED_LANGUAGES: readonly TabLanguage[] = LANGUAGE_ORDER.filter(
  (lang) => (languages as string[]).includes(lang),
);

/** The toggle renders only when there is a choice to make. */
export const LANGUAGE_TOGGLE_VISIBLE = ENABLED_LANGUAGES.length > 1;
