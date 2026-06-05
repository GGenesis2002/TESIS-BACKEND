const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ordenModule = {
    // Generar un ticket corto único (Ej: LAB-A7B2)
    generarTicket: () => 'LAB-' + crypto.randomBytes(2).toString('hex').toUpperCase(),

    // Crear Orden (Paciente o Secretaria)
    // ✅ FIX: se agrega `expiracionQR` como parámetro explícito (antes era variable inexistente en scope)
    crear: async (id_paciente, id_secretaria, examenes, estadoInicial = 'Pendiente', expiracionQR = 2) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const ticket = ordenModule.generarTicket();

            const res = await client.query(
                `INSERT INTO orden_medica (id_paciente, id_secretaria, estado, numero_ticket) 
                 VALUES ($1, $2, $3, $4) RETURNING id_orden`,
                [id_paciente, id_secretaria, estadoInicial, ticket]
            );
            const id_orden = res.rows[0].id_orden;

            let total = 0;
            for (const ex of examenes) {
                // ✅ FIX: ahora cada `ex` es un objeto { id_examen, precio }
                // Antes el frontend mandaba números planos, causando ex.id_examen = undefined
                await client.query(
                    `INSERT INTO detalle_orden (id_orden, id_examen, subtotal) VALUES ($1, $2, $3)`,
                    [id_orden, ex.id_examen, ex.precio]
                );
                total += parseFloat(ex.precio);
            }

            // SEGURIDAD: Token firmado que expira según configuración del sistema
            const tokenQR = jwt.sign(
                { id_orden, ticket }, 
                process.env.JWT_SECRET, 
                { expiresIn: `${expiracionQR}h` }
            );

            await client.query(
                `UPDATE orden_medica SET total = $1, qr_codigo = $2 WHERE id_orden = $3`,
                [total, tokenQR, id_orden]
            );

            await client.query('COMMIT');
            return { id_orden, tokenQR, ticket };
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    },
    // Cancelar una orden médica con su motivo
    cancelar: async (id_orden, motivo) => {
        const query = `
            UPDATE orden_medica 
            SET estado = 'Cancelada', 
                observacion_validador = COALESCE(observacion_validador, $2)
            WHERE id_orden = $1 
            RETURNING *
        `;
        const result = await pool.query(query, [id_orden, motivo || "Orden cancelada por el operador."]);
        return result.rows[0];
    },

    // Corregir Orden (Limpiar y reinsertar exámenes)
    // ✅ FIX: se espera que `nuevosExamenes` sea array de objetos { id_examen, precio }
    corregir: async (id_orden, nuevosExamenes) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Borrar detalles anteriores
            await client.query('DELETE FROM detalle_orden WHERE id_orden = $1', [id_orden]);

            // 2. Insertar los nuevos y recalcular total
            let nuevoTotal = 0;
            for (const ex of nuevosExamenes) {
                // ✅ FIX: cada ex es { id_examen, precio }, no un número plano
                await client.query(
                    `INSERT INTO detalle_orden (id_orden, id_examen, subtotal) VALUES ($1, $2, $3)`,
                    [id_orden, ex.id_examen, ex.precio]
                );
                nuevoTotal += parseFloat(ex.precio);
            }

            // 3. Actualizar total en la orden
            await client.query('UPDATE orden_medica SET total = $1 WHERE id_orden = $2', [nuevoTotal, id_orden]);

            await client.query('COMMIT');
            return nuevoTotal;
        } catch (e) { await client.query('ROLLBACK'); throw e; }
        finally { client.release(); }
    },

    // Listar órdenes por estado (requerido por ordenController.listar)
    listarPorEstado: async (estado) => {
        let query = `
            SELECT o.*, u.nombres, u.apellidos
            FROM orden_medica o
            JOIN paciente p ON o.id_paciente = p.id_paciente
            JOIN usuario u ON p.id_usuario = u.id_usuario
        `;
        const params = [];
        if (estado) {
            query += ' WHERE o.estado = $1';
            params.push(estado);
        }
        query += ' ORDER BY o.fecha_orden DESC';
        const { rows } = await pool.query(query, params);
        return rows;
    }
};

module.exports = ordenModule;