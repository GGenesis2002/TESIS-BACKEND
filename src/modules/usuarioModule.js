const pool = require('../config/db');

const Usuario = {
    // Listar todos los usuarios con todos sus roles concatenados
    getAll: async () => {
        const query = `
            SELECT
                u.id_usuario,
                u.cedula,
                u.nombres,
                u.apellidos,
                u.correo,
                u.username,
                u.estado,
                STRING_AGG(r.nombre, ', ' ORDER BY r.nombre) AS roles
            FROM usuario u
            LEFT JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
            LEFT JOIN rol r ON ur.id_rol = r.id_rol
            GROUP BY u.id_usuario, u.cedula, u.nombres, u.apellidos, u.correo, u.username, u.estado
            ORDER BY u.id_usuario DESC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Obtener usuario por ID con su lista de roles como array
    getById: async (id) => {
        const queryUsuario = `
            SELECT id_usuario, cedula, nombres, apellidos, correo, username, estado
            FROM usuario
            WHERE id_usuario = $1`;
        const { rows: usuarioRows } = await pool.query(queryUsuario, [id]);
        if (!usuarioRows[0]) return null;

        const usuario = usuarioRows[0];

        const queryRoles = `
            SELECT r.id_rol, r.nombre AS rol_nombre
            FROM usuario_rol ur
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE ur.id_usuario = $1 AND ur.activo = TRUE
            ORDER BY r.nombre ASC`;
        const { rows: roles } = await pool.query(queryRoles, [id]);

        usuario.roles = roles; // [{ id_rol: 1, rol_nombre: 'Administrador' }, ...]
        return usuario;
    },

    // Asignar un nuevo rol a un usuario (si ya existe lo reactiva)
    asignarRol: async (id_usuario, id_rol) => {
        const query = `
            INSERT INTO usuario_rol (id_usuario, id_rol, activo)
            VALUES ($1, $2, TRUE)
            ON CONFLICT (id_usuario, id_rol)
            DO UPDATE SET activo = TRUE
            RETURNING *`;
        const { rows } = await pool.query(query, [id_usuario, id_rol]);
        return rows[0];
    },

    // Quitar un rol a un usuario (baja lógica)
    quitarRol: async (id_usuario, id_rol) => {
        const query = `
            UPDATE usuario_rol SET activo = FALSE
            WHERE id_usuario = $1 AND id_rol = $2
            RETURNING *`;
        const { rows } = await pool.query(query, [id_usuario, id_rol]);
        return rows[0];
    },

    // Actualizar estado global (activar/desactivar usuario completo)
    updateStatus: async (id) => {
        const query = `UPDATE usuario SET estado = NOT estado WHERE id_usuario = $1 RETURNING estado`;
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    }
};

module.exports = Usuario;