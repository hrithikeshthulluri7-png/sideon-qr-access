module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'controllers/**/*.js',
    'routes/**/*.js',
    'utils/**/*.js',
    '!**/*.test.js',
    '!**/node_modules/**',
    '!**/migrate.js',
  ],
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  coverageThreshold: {
    global: {
      branches: 45,
      functions: 40,
      lines: 50,
      statements: 50,
    },
    './utils/tokenGenerator.js': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './routes/qrRoutes.js': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  verbose: true,
  testTimeout: 10000,
};
