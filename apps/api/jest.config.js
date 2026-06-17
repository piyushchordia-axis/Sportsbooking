/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@sportsbooking/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
  collectCoverageFrom: ['**/*.ts'],
  testEnvironment: 'node',
};
