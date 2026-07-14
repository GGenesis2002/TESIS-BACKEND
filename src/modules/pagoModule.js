const pool = require('../config/db');
const cajaModule = require('./cajaModule');

const pagoModule = {

    /**
     * Registra el pago de una orden.
     * Soporta pago simple (un método) o mixto (efectivo + transferencia).
     *
     * @param {Object} datos
     * @param {number} datos.id_orden
     * @param {number} datos.id_secretaria
     * @param {Array}  datos.pagos  — [{ monto, metodo_pago, referencia?, banco?, titular?, cedula_titular? }, ...]
     *   (referencia, banco, titular y cedula_titular son obligatorios cuando metodo_pago = 'Transferencia')
     *
     * La suma de datos.pagos[].monto debe cubrir el total de la orden.
     * Se permiten máximo 2 partes (Efectivo y Transferencia).
     * Inserta una fila en `pago` por cada parte.
     * Al final marca la orden como 'Pagada'.
     */
    registrarPago: async (datos) => {
        const { id_orden, id_secretaria, pagos } = datos;
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
                throw new Error(
                    `La orden #${id_orden} no está en estado 'Generada' (estado actual: ${ordenRes.rows[0].estado}).`
                );
            }

            const totalOrden = parseFloat(ordenRes.rows[0].total);

            // 2. Verificar que la secretaria tenga un turno de caja abierto.
            //    Todo cobro debe quedar asociado a un turno para poder
            //    cuadrarlo después en el cierre de caja.
            const turnoRes = await client.query(
                `SELECT id_cierre FROM cierre_caja WHERE id_secretaria = $1 AND estado = 'ABIERTO'`,
                [id_secretaria]
            );
            if (turnoRes.rows.length === 0) {
                throw new Error('Debes abrir un turno de caja antes de registrar cobros.');
            }
            const id_cierre = turnoRes.rows[0].id_cierre;

            // 3. Validar las partes del pago
            if (!Array.isArray(pagos) || pagos.length === 0) {
                throw new Error('Debe indicar al menos una parte de pago.');
            }
            if (pagos.length > 2) {
                throw new Error('Se permiten máximo 2 métodos de pago (Efectivo y Transferencia).');
            }

            const metodosValidos = ['Efectivo', 'Transferencia'];
            for (const p of pagos) {
                if (!metodosValidos.includes(p.metodo_pago)) {
                    throw new Error(`Método de pago inválido: ${p.metodo_pago}. Use Efectivo o Transferencia.`);
                }
                if (!p.monto || parseFloat(p.monto) <= 0) {
                    throw new Error(`El monto para ${p.metodo_pago} debe ser mayor a 0.`);
                }
                // Para transferencias se exige, además de la referencia, el banco
                // y los datos de quien realizó la transferencia (nombre y cédula),
                // para poder validar el comprobante contra la transferencia real.
                if (p.metodo_pago === 'Transferencia') {
                    if (!p.referencia || p.referencia.trim() === '') {
                        throw new Error('El número de referencia es obligatorio para pagos por Transferencia.');
                    }
                    if (!p.banco || p.banco.trim() === '') {
                        throw new Error('El banco es obligatorio para pagos por Transferencia.');
                    }
                    if (!p.titular || p.titular.trim() === '') {
                        throw new Error('El nombre de quien realizó la transferencia es obligatorio para pagos por Transferencia.');
                    }
                    if (!p.cedula_titular || p.cedula_titular.trim() === '') {
                        throw new Error('La cédula de quien realizó la transferencia es obligatoria para pagos por Transferencia.');
                    }
                }
            }

            // 4. Verificar que la suma cubre el total de la orden (tolerancia de 1 centavo)
            const sumaPagos = pagos.reduce((acc, p) => acc + parseFloat(p.monto), 0);
            if (Math.abs(sumaPagos - totalOrden) > 0.01) {
                throw new Error(
                    `La suma de los pagos ($${sumaPagos.toFixed(2)}) no coincide con el total de la orden ($${totalOrden.toFixed(2)}).`
                );
            }

            // 5. Verificar que no se repita el mismo método de pago en el modo mixto
            if (pagos.length === 2) {
                const metodos = pagos.map(p => p.metodo_pago);
                if (metodos[0] === metodos[1]) {
                    throw new Error('En un pago mixto los dos métodos deben ser diferentes.');
                }
            }

            // 6. Insertar una fila en `pago` por cada parte
            //    La columna metodo_pago puede almacenar
            //    "Transferencia (REF: XXXX - BANCO: YYYY - TITULAR: ZZZZ - CI: WWWW)"
            //    para tener toda la info de validación visible en reportes sin
            //    alterar el esquema de la BD.
            //    Cada fila queda vinculada al turno de caja abierto (id_cierre).
            const pagosInsertados = [];
            for (const p of pagos) {
                const metodoPagoGuardado = p.metodo_pago === 'Transferencia' && p.referencia
                    ? `Transferencia (REF: ${p.referencia.trim().toUpperCase()} - BANCO: ${p.banco.trim().toUpperCase()} - TITULAR: ${p.titular.trim().toUpperCase()} - CI: ${p.cedula_titular.trim()})`
                    : p.metodo_pago;

                const res = await client.query(
                    `INSERT INTO pago (id_orden, id_secretaria, monto, metodo_pago, estado_pago, id_cierre)
                     VALUES ($1, $2, $3, $4, 'Completado', $5)
                     RETURNING *`,
                    [id_orden, id_secretaria, parseFloat(p.monto), metodoPagoGuardado, id_cierre]
                );
                pagosInsertados.push(res.rows[0]);
            }

            // 7. Actualizar la orden a 'Pagada'
            await client.query(
                `UPDATE orden_medica SET estado = 'Pagada', id_secretaria = $1 WHERE id_orden = $2`,
                [id_secretaria, id_orden]
            );

            await client.query('COMMIT');

            return {
                pagos: pagosInsertados,
                total: sumaPagos,
                esMixto: pagos.length > 1,
            };

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    /**
     * Reporte de pagos del día.
     * Agrupa por id_orden para mostrar una fila por orden aunque tenga pago mixto.
     * Incluye el detalle de métodos usados.
     */
    reporteDiario: async (fecha, id_secretaria) => {
        const query = `
            SELECT
                MIN(p.id_pago)                            AS id_pago,
                p.id_orden,
                SUM(p.monto)                              AS monto,
                STRING_AGG(p.metodo_pago, ' + ' ORDER BY p.id_pago) AS metodo_pago,
                MAX(p.estado_pago)                        AS estado_pago,
                MAX(p.fecha_pago)                         AS fecha_pago,
                o.numero_ticket,
                o.total                                   AS total_orden,
                o.estado                                  AS estado_orden,
                up.nombres,
                up.apellidos,
                up.cedula,
                ua.username                               AS secretaria
            FROM pago p
            JOIN orden_medica       o   ON p.id_orden      = o.id_orden
            JOIN paciente           pac ON o.id_paciente    = pac.id_paciente
            JOIN usuario            up  ON pac.id_usuario   = up.id_usuario
            LEFT JOIN asistente_analista aa ON p.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario            ua ON aa.id_usuario   = ua.id_usuario
            WHERE DATE(p.fecha_pago) = $1
              AND p.id_secretaria = $2
            GROUP BY p.id_orden, o.numero_ticket, o.total, o.estado, up.nombres, up.apellidos, up.cedula, ua.username
            ORDER BY MAX(p.fecha_pago) DESC`;

        const { rows } = await pool.query(query, [fecha, id_secretaria]);
        return rows;
    },

    /**
     * Reporte histórico de los pagos procesados por la secretaria autenticada.
     * Agrupa por id_orden (igual que reporteDiario). Cada secretaria solo ve
     * sus propios pagos, no los de sus compañeras.
     */
    reporteTodos: async (id_secretaria) => {
        const query = `
            SELECT
                MIN(p.id_pago)                            AS id_pago,
                p.id_orden,
                SUM(p.monto)                              AS monto,
                STRING_AGG(p.metodo_pago, ' + ' ORDER BY p.id_pago) AS metodo_pago,
                MAX(p.estado_pago)                        AS estado_pago,
                MAX(p.fecha_pago)                         AS fecha_pago,
                o.numero_ticket,
                o.total                                   AS total_orden,
                o.estado                                  AS estado_orden,
                up.nombres,
                up.apellidos,
                up.cedula,
                ua.username                               AS secretaria
            FROM pago p
            JOIN orden_medica       o   ON p.id_orden      = o.id_orden
            JOIN paciente           pac ON o.id_paciente    = pac.id_paciente
            JOIN usuario            up  ON pac.id_usuario   = up.id_usuario
            LEFT JOIN asistente_analista aa ON p.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario            ua ON aa.id_usuario   = ua.id_usuario
            WHERE p.id_secretaria = $1
            GROUP BY p.id_orden, o.numero_ticket, o.total, o.estado, up.nombres, up.apellidos, up.cedula, ua.username
            ORDER BY MAX(p.fecha_pago) DESC`;

        const { rows } = await pool.query(query, [id_secretaria]);
        return rows;
    },

    /**
     * Obtiene las órdenes en estado 'Generada' para la vista de cobro.
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
    },

    /**
     * Registra el reembolso (total o parcial) de una orden ya pagada.
     * Soporta reembolso simple (un método) o mixto (efectivo + transferencia),
     * con el mismo patrón que registrarPago.
     *
     * Reglas de negocio:
     * - Solo se puede reembolsar una orden en estado 'Pagada' (antes de que
     *   se tome la muestra), para no chocar con el trigger que descuenta
     *   inventario al pasar a 'En Proceso'.
     * - El monto total reembolsado no puede superar lo efectivamente pagado
     *   menos lo ya reembolsado previamente (permite reembolsos parciales).
     * - Cada parte del reembolso, además, no puede superar lo que realmente
     *   hay disponible en ESA forma de pago dentro del turno de caja activo
     *   (no se puede devolver en efectivo más de lo que hay en efectivo en
     *   caja, ni por transferencia más de lo neto cobrado por transferencia
     *   en el turno). Antes esto no se validaba y permitía dejar la caja en
     *   negativo.
     * - Si el reembolso cubre el 100% de lo pagado, la orden pasa a 'Cancelada'.
     * - Queda vinculado al turno de caja abierto de la secretaria.
     *
     * @param {Object} datos
     * @param {number} datos.id_orden
     * @param {number} datos.id_secretaria
     * @param {Array}  [datos.reembolsos] — [{ monto, metodo_reembolso, referencia?, banco?, titular?, cedula_titular? }, ...]
     *   (máx. 2, métodos distintos; referencia/banco/titular/cedula_titular obligatorios si metodo_reembolso = 'Transferencia')
     * @param {number} [datos.monto]            — forma antigua (reembolso simple)
     * @param {string} [datos.metodo_reembolso] — forma antigua (reembolso simple)
     * @param {string} [datos.referencia]       — forma antigua (reembolso simple)
     * @param {string} [datos.banco]            — forma antigua (reembolso simple)
     * @param {string} [datos.titular]          — forma antigua (reembolso simple)
     * @param {string} [datos.cedula_titular]   — forma antigua (reembolso simple)
     * @param {string} datos.motivo
     */
    registrarReembolso: async (datos) => {
        const { id_orden, id_secretaria, motivo } = datos;
        let { reembolsos, monto, metodo_reembolso, referencia, banco, titular, cedula_titular } = datos;

        // Compatibilidad hacia atrás: si el cliente envía la forma antigua
        // { monto, metodo_reembolso, referencia, banco, titular, cedula_titular }
        // se normaliza a un arreglo.
        if (!reembolsos && monto && metodo_reembolso) {
            reembolsos = [{ monto: parseFloat(monto), metodo_reembolso, referencia, banco, titular, cedula_titular }];
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // 1. Verificar que la orden existe y está en un estado reembolsable
            const ordenRes = await client.query(
                `SELECT id_orden, estado FROM orden_medica WHERE id_orden = $1`,
                [id_orden]
            );
            if (ordenRes.rows.length === 0) {
                throw new Error(`La orden #${id_orden} no existe.`);
            }
            if (ordenRes.rows[0].estado !== 'Pagada') {
                throw new Error(
                    `Solo se pueden reembolsar órdenes en estado 'Pagada' (estado actual: ${ordenRes.rows[0].estado}). Si la muestra ya fue tomada, este caso debe manejarlo un administrador.`
                );
            }

            // 1.b Política de negocio: solo se puede reembolsar el mismo día en que
            //     se realizó el pago. Antes esto solo se validaba en el frontend,
            //     lo que permitía saltarla llamando al endpoint directamente.
            const fechaPagoRes = await client.query(
                `SELECT MAX(fecha_pago) AS fecha_pago FROM pago WHERE id_orden = $1`,
                [id_orden]
            );
            const fechaPago = fechaPagoRes.rows[0].fecha_pago;
            if (fechaPago) {
                const hoy = new Date();
                const fp = new Date(fechaPago);
                const esMismoDia =
                    fp.getFullYear() === hoy.getFullYear() &&
                    fp.getMonth() === hoy.getMonth() &&
                    fp.getDate() === hoy.getDate();
                if (!esMismoDia) {
                    throw new Error(
                        `Solo se pueden reembolsar pagos realizados el mismo día de hoy (esta orden se pagó el ${fp.toLocaleDateString('es-EC')}).`
                    );
                }
            }

            // 2. Validar motivo (obligatorio, aplica a toda la operación aunque sea mixta)
            if (!motivo || motivo.trim() === '') {
                throw new Error('El motivo del reembolso es obligatorio.');
            }

            // 3. Validar el arreglo de partes del reembolso
            if (!Array.isArray(reembolsos) || reembolsos.length === 0) {
                throw new Error('Debe indicar al menos una parte de reembolso.');
            }
            if (reembolsos.length > 2) {
                throw new Error('Se permiten máximo 2 métodos de reembolso (Efectivo y Transferencia).');
            }

            const metodosValidos = ['Efectivo', 'Transferencia'];
            for (const r of reembolsos) {
                if (!metodosValidos.includes(r.metodo_reembolso)) {
                    throw new Error(`Método de reembolso inválido: ${r.metodo_reembolso}. Use Efectivo o Transferencia.`);
                }
                if (!r.monto || parseFloat(r.monto) <= 0) {
                    throw new Error(`El monto para ${r.metodo_reembolso} debe ser mayor a 0.`);
                }
                if (r.metodo_reembolso === 'Transferencia') {
                    if (!r.referencia || r.referencia.trim() === '') {
                        throw new Error('El número de referencia es obligatorio para reembolsos por Transferencia.');
                    }
                    if (!r.banco || r.banco.trim() === '') {
                        throw new Error('El banco es obligatorio para reembolsos por Transferencia.');
                    }
                    if (!r.titular || r.titular.trim() === '') {
                        throw new Error('El nombre de la persona a quien se transfiere el reembolso es obligatorio para reembolsos por Transferencia.');
                    }
                    if (!r.cedula_titular || r.cedula_titular.trim() === '') {
                        throw new Error('La cédula de la persona a quien se transfiere el reembolso es obligatoria para reembolsos por Transferencia.');
                    }
                }
            }
            if (reembolsos.length === 2) {
                const metodos = reembolsos.map(r => r.metodo_reembolso);
                if (metodos[0] === metodos[1]) {
                    throw new Error('En un reembolso mixto los dos métodos deben ser diferentes.');
                }
            }

            // 4. Verificar que no se reembolse más de lo disponible para ESTA orden
            //    (pagado - ya reembolsado)
            const pagadoRes = await client.query(
                `SELECT COALESCE(SUM(monto), 0) AS total_pagado FROM pago WHERE id_orden = $1`,
                [id_orden]
            );
            const reembolsadoRes = await client.query(
                `SELECT COALESCE(SUM(monto), 0) AS total_reembolsado FROM reembolso WHERE id_orden = $1`,
                [id_orden]
            );
            const totalPagado = parseFloat(pagadoRes.rows[0].total_pagado);
            const totalReembolsado = parseFloat(reembolsadoRes.rows[0].total_reembolsado);
            const disponibleParaReembolso = totalPagado - totalReembolsado;

            const montoTotalReembolso = reembolsos.reduce((s, r) => s + parseFloat(r.monto), 0);
            if (montoTotalReembolso > disponibleParaReembolso + 0.01) {
                throw new Error(
                    `El monto a reembolsar ($${montoTotalReembolso.toFixed(2)}) supera lo disponible para reembolso de esta orden ($${disponibleParaReembolso.toFixed(2)}).`
                );
            }

            // 5. Exigir turno de caja abierto (igual que en registrarPago).
            const turnoRes = await client.query(
                `SELECT id_cierre FROM cierre_caja WHERE id_secretaria = $1 AND estado = 'ABIERTO'`,
                [id_secretaria]
            );
            if (turnoRes.rows.length === 0) {
                throw new Error('Debes abrir un turno de caja antes de procesar reembolsos.');
            }
            const id_cierre = turnoRes.rows[0].id_cierre;

            // 6. Verificar que cada parte del reembolso no supere lo que REALMENTE
            //    hay disponible en esa forma de pago dentro del turno de caja.
            //    Esto evita, por ejemplo, reembolsar $50 en efectivo cuando la
            //    caja del turno solo tiene $25 netos en efectivo.
            const resumenTurno = await cajaModule._resumenTurno(id_cierre);
            const disponibleEfectivoTurno = resumenTurno.total_efectivo_sistema - resumenTurno.total_reembolsos_efectivo;
            const disponibleTransferenciaTurno = resumenTurno.total_transferencia_sistema - resumenTurno.total_reembolsos_transferencia;

            for (const r of reembolsos) {
                const montoR = parseFloat(r.monto);
                if (r.metodo_reembolso === 'Efectivo' && montoR > disponibleEfectivoTurno + 0.01) {
                    throw new Error(
                        `No hay suficiente efectivo en caja para este reembolso: se pidió $${montoR.toFixed(2)} pero solo hay $${disponibleEfectivoTurno.toFixed(2)} disponibles en efectivo en el turno actual.`
                    );
                }
                if (r.metodo_reembolso === 'Transferencia' && montoR > disponibleTransferenciaTurno + 0.01) {
                    throw new Error(
                        `No hay suficiente saldo por transferencia en caja para este reembolso: se pidió $${montoR.toFixed(2)} pero solo hay $${disponibleTransferenciaTurno.toFixed(2)} disponibles por transferencia en el turno actual.`
                    );
                }
            }

            // 7. Insertar una fila en `reembolso` por cada parte
            const reembolsosInsertados = [];
            for (const r of reembolsos) {
                // La tabla `reembolso` ya tiene una columna `referencia` dedicada.
                // Para transferencias se guarda ahí también el banco y los datos
                // de quien recibe el reembolso, para poder validarlo después
                // (mismo criterio que se aplica en registrarPago).
                const referenciaGuardada = r.metodo_reembolso === 'Transferencia' && r.referencia
                    ? `${r.referencia.trim().toUpperCase()} - BANCO: ${r.banco.trim().toUpperCase()} - TITULAR: ${r.titular.trim().toUpperCase()} - CI: ${r.cedula_titular.trim()}`
                    : (r.referencia ? r.referencia.trim().toUpperCase() : null);
                const insertRes = await client.query(
                    `INSERT INTO reembolso (id_orden, id_secretaria, id_cierre, monto, metodo_reembolso, referencia, motivo)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING *`,
                    [id_orden, id_secretaria, id_cierre, parseFloat(r.monto), r.metodo_reembolso, referenciaGuardada, motivo.trim()]
                );
                reembolsosInsertados.push(insertRes.rows[0]);
            }

            // 8. Si el reembolso cubre lo disponible de la orden, pasa a 'Cancelada'
            const disponibleRestante = Math.max(0, disponibleParaReembolso - montoTotalReembolso);
            let ordenCancelada = false;
            if (disponibleRestante <= 0.01) {
                await client.query(`UPDATE orden_medica SET estado = 'Cancelada' WHERE id_orden = $1`, [id_orden]);
                ordenCancelada = true;
            }

            await client.query('COMMIT');

            return {
                reembolsos: reembolsosInsertados,
                total: montoTotalReembolso,
                esMixto: reembolsos.length > 1,
                ordenCancelada,
                disponibleRestante,
            };

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    /**
     * Reporte histórico de los reembolsos procesados por la secretaria
     * autenticada (con datos del paciente y de la orden). Cada secretaria
     * solo ve sus propios reembolsos, no los de sus compañeras.
     */
    reporteReembolsos: async (id_secretaria) => {
        const query = `
            SELECT
                r.*,
                o.numero_ticket,
                o.total AS total_orden,
                up.nombres,
                up.apellidos,
                up.cedula,
                ua.username AS secretaria
            FROM reembolso r
            JOIN orden_medica o   ON r.id_orden      = o.id_orden
            JOIN paciente     pac ON o.id_paciente    = pac.id_paciente
            JOIN usuario      up  ON pac.id_usuario   = up.id_usuario
            LEFT JOIN asistente_analista aa ON r.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario            ua ON aa.id_usuario   = ua.id_usuario
            WHERE r.id_secretaria = $1
            ORDER BY r.fecha_reembolso DESC`;

        const { rows } = await pool.query(query, [id_secretaria]);
        return rows;
    },
};

module.exports = pagoModule;