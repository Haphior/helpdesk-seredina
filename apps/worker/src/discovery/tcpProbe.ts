import { Socket } from 'node:net';

// A handful of near-universally-listened-on ports as a liveness heuristic -- not a
// port scanner. An ECONNREFUSED is just as good a signal as an open connection: it
// means something answered at that IP, the port was just closed. Only a timeout
// (nothing answered at all) counts as "not there."
const PROBE_PORTS = [22, 80, 443, 445, 3389, 8080];
const PROBE_TIMEOUT_MS = 300;

function probePort(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const finish = (alive: boolean) => {
      socket.destroy();
      resolve(alive);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      // ECONNREFUSED means a host answered and actively closed the port -- that's a
      // live host, just not listening there. Anything else (EHOSTUNREACH, etc.) isn't.
      finish(err.code === 'ECONNREFUSED');
    });

    socket.connect(port, ip);
  });
}

export async function isHostAlive(ip: string): Promise<boolean> {
  const results = await Promise.all(PROBE_PORTS.map((port) => probePort(ip, port)));
  return results.some(Boolean);
}
