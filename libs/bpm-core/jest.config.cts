module.exports = {
  displayName: 'bpm-core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  // `*.real-engine.spec.ts` run in jest.real-engine.config.cts against the
  // installed engines; here `cel-js` is the shim below, so they must not run.
  testPathIgnorePatterns: ['/node_modules/', '\\.real-engine\\.spec\\.ts$'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
    '^.+\\.js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^cel-js$': '<rootDir>/src/lib/testing/cel-js.jest.ts',
  },
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/cel-js@|cel-js)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/bpm-core',
};
