const pool = require('../config/db');

const Paciente = {
    // Listar todos los usuarios que tienen el rol 'Paciente' activo
    getAll: async () => {
        const query = `
            SELECT
                u.id_usuario,
                u.cedula,
                u.nombres,
                u.apellidos,
                u.correo,
                u.estado,
                u.username,
                p.id_paciente,
                p.fecha_nacimiento,
                p.telefono,
                p.direccion,
                p.genero,
                STRING_AGG(r.nombre, ', ' ORDER BY r.nombre) AS roles
            FROM usuario u
            JOIN paciente p ON u.id_usuario = p.id_usuario
            JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE EXISTS (
                -- Verificar que tenga el rol Paciente activo (aunque tenga otros roles también)
                SELECT 1 FROM usuario_rol ur2
                JOIN rol r2 ON ur2.id_rol = r2.id_rol
                WHERE ur2.id_usuario = u.id_usuario
                  AND r2.nombre = 'Paciente'
                  AND ur2.activo = TRUE
            )
            GROUP BY u.id_usuario, u.cedula, u.nombres, u.apellidos, u.correo,
                     u.estado, u.username, p.id_paciente, p.fecha_nacimiento,
                     p.telefono, p.direccion, p.genero
            ORDER BY u.id_usuario DESC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Buscar por Cédula o Nombre (entre los que tienen rol Paciente)
    search: async (termino) => {
        const query = `
            SELECT
                u.id_usuario,
                u.cedula,
                u.nombres,
                u.apellidos,
                u.correo,
                u.estado,
                p.id_paciente,
                p.fecha_nacimiento,
                p.telefono,
                p.direccion,
                p.genero
            FROM usuario u
            JOIN paciente p ON u.id_usuario = p.id_usuario
            WHERE (
                u.cedula LIKE $1
                OR u.nombres ILIKE $1
                OR u.apellidos ILIKE $1
                OR CONCAT(u.nombres, ' ', u.apellidos) ILIKE $1
            )
            AND u.estado = TRUE
            AND EXISTS (
                SELECT 1 FROM usuario_rol ur
                JOIN rol r ON ur.id_rol = r.id_rol
                WHERE ur.id_usuario = u.id_usuario
                  AND r.nombre = 'Paciente'
                  AND ur.activo = TRUE
            )`;
        const { rows } = await pool.query(query, [`%${termino}%`]);
        return rows;
    },

    // Obtener perfil completo de un paciente con todos sus roles
    getById: async (id) => {
        const query = `
            SELECT
                u.id_usuario,
                u.cedula,
                u.nombres,
                u.apellidos,
                u.correo,
                u.username,
                u.estado,
                p.id_paciente,
                p.fecha_nacimiento,
                p.telefono,
                p.direccion,
                p.genero
            FROM usuario u
            JOIN paciente p ON u.id_usuario = p.id_usuario
            WHERE u.id_usuario = $1`;
        const { rows } = await pool.query(query, [id]);
        if (!rows[0]) return null;

        const paciente = rows[0];

        // Cargar todos sus roles por separado
        const { rows: roles } = await pool.query(`
            SELECT r.id_rol, r.nombre AS rol_nombre
            FROM usuario_rol ur
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE ur.id_usuario = $1 AND ur.activo = TRUE
            ORDER BY r.nombre ASC`, [id]);

        paciente.roles = roles.map(r => r.rol_nombre);
        return paciente;
    },

    // Desactivar (Eliminación lógica del usuario completo)
    logicalDelete: async (id) => {
        const query = `UPDATE usuario SET estado = FALSE WHERE id_usuario = $1`;
        const { rowCount } = await pool.query(query, [id]);
        return rowCount > 0;
    },

    // Reactivar
    reactivate: async (id) => {
        const query = `UPDATE usuario SET estado = TRUE WHERE id_usuario = $1 RETURNING *`;
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    }
};

module.exports = Paciente;