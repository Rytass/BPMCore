module.exports = {
  displayName: 'bpm-core-react',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom',
  transform: {
    // `@mezzanine-ui/*` ships ESM only. Most specs mock it, but a spec that has
    // to exercise a real control (the controlled `Upload`, whose contract a
    // mock would only restate) needs it compiled to CommonJS.
    '/node_modules/.*@mezzanine-ui/.+\\.js$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: { allowJs: true, jsx: 'react-jsx', module: 'commonjs' },
      },
    ],
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/)?@mezzanine-ui)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html'],
  moduleNameMapper: {
    // ESM-only package; see the stub for why the test environment cannot load
    // the real one.
    '^@mezzanine-ui/icons$': '<rootDir>/src/testing/mezzanine-icons.jest.cjs',
    '^@rytass/bpm-core-client/form$':
      '<rootDir>/../bpm-core-client/src/lib/form/index.ts',
    '^@rytass/bpm-core-shared/form$': '<rootDir>/../shared/src/lib/form.ts',
  },
  coverageDirectory: '../../coverage/libs/bpm-core-react',
};
