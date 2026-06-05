const pool = require('../config/db');

const categoriaModule = {
    // Crear nueva categoría
    create: async (nombre, descripcion) => {
        const query = `
            INSERT INTO categoria_examen (nombre_categoria, descripcion) 
            VALUES ($1, $2) RETURNING *`;
        const { rows } = await pool.query(query, [nombre, descripcion]);
        return rows[0];
    },

    // Obtener solo las categorías ACTIVAS
    getAllActive: async () => {
        const query = `
            SELECT * FROM categoria_examen 
            WHERE estado = TRUE 
            ORDER BY nombre_categoria ASC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    searchByName: async (termino) => {
        const query = `
            SELECT * FROM categoria_examen 
            WHERE nombre_categoria ILIKE $1 AND estado = TRUE
            ORDER BY nombre_categoria ASC`;
        const { rows } = await pool.query(query, [`%${termino}%`]);
        return rows;
    },
    
    // Obtener solo las categorías INACTIVAS (La Papelera)
    getAllInactive: async () => {
        const query = `
            SELECT * FROM categoria_examen 
            WHERE estado = FALSE 
            ORDER BY nombre_categoria ASC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Obtener una por ID
    getById: async (id) => {
        const query = 'SELECT * FROM categoria_examen WHERE id_categoria = $1';
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    },

    // Actualizar datos
    update: async (id, nombre, descripcion) => {
        const query = `
            UPDATE categoria_examen 
            SET nombre_categoria = $1, descripcion = $2 
            WHERE id_categoria = $3 RETURNING *`;
        const { rows } = await pool.query(query, [nombre, descripcion, id]);
        return rows[0];
    },

    // Eliminación Lógica (Desactivar)
    logicalDelete: async (id) => {
        const query = 'UPDATE categoria_examen SET estado = FALSE WHERE id_categoria = $1';
        const { rowCount } = await pool.query(query, [id]);
        return rowCount > 0;
    },

    // Reactivar categoría
    reactivate: async (id) => {
        const query = 'UPDATE categoria_examen SET estado = TRUE WHERE id_categoria = $1 RETURNING *';
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    }
};

module.exports = categoriaModule;