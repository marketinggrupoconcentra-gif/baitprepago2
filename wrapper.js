const { spawn } = require('child_process');
const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\\run.ps1']);

ps.stdout.on('data', data => console.log(data.toString()));
ps.stderr.on('data', data => console.error(data.toString()));

ps.on('close', code => console.log(`child process exited with code ${code}`));

setTimeout(() => {
  ps.stdin.write('Control10*2026#\r\n');
}, 5000);
