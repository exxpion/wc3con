import bcrypt from 'bcrypt';
import { dbGetUserByUsername, dbCreateUser } from '../db/index.js';
const SALT_ROUNDS = 10;
export async function setupAuthRoutes(app) {
    // Register
    app.post('/api/auth/register', async (request, reply) => {
        const { username, password } = request.body;
        if (!username || !password) {
            return reply.code(400).send({ error: 'Username and password required' });
        }
        if (username.length < 3 || username.length > 20) {
            return reply.code(400).send({ error: 'Username must be 3-20 characters' });
        }
        if (password.length < 6) {
            return reply.code(400).send({ error: 'Password must be at least 6 characters' });
        }
        const existingUser = dbGetUserByUsername(username);
        if (existingUser) {
            return reply.code(409).send({ error: 'Username already exists' });
        }
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const user = dbCreateUser(username, passwordHash);
        const token = app.jwt.sign({ userId: user.id, username: user.username });
        return reply.send({
            token,
            user: { id: user.id, username: user.username },
        });
    });
    // Login
    app.post('/api/auth/login', async (request, reply) => {
        const { username, password } = request.body;
        if (!username || !password) {
            return reply.code(400).send({ error: 'Username and password required' });
        }
        const user = dbGetUserByUsername(username);
        if (!user) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const token = app.jwt.sign({ userId: user.id, username: user.username });
        return reply.send({
            token,
            user: { id: user.id, username: user.username },
        });
    });
    // Verify token
    app.get('/api/auth/verify', async (request, reply) => {
        try {
            await request.jwtVerify();
            return reply.send({ valid: true, user: request.user });
        }
        catch (err) {
            return reply.code(401).send({ valid: false });
        }
    });
}
//# sourceMappingURL=index.js.map