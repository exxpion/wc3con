import Database from 'better-sqlite3';
import { User } from '../types/index.js';
export declare const db: Database.Database;
export declare const dbGetUserByUsername: (username: string) => User | undefined;
export declare const dbGetUserById: (id: number) => User | undefined;
export declare const dbCreateUser: (username: string, passwordHash: string) => User;
//# sourceMappingURL=index.d.ts.map