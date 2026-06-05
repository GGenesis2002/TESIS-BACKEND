const pool = require('../config/db');
const reporteController = require('./reporteController');
const { getConfig } = require('./configuracionController');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const validacionController = {
    gestionarValidacion: async (req, res) => {
        const { id_orden, decision, observaciones } = req.body; 
        
        const client = await pool.connect();
        try {
            // 0. Verificar bloqueo de edición según configuración
            const cfg = await getConfig();
            if (cfg.bloqueoEdicion) {
                const { rows: ordenActual } = await client.query(
                    'SELECT estado FROM orden_medica WHERE id_orden = $1', [id_orden]
                );
                const estadosNoEditables = ['Validado', 'Por Validar'];
                if (ordenActual.length > 0 && estadosNoEditables.includes(ordenActual[0].estado)) {
                    return res.status(403).json({
                        msg: `Bloqueado: la orden está en estado "${ordenActual[0].estado}" y el bloqueo de edición está activo. Desactívalo desde Configuración del Sistema si necesitas modificarla.`
                    });
                }
            }

            // 1. Obtener ID de administrador vinculado al usuario logueado
            const adminRes = await client.query(
                'SELECT id_administrador FROM administrador WHERE id_usuario = $1', 
                [req.user.id]
            );
            
            if (adminRes.rows.length === 0) {
                return res.status(403).json({ msg: "El usuario no es un administrador autorizado" });
            }
            const id_admin = adminRes.rows[0].id_administrador;

            let nuevoEstado = (decision === 'VALIDAR') ? 'Validado' : 'Corregir';

            // 2. Iniciar Transacción
            await client.query('BEGIN');
            
            await client.query(
                `UPDATE resultado SET id_administrador = $1, estado = $2, fecha_resultado = CURRENT_TIMESTAMP 
                 WHERE id_orden = $3`, [id_admin, nuevoEstado, id_orden]
            );

            await client.query(
                `UPDATE orden_medica SET estado = $1, observacion_validador = $2, id_validador = $3 WHERE id_orden = $4`,
                [nuevoEstado, observaciones, req.user.id, id_orden]
            );

            // 3. Auditoría — usa client porque estamos dentro de una transacción
            await registrarAuditoria(
                client,
                req.user.id,
                req.user.id_usuario_rol,
                'CAMBIO_ESTADO_ORDEN',
                `Orden ${id_orden} pasada a ${nuevoEstado}. Motivo: ${observaciones}`
            );

            await client.query('COMMIT');

            // 4. Generación del PDF
            if (decision === 'VALIDAR') {
                try {
                    await reporteController.generarArchivoFisicoPDF(id_orden);
                    return res.json({ 
                        msg: `Orden validada con éxito. El PDF ha sido generado/actualizado.`,
                        estado: nuevoEstado 
                    });
                } catch (errPdf) {
                    console.error("Error generando PDF al validar:", errPdf);
                    return res.json({ 
                        msg: `Orden validada, pero hubo un error generando el archivo físico.`,
                        errorPdf: errPdf.message 
                    });
                }
            }

            res.json({ msg: `La orden ha sido enviada a corrección.` });

        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message });
        } finally {
            client.release();
        }
    }
};

module.exports = validacionController;