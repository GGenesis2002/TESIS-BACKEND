const cron = require('node-cron');
const pool = require('../config/db');
const { registrarAuditoria } = require('./auditoria');

// Zona horaria del laboratorio. Render (y la mayoría de hosts) corren en UTC
// por defecto, así que sin esto los jobs se ejecutaban a las 7pm/8pm hora
// Ecuador en vez de a medianoche/1am como se pensaba.
const TZ = 'America/Guayaquil';

// ── JOB 1: Desactivar pacientes sin login en 30 días ──────────────────────
// Corre todos los días a medianoche (hora Ecuador)
cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Revisando pacientes inactivos...');
    try {
        const { rows } = await pool.query(`
            UPDATE usuario
            SET estado = FALSE
            WHERE estado = TRUE
              AND ultimo_acceso IS NOT NULL
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

        // Pacientes con ultimo_acceso = NULL nunca entran a la condición de
        // arriba (NULL < fecha siempre es NULL, no true), así que jamás se
        // desactivarían solos aunque lleven años sin loguearse. En vez de
        // desactivarlos a ciegas (un paciente recién registrado también
        // tiene ultimo_acceso NULL y sería injusto desactivarlo), los
        // dejamos registrados en auditoría para que un admin los revise.
        const { rows: sinAcceso } = await pool.query(`
            SELECT u.id_usuario
            FROM usuario u
            JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE u.estado = TRUE
              AND u.ultimo_acceso IS NULL
              AND r.nombre = 'Paciente'
              AND ur.activo = TRUE
        `);

        if (sinAcceso.length > 0) {
            await registrarAuditoria(
                pool, null, null,
                'REVISAR_PACIENTES_SIN_ACCESO',
                `${sinAcceso.length} paciente(s) activos nunca han iniciado sesión ` +
                `(ultimo_acceso NULL) y no se desactivaron automáticamente. IDs: ` +
                `${sinAcceso.map(r => r.id_usuario).join(', ')}`
            );
            console.log(`[CRON] Pacientes sin acceso registrado (requieren revisión manual): ${sinAcceso.length}`);
        }
    } catch (e) {
        console.error('[CRON] Error desactivando pacientes:', e.message);
    }
}, { timezone: TZ });
console.log(`[CRON] ✅ JOB 1 registrado — corre a medianoche (${TZ})`);


// ── JOB 2: Eliminar resultados con más de 90 días ─────────────────────────
// Corre a la 1:00 AM (hora Ecuador) para no coincidir con el job anterior
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
}, { timezone: TZ });
console.log(`[CRON] ✅ JOB 2 registrado — corre a la 1:00 AM (${TZ})`);