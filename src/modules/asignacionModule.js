const pool = require('../config/db');

const asignacionModule = {
    // Asignar un examen a un especialista
    create: async (id_especialista, id_examen) => {
        const query = `
            INSERT INTO especialista_examen (id_especialista, id_examen) 
            VALUES ($1, $2) RETURNING *`;
        const { rows } = await pool.query(query, [id_especialista, id_examen]);
        return rows[0];
    },

    // NUEVO: Obtener los exámenes asignados de un especialista usando su ID de USUARIO
    getByUsuarioId: async (id_usuario) => {
        const query = `
            SELECT ee.id_asignacion, ee.id_examen, e.nombre_examen
            FROM especialista_examen ee
            JOIN especialista esp ON ee.id_especialista = esp.id_especialista
            JOIN examen e ON ee.id_examen = e.id_examen
            WHERE esp.id_usuario = $1 AND ee.estado = TRUE`;
        const { rows } = await pool.query(query, [id_usuario]);
        return rows;
    },

    // NUEVO: Eliminar físicamente o dar de baja una asignación cruzando id_especialista e id_examen
    deleteSpecific: async (id_especialista, id_examen) => {
        const query = `
            UPDATE especialista_examen 
            SET estado = FALSE 
            WHERE id_especialista = $1 AND id_examen = $2 
            RETURNING *`;
        const { rows } = await pool.query(query, [id_especialista, id_examen]);
        return rows[0];
    },

    // Listar todas las asignaciones activas
    getAllActive: async () => {
        const query = `
            SELECT 
                ae.id_asignacion,
                u.nombres || ' ' || u.apellidos AS nombre_especialista,
                e.nombre_examen,
                ae.estado
            FROM especialista_examen ae
            JOIN especialista esp ON ae.id_especialista = esp.id_especialista
            JOIN usuario u ON esp.id_usuario = u.id_usuario
            JOIN examen e ON ae.id_examen = e.id_examen
            WHERE ae.estado = TRUE
            ORDER BY nombre_especialista ASC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    search: async (termino) => {
        const query = `
            SELECT 
                ae.id_asignacion,
                u.nombres || ' ' || u.apellidos AS nombre_especialista,
                e.nombre_examen,
                ae.estado
            FROM especialista_examen ae
            JOIN especialista esp ON ae.id_especialista = esp.id_especialista
            JOIN usuario u ON esp.id_usuario = u.id_usuario
            JOIN examen e ON ae.id_examen = e.id_examen
            WHERE (u.nombres ILIKE $1 OR u.apellidos ILIKE $1 OR e.nombre_examen ILIKE $1) 
            AND ae.estado = TRUE`;
        const { rows } = await pool.query(query, [`%${termino}%`]);
        return rows;
    },

    logicalDelete: async (id) => {
        const query = 'UPDATE especialista_examen SET estado = FALSE WHERE id_asignacion = $1 RETURNING *';
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    }
};

module.exports = asignacionModule;