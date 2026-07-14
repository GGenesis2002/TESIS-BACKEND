const pool = require('../config/db');

const cajaModule = {

    /**
     * Calcula los totales en vivo de un turno: cobros por método y reembolsos
     * asociados a ese turno. Se usa tanto para mostrar el turno activo como
     * para calcular el cierre final.
     */
    _resumenTurno: async (id_cierre) => {
        const pagosRes = await pool.query(
            `SELECT
                COALESCE(SUM(monto) FILTER (WHERE metodo_pago LIKE 'Efectivo%'), 0)      AS efectivo,
                COALESCE(SUM(monto) FILTER (WHERE metodo_pago LIKE 'Transferencia%'), 0) AS transferencia,
                COUNT(*) AS num_pagos
             FROM pago WHERE id_cierre = $1`,
            [id_cierre]
        );
        const reembolsosRes = await pool.query(
            `SELECT
                COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Efectivo'), 0)      AS efectivo,
                COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Transferencia'), 0) AS transferencia,
                COUNT(*) AS num_reembolsos
             FROM reembolso WHERE id_cierre = $1`,
            [id_cierre]
        );

        const pagos = pagosRes.rows[0];
        const reembolsos = reembolsosRes.rows[0];

        return {
            total_efectivo_sistema: parseFloat(pagos.efectivo),
            total_transferencia_sistema: parseFloat(pagos.transferencia),
            num_pagos: parseInt(pagos.num_pagos, 10),
            total_reembolsos_efectivo: parseFloat(reembolsos.efectivo),
            total_reembolsos_transferencia: parseFloat(reembolsos.transferencia),
            num_reembolsos: parseInt(reembolsos.num_reembolsos, 10),
        };
    },

    /**
     * Último cierre de caja registrado en todo el sistema (de cualquier
     * secretaria), con su detalle completo. Como la caja es física y única,
     * quien abre un turno nuevo necesita saber en qué quedó el turno anterior
     * (fondo inicial, cobrado, reembolsado y diferencia), sin importar quién
     * lo haya cerrado. Devuelve null si todavía no hay ningún cierre.
     */
    obtenerUltimoCierreGlobal: async () => {
        const { rows } = await pool.query(
            `SELECT cc.*, u.nombres, u.apellidos, u.username
             FROM cierre_caja cc
             JOIN asistente_analista aa ON cc.id_secretaria = aa.id_secretaria
             JOIN usuario u ON aa.id_usuario = u.id_usuario
             WHERE cc.estado = 'CERRADO'
             ORDER BY cc.fecha_cierre DESC
             LIMIT 1`
        );
        return rows.length > 0 ? rows[0] : null;
    },

    /**
     * Busca si existe CUALQUIER turno de caja abierto en el sistema (de
     * cualquier secretaria), junto con el nombre de quien lo tiene abierto.
     * La caja es física/única, así que solo puede haber un turno ABIERTO
     * a la vez entre todas las secretarias.
     */
    _turnoAbiertoGlobal: async () => {
        const { rows } = await pool.query(
            `SELECT cc.id_cierre, cc.id_secretaria, cc.fecha_apertura, u.nombres, u.apellidos
             FROM cierre_caja cc
             JOIN asistente_analista aa ON cc.id_secretaria = aa.id_secretaria
             JOIN usuario u ON aa.id_usuario = u.id_usuario
             WHERE cc.estado = 'ABIERTO'
             LIMIT 1`
        );
        return rows.length > 0 ? rows[0] : null;
    },

    /**
     * Abre un turno de caja para la secretaria. Como la caja es física y
     * única, no puede haber dos turnos ABIERTOS a la vez en todo el sistema
     * (ni de la misma secretaria, ni de otra distinta).
     */
    abrirTurno: async ({ id_secretaria, monto_inicial }) => {
        const abierto = await cajaModule._turnoAbiertoGlobal();
        if (abierto) {
            if (abierto.id_secretaria === id_secretaria) {
                throw new Error(
                    `Ya tienes un turno de caja abierto (#${abierto.id_cierre}). Debes cerrarlo antes de abrir uno nuevo.`
                );
            }
            throw new Error(
                `Ya hay un turno de caja abierto (#${abierto.id_cierre}) por ${abierto.nombres} ${abierto.apellidos}. Debes esperar a que lo cierre antes de abrir uno nuevo.`
            );
        }

        const monto = monto_inicial === undefined || monto_inicial === null || monto_inicial === ''
            ? 0
            : parseFloat(monto_inicial);

        if (isNaN(monto) || monto < 0) {
            throw new Error('El monto inicial de caja no puede ser negativo.');
        }

        const { rows } = await pool.query(
            `INSERT INTO cierre_caja (id_secretaria, monto_inicial, estado)
             VALUES ($1, $2, 'ABIERTO') RETURNING *`,
            [id_secretaria, monto]
        );
        return rows[0];
    },

    /**
     * Devuelve el turno abierto de la secretaria (con esPropio: true), o si
     * no tiene uno propio, indica si OTRA secretaria tiene la caja abierta
     * (esPropio: false + datos de quién la abrió), o null si nadie tiene
     * un turno abierto en el sistema.
     */
    obtenerTurnoActivo: async (id_secretaria) => {
        const { rows } = await pool.query(
            `SELECT * FROM cierre_caja WHERE id_secretaria = $1 AND estado = 'ABIERTO'`,
            [id_secretaria]
        );

        if (rows.length > 0) {
            const turno = rows[0];
            const resumen = await cajaModule._resumenTurno(turno.id_cierre);
            const efectivoEsperado =
                parseFloat(turno.monto_inicial) + resumen.total_efectivo_sistema - resumen.total_reembolsos_efectivo;

            return { ...turno, ...resumen, efectivo_esperado_actual: efectivoEsperado, esPropio: true };
        }

        // No tiene turno propio: revisar si otra secretaria tiene la caja abierta.
        const abiertoOtro = await cajaModule._turnoAbiertoGlobal();
        if (abiertoOtro) {
            return {
                esPropio: false,
                id_cierre: abiertoOtro.id_cierre,
                fecha_apertura: abiertoOtro.fecha_apertura,
                secretaria_nombres: abiertoOtro.nombres,
                secretaria_apellidos: abiertoOtro.apellidos,
            };
        }

        return null;
    },

    /**
     * Cierra el turno de caja: calcula el efectivo esperado, lo compara
     * contra lo contado físicamente por la secretaria, y guarda la diferencia.
     */
    cerrarTurno: async ({ id_cierre, id_secretaria, efectivo_contado, observaciones }) => {
        const turnoRes = await pool.query(`SELECT * FROM cierre_caja WHERE id_cierre = $1`, [id_cierre]);
        if (turnoRes.rows.length === 0) {
            throw new Error(`El turno de caja #${id_cierre} no existe.`);
        }
        const turno = turnoRes.rows[0];

        if (turno.estado !== 'ABIERTO') {
            throw new Error(`El turno de caja #${id_cierre} ya está cerrado.`);
        }
        if (turno.id_secretaria !== id_secretaria) {
            throw new Error('Solo la secretaria que abrió el turno puede cerrarlo.');
        }
        if (efectivo_contado === undefined || efectivo_contado === null || efectivo_contado === '') {
            throw new Error('Debes indicar el monto de efectivo contado físicamente en caja.');
        }
        const contado = parseFloat(efectivo_contado);
        if (isNaN(contado) || contado < 0) {
            throw new Error('El efectivo contado no puede ser negativo.');
        }

        const resumen = await cajaModule._resumenTurno(id_cierre);
        const efectivoEsperado =
            parseFloat(turno.monto_inicial) + resumen.total_efectivo_sistema - resumen.total_reembolsos_efectivo;
        const diferencia = contado - efectivoEsperado;

        const { rows } = await pool.query(
            `UPDATE cierre_caja SET
                fecha_cierre = CURRENT_TIMESTAMP,
                total_efectivo_sistema = $1,
                total_transferencia_sistema = $2,
                total_reembolsos_efectivo = $3,
                total_reembolsos_transferencia = $4,
                efectivo_esperado = $5,
                efectivo_contado = $6,
                diferencia = $7,
                observaciones = $8,
                estado = 'CERRADO'
             WHERE id_cierre = $9
             RETURNING *`,
            [
                resumen.total_efectivo_sistema,
                resumen.total_transferencia_sistema,
                resumen.total_reembolsos_efectivo,
                resumen.total_reembolsos_transferencia,
                efectivoEsperado,
                contado,
                diferencia,
                observaciones || null,
                id_cierre,
            ]
        );

        return rows[0];
    },

    /**
     * Detalle completo de un cierre: cabecera + pagos + reembolsos del turno.
     * Se usa para el comprobante/reporte imprimible del cierre de caja.
     */
    obtenerDetalleCierre: async (id_cierre) => {
        const cabeceraRes = await pool.query(
            `SELECT cc.*, u.nombres, u.apellidos, u.username
             FROM cierre_caja cc
             JOIN asistente_analista aa ON cc.id_secretaria = aa.id_secretaria
             JOIN usuario u ON aa.id_usuario = u.id_usuario
             WHERE cc.id_cierre = $1`,
            [id_cierre]
        );
        if (cabeceraRes.rows.length === 0) {
            throw new Error(`El turno de caja #${id_cierre} no existe.`);
        }

        const pagosRes = await pool.query(
            `SELECT p.*, o.numero_ticket,
                    up.nombres AS paciente_nombres, up.apellidos AS paciente_apellidos
             FROM pago p
             JOIN orden_medica o ON p.id_orden = o.id_orden
             JOIN paciente pac ON o.id_paciente = pac.id_paciente
             JOIN usuario up ON pac.id_usuario = up.id_usuario
             WHERE p.id_cierre = $1
             ORDER BY p.fecha_pago`,
            [id_cierre]
        );

        const reembolsosRes = await pool.query(
            `SELECT r.*, o.numero_ticket
             FROM reembolso r
             JOIN orden_medica o ON r.id_orden = o.id_orden
             WHERE r.id_cierre = $1
             ORDER BY r.fecha_reembolso`,
            [id_cierre]
        );

        return {
            cierre: cabeceraRes.rows[0],
            pagos: pagosRes.rows,
            reembolsos: reembolsosRes.rows,
        };
    },

    /**
     * Historial de cierres de caja realizados por la secretaria autenticada.
     * Cada secretaria solo ve sus propios cierres, no los de sus compañeras.
     */
    listarCierres: async (id_secretaria) => {
        const { rows } = await pool.query(
            `SELECT cc.*, u.nombres, u.apellidos, u.username
             FROM cierre_caja cc
             JOIN asistente_analista aa ON cc.id_secretaria = aa.id_secretaria
             JOIN usuario u ON aa.id_usuario = u.id_usuario
             WHERE cc.id_secretaria = $1
             ORDER BY cc.fecha_apertura DESC`,
            [id_secretaria]
        );
        return rows;
    },
};

module.exports = cajaModule;