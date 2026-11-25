/// <reference types="vite/client" />

import type { DesktopApi } from './types';

declare global {
  interface Window {
    folioDesktop?: DesktopApi;
  }
}

export {};
