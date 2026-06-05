const pool = require('../config/db');

const resultadoModule = {
    // Inserta o actualiza un parámetro (Usa ON CONFLICT para manejar re-intentos)
    guardarOActualizarDetalle: async (id_resultado, id_parametro, valor, observacion) => {
        const query = `
            INSERT INTO detalle_resultado (id_resultado, id_parametro, valor_obtenido, observacion)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id_resultado, id_parametro) 
            DO UPDATE SET valor_obtenido = EXCLUDED.valor_obtenido, observacion = EXCLUDED.observacion
            RETURNING *`;
        const { rows } = await pool.query(query, [id_resultado, id_parametro, valor, observacion]);
        return rows[0];
    },

    // Cambiar el estado general de la orden de resultado
    cambiarEstado: async (id_resultado, nuevoEstado) => {
        const query = `UPDATE resultado SET estado = $1 WHERE id_resultado = $2 RETURNING *`;
        const { rows } = await pool.query(query, [nuevoEstado, id_resultado]);
        return rows[0];
    }
};

module.exports = resultadoModule;