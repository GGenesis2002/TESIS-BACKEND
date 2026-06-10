const pagoModule = require('../modules/pagoModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');
const notificacionModule = require('../modules/notificacionModule');

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

            // Notificar al paciente que su pago fue confirmado
            try {
                const pacRes = await pool.query(
                    `SELECT p.id_usuario FROM orden_medica o
                     JOIN paciente p ON o.id_paciente = p.id_paciente
                     WHERE o.id_orden = $1`,
                    [parseInt(id_orden)]
                );
                if (pacRes.rowCount > 0) {
                    const id_usuario_paciente = pacRes.rows[0].id_usuario;
                    const rolPac = await pool.query(
                        `SELECT ur.id_usuario_rol FROM usuario_rol ur
                         JOIN rol r ON ur.id_rol = r.id_rol
                         WHERE ur.id_usuario = $1 AND LOWER(r.nombre) = 'paciente' AND ur.activo = TRUE
                         LIMIT 1`,
                        [id_usuario_paciente]
                    );
                    await notificacionModule.crear(
                        id_usuario_paciente,
                        `✅ Tu pago de $${parseFloat(monto).toFixed(2)} para la orden #${id_orden} fue registrado correctamente. Método: ${metodo_pago}.`,
                        rolPac.rows[0]?.id_usuario_rol || null
                    );
                }
            } catch (notifErr) {
                console.error('[PAGO] Error al enviar notificación:', notifErr.message);
            }

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