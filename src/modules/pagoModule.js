const pool = require('../config/db');

const pagoModule = {

    /**
     * Registra el pago de una orden y la marca como 'Pagada'.
     * Usa transacción para garantizar atomicidad.
     */
    registrarPago: async (datos) => {
        const { id_orden, id_secretaria, monto, metodo_pago } = datos;
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Verificar que la orden existe y está en estado 'Generada'
            const ordenRes = await client.query(
                `SELECT id_orden, estado, total FROM orden_medica WHERE id_orden = $1`,
                [id_orden]
            );
            if (ordenRes.rows.length === 0) {
                throw new Error(`La orden #${id_orden} no existe.`);
            }
            if (ordenRes.rows[0].estado !== 'Generada') {
                throw new Error(`La orden #${id_orden} no está en estado 'Generada' (estado actual: ${ordenRes.rows[0].estado}).`);
            }

            // 2. Insertar el registro en la tabla pago
            const queryPago = `
                INSERT INTO pago (id_orden, id_secretaria, monto, metodo_pago, estado_pago)
                VALUES ($1, $2, $3, $4, 'Completado')
                RETURNING *`;
            const resPago = await client.query(queryPago, [id_orden, id_secretaria, monto, metodo_pago]);

            // 3. Actualizar la orden médica: pasa de 'Generada' a 'Pagada'
            //    Esto permite que el especialista/técnico la vea en su lista
            await client.query(
                `UPDATE orden_medica
                    SET estado = 'Pagada', id_secretaria = $1
                  WHERE id_orden = $2`,
                [id_secretaria, id_orden]
            );

            await client.query('COMMIT');
            return resPago.rows[0];

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    /**
     * Reporte de pagos del día.
     * Trae datos del paciente y del usuario que atendió.
     *
     * CORRECCIÓN: La tabla es 'asistente_analista' (no 'secretaria').
     * Los nombres del usuario están en la tabla 'usuario', no en asistente_analista.
     */
    reporteDiario: async (fecha) => {
        const query = `
            SELECT
                p.id_pago,
                p.id_orden,
                p.monto,
                p.metodo_pago,
                p.estado_pago,
                p.fecha_pago,
                o.numero_ticket,
                o.total AS total_orden,
                -- Datos del paciente
                up.nombres            AS nombres,
                up.apellidos          AS apellidos,
                up.cedula             AS cedula,
                -- Usuario que registró el cobro (asistente_analista → usuario)
                ua.username           AS secretaria
            FROM pago p
            JOIN orden_medica       o   ON p.id_orden      = o.id_orden
            JOIN paciente           pac ON o.id_paciente    = pac.id_paciente
            JOIN usuario            up  ON pac.id_usuario   = up.id_usuario
            -- CORRECCIÓN: tabla correcta es asistente_analista
            LEFT JOIN asistente_analista aa ON p.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario            ua ON aa.id_usuario   = ua.id_usuario
            WHERE DATE(p.fecha_pago) = $1
            ORDER BY p.fecha_pago DESC`;

        const { rows } = await pool.query(query, [fecha]);
        return rows;
    },

    /**
     * Reporte histórico de todos los pagos registrados.
     * Trae datos del paciente y del usuario que atendió.
     */
    reporteTodos: async () => {
        const query = `
            SELECT
                p.id_pago,
                p.id_orden,
                p.monto,
                p.metodo_pago,
                p.estado_pago,
                p.fecha_pago,
                o.numero_ticket,
                o.total AS total_orden,
                -- Datos del paciente
                up.nombres            AS nombres,
                up.apellidos          AS apellidos,
                up.cedula             AS cedula,
                -- Usuario que registró el cobro
                ua.username           AS secretaria
            FROM pago p
            JOIN orden_medica       o   ON p.id_orden      = o.id_orden
            JOIN paciente           pac ON o.id_paciente    = pac.id_paciente
            JOIN usuario            up  ON pac.id_usuario   = up.id_usuario
            LEFT JOIN asistente_analista aa ON p.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario            ua ON aa.id_usuario   = ua.id_usuario
            ORDER BY p.fecha_pago DESC`;

        const { rows } = await pool.query(query);
        return rows;
    },

    /**
     * Obtiene las órdenes en estado 'Generada' para la vista de cobro.
     * Trae los datos del paciente necesarios para mostrarlo en la tabla.
     */
    obtenerOrdenesGeneradas: async () => {
        const query = `
            SELECT
                o.id_orden,
                o.numero_ticket,
                o.fecha_orden,
                o.total,
                o.estado,
                o.id_paciente,
                u.nombres,
                u.apellidos,
                u.cedula
            FROM orden_medica o
            JOIN paciente pac ON o.id_paciente = pac.id_paciente
            JOIN usuario  u   ON pac.id_usuario = u.id_usuario
            WHERE o.estado = 'Generada'
            ORDER BY o.fecha_orden DESC`;

        const { rows } = await pool.query(query);
        return rows;
    }
};

module.exports = pagoModule;