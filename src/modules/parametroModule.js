const pool = require('../config/db');

const parametroModule = {
    // Crear un parámetro con discriminación de sexo y edad
    create: async (data) => {
        const { 
            id_examen, nombre_parametro, unidad, 
            rango_min, rango_max, valor_referencia,
            sexo_referencia, edad_min, edad_max 
        } = data;

        const query = `
            INSERT INTO parametro_examen (
                id_examen, nombre_parametro, unidad, 
                rango_min, rango_max, valor_referencia, 
                sexo_referencia, edad_min, edad_max
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
        
        const { rows } = await pool.query(query, [
            id_examen, nombre_parametro, unidad,
            // rango_min/rango_max son NOT NULL en la tabla; para parámetros
            // cualitativos (texto/opciones) no se usan, así que se guarda 0 como relleno.
            rango_min === '' || rango_min === undefined || rango_min === null ? 0 : rango_min,
            rango_max === '' || rango_max === undefined || rango_max === null ? 0 : rango_max,
            // valor_referencia se reutiliza para guardar el tipo de dato del parámetro
            // como JSON string, ej: {"tipo":"OPCIONES","opciones":["Positivo","Negativo"]}
            valor_referencia || JSON.stringify({ tipo: 'NUMERICO' }),
            sexo_referencia || 'General', edad_min || 0, edad_max || 120
        ]);
        return rows[0];
    },
    getAllGlobal: async () => {
            const query = 'SELECT * FROM parametro_examen WHERE estado = TRUE ORDER BY id_parametro DESC';
            const { rows } = await pool.query(query);
            return rows;
        },
    // Obtener parámetros ACTIVOS de un examen
    getByExamen: async (id_examen) => {
        const query = `
            SELECT * FROM parametro_examen 
            WHERE id_examen = $1 AND estado = TRUE 
            ORDER BY sexo_referencia DESC, nombre_parametro ASC`; // Ordenado por sexo para facilitar lectura
        const { rows } = await pool.query(query, [id_examen]);
        return rows;
    },

    // Obtener parámetros INACTIVOS
    getInactiveByExamen: async (id_examen) => {
        const query = `
            SELECT * FROM parametro_examen 
            WHERE id_examen = $1 AND estado = FALSE 
            ORDER BY nombre_parametro ASC`;
        const { rows } = await pool.query(query, [id_examen]);
        return rows;
    },

    searchByNameInExamen: async (id_examen, termino) => {
        const query = `
            SELECT * FROM parametro_examen 
            WHERE id_examen = $1 AND nombre_parametro ILIKE $2 AND estado = TRUE
            ORDER BY nombre_parametro ASC`;
        const { rows } = await pool.query(query, [id_examen, `%${termino}%`]);
        return rows;
    },

    // Actualizar parámetro incluyendo nuevos campos
    update: async (id, data) => {
        const { 
            nombre_parametro, unidad, rango_min, 
            rango_max, valor_referencia, sexo_referencia, 
            edad_min, edad_max 
        } = data;

        const query = `
            UPDATE parametro_examen 
            SET nombre_parametro = $1, unidad = $2, rango_min = $3, 
                rango_max = $4, valor_referencia = $5, sexo_referencia = $6,
                edad_min = $7, edad_max = $8
            WHERE id_parametro = $9 RETURNING *`;

        const { rows } = await pool.query(query, [
            nombre_parametro, unidad,
            rango_min === '' || rango_min === undefined || rango_min === null ? 0 : rango_min,
            rango_max === '' || rango_max === undefined || rango_max === null ? 0 : rango_max,
            valor_referencia || JSON.stringify({ tipo: 'NUMERICO' }),
            sexo_referencia, edad_min, edad_max, id
        ]);
        return rows[0];
    },

    logicalDelete: async (id) => {
        const query = 'UPDATE parametro_examen SET estado = FALSE WHERE id_parametro = $1';
        const { rowCount } = await pool.query(query, [id]);
        return rowCount > 0;
    },

    reactivate: async (id) => {
        const query = 'UPDATE parametro_examen SET estado = TRUE WHERE id_parametro = $1 RETURNING *';
        const { rows } = await pool.query(query, [id]);
        return rows[0];
    }
};

module.exports = parametroModule;