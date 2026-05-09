module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^cel-js$': '<rootDir>/src/testing/cel-js.jest.ts',
  },
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/cel-js@|cel-js)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api',
};
