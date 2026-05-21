import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const mapMode = args.includes('-map');
const forceHttp = args.includes('--http');
const forwardedArgs = args.filter((arg) => arg !== '-map' && arg !== '--http');

if (!forwardedArgs.includes('--host')) {
  forwardedArgs.push('--host');
}

const viteExecutable = process.platform === 'win32'
  ? 'node_modules\\vite\\bin\\vite.js'
  : 'node_modules/vite/bin/vite.js';

const blockedNetworkHost = '10.255.255.254';

function shouldSkipLine(line) {
  return line.includes('Network:') && line.includes(blockedNetworkHost);
}

function forwardStreamWithFilter(stream, destination) {
  let buffer = '';

  stream.on('data', (chunk) => {
    buffer += chunk.toString();

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!shouldSkipLine(line)) {
        destination.write(`${line}\n`);
      }
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0 && !shouldSkipLine(buffer)) {
      destination.write(buffer);
    }
  });
}

const child = spawn(
  process.execPath,
  [viteExecutable, ...forwardedArgs],
  {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VITE_APP_MODE: mapMode ? 'map' : (process.env.VITE_APP_MODE ?? 'play'),
      VITE_DEV_HTTPS: forceHttp ? '0' : '1',
    },
  }
);

if (child.stdout) {
  forwardStreamWithFilter(child.stdout, process.stdout);
}

if (child.stderr) {
  forwardStreamWithFilter(child.stderr, process.stderr);
}

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
