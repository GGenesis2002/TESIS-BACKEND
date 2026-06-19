/**
 * pacientes.test.js — Pruebas del módulo de Pacientes
 */

require('./setup');
const request = require('supertest');
const app     = require('../src/app');

const NUEVO_PACIENTE = {
    cedula:           '0987654321',
    nombres:          'María',
    apellidos:        'López',
    correo:           'maria@mail.com',
    username:         'maria_lopez',
    password:         'Segura123',
    fecha_nacimiento: '1990-05-15',
    telefono:         '0991234567',
    direccion:        'Calle Falsa 123',
    genero:           'F',
};

const TOKEN_ADMIN    = () => generarToken({ roles: ['Administrador'] });
const TOKEN_PACIENTE = () => generarToken({ id: 5, roles: ['Paciente'] });

// ─── REGISTRO ─────────────────────────────────────────────────────────────────
describe('👤 Pacientes — POST /api/pacientes/registro', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Registra un paciente nuevo correctamente', async () => {
        const pool   = mockPool();
        const client = await getMockClient();

        // 1. Verificar duplicados (ninguno) — vía pool.query
        pool.query.mockImplementation((sql) => {
            if (/cedula_existe/i.test(sql)) {
                return Promise.resolve({
                    rows: [{ cedula_existe: 0, correo_existe: 0, username_existe: 0, telefono_existe: 0 }],
                });
            }
            // Cualquier otra query a pool.query (p.ej. el cron de limpieza de órdenes
            // expiradas que corre en background) recibe una respuesta segura por defecto,
            // para no desfasar las queries que sí nos interesan.
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        // client.query identificado por contenido SQL — inmune a llamadas extra
        // (p.ej. si algún proceso de fondo usa el mismo client mockeado).
        client.query.mockImplementation((sql) => {
            if (/^BEGIN/i.test(sql))                 return Promise.resolve({});
            if (/INSERT INTO usuario\s*\(/i.test(sql)) return Promise.resolve({ rows: [{ id_usuario: 10 }] });
            if (/INSERT INTO usuario_rol/i.test(sql))  return Promise.resolve({});
            if (/INSERT INTO paciente/i.test(sql))     return Promise.resolve({});
            if (/INSERT INTO auditoria/i.test(sql))    return Promise.resolve({});
            if (/^COMMIT/i.test(sql))                  return Promise.resolve({});
            if (/^ROLLBACK/i.test(sql))                return Promise.resolve({});
            return Promise.resolve({});
        });

        const res = await request(app)
            .post('/api/pacientes/registro')
            .send(NUEVO_PACIENTE);

        if (res.status !== 201) {
            console.log('DEBUG res.body:', JSON.stringify(res.body));
        }

        expect(res.status).toBe(201);
        expect(res.body.msg).toMatch(/registrado/i);
        expect(res.body).toHaveProperty('id_usuario');
    });

    test('❌ Rechaza si la cédula ya está registrada', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{ cedula_existe: 1, correo_existe: 0, username_existe: 0, telefono_existe: 0 }],
        });

        const res = await request(app)
            .post('/api/pacientes/registro')
            .send(NUEVO_PACIENTE);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/cédula/i);
    });

    test('❌ Rechaza si el correo ya existe', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{ cedula_existe: 0, correo_existe: 1, username_existe: 0, telefono_existe: 0 }],
        });

        const res = await request(app)
            .post('/api/pacientes/registro')
            .send(NUEVO_PACIENTE);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/correo/i);
    });

    test('❌ Rechaza si el username ya está en uso', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{ cedula_existe: 0, correo_existe: 0, username_existe: 1, telefono_existe: 0 }],
        });

        const res = await request(app)
            .post('/api/pacientes/registro')
            .send(NUEVO_PACIENTE);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/usuario/i);
    });

    test('❌ Rechaza si el teléfono ya está registrado', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{ cedula_existe: 0, correo_existe: 0, username_existe: 0, telefono_existe: 1 }],
        });

        const res = await request(app)
            .post('/api/pacientes/registro')
            .send(NUEVO_PACIENTE);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/teléfono/i);
    });
});

