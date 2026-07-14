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
    //     {
    //       monto: number,
    //       metodo_pago: "Efectivo" | "Transferencia",
    //       // Los siguientes 3 campos son obligatorios SOLO si metodo_pago = "Transferencia":
    //       referencia?: string,       // número de referencia/comprobante
    //       banco?: string,            // banco desde el que se hizo la transferencia
    //       titular?: string,          // nombre de quien realizó la transferencia
    //       cedula_titular?: string,   // cédula de quien realizó la transferencia
    //     },
    //     // segunda parte opcional para pago mixto (mismo formato):
    //     { monto: number, metodo_pago: "Efectivo" | "Transferencia", referencia?: string, banco?: string, titular?: string, cedula_titular?: string }
    //   ]
    // }
    //
    // Compatibilidad hacia atrás: si el cliente envía { id_orden, monto, metodo_pago }
    // (forma antigua) se normaliza automáticamente a la nueva estructura. Nota: esta
    // forma antigua no incluye banco/titular/cedula_titular, por lo que solo debe
    // usarse para pagos en Efectivo.
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
                            let detalle = '';
                            if (p.metodo_pago === 'Transferencia') {
                                const partes = [];
                                if (p.referencia) partes.push(`REF: ${p.referencia.toUpperCase()}`);
                                if (p.banco) partes.push(`BANCO: ${p.banco.toUpperCase()}`);
                                if (p.titular) partes.push(`TITULAR: ${p.titular.toUpperCase()}`);
                                if (partes.length > 0) detalle = ` (${partes.join(', ')})`;
                            }
                            return `${p.metodo_pago}${detalle}: $${parseFloat(p.monto).toFixed(2)}`;
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
                e.message.includes('obligatoria') ||
                e.message.includes('referencia') ||
                e.message.includes('inválido') ||
                e.message.includes('diferente') ||
                e.message.includes('turno de caja');
                
            res.status(esErrorNegocio ? 400 : 500).json({ error: e.message });
        }
    },

    // POST /pagos/reembolsar
    //
    // Body esperado (reembolso mixto, patrón igual al de /pagos/procesar):
    // {
    //   id_orden: number,
    //   reembolsos: [
    //     {
    //       monto: number,
    //       metodo_reembolso: "Efectivo" | "Transferencia",
    //       // Los siguientes 3 campos son obligatorios SOLO si metodo_reembolso = "Transferencia":
    //       referencia?: string,       // número de referencia/comprobante
    //       banco?: string,            // banco al que se transfiere el reembolso
    //       titular?: string,          // nombre de quien recibe la transferencia
    //       cedula_titular?: string,   // cédula de quien recibe la transferencia
    //     },
    //     // segunda parte opcional para reembolso mixto (mismo formato)
    //   ],
    //   motivo: string
    // }
    //
    // Compatibilidad hacia atrás: si el cliente envía { id_orden, monto, metodo_reembolso, referencia, motivo }
    // (forma antigua) se normaliza automáticamente a la nueva estructura. Nota: esta
    // forma antigua no incluye banco/titular/cedula_titular, por lo que solo debe
    // usarse para reembolsos en Efectivo.
    //
    // Solo se pueden reembolsar órdenes en estado 'Pagada'. Si el monto
    // reembolsado cubre el 100% de lo pagado, la orden pasa a 'Cancelada'.
    // Se admite reembolso parcial (monto menor a lo pagado). Cada parte del
    // reembolso además se valida contra el efectivo/transferencia realmente
    // disponible en el turno de caja activo.
    procesarReembolso: async (req, res) => {
        try {
            const { id_orden, reembolsos, monto, metodo_reembolso, referencia, banco, titular, cedula_titular, motivo } = req.body;

            if (!id_orden) {
                return res.status(400).json({ error: 'id_orden es obligatorio.' });
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

            const resultado = await pagoModule.registrarReembolso({
                id_orden: parseInt(id_orden),
                id_secretaria,
                reembolsos,
                monto,
                metodo_reembolso,
                referencia,
                banco,
                titular,
                cedula_titular,
                motivo,
            });

            const resumenMetodos = resultado.reembolsos
                .map(r => {
                    const ref = r.referencia ? ` (REF: ${r.referencia})` : '';
                    return `${r.metodo_reembolso}${ref}: $${parseFloat(r.monto).toFixed(2)}`;
                })
                .join(' — ');

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
                    await notificacionModule.crear(
                        id_usuario_paciente,
                        `↩️ Se registró un reembolso de $${resultado.total.toFixed(2)} para tu orden #${id_orden}. ${resumenMetodos}.`,
                        rolPac.rows[0]?.id_usuario_rol || null
                    );
                }
            } catch (notifErr) {
                console.error('[REEMBOLSO] Error al enviar notificación:', notifErr.message);
            }

            // ── Auditoría ────────────────────────────────────────────────────
            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'REGISTRO_REEMBOLSO',
                `Reembolso de $${resultado.total.toFixed(2)} registrado para orden #${id_orden} — ${resumenMetodos} — Motivo: ${motivo}`
            );

            res.status(201).json({
                msg: resultado.ordenCancelada
                    ? 'Reembolso procesado con éxito. La orden fue cancelada.'
                    : 'Reembolso parcial procesado con éxito. La orden sigue como PAGADA.',
                reembolsos: resultado.reembolsos,
                total: resultado.total,
                esMixto: resultado.esMixto,
                ordenCancelada: resultado.ordenCancelada,
                disponibleRestante: resultado.disponibleRestante,
            });

        } catch (e) {
            const esErrorNegocio =
                e.message.includes('no existe') ||
                e.message.includes('estado') ||
                e.message.includes('supera') ||
                e.message.includes('obligatorio') ||
                e.message.includes('obligatoria') ||
                e.message.includes('inválido') ||
                e.message.includes('mayor a 0') ||
                e.message.includes('turno de caja') ||
                e.message.includes('mismo día') ||
                e.message.includes('suficiente') ||
                e.message.includes('diferentes') ||
                e.message.includes('máximo 2') ||
                e.message.includes('al menos una parte');
            res.status(esErrorNegocio ? 400 : 500).json({ error: e.message });
        }
    },

    // GET /pagos/reembolsos — reembolsos procesados por la secretaria autenticada
    verReembolsos: async (req, res) => {
        try {
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
            const lista = await pagoModule.reporteReembolsos(id_secretaria);
            res.json(lista);
        } catch (e) {
            res.status(500).json({ error: e.message });
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