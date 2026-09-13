import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build / test / tooling artifacts (incl. de agentes paralelos):
    "test-results/**",
    "playwright-report/**",
    "coverage/**",
    ".vercel/**",
    ".workspace/**",
    ".agents/**",
    ".codex/**",
    ".claude/**",
    "docs/**",
    "scratch*.ts",
    "scratch*.mjs",
    // Zona protegida: landing vanilla en producción (no se reescribe con reglas de Next)
    "public/legacy/**",
    "public/assets/site.js",
  ]),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ]
    }
  }
]);

export default eslintConfig;
