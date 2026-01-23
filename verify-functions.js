#!/usr/bin/env node

/**
 * Verification script to check if Azure Functions are properly registered
 */

import { app } from '@azure/functions';

console.log('='.repeat(60));
console.log('Azure Functions Registration Verification');
console.log('='.repeat(60));
console.log('');

// Import the app with registered functions
console.log('Loading functions from src/app.js...');
try {
  await import('./src/app.js');
  console.log('✓ Functions loaded successfully');
} catch (error) {
  console.error('✗ Error loading functions:', error.message);
  process.exit(1);
}

console.log('');
console.log('Checking app object...');
console.log(`- App type: ${typeof app}`);
console.log(`- App constructor: ${app.constructor.name}`);

console.log('');
console.log('='.repeat(60));
console.log('✅ Verification complete!');
console.log('');
console.log('To start the function app locally, run:');
console.log('  npm start');
console.log('');
console.log('The function should be available at:');
console.log('  http://localhost:7071/api/committees/all');
console.log('='.repeat(60));
