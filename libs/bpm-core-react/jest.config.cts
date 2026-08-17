module.exports = {
  displayName: 'bpm-core-react',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  moduleNameMapper: {
    '^@rytass/bpm-core-client/form$':
      '<rootDir>/../bpm-core-client/src/lib/form/index.ts',
    '^@rytass/bpm-core-shared/form$': '<rootDir>/../shared/src/lib/form.ts',
  },
  coverageDirectory: '../../coverage/libs/bpm-core-react',
};
