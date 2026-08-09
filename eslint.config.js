import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: {
        // The Node 20+ web globals this package is built on. Listed rather than
        // switching on a whole environment preset, so a reach for something
        // genuinely absent still fails.
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        RequestInit: "readonly",
        Headers: "readonly",
        AbortSignal: "readonly",
        globalThis: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { ...tsPlugin.configs.recommended.rules },
  },
  {
    files: ["src/**/__tests__/**/*.ts"],
    languageOptions: {
      globals: {
        describe: "readonly", it: "readonly", expect: "readonly",
        beforeEach: "readonly", afterEach: "readonly", jest: "readonly",
        globalThis: "readonly", Response: "readonly", RequestInit: "readonly",
        Headers: "readonly", fetch: "readonly",
      },
    },
  },
];
