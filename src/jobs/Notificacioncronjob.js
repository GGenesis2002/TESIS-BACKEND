/**
 * notificacionCronJob.js
 *
 * Tareas programadas para el sistema de notificaciones.
 * Ejecutar este archivo una vez al arrancar el servidor (ej: en app.js o server.js):
 *
 *   require('./jobs/notificacionCronJob');
 *
 * Requiere: npm install node-cron
 */

const cron = require('node-cron');
const pool = require('../config/db');
const notificacionModule = require('../modules/notificacionModule');

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1: Alertar órdenes sin pagar después de 2 días
// Se ejecuta todos los días a las 8:00 AM
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Revisando órdenes sin pagar con más de 2 días...');

    try {
        /**
         * Busca órdenes que:
         * - No han sido pagadas (estado = 'pendiente' o como lo manejes)
         * - Fueron creadas hace más de 2 días
         * - No tienen ya una notificación de este tipo enviada (evita spam)
         *
         * AJUSTA los nombres de tabla/columna según tu base de datos:
         *   - "orden"           → tu tabla de órdenes
         *   - "id_orden"        → PK de la orden
         *   - "id_usuario"      → FK al paciente dueño de la orden
         *   - "id_usuario_rol"  → FK a usuario_rol del paciente (puede ser NULL)
         *   - "estado_pago"     → columna que indica si fue pagada
         *   - "fecha_creacion"  → fecha en que se generó la orden
         */
        const query = `
            SELECT
                o.id_orden,
                o.numero_ticket,
                p.id_usuario,
                ur.id_usuario_rol,
                o.fecha_orden
            FROM orden_medica o
            JOIN paciente p ON o.id_paciente = p.id_paciente
            JOIN usuario_rol ur ON ur.id_usuario = p.id_usuario
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE o.estado = 'Generada'
              AND o.fecha_orden <= NOW() - INTERVAL '2 days'
              AND LOWER(r.nombre) = 'paciente'
              AND ur.activo = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM notificacion n
                  WHERE n.id_usuario = p.id_usuario
                    AND n.mensaje LIKE '%pendiente de pago%'
                    AND n.fecha >= NOW() - INTERVAL '3 days'
              )
        `;

        const { rows: ordenesPendientes } = await pool.query(query);

        if (ordenesPendientes.length === 0) {
            console.log('[CRON] Sin órdenes pendientes que alertar hoy.');
            return;
        }

        for (const orden of ordenesPendientes) {
            await notificacionModule.crear(
                orden.id_usuario,
                `⚠️ Tienes una orden pendiente de pago (Ticket #${orden.numero_ticket}). Han pasado más de 2 días desde que la generaste. Por favor, acércate a cancelarla antes de que expire.`,
                orden.id_usuario_rol ?? null
            );
        }

        console.log(`[CRON] Se enviaron ${ordenesPendientes.length} notificaciones de pago pendiente.`);
    } catch (e) {
        console.error('[CRON] Error al procesar órdenes sin pagar:', e.message);
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCCIONES: Notificación "Resultados listos"
// ─────────────────────────────────────────────────────────────────────────────
//
// Esta notificación NO va en el cron — se dispara en el momento exacto
// en que el laboratorio carga los resultados de una orden.
//
// En el controller donde guardas/actualizas resultados (ej: resultadoController.js),
// agrega esto después de guardar exitosamente:
//
//   const notificacionModule = require('../modules/notificacionModule');
//
//   await notificacionModule.crear(
//       orden.id_usuario,               // paciente dueño de la orden
//       `✅ Tus resultados del examen #${orden.id_orden} ya están listos. Puedes revisarlos en la aplicación.`,
//       orden.id_usuario_rol ?? null    // rol activo del paciente (si aplica)
//   );
//
// Eso es todo — el módulo y las rutas ya están listos para recibirla.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {};