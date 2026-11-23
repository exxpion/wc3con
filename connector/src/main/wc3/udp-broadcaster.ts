import * as dgram from 'dgram';
import { buildGameInfoPacket, parseSearchGamePacket, GameInfo } from './protocol';

export class UDPBroadcaster {
  private socket: dgram.Socket | null = null;
  private games: Map<string, GameInfo> = new Map();
  private broadcastInterval: NodeJS.Timeout | null = null;

  constructor(private port: number = 6112) {}

  start(): void {
    if (this.socket) {
      console.log('UDP broadcaster already running');
      return;
    }

    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      console.error('UDP socket error:', err);
      this.stop();
    });

    this.socket.on('message', (msg, rinfo) => {
      // Check if this is a W3GS_SEARCHGAME packet from WC3
      if (parseSearchGamePacket(msg)) {
        console.log(`WC3 client searching for games from ${rinfo.address}:${rinfo.port}`);
        this.respondWithGameList(rinfo.address, rinfo.port);
      }
    });

    this.socket.on('listening', () => {
      const address = this.socket!.address();
      console.log(`UDP broadcaster listening on ${address.address}:${address.port}`);
      this.socket!.setBroadcast(true);
    });

    this.socket.bind(this.port, '0.0.0.0');

    // Broadcast game list every 5 seconds
    this.broadcastInterval = setInterval(() => {
      this.broadcastGameList();
    }, 5000);
  }

  stop(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    console.log('UDP broadcaster stopped');
  }

  addGame(roomId: string, game: GameInfo): void {
    this.games.set(roomId, game);
    console.log(`Added game: ${game.name} (${roomId})`);
    this.broadcastGameList();
  }

  removeGame(roomId: string): void {
    this.games.delete(roomId);
    console.log(`Removed game: ${roomId}`);
  }

  clearGames(): void {
    this.games.clear();
  }

  private broadcastGameList(): void {
    if (!this.socket || this.games.size === 0) return;

    this.games.forEach((game) => {
      const packet = buildGameInfoPacket(game);
      
      // Broadcast to local network
      this.socket!.send(packet, this.port, '255.255.255.255', (err) => {
        if (err) {
          console.error('Failed to broadcast game:', err);
        }
      });

      // Also send to localhost explicitly for testing
      this.socket!.send(packet, this.port, '127.0.0.1', (err) => {
        if (err) {
          console.error('Failed to send to localhost:', err);
        }
      });
    });
  }

  private respondWithGameList(address: string, port: number): void {
    if (!this.socket) return;

    this.games.forEach((game) => {
      const packet = buildGameInfoPacket(game);
      this.socket!.send(packet, port, address, (err) => {
        if (err) {
          console.error(`Failed to respond to ${address}:${port}:`, err);
        }
      });
    });
  }
}
