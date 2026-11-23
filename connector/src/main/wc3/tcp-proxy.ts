import * as net from 'net';

export interface TCPProxyOptions {
  localPort: number;
  onConnection: (socket: net.Socket) => void;
  onData: (socket: net.Socket, data: Buffer) => void;
  onClose: (socket: net.Socket) => void;
}

export class TCPProxy {
  private server: net.Server | null = null;
  private connections: Set<net.Socket> = new Set();

  constructor(private options: TCPProxyOptions) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        console.log('TCP proxy already running');
        return resolve();
      }

      this.server = net.createServer((socket) => {
        console.log(`New TCP connection from ${socket.remoteAddress}:${socket.remotePort}`);
        
        this.connections.add(socket);
        this.options.onConnection(socket);

        socket.on('data', (data) => {
          this.options.onData(socket, data);
        });

        socket.on('close', () => {
          console.log(`TCP connection closed from ${socket.remoteAddress}:${socket.remotePort}`);
          this.connections.delete(socket);
          this.options.onClose(socket);
        });

        socket.on('error', (err) => {
          console.error('TCP socket error:', err);
          this.connections.delete(socket);
        });
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${this.options.localPort} is already in use. Please close WC3 or any other application using this port.`);
          reject(new Error(`Port ${this.options.localPort} is already in use`));
        } else {
          console.error('TCP server error:', err);
          reject(err);
        }
      });

      this.server.listen(this.options.localPort, '0.0.0.0', () => {
        console.log(`TCP proxy listening on 0.0.0.0:${this.options.localPort}`);
        resolve();
      });
    });
  }

  stop(): void {
    this.connections.forEach(socket => socket.destroy());
    this.connections.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    console.log('TCP proxy stopped');
  }

  send(socket: net.Socket, data: Buffer): void {
    if (socket.writable) {
      socket.write(data);
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
