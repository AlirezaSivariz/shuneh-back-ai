/** Jest config — API integration tests on Express + in-memory MongoDB. */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tests/tsconfig.json" }],
  },
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testTimeout: 30000,
  // One in-memory mongo per worker; keep it simple & deterministic.
  maxWorkers: 1,
  clearMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/server.ts", "!src/seed/**", "!src/**/*.routes.ts"],
};
