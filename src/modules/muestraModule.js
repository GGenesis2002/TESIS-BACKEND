const pool = require('../config/db');

const muestraModule = {

    /**
     * Obtener los insumos que se van a consumir para una orden.
     * Lee tipo_muestra desde la tabla pivote examen_tipo_muestra
     * para soportar exámenes con múltiples tipos (sangre Y orina, etc.)
     */
    obtenerInsumosPorOrden: async (id_orden) => {
    const { rows } = await pool.query(`
        SELECT
            i.id_insumo,
            i.nombre                                    AS insumo,
            i.unidad_medida,
            i.stock_actual,
            i.stock_minimo,
            i.id_tipo_muestra,
            tm.nombre                                   AS tipo_muestra_nombre,
            MAX(ei.cantidad_usada)                      AS cantidad,
            STRING_AGG(DISTINCT e.nombre_examen, ', ')  AS examenes,
            ce.id_categoria                             AS id_categoria_examen,
            ce.nombre_categoria                         AS categoria_examen
        FROM detalle_orden do2
        JOIN examen_insumo  ei ON do2.id_examen    = ei.id_examen
        JOIN insumos        i  ON ei.id_insumo     = i.id_insumo
        JOIN examen         e  ON do2.id_examen    = e.id_examen
        LEFT JOIN tipo_muestra     tm ON i.id_tipo_muestra = tm.id_tipo_muestra
        LEFT JOIN categoria_examen ce ON e.id_categoria    = ce.id_categoria
        WHERE do2.id_orden = $1
        GROUP BY
            i.id_insumo, i.nombre, i.unidad_medida,
            i.stock_actual, i.stock_minimo,
            i.id_tipo_muestra, tm.nombre,
            ce.id_categoria, ce.nombre_categoria
        ORDER BY ce.nombre_categoria NULLS LAST, i.nombre
    `, [id_orden]);
    return rows;
},

/**
     * Obtiene el historial completo de órdenes listas para muestra o ya procesadas.
     * Ideal para el filtrado avanzado en el frontend.
     */
    obtenerHistorialMuestras: async () => {
        const query = `
            SELECT
                o.id_orden,
                o.numero_ticket,
                o.fecha_orden, -- Si manejas una tabla 'muestra' con su propia fecha, cámbiala aquí
                o.estado,
                o.id_paciente,
                u.nombres,
                u.apellidos,
                u.cedula
            FROM orden_medica o
            JOIN paciente pac ON o.id_paciente = pac.id_paciente
            JOIN usuario  u   ON pac.id_usuario = u.id_usuario
            WHERE o.estado IN ('Pagada', 'Muestra Tomada', 'En Proceso', 'Por Validar', 'Validada', 'Entregada')
            ORDER BY o.fecha_orden DESC`;

        const { rows } = await pool.query(query);
        return rows;
    },
    
    /**
     * Registrar la toma de muestra con MÚLTIPLES recipientes.
     * Cambia el estado a 'En Proceso', lo que dispara el trigger
     * que descuenta el inventario automáticamente.
     */
    registrarToma: async (id_orden, recipientes) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar que la orden exista y esté en estado 'Pagada'
            const resOrden = await client.query(`
                SELECT numero_ticket, estado FROM orden_medica WHERE id_orden = $1
            `, [id_orden]);

            if (resOrden.rows.length === 0) throw new Error('Orden no encontrada');
            if (resOrden.rows[0].estado !== 'Pagada')
                throw new Error(`La orden ya se procesó (estado actual: ${resOrden.rows[0].estado})`);

            const codigo_muestra = resOrden.rows[0].numero_ticket;

            // 2. Validar stock suficiente para todos los insumos de la orden
            const stockCheck = await client.query(`
                SELECT
                    i.nombre,
                    i.stock_actual,
                    MAX(ei.cantidad_usada) AS necesita
                FROM detalle_orden do2
                JOIN examen_insumo ei ON do2.id_examen = ei.id_examen
                JOIN insumos i        ON ei.id_insumo  = i.id_insumo
                WHERE do2.id_orden = $1
                GROUP BY i.id_insumo, i.nombre, i.stock_actual
                HAVING i.stock_actual < MAX(ei.cantidad_usada)
            `, [id_orden]);

            if (stockCheck.rows.length > 0) {
                const faltantes = stockCheck.rows
                    .map(r => `"${r.nombre}" (disponible: ${r.stock_actual}, necesita: ${r.necesita})`)
                    .join(' | ');
                throw new Error(`Stock insuficiente para: ${faltantes}`);
            }

            // 3. Insertar UNA fila en muestra por cada recipiente.
            const listaRecipientes = recipientes && recipientes.length > 0
                ? recipientes
                : [{ id_tipo_muestra: null, tipo_recipiente: 'No especificado' }];

            const muestrasInsertadas = [];
            for (const rec of listaRecipientes) {
                const resMuestra = await client.query(`
                    INSERT INTO muestra
                        (id_orden, id_tipo_muestra, tipo_recipiente, codigo_muestra, fecha_recoleccion, hora_recoleccion)
                    VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_TIME)
                    RETURNING *
                `, [
                    id_orden,
                    rec.id_tipo_muestra || null,
                    rec.tipo_recipiente || 'No especificado',
                    codigo_muestra,
                ]);
                muestrasInsertadas.push(resMuestra.rows[0]);
            }

            // 4. Cambiar estado a 'En Proceso' → dispara trigger de inventario
            await client.query(`
                UPDATE orden_medica SET estado = 'En Proceso' WHERE id_orden = $1
            `, [id_orden]);

            // 5. Obtener insumos descontados para incluirlos en la respuesta
            const resInsumos = await client.query(`
                SELECT
                    i.nombre,
                    MAX(ei.cantidad_usada) AS cantidad,
                    i.unidad_medida,
                    i.stock_actual         AS stock_tras_descuento
                FROM detalle_orden do2
                JOIN examen_insumo ei ON do2.id_examen = ei.id_examen
                JOIN insumos i        ON ei.id_insumo  = i.id_insumo
                WHERE do2.id_orden = $1
                GROUP BY i.id_insumo, i.nombre, i.unidad_medida, i.stock_actual
                ORDER BY i.nombre
            `, [id_orden]);

            await client.query('COMMIT');

            return {
                muestras: muestrasInsertadas,
                insumos:  resInsumos.rows,
                codigo_muestra,
            };

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    /**
     * Muestras en proceso para el especialista.
     * Lee tipo_muestra desde la pivote para soportar múltiples tipos.
     */
    obtenerPendientesLaboratorio: async () => {
        const { rows } = await pool.query(`
            SELECT
                m.*,
                u.nombres,
                u.apellidos,
                o.numero_ticket,
                COALESCE(
                    tm_directo.nombre,
                    (
                        SELECT STRING_AGG(tm2.nombre, ' / ' ORDER BY tm2.nombre)
                        FROM detalle_orden       do2
                        JOIN examen              e2  ON do2.id_examen       = e2.id_examen
                        JOIN examen_tipo_muestra etm ON e2.id_examen        = etm.id_examen
                        JOIN tipo_muestra        tm2 ON etm.id_tipo_muestra = tm2.id_tipo_muestra
                        WHERE do2.id_orden = o.id_orden
                    )
                ) AS tipo_muestra_nombre
            FROM muestra m
            JOIN orden_medica  o  ON m.id_orden    = o.id_orden
            JOIN paciente      p  ON o.id_paciente = p.id_paciente
            JOIN usuario       u  ON p.id_usuario  = u.id_usuario
            LEFT JOIN tipo_muestra tm_directo ON m.id_tipo_muestra = tm_directo.id_tipo_muestra
            WHERE o.estado = 'En Proceso'
            ORDER BY m.fecha_recoleccion DESC, m.hora_recoleccion DESC
        `);
        return rows;
    },
};

module.exports = muestraModule;