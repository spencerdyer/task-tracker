import { TextDecoder, TextEncoder } from 'util';

// jsdom lacks a few browser objects the app reads
Object.assign(globalThis, { TextEncoder, TextDecoder });

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

(globalThis as any).IntersectionObserver = class {
  disconnect() {}
  observe() {}
  takeRecords() { return []; }
  unobserve() {}
};
