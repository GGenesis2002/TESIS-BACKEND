const pool = require('../config/db');

const notificacionModule = {

    /**
     * Crear una notificación para un usuario, asociada a un rol específico.
     * @param {number} id_usuario
     * @param {string} mensaje
     * @param {number|null} id_usuario_rol - FK de usuario_rol.
     */
    crear: async (id_usuario, mensaje, id_usuario_rol = null) => {
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
     * 
     * Esto garantiza compatibilidad hacia atrás con notificaciones ya existentes
     * que fueron creadas sin id_usuario_rol, y a la vez filtra correctamente
     * las nuevas que sí tengan rol asignado.
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

    /**
     * Contar notificaciones no leídas del usuario.
     * Misma lógica: incluye globales (NULL) + las del rol activo.
     */
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

    /**
     * Marcar una notificación como leída (solo si pertenece al usuario).
     */
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

    /**
     * Eliminar físicamente una notificación (solo si pertenece al usuario).
     */
    eliminar: async (id_notificacion, id_usuario) => {
        const query = `
            DELETE FROM notificacion
            WHERE id_notificacion = $1
              AND id_usuario = $2
            RETURNING *`;
        const { rows } = await pool.query(query, [id_notificacion, id_usuario]);
        return rows.length > 0;
    }
};

module.exports = notificacionModule;