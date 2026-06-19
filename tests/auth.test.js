/**
 * auth.test.js — Pruebas del módulo de Login y Autenticación
 */

require('./setup');
const request    = require('supertest');
const bcrypt     = require('bcryptjs');
const app        = require('../src/app');
const loginModule = require('../src/modules/loginModule');

// ─── Usuario base para pruebas ────────────────────────────────────────────────
const USUARIO_ACTIVO = {
    id_usuario:     1,
    username:       'admin_test',
    password:       bcrypt.hashSync('Password123', 10),
    nombres:        'Carlos',
    apellidos:      'García',
    correo:         'carlos@lab.com',
    cedula:         '1234567890',
    estado:         true,
    ultimo_acceso:  null,
    roles:          ['Administrador'],
    rolesConId:     [{ nombre: 'Administrador', id_usuario_rol: 1 }],
    id_usuario_rol: 1,
    rol_nombre:     'Administrador',
};

// ─── SUITE: Login ─────────────────────────────────────────────────────────────
describe('🔐 Autenticación — POST /api/login/login', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('✅ Retorna token y datos del usuario con credenciales válidas', async () => {
        // getUserByUsername devuelve el usuario activo
        loginModule.getUserByUsername.mockResolvedValueOnce(USUARIO_ACTIVO);

        // contar intentos fallidos → 0
        // pool.query identificado por contenido SQL — inmune a llamadas extra
        // del cron limpiarOrdenesExpiradas que corre en background al cargar app.js.
        mockPool().query.mockImplementation((sql) => {
            if (/auditoria/i.test(sql) && /LOGIN_FAIL/i.test(sql)) {
                return Promise.resolve({ rows: [{ count: '0' }] });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .post('/api/login/login')
            .send({ username: 'admin_test', password: 'Password123' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toMatchObject({ username: 'admin_test', rol: 'Administrador' });
        expect(res.body.user).not.toHaveProperty('password');
    });

    test('❌ Retorna 401 con contraseña incorrecta', async () => {
        loginModule.getUserByUsername.mockResolvedValueOnce(USUARIO_ACTIVO);

        mockPool().query.mockImplementation((sql) => {
            if (/auditoria/i.test(sql) && /LOGIN_FAIL/i.test(sql)) {
                return Promise.resolve({ rows: [{ count: '0' }] });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .post('/api/login/login')
            .send({ username: 'admin_test', password: 'ClaveWRONG' });

        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/inválidas|Credenciales/i);
    });

    test('❌ Retorna 401 si el usuario no existe', async () => {
        loginModule.getUserByUsername.mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/api/login/login')
            .send({ username: 'no_existe', password: 'cualquiera' });

        expect(res.status).toBe(401);
    });

    test('❌ Retorna 403 si la cuenta está desactivada', async () => {
        loginModule.getUserByUsername.mockResolvedValueOnce({ ...USUARIO_ACTIVO, estado: false });

        const res = await request(app)
            .post('/api/login/login')
            .send({ username: 'admin_test', password: 'Password123' });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/desactivada/i);
    });

    test('❌ Retorna 401 si superó el límite de intentos fallidos', async () => {
        loginModule.getUserByUsername.mockResolvedValueOnce(USUARIO_ACTIVO);

        mockPool().query.mockImplementation((sql) => {
            if (/auditoria/i.test(sql) && /LOGIN_FAIL/i.test(sql)) {
                return Promise.resolve({ rows: [{ count: '5' }] }); // 5 intentos = límite
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .post('/api/login/login')
            .send({ username: 'admin_test', password: 'Password123' });

        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/bloqueada|espera/i);
    });
});

// ─── SUITE: Middleware ────────────────────────────────────────────────────────
describe('🛡️ Middleware verifyToken', () => {

    beforeEach(() => jest.clearAllMocks());

    test('❌ Retorna 403 si no se envía token', async () => {
        const res = await request(app).get('/api/usuarios/all');
        expect(res.status).toBe(403);
        expect(res.body.msg).toMatch(/token/i);
    });

    test('❌ Retorna 401 si el token es inválido', async () => {
        const res = await request(app)
            .get('/api/usuarios/all')
            .set('Authorization', 'Bearer token.falso.invalido');
        expect(res.status).toBe(401);
    });

    test('✅ Permite acceso con token válido', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{ id_usuario: 1, username: 'admin_test', roles: 'Administrador' }],
        });

        const res = await request(app)
            .get('/api/usuarios/all')
            .set('Authorization', `Bearer ${generarToken()}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ─── SUITE: Recuperación ──────────────────────────────────────────────────────
describe('📧 Recuperación — POST /api/login/solicitar-codigo', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Envía código al correo registrado', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [{ id_usuario: 1, nombres: 'Carlos' }] })
            .mockResolvedValueOnce({});

        const res = await request(app)
            .post('/api/login/solicitar-codigo')
            .send({ correo: 'carlos@lab.com' });

        expect(res.status).toBe(200);
        expect(res.body.msg).toMatch(/enviado/i);
    });

    test('❌ Retorna 404 si el correo no existe', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .post('/api/login/solicitar-codigo')
            .send({ correo: 'noexiste@lab.com' });

        expect(res.status).toBe(404);
    });
});