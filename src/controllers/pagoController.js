const pagoModule = require('../modules/pagoModule');
const pool = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');
const notificacionModule = require('../modules/notificacionModule');

const pagoController = {

    // POST /pagos/procesar
    //
    // Body esperado:
    // {
    //   id_orden: number,
    //   pagos: [
    //     { monto: number, metodo_pago: "Efectivo" | "Transferencia", referencia?: string },
    //     // segunda parte opcional para pago mixto:
    //     { monto: number, metodo_pago: "Efectivo" | "Transferencia", referencia?: string }
    //   ]
    // }
    //
    // Compatibilidad hacia atrás: si el cliente envía { id_orden, monto, metodo_pago }
    // (forma antigua) se normaliza automáticamente a la nueva estructura.
    procesarCobro: async (req, res) => {
        try {
            let { id_orden, pagos, monto, metodo_pago } = req.body;

            // ── Compatibilidad hacia atrás ───────────────────────────────────
            if (!pagos && monto && metodo_pago) {
                pagos = [{ monto: parseFloat(monto), metodo_pago }];
            }

            // ── Validaciones básicas ─────────────────────────────────────────
            if (!id_orden) {
                return res.status(400).json({ error: 'id_orden es obligatorio.' });
            }
            if (!Array.isArray(pagos) || pagos.length === 0) {
                return res.status(400).json({ error: 'Debe enviar al menos una parte de pago en el array "pagos".' });
            }

            // ── Obtener perfil de secretaria ─────────────────────────────────
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

            // ── Registrar pagos (uno o mixto) ────────────────────────────────
            const resultado = await pagoModule.registrarPago({
                id_orden: parseInt(id_orden),
                id_secretaria,
                pagos,
            });

            // ── Notificación al paciente ─────────────────────────────────────
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

                    const resumenMetodos = pagos
                        .map(p => {
                            const ref = p.referencia ? ` (REF: ${p.referencia.toUpperCase()})` : '';
                            return `${p.metodo_pago}${ref}: $${parseFloat(p.monto).toFixed(2)}`;
                        })
                        .join(' — ');

                    await notificacionModule.crear(
                        id_usuario_paciente,
                        `✅ Tu pago de $${resultado.total.toFixed(2)} para la orden #${id_orden} fue registrado. ${resumenMetodos}.`,
                        rolPac.rows[0]?.id_usuario_rol || null
                    );
                }
            } catch (notifErr) {
                console.error('[PAGO] Error al enviar notificación:', notifErr.message);
            }

            // ── Auditoría ────────────────────────────────────────────────────
            const resumenAuditoria = pagos
                .map(p => `${p.metodo_pago} $${parseFloat(p.monto).toFixed(2)}`)
                .join(' + ');

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'REGISTRO_PAGO',
                `Pago de $${resultado.total.toFixed(2)} registrado para orden #${id_orden} — ${resumenAuditoria}`
            );

            res.status(201).json({
                msg: resultado.esMixto
                    ? 'Pago mixto procesado con éxito. La orden ahora está PAGADA.'
                    : 'Pago procesado con éxito. La orden ahora está PAGADA.',
                pagos: resultado.pagos,
                total: resultado.total,
                esMixto: resultado.esMixto,
            });

        } catch (e) {
            const esErrorNegocio =
                e.message.includes('no existe') ||
                e.message.includes('estado') ||
                e.message.includes('coincide') ||
                e.message.includes('obligatorio') ||
                e.message.includes('referencia') ||
                e.message.includes('inválido') ||
                e.message.includes('diferente');
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