

require('./setup');
const request = require('supertest');
const app     = require('../src/app');

const TOKEN_PACIENTE   = () => generarToken({ id: 5, roles: ['Paciente']       });
const TOKEN_ADMIN      = () => generarToken({ id: 1, roles: ['Administrador']  });

const EXAMENES_VALIDOS = [
    { id_examen: 1, precio: 15.00 },
    { id_examen: 2, precio: 25.00 },
];

// ─── CREACIÓN POR PACIENTE ────────────────────────────────────────────────────
describe('📋 Órdenes — POST /api/ordenes/paciente/generar', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ El paciente crea su propia orden correctamente', async () => {
        const pool   = mockPool();
        const client = await getMockClient();

        // pool.query identificado por contenido SQL — inmune a llamadas extra
        // (p.ej. el cron limpiarOrdenesExpiradas que corre en background y puede
        // robarle el turno a la query que realmente nos interesa si usáramos
        // mockResolvedValueOnce en una cola estricta).
        pool.query.mockImplementation((sql) => {
            if (/id_paciente/i.test(sql) && /usuario/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_paciente: 10 }], rowCount: 1 });
            }
            // registrarAuditoria u otras llamadas (incluido el cron de fondo)
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        // client.query identificado por contenido SQL — misma protección.
        client.query.mockImplementation((sql) => {
            if (/^BEGIN/i.test(sql))                    return Promise.resolve({});
            if (/INSERT INTO orden_medica/i.test(sql))  return Promise.resolve({ rows: [{ id_orden: 50 }] });
            if (/INSERT INTO detalle_orden/i.test(sql)) return Promise.resolve({});
            if (/UPDATE orden_medica/i.test(sql))       return Promise.resolve({});
            if (/^COMMIT/i.test(sql))                   return Promise.resolve({});
            if (/^ROLLBACK/i.test(sql))                 return Promise.resolve({});
            return Promise.resolve({});
        });

        const res = await request(app)
            .post('/api/ordenes/paciente/generar')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`)
            .send({ examenes: EXAMENES_VALIDOS });

        if (res.status !== 200) {
            console.log('DEBUG res.body:', JSON.stringify(res.body));
        }

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ticket');
        expect(res.body).toHaveProperty('qr');
        expect(res.body.msg).toMatch(/QR válido/i);
    });

    test('❌ Rechaza si el array de exámenes está vacío', async () => {
        const res = await request(app)
            .post('/api/ordenes/paciente/generar')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`)
            .send({ examenes: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/al menos un examen/i);
    });

    test('❌ Rechaza si los exámenes son números planos (formato incorrecto)', async () => {
        const res = await request(app)
            .post('/api/ordenes/paciente/generar')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`)
            .send({ examenes: [1, 2, 3] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/formato/i);
    });

    test('❌ Rechaza si el examen no tiene precio', async () => {
        const res = await request(app)
            .post('/api/ordenes/paciente/generar')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`)
            .send({ examenes: [{ id_examen: 1 }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/formato/i);
    });

    test('❌ Retorna 403 si el paciente no está registrado en la BD', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post('/api/ordenes/paciente/generar')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`)
            .send({ examenes: EXAMENES_VALIDOS });

        expect(res.status).toBe(403);
    });
});

// ─── LISTADO ──────────────────────────────────────────────────────────────────
describe('📂 Órdenes — GET /api/ordenes', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Admin ve todas las órdenes', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [
                { id_orden: 1, numero_ticket: 'LAB-AA01', estado: 'Generada', nombres: 'María' },
                { id_orden: 2, numero_ticket: 'LAB-BB02', estado: 'Pagada',   nombres: 'Juan'  },
            ],
        });

        const res = await request(app)
            .get('/api/ordenes')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
    });

    test('✅ Paciente solo ve sus propias órdenes', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [{ id_paciente: 5 }], rowCount: 1 })
            .mockResolvedValueOnce({
                rows: [{ id_orden: 3, numero_ticket: 'LAB-CC03', estado: 'Generada' }],
            });

        const res = await request(app)
            .get('/api/ordenes')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
    });

    test('✅ Paciente sin órdenes recibe array vacío', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .get('/api/ordenes')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// ─── DETALLE ──────────────────────────────────────────────────────────────────
describe('🔍 Órdenes — GET /api/ordenes/:id/detalle', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Retorna exámenes con su categoría', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{
                id_detalle: 1, id_orden: 10, id_examen: 1, subtotal: 15.00,
                nombre_examen: 'Hemograma', nombre_categoria: 'Hematología',
            }],
        });

        const res = await request(app)
            .get('/api/ordenes/10/detalle')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body[0]).toHaveProperty('nombre_examen', 'Hemograma');
        expect(res.body[0]).toHaveProperty('nombre_categoria', 'Hematología');
    });
});

// ─── CANCELAR ────────────────────────────────────────────────────────────────
describe('🚫 Órdenes — PATCH /api/ordenes/:id/cancelar', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Cancela una orden en estado Generada', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [{ estado: 'Generada' }] })
            .mockResolvedValueOnce({ rows: [{ id_orden: 1, estado: 'Cancelada' }] })
            .mockResolvedValueOnce({});

        const res = await request(app)
            .patch('/api/ordenes/1/cancelar')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send({ motivo: 'Error en exámenes' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('❌ No permite cancelar una orden Pagada', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [{ estado: 'Pagada' }] });

        const res = await request(app)
            .patch('/api/ordenes/1/cancelar')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send({ motivo: 'Quiero cancelar' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/No se puede cancelar/i);
    });

    test('❌ Retorna 404 si la orden no existe', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .patch('/api/ordenes/999/cancelar')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send({ motivo: 'No existe' });

        expect(res.status).toBe(404);
    });
});

// ─── ELIMINAR ────────────────────────────────────────────────────────────────
describe('🗑️ Órdenes — DELETE /api/ordenes/:id', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Elimina una orden en estado Cancelada', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [{ estado: 'Cancelada', id_paciente: 10 }] })
            .mockResolvedValueOnce({})  // DELETE detalle_orden
            .mockResolvedValueOnce({})  // DELETE orden_medica
            .mockResolvedValueOnce({}); // registrarAuditoria

        const res = await request(app)
            .delete('/api/ordenes/1')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('❌ No permite eliminar una orden En Proceso', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [{ estado: 'En Proceso', id_paciente: 10 }] });

        const res = await request(app)
            .delete('/api/ordenes/1')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/No se puede eliminar/i);
    });
});
