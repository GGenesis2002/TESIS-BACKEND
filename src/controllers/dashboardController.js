const pool = require('../config/db');

const dashboardController = {

    // ─── DASHBOARD ADMINISTRADOR ────────────────────────────────────────────
    getAdminStats: async (req, res) => {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            const query = `
                SELECT
                    (SELECT COUNT(*) FROM paciente)                                                                  AS pac_hoy,
                    (SELECT COUNT(*) FROM orden_medica WHERE fecha_orden::date = $1)                                 AS ord_hoy,
                    (SELECT COUNT(*) FROM orden_medica WHERE estado = 'Por Validar')                                 AS pen_val,
                    (SELECT COUNT(*) FROM orden_medica WHERE estado = 'Validado')                                    AS completados,
                    (SELECT COUNT(*) FROM detalle_resultado dr
                     JOIN parametro_examen pe ON dr.id_parametro = pe.id_parametro
                     WHERE dr.valor_obtenido ~ '^-?[0-9]+(\.[0-9]+)?$'
                       AND pe.rango_min IS NOT NULL
                       AND pe.rango_max IS NOT NULL
                       AND (
                           dr.valor_obtenido::numeric > pe.rango_max
                           OR dr.valor_obtenido::numeric < pe.rango_min
                       ))                                                                                           AS criticos,
                    (SELECT COUNT(*) FROM usuario WHERE ultimo_acceso::date = $1)                                    AS activos,
                    (
                        (SELECT COALESCE(SUM(monto),0) FROM pago WHERE fecha_pago::date = $1)
                        -
                        (SELECT COALESCE(SUM(monto),0) FROM reembolso WHERE fecha_reembolso::date = $1)
                    )                                                                                              AS ingresos_hoy,
                    (SELECT COUNT(*) FROM insumos WHERE stock_actual <= stock_minimo AND estado = TRUE)              AS stock_bajo
            `;
            const stats            = await pool.query(query, [hoy]);
            const ordenesRecientes = await pool.query(
                "SELECT numero_ticket, estado FROM orden_medica WHERE fecha_orden::date = $1 LIMIT 5", [hoy]
            );
            res.json({ kpis: stats.rows[0], ordenesDia: ordenesRecientes.rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // ─── DASHBOARD SECRETARÍA / ASISTENTE ANALISTA ──────────────────────────
    getAsistenAnalistaStats: async (req, res) => {
        try {
            const hoy = new Date().toISOString().split('T')[0];
            
            const queryKpis = `
                SELECT
                    (SELECT COUNT(*) FROM paciente)                                                                  AS pac_reg_hoy,
                    (SELECT COUNT(*) FROM orden_medica WHERE fecha_orden::date = $1)                                 AS ord_cre_hoy,
                    (SELECT COUNT(*) FROM orden_medica WHERE estado IN ('Generada','Pagada','En Proceso','Por Validar')) AS resultados_pen,
                    (SELECT COUNT(*) FROM orden_medica WHERE estado = 'Validado')                                    AS listos_entrega
            `;
            const stats = await pool.query(queryKpis, [hoy]);
            
            const pacientesRecientes = await pool.query(
                `SELECT u.nombres, u.apellidos, p.id_paciente
                 FROM usuario u JOIN paciente p ON u.id_usuario = p.id_usuario
                 ORDER BY p.id_paciente DESC LIMIT 50`
            );

            // Lista completa de órdenes de hoy (para el detalle clickeable del KPI)
            const ordenesHoyRes = await pool.query(
                `SELECT
                    o.id_orden,
                    o.numero_ticket,
                    o.estado,
                    o.fecha_orden,
                    COALESCE(o.total, 0)::numeric                AS total,
                    CONCAT(u.nombres, ' ', u.apellidos)           AS paciente
                 FROM orden_medica o
                 LEFT JOIN paciente p ON o.id_paciente = p.id_paciente
                 LEFT JOIN usuario  u ON p.id_usuario  = u.id_usuario
                 WHERE o.fecha_orden::date = $1
                 ORDER BY o.fecha_orden DESC`,
                [hoy]
            );
            const ordenesHoy = ordenesHoyRes.rows.map(o => ({
                ...o,
                total: parseFloat(o.total),
                paciente: o.paciente ? o.paciente.trim() : '—',
            }));

            // Lista COMPLETA de órdenes en proceso (sin restringir a "hoy"), para el
            // modal "En Proceso" y su filtro de búsqueda por fecha
            const ordenesProcesoRes = await pool.query(
                `SELECT
                    o.id_orden,
                    o.numero_ticket,
                    o.estado,
                    o.fecha_orden,
                    COALESCE(o.total, 0)::numeric                AS total,
                    CONCAT(u.nombres, ' ', u.apellidos)           AS paciente
                 FROM orden_medica o
                 LEFT JOIN paciente p ON o.id_paciente = p.id_paciente
                 LEFT JOIN usuario  u ON p.id_usuario  = u.id_usuario
                 WHERE o.estado IN ('Generada','Pagada','En Proceso','Por Validar')
                 ORDER BY o.fecha_orden DESC
                 LIMIT 500`
            );
            const ordenesProceso = ordenesProcesoRes.rows.map(o => ({
                ...o,
                total: parseFloat(o.total),
                paciente: o.paciente ? o.paciente.trim() : '—',
            }));

            // Lista COMPLETA de órdenes validadas (sin restringir a "hoy"), para el
            // modal "Listos para Entrega" y su filtro de búsqueda por fecha
            const ordenesValidadasRes = await pool.query(
                `SELECT
                    o.id_orden,
                    o.numero_ticket,
                    o.estado,
                    o.fecha_orden,
                    o.fecha_validacion,
                    COALESCE(o.total, 0)::numeric                AS total,
                    CONCAT(u.nombres, ' ', u.apellidos)           AS paciente
                 FROM orden_medica o
                 LEFT JOIN paciente p ON o.id_paciente = p.id_paciente
                 LEFT JOIN usuario  u ON p.id_usuario  = u.id_usuario
                 WHERE o.estado = 'Validado'
                 ORDER BY COALESCE(o.fecha_validacion, o.fecha_orden) DESC
                 LIMIT 500`
            );
            const ordenesValidadas = ordenesValidadasRes.rows.map(o => ({
                ...o,
                total: parseFloat(o.total),
                paciente: o.paciente ? o.paciente.trim() : '—',
            }));

            const queryGrafico = `
                SELECT estado AS name, COUNT(*)::int AS cantidad 
                FROM orden_medica 
                GROUP BY estado
            `;
            const graficoData = await pool.query(queryGrafico);

            // Alertas reales: órdenes sin pagar, resultados devueltos y stock bajo
            const alertasRes = await pool.query(`
                SELECT
                    (SELECT COUNT(*) FROM orden_medica
                     WHERE estado = 'Generada'
                       AND fecha_orden < NOW() - INTERVAL '1 day')  AS ordenes_sin_pagar,
                    (SELECT COUNT(*) FROM orden_medica
                     WHERE estado = 'Devuelto')                      AS resultados_devueltos,
                    (SELECT COUNT(*) FROM insumos
                     WHERE stock_actual <= stock_minimo
                       AND estado = TRUE)                            AS stock_bajo
            `);
            const al = alertasRes.rows[0];

            res.json({ 
                kpis: stats.rows[0], 
                pacientesRecientes: pacientesRecientes.rows,
                ordenesHoy,
                ordenesProceso,
                ordenesValidadas,
                grafico: graficoData.rows,
                alertas: {
                    urgentes:             parseInt(al.ordenes_sin_pagar    || 0),
                    resultados_devueltos: parseInt(al.resultados_devueltos || 0),
                    stock_bajo:           parseInt(al.stock_bajo           || 0),
                },
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },


    // Renombrado conceptualmente a "Ingresos" (ya no es solo "hoy"): acepta ?desde=&hasta=
getArqueoCajaHoy: async (req, res) => {
    try {
        const hoyISO = new Date().toISOString().split('T')[0];
        const desde  = req.query.desde || hoyISO;
        const hasta  = req.query.hasta || hoyISO;

        const queryTotales = `
            WITH pagos AS (
                SELECT
                    COALESCE(SUM(monto) FILTER (WHERE metodo_pago LIKE 'Efectivo%'), 0)      AS efectivo,
                    COALESCE(SUM(monto) FILTER (WHERE metodo_pago LIKE 'Transferencia%'), 0) AS transferencia
                FROM pago
                WHERE fecha_pago::date BETWEEN $1 AND $2
            ),
            reembolsos AS (
                SELECT
                    COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Efectivo'), 0)      AS efectivo,
                    COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Transferencia'), 0) AS transferencia
                FROM reembolso
                WHERE fecha_reembolso::date BETWEEN $1 AND $2
            )
            SELECT
                (pagos.efectivo - reembolsos.efectivo)           AS efectivo,
                (pagos.transferencia - reembolsos.transferencia) AS transferencia,
                pagos.efectivo                                   AS efectivo_cobrado,
                reembolsos.efectivo                              AS efectivo_reembolsado,
                pagos.transferencia                              AS transferencia_cobrada,
                reembolsos.transferencia                         AS transferencia_reembolsada,
                -- Alias con el nombre viejo que usa Admindashboard.jsx (misma info que arriba)
                reembolsos.efectivo                              AS reembolsos_efectivo,
                reembolsos.transferencia                         AS reembolsos_transferencia,
                0                                                AS tarjeta
            FROM pagos, reembolsos;
        `;

        // Detalle transacción por transacción para el listado "Movimientos del turno".
        // Se arma con UNION ALL (cobros + reembolsos) uniendo usuario y ticket de la orden.
        const queryMovimientos = `
            SELECT usuario, tipo, metodo, monto, hora, ticket
            FROM (
                SELECT
                    CONCAT(u.nombres, ' ', u.apellidos)              AS usuario,
                    'cobro'                                          AS tipo,
                    CASE
                        WHEN pa.metodo_pago LIKE 'Efectivo%'      THEN 'Efectivo'
                        WHEN pa.metodo_pago LIKE 'Transferencia%' THEN 'Transferencia'
                        ELSE pa.metodo_pago
                    END                                              AS metodo,
                    pa.monto                                         AS monto,
                    pa.fecha_pago                                    AS hora,
                    om.numero_ticket                                 AS ticket
                FROM pago pa
                LEFT JOIN orden_medica om        ON pa.id_orden = om.id_orden
                LEFT JOIN asistente_analista aa  ON pa.id_secretaria = aa.id_secretaria
                LEFT JOIN usuario u              ON aa.id_usuario = u.id_usuario
                WHERE pa.fecha_pago::date BETWEEN $1 AND $2

                UNION ALL

                SELECT
                    CONCAT(u.nombres, ' ', u.apellidos)              AS usuario,
                    'reembolso'                                      AS tipo,
                    re.metodo_reembolso                              AS metodo,
                    re.monto                                         AS monto,
                    re.fecha_reembolso                               AS hora,
                    om.numero_ticket                                 AS ticket
                FROM reembolso re
                LEFT JOIN orden_medica om        ON re.id_orden = om.id_orden
                LEFT JOIN asistente_analista aa  ON re.id_secretaria = aa.id_secretaria
                LEFT JOIN usuario u              ON aa.id_usuario = u.id_usuario
                WHERE re.fecha_reembolso::date BETWEEN $1 AND $2
            ) mov
            ORDER BY hora DESC;
        `;

        const [resTotales, resMovimientos] = await Promise.all([
            pool.query(queryTotales, [desde, hasta]),
            pool.query(queryMovimientos, [desde, hasta]),
        ]);

        const movimientos = resMovimientos.rows.map(m => ({
            usuario: m.usuario || 'No registrado',
            tipo: m.tipo,
            metodo: m.metodo,
            monto: parseFloat(m.monto),
            hora: m.hora,
            ticket: m.ticket || null,
        }));

        res.json({ ...resTotales.rows[0], movimientos });
    } catch (e) {
        console.error("Error en getArqueoCajaHoy:", e);
        res.status(500).json({ error: "Error en el servidor al calcular el arqueo" });
    }
},
    // ─── DRILL-DOWN: ARQUEO DEL DÍA DESGLOSADO POR USUARIO ──────────────────
    getArqueoPorUsuario: async (req, res) => {
        try {
            const hoyISO = new Date().toISOString().split('T')[0];
            const desde  = req.query.desde || hoyISO;
            const hasta  = req.query.hasta || hoyISO;

            const query = `
                WITH cobros AS (
                    SELECT
                        id_secretaria,
                        COALESCE(SUM(monto) FILTER (WHERE metodo_pago LIKE 'Efectivo%'), 0)      AS cobrado_efectivo,
                        COALESCE(SUM(monto) FILTER (WHERE metodo_pago LIKE 'Transferencia%'), 0) AS cobrado_transferencia
                    FROM pago
                    WHERE fecha_pago::date BETWEEN $1 AND $2
                    GROUP BY id_secretaria
                ),
                devoluciones AS (
                    SELECT
                        id_secretaria,
                        COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Efectivo'), 0)      AS reembolsado_efectivo,
                        COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Transferencia'), 0) AS reembolsado_transferencia
                    FROM reembolso
                    WHERE fecha_reembolso::date BETWEEN $1 AND $2
                    GROUP BY id_secretaria
                )
                SELECT
                    u.id_usuario,
                    CONCAT(u.nombres, ' ', u.apellidos)                          AS usuario,
                    COALESCE(ur1.rol, 'Sin rol')                                 AS rol,
                    COALESCE(cobros.cobrado_efectivo, 0)                         AS cobrado_efectivo,
                    COALESCE(cobros.cobrado_transferencia, 0)                    AS cobrado_transferencia,
                    COALESCE(devoluciones.reembolsado_efectivo, 0)               AS reembolsado_efectivo,
                    COALESCE(devoluciones.reembolsado_transferencia, 0)          AS reembolsado_transferencia,
                    COALESCE(cobros.cobrado_efectivo, 0)
                        - COALESCE(devoluciones.reembolsado_efectivo, 0)         AS neto_efectivo,
                    COALESCE(cobros.cobrado_transferencia, 0)
                        - COALESCE(devoluciones.reembolsado_transferencia, 0)    AS neto_transferencia
                FROM asistente_analista aa
                JOIN usuario u ON aa.id_usuario = u.id_usuario
                LEFT JOIN cobros       ON cobros.id_secretaria       = aa.id_secretaria
                LEFT JOIN devoluciones ON devoluciones.id_secretaria = aa.id_secretaria
                LEFT JOIN LATERAL (
                    SELECT r.nombre AS rol
                    FROM usuario_rol ur
                    JOIN rol r ON ur.id_rol = r.id_rol
                    WHERE ur.id_usuario = u.id_usuario
                      AND ur.activo = TRUE
                    ORDER BY ur.id_usuario_rol DESC
                    LIMIT 1
                ) ur1 ON TRUE
                WHERE cobros.id_secretaria IS NOT NULL OR devoluciones.id_secretaria IS NOT NULL
                ORDER BY (neto_efectivo + neto_transferencia) DESC
            `;

            const result = await pool.query(query, [desde, hasta]);

            const rows = result.rows.map(row => ({
                ...row,
                cobrado_efectivo:          parseFloat(row.cobrado_efectivo),
                cobrado_transferencia:     parseFloat(row.cobrado_transferencia),
                reembolsado_efectivo:      parseFloat(row.reembolsado_efectivo),
                reembolsado_transferencia: parseFloat(row.reembolsado_transferencia),
                neto_efectivo:             parseFloat(row.neto_efectivo),
                neto_transferencia:        parseFloat(row.neto_transferencia),
            }));

            res.json(rows);
        } catch (e) {
            console.error("Error en getArqueoPorUsuario:", e);
            res.status(500).json({ error: "Error en el servidor al calcular el arqueo por usuario" });
        }
    },

    // ─── NUEVA ACCIÓN: DESCARGAR REPORTE MENSUAL EN CSV ─────────────────────
    descargarReporteMensual: async (req, res) => {
        try {
            const { mes, anio } = req.query;
            if (!mes || !anio) {
                return res.status(400).json({ error: "El mes y el año son parámetros obligatorios." });
            }

            const query = `
                SELECT 
                    o.id_orden, 
                    o.numero_ticket, 
                    o.fecha_orden::date as fecha, 
                    o.estado, 
                    COALESCE(o.total, 0) as total,
                    u.nombres, 
                    u.apellidos
                FROM orden_medica o
                LEFT JOIN paciente p ON o.id_paciente = p.id_paciente
                LEFT JOIN usuario u ON p.id_usuario = u.id_usuario
                WHERE EXTRACT(MONTH FROM o.fecha_orden) = $1 
                  AND EXTRACT(YEAR FROM o.fecha_orden) = $2
                ORDER BY o.fecha_orden DESC
            `;
            const result = await pool.query(query, [mes, anio]);

            let csvContent = '\uFEFF';
            csvContent += 'ID Órden,Ticket,Fecha,Estado,Total Facturado,Paciente\n';

            result.rows.forEach(row => {
                const nombreCompleto = `${row.nombres || ''} ${row.apellidos || ''}`.trim() || 'No Registrado';
                csvContent += `${row.id_orden},${row.numero_ticket || '—'},${row.fecha},${row.estado},${parseFloat(row.total).toFixed(2)},"${nombreCompleto}"\n`;
            });

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=Reporte_Mensual_${mes}_${anio}.csv`);
            return res.status(200).send(csvContent);

        } catch (e) {
            console.error("Error generando reporte mensual:", e);
            res.status(500).json({ error: "Error interno al generar el archivo de reporte." });
        }
    },

    // ─── AUDITORÍA GENERAL (endpoint /dashboard/auditoria) ──────────────────
    getAuditoria: async (req, res) => {
        try {
            const { desde, hasta } = req.query;

            // ✅ CORRECCIÓN: se une auditoria.id_usuario_rol directamente con usuario_rol
            // así se obtiene el rol CON EL QUE realmente actuó, no todos sus roles
            const query = `
                SELECT
                    a.id_auditoria,
                    a.accion,
                    a.descripcion,
                    a.fecha_hora,
                    COALESCE(u.nombres,   'Usuario eliminado') AS nombres,
                    COALESCE(u.apellidos, '')                  AS apellidos,
                    COALESCE(u.username,  'desconocido')       AS username,
                    COALESCE(u.correo,    '')                  AS correo,
                    COALESCE(r.nombre,    'Sin rol')           AS rol
                FROM auditoria a
                LEFT JOIN usuario      u  ON a.id_usuario     = u.id_usuario
                LEFT JOIN usuario_rol  ur ON a.id_usuario_rol = ur.id_usuario_rol
                LEFT JOIN rol          r  ON ur.id_rol        = r.id_rol
                WHERE ($1::date IS NULL OR a.fecha_hora::date >= $1)
                  AND ($2::date IS NULL OR a.fecha_hora::date <= $2)
                ORDER BY a.fecha_hora DESC
                LIMIT 200
            `;
            const result = await pool.query(query, [desde || null, hasta || null]);
            res.json(result.rows);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // ─── DASHBOARD TÉCNICO ──────────────────────────────────────────────────
    getTecnicoStats: async (req, res) => {
        try {
            const hoy = new Date().toISOString().split('T')[0];

            const queryKpis = `
                SELECT
                    (SELECT COUNT(*) FROM usuario)                                                                   AS total_usuarios,
                    (SELECT COUNT(*) FROM usuario WHERE estado = true)                                               AS usuarios_activos,
                    (SELECT COUNT(*) FROM usuario WHERE estado = false)                                              AS usuarios_inactivos,
                    (SELECT COUNT(*) FROM usuario_rol ur
                     JOIN rol r ON ur.id_rol = r.id_rol
                     WHERE r.nombre = 'Técnico'
                       AND ur.activo = TRUE)                                                                        AS total_tecnicos,
                    (SELECT COUNT(*) FROM examen)                                                                    AS total_examenes,
                    (SELECT COUNT(*) FROM parametro_examen)                                                         AS total_parametros,
                    (SELECT COUNT(*) FROM categoria_examen WHERE estado = true)                                      AS total_categorias,
                    (SELECT COUNT(*) FROM usuario WHERE ultimo_acceso::date = $1)                                    AS usuarios_activos_hoy,
                    (SELECT COUNT(*) FROM examen e
                     WHERE NOT EXISTS (
                         SELECT 1 FROM parametro_examen pe WHERE pe.id_examen = e.id_examen
                     ))                                                                                              AS ex_sin_parametros,
                    (SELECT COUNT(*) FROM auditoria
                     WHERE fecha_hora > NOW() - INTERVAL '30 days')                                                 AS eventos_auditoria_mes
            `;
            const stats = await pool.query(queryKpis, [hoy]);

            // ✅ CORRECCIÓN: mismo fix — unir por a.id_usuario_rol, no por ur.id_usuario
            const queryLogs = `
                SELECT
                    COALESCE(u.username, 'desconocido') AS username,
                    a.accion,
                    a.descripcion,
                    a.fecha_hora                        AS fecha_registro,
                    COALESCE(r.nombre, 'Sin rol')       AS rol
                FROM auditoria a
                LEFT JOIN usuario      u  ON a.id_usuario     = u.id_usuario
                LEFT JOIN usuario_rol  ur ON a.id_usuario_rol = ur.id_usuario_rol
                LEFT JOIN rol          r  ON ur.id_rol        = r.id_rol
                ORDER BY a.fecha_hora DESC
                LIMIT 50
            `;
            const logsResult = await pool.query(queryLogs);

            const dbStats = await pool.query(
                `SELECT COUNT(*) AS conexiones_activas FROM pg_stat_activity WHERE state = 'active'`
            );

            res.json({
                status: "success",
                kpis: stats.rows[0],
                auditoriaDetallada: logsResult.rows,
                estadoSistema: {
                    baseDatos:         "CONECTADA",
                    conexionesActivas: dbStats.rows[0].conexiones_activas,
                    entorno:           process.env.NODE_ENV || "development",
                    versionBD:         "PostgreSQL 15+",
                    servidorActivo:    true,
                },
            });
        } catch (e) {
            console.error("Error en getTecnicoStats:", e);
            res.status(500).json({ status: "error", error: "Error al recuperar datos técnicos del sistema" });
        }
    },

  
// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/ordenes-por-usuario
// Devuelve las órdenes de hoy agrupadas por el usuario que las creó
// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/ordenes-por-usuario
getOrdenesPorUsuario: async (req, res) => {
    try {
        const hoy = new Date().toISOString().split('T')[0];

        const result = await pool.query(`
            SELECT
                o.id_orden,
                o.numero_ticket,
                o.estado,
                o.fecha_orden,
                COALESCE(o.total, 0)                                 AS total,
                CONCAT(up.nombres, ' ', up.apellidos)                AS paciente,
                CONCAT(uu.nombres, ' ', uu.apellidos)                AS nombre_usuario,
                uu.username                                          AS username,
                ur1.rol                                              AS rol
            FROM orden_medica o
            LEFT JOIN paciente          p   ON o.id_paciente   = p.id_paciente
            LEFT JOIN usuario           up  ON p.id_usuario    = up.id_usuario
            LEFT JOIN asistente_analista aa ON o.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario           uu  ON aa.id_usuario   = uu.id_usuario
            LEFT JOIN LATERAL (
                SELECT r.nombre AS rol
                FROM usuario_rol ur
                JOIN rol r ON ur.id_rol = r.id_rol
                WHERE ur.id_usuario = uu.id_usuario
                  AND ur.activo = TRUE
                ORDER BY ur.id_usuario_rol DESC
                LIMIT 1
            ) ur1 ON TRUE
            WHERE o.fecha_orden::date = $1
            ORDER BY uu.nombres ASC, o.fecha_orden DESC
        `, [hoy]);

        const mapa = {};
        for (const row of result.rows) {
            const key = row.username || 'sin_usuario';
            if (!mapa[key]) {
                mapa[key] = {
                    usuario: row.nombre_usuario || 'Usuario desconocido',
                    username: row.username,
                    rol: row.rol || 'Sin rol',
                    ordenes: [],
                };
            }
            mapa[key].ordenes.push({
                id_orden:      row.id_orden,
                numero_ticket: row.numero_ticket,
                estado:        row.estado,
                fecha_orden:   row.fecha_orden,
                total:         parseFloat(row.total),
                paciente:      row.paciente ? row.paciente.trim() : '—',
            });
        }

        res.json(Object.values(mapa));
    } catch (e) {
        console.error('Error crítico en getOrdenesPorUsuario:', e.message);
        res.status(500).json({ error: "Fallo interno al procesar órdenes por usuario." });
    }
},

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/ordenes-por-usuario
// Devuelve las órdenes de hoy agrupadas por el usuario que las creó
// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/ingresos-por-usuario?desde=&hasta=
getIngresosPorUsuario: async (req, res) => {
    try {
        const hoyISO = new Date().toISOString().split('T')[0];
        const desde  = req.query.desde || hoyISO;
        const hasta  = req.query.hasta || hoyISO;

        const result = await pool.query(`
            WITH cobros AS (
                SELECT id_secretaria,
                       COUNT(DISTINCT id_orden)::int AS total_ordenes,
                       SUM(monto)                     AS total_cobrado
                FROM pago
                WHERE fecha_pago::date BETWEEN $1 AND $2
                GROUP BY id_secretaria
            ),
            devoluciones AS (
                SELECT id_secretaria,
                       SUM(monto) AS total_reembolsado
                FROM reembolso
                WHERE fecha_reembolso::date BETWEEN $1 AND $2
                GROUP BY id_secretaria
            )
            SELECT
                u.id_usuario,
                CONCAT(u.nombres, ' ', u.apellidos)          AS usuario,
                COALESCE(ur1.rol, 'Sin rol')                 AS rol,
                COALESCE(cobros.total_ordenes, 0)            AS total_ordenes,
                COALESCE(cobros.total_cobrado, 0)
                    - COALESCE(devoluciones.total_reembolsado, 0)   AS total_generado,
                COALESCE(devoluciones.total_reembolsado, 0)  AS total_reembolsado
            FROM asistente_analista aa
            JOIN usuario u ON aa.id_usuario = u.id_usuario
            LEFT JOIN cobros       ON cobros.id_secretaria       = aa.id_secretaria
            LEFT JOIN devoluciones ON devoluciones.id_secretaria = aa.id_secretaria
            LEFT JOIN LATERAL (
                SELECT r.nombre AS rol
                FROM usuario_rol ur
                JOIN rol r ON ur.id_rol = r.id_rol
                WHERE ur.id_usuario = u.id_usuario
                  AND ur.activo = TRUE
                ORDER BY ur.id_usuario_rol DESC
                LIMIT 1
            ) ur1 ON TRUE
            WHERE cobros.id_secretaria IS NOT NULL OR devoluciones.id_secretaria IS NOT NULL
            ORDER BY total_generado DESC
        `, [desde, hasta]);

        const rowsCorregidas = result.rows.map(row => ({
            ...row,
            total_generado:    parseFloat(row.total_generado),
            total_reembolsado: parseFloat(row.total_reembolsado),
        }));

        res.json(rowsCorregidas);
    } catch (e) {
        console.error('Error crítico en getIngresosPorUsuario:', e.message);
        res.status(500).json({ error: "Fallo interno al calcular ingresos por usuario." });
    }
},
// ─────────────────────────────────────────────────────────────────────────────
// GET /usuarios/activos-hoy
// Lista de usuarios que han iniciado sesión hoy (para el modal de usuarios)
// ─────────────────────────────────────────────────────────────────────────────
// NOTA: Este endpoint va en usuariosController.js / usuariosRoutes.js
// Se agrega aquí como referencia. Mover al archivo correcto.
getUsuariosActivosHoy: async (req, res) => {
    try {
        const hoy = new Date().toISOString().split('T')[0];

        const result = await pool.query(`
            SELECT
                u.id_usuario,
                u.nombres,
                u.apellidos,
                u.username,
                u.correo,
                u.ultimo_acceso,
                r.nombre AS rol
            FROM usuario u
            LEFT JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
            LEFT JOIN rol r ON ur.id_rol = r.id_rol
            WHERE u.ultimo_acceso::date = $1
              AND u.estado = TRUE
            ORDER BY u.ultimo_acceso DESC
        `, [hoy]);

        res.json(result.rows);
    } catch (e) {
        console.error('Error en getUsuariosActivosHoy:', e);
        res.status(500).json({ error: e.message });
    }
},

// ─────────────────────────────────────────────────────────────────────────────
// GET /resultados/criticos
// Lista de resultados con valores fuera del rango de referencia
// ─────────────────────────────────────────────────────────────────────────────
// NOTA: Este endpoint va en resultadosController.js / resultadosRoutes.js
// Se agrega aquí como referencia. Mover al archivo correcto.
getResultadosCriticos: async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                CONCAT(u.nombres, ' ', u.apellidos) AS paciente,
                e.nombre_examen                      AS examen,
                pe.nombre_parametro                  AS parametro,
                dr.valor_obtenido,
                pe.rango_min,
                pe.rango_max,
                pe.unidad
            FROM detalle_resultado dr
            JOIN parametro_examen pe ON dr.id_parametro = pe.id_parametro
            JOIN examen e            ON pe.id_examen    = e.id_examen
            JOIN resultado r         ON dr.id_resultado = r.id_resultado
            JOIN orden_medica o      ON r.id_orden      = o.id_orden
            JOIN paciente p          ON o.id_paciente   = p.id_paciente
            JOIN usuario u           ON p.id_usuario    = u.id_usuario
            WHERE dr.valor_obtenido ~ '^-?[0-9]+(\\.[0-9]+)?$'
              AND pe.rango_min IS NOT NULL
              AND pe.rango_max IS NOT NULL
              AND (
                  dr.valor_obtenido::numeric > pe.rango_max
                  OR dr.valor_obtenido::numeric < pe.rango_min
              )
            ORDER BY o.fecha_orden DESC
            LIMIT 100
        `);

        res.json(result.rows);
    } catch (e) {
        console.error('Error en getResultadosCriticos:', e);
        res.status(500).json({ error: e.message });
    }
},

};

module.exports = dashboardController;