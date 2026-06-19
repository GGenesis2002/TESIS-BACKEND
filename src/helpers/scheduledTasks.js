const cron = require('node-cron');
const pool = require('../config/db');
const { registrarAuditoria } = require('./auditoria');

// ── JOB 1: Desactivar pacientes sin login en 30 días ──────────────────────
// Corre todos los días a medianoche
cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Revisando pacientes inactivos...');
    try {
        const { rows } = await pool.query(`
            UPDATE usuario
            SET estado = FALSE
            WHERE estado = TRUE
              AND ultimo_acceso < NOW() - INTERVAL '30 days'
              AND id_usuario IN (
                  SELECT ur.id_usuario FROM usuario_rol ur
                  JOIN rol r ON ur.id_rol = r.id_rol
                  WHERE r.nombre = 'Paciente' AND ur.activo = TRUE
              )
            RETURNING id_usuario
        `);

        for (const row of rows) {
            await registrarAuditoria(
                pool, null, null,
                'AUTO_DESACTIVAR_PACIENTE',
                `Paciente ID ${row.id_usuario} desactivado por inactividad de 30 días`
            );
        }
        console.log(`[CRON] Pacientes desactivados: ${rows.length}`);
    } catch (e) {
        console.error('[CRON] Error desactivando pacientes:', e.message);
    }
});
console.log('[CRON] ✅ JOB 1 registrado — corre a medianoche');


// ── JOB 2: Eliminar resultados con más de 90 días ─────────────────────────
// Corre a la 1:00 AM para no coincidir con el job anterior
cron.schedule('0 1 * * *', async () => {
    console.log('[CRON] Limpiando resultados viejos...');
    try {
        const { rows: viejos } = await pool.query(`
            SELECT r.id_resultado 
            FROM resultado r
            JOIN orden_medica o ON r.id_orden = o.id_orden
            WHERE o.fecha_orden < NOW() - INTERVAL '90 days'
              AND r.estado = 'Validado'
        `);

        for (const row of viejos) {
            await pool.query(
                'DELETE FROM detalle_resultado WHERE id_resultado = $1',
                [row.id_resultado]
            );
            await pool.query(
                'DELETE FROM resultado WHERE id_resultado = $1',
                [row.id_resultado]
            );
            await registrarAuditoria(
                pool, null, null,
                'AUTO_ELIMINAR_RESULTADO',
                `Resultado ID ${row.id_resultado} eliminado automáticamente (90 días)`
            );
        }
        console.log(`[CRON] Resultados eliminados: ${viejos.length}`);
    } catch (e) {
        console.error('[CRON] Error limpiando resultados:', e.message);
    }
});
console.log('[CRON] ✅ JOB 2 registrado — corre a la 1:00 AM'); 