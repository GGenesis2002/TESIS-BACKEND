const pool = require('../config/db');

const loginModule = {
    // Busca al usuario por username y devuelve TODOS sus roles activos
    getUserByUsername: async (username) => {
        // 1. Datos base del usuario (sin id_rol)
        const queryUsuario = `
            SELECT u.id_usuario, u.cedula, u.nombres, u.apellidos,
                   u.correo, u.username, u.password, u.estado, u.ultimo_acceso
            FROM usuario u
            WHERE u.username = $1 AND u.estado = TRUE`;

        const { rows: usuarioRows } = await pool.query(queryUsuario, [username]);
        if (!usuarioRows[0]) return null;

        const usuario = usuarioRows[0];

        // 2. Todos los roles activos del usuario — ahora incluye id_usuario_rol
        const queryRoles = `
            SELECT ur.id_usuario_rol, r.id_rol, r.nombre AS rol_nombre
            FROM usuario_rol ur
            JOIN rol r ON ur.id_rol = r.id_rol
            WHERE ur.id_usuario = $1 AND ur.activo = TRUE`;

        const { rows: roles } = await pool.query(queryRoles, [usuario.id_usuario]);

        // Array simple de nombres de roles: ['Administrador', 'Especialista']
        usuario.roles = roles.map(r => r.rol_nombre);

        // Array completo con id_usuario_rol por cada rol
        // Ejemplo: [{ nombre: 'Administrador', id_usuario_rol: 3 }, ...]
        usuario.rolesConId = roles.map(r => ({
            nombre: r.rol_nombre,
            id_usuario_rol: r.id_usuario_rol
        }));

        // Primer id_usuario_rol (rol principal por defecto)
        usuario.id_usuario_rol = roles[0]?.id_usuario_rol || null;

        // Compatibilidad con middlewares que aún esperan rol_nombre como string
        usuario.rol_nombre = usuario.roles[0] || null;

        return usuario;
    },

    // Registra el acceso exitoso y actualiza el timestamp
    recordAccess: async (id_usuario, ip) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                'UPDATE usuario SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id_usuario = $1',
                [id_usuario]
            );

            await client.query(
                'INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)',
                [id_usuario, 'LOGIN', `Inicio de sesión exitoso`]
            );

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    // Registra intentos fallidos (Seguridad preventiva)
    recordFailure: async (id_usuario, mensaje, ip) => {
        try {
            await pool.query(
                'INSERT INTO auditoria (id_usuario, accion, descripcion) VALUES ($1, $2, $3)',
                [id_usuario, 'LOGIN_FAIL', `${mensaje} | IP: ${ip}`]
            );
        } catch (e) {
            console.error("Error en auditoría de fallo:", e);
        }
    }
};

module.exports = loginModule;