// ─── LISTADO ──────────────────────────────────────────────────────────────────
describe('📋 Pacientes — GET /api/pacientes', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Admin ve la lista de pacientes', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [
                { id_usuario: 1, nombres: 'María', apellidos: 'López', cedula: '0987' },
                { id_usuario: 2, nombres: 'Juan',  apellidos: 'Pérez', cedula: '1234' },
            ],
        });

        const res = await request(app)
            .get('/api/pacientes')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0]).toHaveProperty('cedula');
    });

    test('✅ Retorna array vacío si no hay pacientes', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/api/pacientes')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// ─── PERFIL PROPIO ────────────────────────────────────────────────────────────
describe('🪪 Pacientes — GET /api/pacientes/perfil', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ El paciente ve su propio perfil', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{
                id_usuario: 5, cedula: '0987654321', nombres: 'María',
                apellidos: 'López', correo: 'maria@mail.com', username: 'maria_lopez',
                telefono: '0991234567', direccion: 'Calle 123', genero: 'F', fecha_nacimiento: '1990-05-15',
            }],
        });

        const res = await request(app)
            .get('/api/pacientes/perfil')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(200);
        expect(res.body.perfil).toHaveProperty('nombres', 'María');
    });

    test('❌ Retorna 404 si el perfil no existe', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/api/pacientes/perfil')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(404);
    });
});

// ─── ACTUALIZACIÓN ────────────────────────────────────────────────────────────
describe('✏️ Pacientes — PUT /api/pacientes/:id', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Actualiza datos del paciente', async () => {
        const pool   = mockPool();
        const client = await getMockClient();

        pool.query.mockResolvedValueOnce({ rows: [{ cedula_existe: 0, correo_existe: 0 }] });
        client.query
            .mockResolvedValueOnce({})  // BEGIN
            .mockResolvedValueOnce({})  // UPDATE usuario
            .mockResolvedValueOnce({})  // UPDATE paciente
            .mockResolvedValueOnce({})  // registrarAuditoria
            .mockResolvedValueOnce({}); // COMMIT

        const res = await request(app)
            .put('/api/pacientes/5')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send({ ...NUEVO_PACIENTE, nombres: 'María Actualizada' });

        expect(res.status).toBe(200);
        expect(res.body.msg).toMatch(/actualizados/i);
    });

    test('❌ Rechaza si la nueva cédula pertenece a otro usuario', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [{ cedula_existe: 1, correo_existe: 0 }] });

        const res = await request(app)
            .put('/api/pacientes/5')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send(NUEVO_PACIENTE);

        expect(res.status).toBe(400);
        expect(res.body.msg).toMatch(/cédula/i);
    });
});

// ─── DESACTIVAR / REACTIVAR ───────────────────────────────────────────────────
describe('🗑️ Pacientes — DELETE /api/pacientes/:id', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Desactiva paciente (eliminación lógica)', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rowCount: 1 })  // logicalDelete
            .mockResolvedValueOnce({});               // registrarAuditoria

        const res = await request(app)
            .delete('/api/pacientes/5')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body.msg).toMatch(/papelera/i);
    });

    test('❌ Retorna 404 si el paciente no existe', async () => {
        mockPool().query.mockResolvedValueOnce({ rowCount: 0 });

        const res = await request(app)
            .delete('/api/pacientes/999')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(404);
    });
});

describe('♻️ Pacientes — PUT /api/pacientes/reactivar/:id', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Reactiva un paciente desactivado', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [{ id_usuario: 5, estado: true }] });

        const res = await request(app)
            .put('/api/pacientes/reactivar/5')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body.msg).toMatch(/reactivado/i);
    });
});