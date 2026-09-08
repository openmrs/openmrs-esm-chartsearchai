declare module '*.css';
declare module '*.scss';
declare module '*.svg' {
  const content: string;
  export default content;
}

interface Window {
  openmrsBase: string;
  spaBase: string;
}

declare interface RequireContext {
  keys(): string[];
  (id: string): unknown;
  <T>(id: string): T;
  resolve(id: string): string;
  id: string;
}

declare namespace NodeJS {
  interface Require {
    context(directory: string, useSubdirectories?: boolean, regExp?: RegExp, mode?: string): RequireContext;
  }
}

// i18next-parser ships no type declarations. Only the lexer is used, and only from a test that
// compares in-code t() defaults against the catalogue.
declare module 'i18next-parser' {
  export class JsxLexer {
    extract(content: string, filename?: string): Array<{ key: string; defaultValue?: string }>;
  }
}
