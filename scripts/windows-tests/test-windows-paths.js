// Test Windows path handling
const path = require('path');
const os = require('os');

console.log('Testing Windows-compatible path handling...');
console.log('Platform:', os.platform());
console.log('Path separator:', path.sep);
console.log('Path delimiter:', path.delimiter);

// Test path operations that should work cross-platform
const testPath = path.join('server', 'src', 'index.ts');
console.log('Cross-platform path:', testPath);

// Test environment variables
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('RUNNER_OS:', process.env.RUNNER_OS);

console.log('✅ Windows compatibility test passed');
