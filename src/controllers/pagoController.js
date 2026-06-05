const pagoModule = require('../modules/pagoModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const pagoController = {

    // POST /pagos/procesar
    procesarCobro: async (req, res) => {
        try {
            const { id_orden, monto, metodo_pago } = req.body;

            if (!id_orden || !monto || !metodo_pago) {
                return res.status(400).json({ error: 'id_orden, monto y metodo_pago son obligatorios.' });
            }
            if (parseFloat(monto) <= 0) {
                return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
            }

            const secRes = await pool.query(
                `SELECT id_secretaria FROM asistente_analista WHERE id_usuario = $1`,
                [req.user.id]
            );
            if (secRes.rows.length === 0) {
                return res.status(403).json({
                    error: 'El usuario autenticado no tiene perfil de asistente/secretaria asignado.'
                });
            }

            const id_secretaria = secRes.rows[0].id_secretaria;
            const pagoRealizado = await pagoModule.registrarPago({
                id_orden: parseInt(id_orden),
                id_secretaria,
                monto: parseFloat(monto),
                metodo_pago
            });

            // Auditoría — usa pool (sin transacción)
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'REGISTRO_PAGO',
                `Pago de $${monto} registrado para la orden ID: ${id_orden} — Método: ${metodo_pago}`
            );

            res.status(201).json({
                msg: 'Pago procesado con éxito. La orden ahora está marcada como PAGADA.',
                pago: pagoRealizado
            });
        } catch (e) {
            const esErrorNegocio = e.message.includes('no existe') || e.message.includes('estado');
            res.status(esErrorNegocio ? 400 : 500).json({ error: e.message });
        }
    },

    // GET /pagos/hoy
    verPagosHoy: async (req, res) => {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const lista = await pagoModule.reporteDiario(hoy);
            res.json(lista);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

   // GET /pagos/todos
    verTodosPagos: async (req, res) => {
        try {
            const lista = await pagoModule.reporteTodos();
            res.json(lista);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },
    // GET /pagos/ordenes-generadas
    obtenerOrdenesGeneradas: async (req, res) => {
        try {
            const ordenes = await pagoModule.obtenerOrdenesGeneradas();
            res.json(ordenes);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
};

module.exports = pagoController;