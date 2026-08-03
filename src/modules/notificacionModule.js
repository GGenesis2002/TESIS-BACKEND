const pool = require('../config/db');

const notificacionModule = {

    /**
     * Crear una notificación para un usuario, asociada a un rol específico.
     * @param {number} id_usuario
     * @param {string} mensaje
     * @param {number|null} id_usuario_rol - FK de usuario_rol.
     *   OBLIGATORIO pasarlo explícitamente. Usa null SOLO si la notificación
     *   es intencionalmente global (debe verse sin importar el rol activo).
     */
    crear: async (id_usuario, mensaje, id_usuario_rol) => {
        if (id_usuario_rol === undefined) {
            throw new Error(
                `notificacionModule.crear() fue llamado sin id_usuario_rol. ` +
                `Pasa el id_usuario_rol correspondiente, o null explícito si es ` +
                `intencionalmente global. (usuario: ${id_usuario}, mensaje: "${mensaje}")`
            );
        }

        const query = `
            INSERT INTO notificacion (id_usuario, mensaje, id_usuario_rol)
            VALUES ($1, $2, $3)
            RETURNING *`;
        const { rows } = await pool.query(query, [id_usuario, mensaje, id_usuario_rol]);
        return rows[0];
    },

    /**
     * Obtener notificaciones del usuario.
     * Muestra:
     *   1. Notificaciones del rol activo (id_usuario_rol = el del rol en sesión)
     *   2. Notificaciones globales/legacy (id_usuario_rol IS NULL)
     */
    getByUser: async (id_usuario, id_usuario_rol = null) => {
        const query = `
            SELECT * FROM notificacion
            WHERE id_usuario = $1
              AND (
                  id_usuario_rol IS NULL
                  OR id_usuario_rol = $2
              )
            ORDER BY fecha DESC
            LIMIT 30`;
        const { rows } = await pool.query(query, [id_usuario, id_usuario_rol]);
        return rows;
    },

    contarNoLeidas: async (id_usuario, id_usuario_rol = null) => {
        const query = `
            SELECT COUNT(*)::int AS count
            FROM notificacion
            WHERE id_usuario = $1
              AND leido = FALSE
              AND (
                  id_usuario_rol IS NULL
                  OR id_usuario_rol = $2
              )`;
        const { rows } = await pool.query(query, [id_usuario, id_usuario_rol]);
        return rows[0].count;
    },

    marcarLeida: async (id_notificacion, id_usuario) => {
        const query = `
            UPDATE notificacion
            SET leido = TRUE
            WHERE id_notificacion = $1
              AND id_usuario = $2
            RETURNING *`;
        const { rows } = await pool.query(query, [id_notificacion, id_usuario]);
        return rows[0];
    },

    eliminar: async (id_notificacion, id_usuario) => {
        const query = `
            DELETE FROM notificacion
            WHERE id_notificacion = $1
              AND id_usuario = $2
            RETURNING *`;
        const { rows } = await pool.query(query, [id_notificacion, id_usuario]);
        return rows.length > 0;
    },

    /**
     * Eliminar automáticamente las notificaciones con más de 30 días (1 mes).
     * Se usa desde el cron de scheduledTasks.js. La eliminación MANUAL (botón
     * del usuario, vía notificacionController.eliminarNotificacion) sigue
     * funcionando igual y de forma independiente a esta limpieza automática.
     */
    eliminarAntiguas: async () => {
        const query = `
            DELETE FROM notificacion
            WHERE fecha < NOW() - INTERVAL '30 days'
            RETURNING id_notificacion`;
        const { rows } = await pool.query(query);
        return rows;
    }
};

module.exports = notificacionModule;