// Lets `node --test` load the TypeScript sources directly: `src/` writes
// relative imports without an extension, which Node's ESM resolver rejects,
// so this hook appends `.ts` when such a file exists. Node 24 strips the
// types itself.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[A-Za-z0-9]+$/.test(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return {
          url: candidate.href,
          format: "module-typescript",
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});
