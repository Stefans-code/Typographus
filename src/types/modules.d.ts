/// <reference types="vite/client" />

/* Minimal ambient types for libraries that ship without declarations. */

declare module "pagedjs" {
  export interface PagedFlow {
    total: number;
    pages: unknown[];
    performance?: number;
  }
  export class Previewer {
    constructor(options?: unknown);
    preview(
      content: string | Node,
      stylesheets: Array<Record<string, string> | string>,
      renderTo: Element
    ): Promise<PagedFlow>;
  }
  export class Handler {}
  export function registerHandlers(...handlers: unknown[]): void;
}
