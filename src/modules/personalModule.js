const pool = require('../config/db');

const Personal = {
    // Obtener todo el personal (no-pacientes) con todos sus roles
    getAllStaff: async () => {
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
            JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE r.nombre IN ('Administrador', 'Tecnico', 'Especialista', 'asistente_analista')
            GROUP BY u.id_usuario, u.cedula, u.nombres, u.apellidos, u.correo, u.username, u.estado
            ORDER BY u.id_usuario DESC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Obtener solo los especialistas activos (para selectores en asignaciones/órdenes)
    getAllEspecialistas: async () => {
        const query = `
            SELECT
                u.id_usuario,
                u.nombres,
                u.apellidos,
                u.nombres || ' ' || u.apellidos AS nombre_completo,
                e.id_especialista,
                e.especialidad
            FROM usuario u
            JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
            JOIN rol r ON ur.id_rol = r.id_rol AND r.nombre = 'Especialista'
            JOIN especialista e ON u.id_usuario = e.id_usuario
            WHERE u.estado = TRUE
            ORDER BY u.apellidos ASC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Obtener detalles completos de un especialista (para firmas y reportes)
    getEspecialista: async (id_usuario) => {
        const query = `
            SELECT
                u.id_usuario,
                u.cedula,
                u.nombres,
                u.apellidos,
                u.correo,
                u.estado,
                e.especialidad,
                e.id_especialista,
                STRING_AGG(r.nombre, ', ' ORDER BY r.nombre) AS roles
            FROM usuario u
            JOIN especialista e ON u.id_usuario = e.id_usuario
            JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE u.id_usuario = $1
            GROUP BY u.id_usuario, u.cedula, u.nombres, u.apellidos, u.correo, u.estado,
                     e.especialidad, e.id_especialista`;
        const { rows } = await pool.query(query, [id_usuario]);
        return rows[0];
    }
};

module.exports = Personal;