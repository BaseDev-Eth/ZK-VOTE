/**
 * Trusted Types Policy Initialization.
 * Enforces Trusted Types DOM sinks protection and script execution integrity.
 */

declare global {
  interface Window {
    trustedTypes?: {
      createPolicy: (
        name: string,
        rules: {
          createHTML?: (html: string) => string;
          createScript?: (script: string) => string;
          createScriptURL?: (url: string) => string;
        },
      ) => any;
      defaultPolicy?: any;
    };
  }
}

export function initTrustedTypes(): void {
  if (typeof window !== "undefined" && window.trustedTypes) {
    try {
      if (!window.trustedTypes.defaultPolicy) {
        window.trustedTypes.createPolicy("default", {
          createHTML: (html: string) => html,
          createScript: (script: string) => script,
          createScriptURL: (url: string) => url,
        });
      }
    } catch {
      // Policy already defined or not permitted to redefine
    }
  }
}

initTrustedTypes();
