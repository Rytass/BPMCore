module.exports = {
  displayName: 'bpm-core-client',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/bpm-core-client',
  // Pins TZ to Asia/Taipei before workers fork, so
  // `form-rendering.spec.ts`'s calendar-day assertions are independent of
  // the host/CI runner's timezone. See jest.global-setup.ts for why this
  // can't be done inside the spec file itself.
  globalSetup: '<rootDir>/jest.global-setup.ts',
};
