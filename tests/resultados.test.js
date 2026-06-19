/**
 * resultados.test.js — Pruebas del módulo de Resultados y Validación
 */

require('./setup');
const request = require('supertest');
const app     = require('../src/app');

const TOKEN_ESPECIALISTA = () => generarToken({ id: 3, id_usuario_rol: 3, roles: ['Especialista']  });
const TOKEN_ADMIN        = () => generarToken({ id: 1, id_usuario_rol: 1, roles: ['Administrador'] });
const TOKEN_PACIENTE     = () => generarToken({ id: 5, id_usuario_rol: 5, roles: ['Paciente']      });

// ─── GUARDAR VALOR ────────────────────────────────────────────────────────────
describe('🧪 Resultados — POST /api/resultados/guardar-valor', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Especialista guarda un valor de parámetro', async () => {
        // pool.query identificado por contenido SQL — inmune al cron
        // limpiarOrdenesExpiradas que corre en background al cargar app.js
        // y puede robarle el turno a mockResolvedValueOnce en una cola estricta.
        mockPool().query.mockImplementation((sql) => {
            if (/SELECT estado FROM resultado/i.test(sql)) {
                return Promise.resolve({ rows: [{ estado: 'En Proceso' }] });
            }
            if (/INSERT INTO detalle_resultado/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_detalle_resultado: 1, valor_obtenido: '5.4' }] });
            }
            if (/INSERT INTO auditoria/i.test(sql)) {
                return Promise.resolve({});
            }
            // cron u otras llamadas de fondo
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .post('/api/resultados/guardar-valor')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`)
            .send({ id_resultado: 1, id_parametro: 1, valor_obtenido: '5.4', observacion: '' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('valor_obtenido', '5.4');
    });

    test('❌ No permite guardar si el resultado está Validado (bloqueado)', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [{ estado: 'Validado' }] });

        const res = await request(app)
            .post('/api/resultados/guardar-valor')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`)
            .send({ id_resultado: 1, id_parametro: 1, valor_obtenido: '5.4' });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/bloqueado/i);
    });

    test('❌ Retorna 404 si el resultado no existe', async () => {
        // rows vacío → el controller devuelve 404
        mockPool().query.mockImplementation((sql) => {
            if (/SELECT estado FROM resultado/i.test(sql)) {
                return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .post('/api/resultados/guardar-valor')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`)
            .send({ id_resultado: 999, id_parametro: 1, valor_obtenido: '5.4' });

        expect(res.status).toBe(404);
    });
});

// ─── MIS ÓRDENES (ESPECIALISTA) ───────────────────────────────────────────────
describe('📂 Resultados — GET /api/resultados/mis-ordenes', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Retorna las órdenes asignadas al especialista', async () => {
        mockPool().query.mockImplementation((sql) => {
            if (/FROM especialista\b/i.test(sql) && !/especialista_examen/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_especialista: 2 }], rowCount: 1 });
            }
            if (/FROM especialista_examen/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_examen: 1 }, { id_examen: 2 }], rowCount: 2 });
            }
            if (/FROM orden_medica/i.test(sql)) {
                return Promise.resolve({
                    rows: [{
                        id_orden:         10,
                        numero_ticket:    'LAB-AA10',
                        estado_orden:     'En Proceso',
                        paciente_nombre:  'María López',
                        paciente_cedula:  '0987654321',
                        estado_resultado: 'En Proceso',
                        mis_examenes:     [{ id_examen: 1, nombre_examen: 'Hemograma', completado: false }],
                    }],
                });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .get('/api/resultados/mis-ordenes')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toHaveProperty('numero_ticket', 'LAB-AA10');
    });

    test('❌ Retorna 403 si el usuario no es especialista en BD', async () => {
        // rowCount: 0 → no encontró el especialista
        mockPool().query.mockImplementation((sql) => {
            if (/FROM especialista\b/i.test(sql) && !/especialista_examen/i.test(sql)) {
                return Promise.resolve({ rows: [], rowCount: 0 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .get('/api/resultados/mis-ordenes')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`);

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/especialista/i);
    });

    test('✅ Retorna array vacío si el especialista no tiene exámenes asignados', async () => {
        mockPool().query
            .mockResolvedValueOnce({ rows: [{ id_especialista: 2 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // sin exámenes asignados

        const res = await request(app)
            .get('/api/resultados/mis-ordenes')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// ─── ENVIAR A REVISIÓN ────────────────────────────────────────────────────────
describe('📤 Resultados — PUT /api/resultados/enviar-revision/:id', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Envía resultado a revisión y cambia estado de la orden', async () => {
        const client = await getMockClient();

        // client.query identificado por contenido SQL — inmune a sobrantes de
        // cola de tests anteriores (mockResolvedValueOnce no consumido se filtra
        // al siguiente test pese a jest.clearAllMocks(), ya que éste no vacía
        // la cola interna de "Once" — solo limpia calls/results/instances).
        client.query.mockImplementation((sql) => {
            if (/^BEGIN/i.test(sql))    return Promise.resolve({});
            if (/^COMMIT/i.test(sql))   return Promise.resolve({});
            if (/^ROLLBACK/i.test(sql)) return Promise.resolve({});
            if (/UPDATE resultado SET estado = 'Por Validar'/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_orden: 10 }] });
            }
            if (/COUNT\(\*\) AS total_examenes/i.test(sql)) {
                return Promise.resolve({ rows: [{ total_examenes: '1', completados: '1' }] });
            }
            if (/UPDATE orden_medica SET estado = 'Por Validar'/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/FROM usuario u\s*$|JOIN usuario_rol ur ON u\.id_usuario/i.test(sql) && /administrador/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_usuario: 1 }] });
            }
            if (/SELECT ur\.id_usuario_rol/i.test(sql) && /administrador/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_usuario_rol: 1 }] });
            }
            if (/INSERT INTO notificacion/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/INSERT INTO auditoria/i.test(sql)) {
                return Promise.resolve({});
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .put('/api/resultados/enviar-revision/1')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`);

        expect(res.status).toBe(200);
        expect(res.body.msg).toMatch(/revisión/i);
        expect(res.body.orden_completada).toBe(true);
    });

    test('❌ Retorna 404 si el resultado no existe', async () => {
        const client = await getMockClient();

        client.query.mockImplementation((sql) => {
            if (/^BEGIN/i.test(sql))    return Promise.resolve({});
            if (/^ROLLBACK/i.test(sql)) return Promise.resolve({});
            if (/UPDATE resultado SET estado = 'Por Validar'/i.test(sql)) {
                return Promise.resolve({ rows: [] }); // 0 filas → id_orden undefined
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .put('/api/resultados/enviar-revision/999')
            .set('Authorization', `Bearer ${TOKEN_ESPECIALISTA()}`);

        expect(res.status).toBe(404);
    });
});

// ─── DEVOLVER AL ESPECIALISTA ─────────────────────────────────────────────────
describe('↩️ Resultados — PUT /api/resultados/devolver/:id_resultado', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Admin devuelve resultado con motivo', async () => {
        const client = await getMockClient();

        client.query.mockImplementation((sql) => {
            if (/^BEGIN/i.test(sql))    return Promise.resolve({});
            if (/^COMMIT/i.test(sql))   return Promise.resolve({});
            if (/^ROLLBACK/i.test(sql)) return Promise.resolve({});
            if (/UPDATE resultado SET estado = 'Devuelto'/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/UPDATE detalle_resultado/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/SELECT id_especialista, id_orden FROM resultado/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_especialista: 2, id_orden: 10 }] });
            }
            if (/UPDATE orden_medica SET observacion_validador/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/UPDATE orden_medica SET estado = 'En Proceso'/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/SELECT id_usuario FROM especialista WHERE/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_usuario: 3 }], rowCount: 1 });
            }
            if (/SELECT ur\.id_usuario_rol/i.test(sql) && /especialista/i.test(sql)) {
                return Promise.resolve({ rows: [{ id_usuario_rol: 3 }] });
            }
            if (/INSERT INTO notificacion/i.test(sql)) {
                return Promise.resolve({});
            }
            if (/INSERT INTO auditoria/i.test(sql)) {
                return Promise.resolve({});
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const res = await request(app)
            .put('/api/resultados/devolver/1')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send({ motivo: 'Valor de glucosa fuera de rango, revisar' });

        expect(res.status).toBe(200);
        expect(res.body.msg).toMatch(/devuelto/i);
    });

    test('❌ Rechaza si no se envía motivo', async () => {
        const res = await request(app)
            .put('/api/resultados/devolver/1')
            .set('Authorization', `Bearer ${TOKEN_ADMIN()}`)
            .send({ motivo: '' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/motivo/i);
    });
});

// ─── RESULTADOS DEL PACIENTE ──────────────────────────────────────────────────
describe('👁️ Pacientes — GET /api/pacientes/mis-resultados/:id_orden', () => {

    beforeEach(() => jest.clearAllMocks());

    test('✅ Paciente ve sus resultados si están Validados', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{
                estado:                'Validado',
                numero_ticket:         'LAB-AA10',
                correo_paciente:       'maria@mail.com',
                nombre_examen:         'Hemograma',
                nombre_parametro:      'Hemoglobina',
                unidad:                'g/dL',
                rango_min:             12,
                rango_max:             16,
                valor_resultado:       '13.5',
                observaciones:         null,
                especialista_procesador: 'Juan Médico',
                validador_firma:       'Dr. García',
            }],
        });

        const res = await request(app)
            .get('/api/pacientes/mis-resultados/10')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(200);
        expect(res.body.data[0]).toHaveProperty('nombre_examen', 'Hemograma');
        expect(res.body.data[0]).toHaveProperty('valor_resultado', '13.5');
    });

    test('❌ No muestra resultados si la orden no está Validada', async () => {
        mockPool().query.mockResolvedValueOnce({
            rows: [{ estado: 'En Proceso', numero_ticket: 'LAB-AA10' }],
        });

        const res = await request(app)
            .get('/api/pacientes/mis-resultados/10')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(403);
        expect(res.body.msg).toMatch(/validados/i);
    });

    test('❌ Retorna 404 si la orden no pertenece al paciente', async () => {
        mockPool().query.mockResolvedValueOnce({ rows: [] });

        const res = await request(app)
            .get('/api/pacientes/mis-resultados/999')
            .set('Authorization', `Bearer ${TOKEN_PACIENTE()}`);

        expect(res.status).toBe(404);
    });
});