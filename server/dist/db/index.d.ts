import Database from 'better-sqlite3';
import { User, PendingRegistration } from '../types/index.js';
export declare const db: Database.Database;
export declare const dbGetUserByUsername: (username: string) => User | undefined;
export declare const dbGetUserByEmail: (email: string) => User | undefined;
export declare const dbGetUserById: (id: number) => User | undefined;
export declare const dbCreateUser: (username: string, passwordHash: string, email: string, ip: string) => User;
export declare const dbUpdatePassword: (userId: number, passwordHash: string) => void;
export declare const dbCountUsersFromIpToday: (ip: string) => number;
export declare const dbSetLastIp: (userId: number, ip: string) => void;
export declare const dbSavePendingRegistration: (username: string, passwordHash: string, email: string, ip: string) => void;
export declare const dbGetPendingByUsername: (username: string) => PendingRegistration | undefined;
export declare const dbGetPendingByEmail: (email: string) => PendingRegistration | undefined;
export declare const dbDeletePending: (id: number) => void;
export declare const dbCountPendingFromIpToday: (ip: string) => number;
export interface VerificationCodeRow {
    id: number;
    type: string;
    identifier: string;
    code: string;
    expires_at: number;
    created_at: number;
}
export declare const dbSaveVerificationCode: (type: "register" | "reset", identifier: string, code: string) => void;
export declare const dbGetLatestCode: (type: "register" | "reset", identifier: string) => VerificationCodeRow | undefined;
export declare const dbInvalidateCode: (id: number) => void;
export declare function startDbCleanup(): void;
//# sourceMappingURL=index.d.ts.map