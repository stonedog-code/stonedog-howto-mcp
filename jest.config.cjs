/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { useESM: true }] },
  // Relative imports carry a `.js` extension because that is what Node's ESM
  // loader resolves at runtime -- the emitted JS is what actually runs, and
  // TypeScript does not rewrite extensions on emit. Jest sees the `.ts` source,
  // so it needs the extension stripped back off.
  //
  // Without this, jest reports "Cannot find module '../client.js'" and exits
  // with 0 tests -- which reads as a passing suite in anything that only greps
  // for failures.
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**", "!src/index.ts"],
};
