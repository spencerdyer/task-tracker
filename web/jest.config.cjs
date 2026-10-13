/** Jest: TypeScript through ts-jest, a browser-like DOM from jsdom. */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', esModuleInterop: true, isolatedModules: true } }],
  },
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/src/test/styleStub.cjs',
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
};
