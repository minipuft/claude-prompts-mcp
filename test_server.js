#!/usr/bin/env node

// Simple test script to verify server startup
const { spawn } = require('child_process');
const path = require('path');

console.log('Testing MCP Server startup...');

const serverPath = path.join(__dirname, 'server', 'dist', 'index.js');
console.log('Server path:', serverPath);

// Test 1: Check if server can show help
console.log('\n=== Test 1: Help Command ===');
const helpProcess = spawn('node', [serverPath, '--help'], {
    stdio: 'pipe',
    cwd: path.join(__dirname, 'server')
});

let helpOutput = '';
let helpError = '';

helpProcess.stdout.on('data', (data) => {
    helpOutput += data.toString();
});

helpProcess.stderr.on('data', (data) => {
    helpError += data.toString();
});

helpProcess.on('close', (code) => {
    console.log(`Help command exit code: ${code}`);
    if (helpOutput) {
        console.log('Help output:', helpOutput.substring(0, 200) + '...');
    }
    if (helpError) {
        console.log('Help stderr:', helpError);
    }
    
    // Test 2: Try to start server with debug output (timeout after 5 seconds)
    console.log('\n=== Test 2: Server Startup (5 second timeout) ===');
    const startProcess = spawn('node', [serverPath, '--debug-startup'], {
        stdio: 'pipe',
        cwd: path.join(__dirname, 'server')
    });

    let startOutput = '';
    let startError = '';

    startProcess.stdout.on('data', (data) => {
        startOutput += data.toString();
    });

    startProcess.stderr.on('data', (data) => {
        startError += data.toString();
    });

    // Kill after 5 seconds
    const timeout = setTimeout(() => {
        console.log('Killing server after 5 seconds...');
        startProcess.kill('SIGINT');
    }, 5000);

    startProcess.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`Server startup exit code: ${code}`);
        if (startOutput) {
            console.log('Server stdout:', startOutput);
        }
        if (startError) {
            console.log('Server stderr:', startError);
        }
        
        // Analyze results
        console.log('\n=== Analysis ===');
        const hasError = startError.includes('Error') || startError.includes('error');
        const hasSuccess = startError.includes('successfully') || startOutput.includes('successfully');
        
        if (hasError) {
            console.log('❌ Server startup had errors');
        } else if (hasSuccess) {
            console.log('✅ Server appears to start successfully');
        } else {
            console.log('⚠️  Server startup status unclear');
        }
    });

    startProcess.on('error', (error) => {
        clearTimeout(timeout);
        console.log('Server startup error:', error);
    });
});

helpProcess.on('error', (error) => {
    console.log('Help command error:', error);
});