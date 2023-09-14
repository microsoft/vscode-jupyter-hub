const { spawn } = require('child_process');

// Spawn a Python process with the -c flag to execute a command
const pythonProcess = spawn('/Users/donjayamanne/crap/.venv/bin/python', ['-c', 'print("Hello, world!")']);

// Listen for the process to output data
pythonProcess.stdout.on('data', (data) => {
    console.log(`Python process output: ${data}`);
});

// Listen for the process to exit
pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
});
