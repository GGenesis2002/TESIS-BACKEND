const pool = require('../config/db');

const examenModule = {
    // Crear examen — ahora incluye tipo_resultado
    create: async (data) => {
        const { id_categoria, nombre_examen, precio, descripcion, tipo_resultado } = data;
        const query = `
            INSERT INTO examen (id_categoria, nombre_examen, precio, descripcion, tipo_resultado) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        const { rows } = await pool.query(query, [
            id_categoria, nombre_examen, precio, descripcion,
            tipo_resultado || 'PARAMETROS'
        ]);
        return rows[0];
    },
getByCategoria: async (idCategoria) => {
    const query = `
        SELECT e.*, c.nombre_categoria
        FROM examen e
        JOIN categoria_examen c
            ON e.id_categoria = c.id_categoria
        WHERE e.estado = TRUE
          AND e.id_categoria = $1
        ORDER BY e.nombre_examen ASC
    `;

    const { rows } = await pool.query(query, [idCategoria]);
    return rows;
},
    // Obtener activos con el nombre de su categoría
    getAllActive: async () => {
        const query = `
            SELECT e.*, c.nombre_categoria 
            FROM examen e
            JOIN categoria_examen c ON e.id_categoria = c.id_categoria
            WHERE e.estado = TRUE
            ORDER BY c.nombre_categoria ASC, e.nombre_examen ASC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Obtener inactivos (Papelera)
    getAllInactive: async () => {
        const query = `
            SELECT e.*, c.nombre_categoria 
            FROM examen e
            JOIN categoria_examen c ON e.id_categoria = c.id_categoria
            WHERE e.estado = FALSE
            ORDER BY e.nombre_examen ASC`;
        const { rows } = await pool.query(query);
        return rows;
    },

    // Búsqueda por nombre
    searchByName: async (termino) => {
        const query = `
            SELECT e.*, c.nombre_categoria 
            FROM examen e
            JOIN categoria_examen c ON e.id_categoria = c.id_categoria
            WHERE e.nombre_examen ILIKE $1 AND e.estado = TRUE
            ORDER BY e.nombre_examen ASC`;
        const { rows } = await pool.query(query, [`%${termino}%`]);
        return rows;
    },

    // Obtener por ID
    getById: async (id) => {
        const query = `
            SELECT e.*, c.nombre_categoria 
            FROM examen e
            JOIN categoria_examen c ON e.id_categoria = c.id_categoria
            WHERE e.id_examen = $1`;
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    },

    // Actualizar — ahora incluye tipo_resultado
    update: async (id, data) => {
        const { id_categoria, nombre_examen, precio, descripcion, tipo_resultado } = data;
        const query = `
            UPDATE examen 
            SET id_categoria = $1, nombre_examen = $2, precio = $3, 
                descripcion = $4, tipo_resultado = $5
            WHERE id_examen = $6 RETURNING *`;
        const { rows } = await pool.query(query, [
            id_categoria, nombre_examen, precio, descripcion,
            tipo_resultado || 'PARAMETROS', id
        ]);
        return rows[0];
    },

    // Desactivar (Eliminación Lógica)
    logicalDelete: async (id) => {
        const query = 'UPDATE examen SET estado = FALSE WHERE id_examen = $1';
        const { rowCount } = await pool.query(query, [id]);
        return rowCount > 0;
    },

    // Reactivar
    reactivate: async (id) => {
        const query = 'UPDATE examen SET estado = TRUE WHERE id_examen = $1 RETURNING *';
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    }
};

module.exports = examenModule;