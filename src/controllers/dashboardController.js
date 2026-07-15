const pool = require('../config/db');
const cajaModule = require('../modules/cajaModule');

// ─── HELPER: FECHA "HOY" EN ZONA HORARIA DE ECUADOR ─────────────────────────
// new Date().toISOString() siempre devuelve la fecha en UTC. Ecuador es
// GMT-5, así que entre las 19:00 y las 23:59 (hora local) toISOString() ya
// devuelve la fecha del día siguiente, haciendo que los filtros "de hoy"
// (arqueo de caja, KPIs, etc.) busquen una fecha sin datos todavía y
// muestren $0.00 aunque sí haya movimientos. Esta función calcula "hoy"
// directamente en America/Guayaquil, sin pasar por UTC.
function getHoyLocal() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Guayaquil',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

// ─── HELPER: FILTRO DE ALCANCE POR ROL (admin ve todo, asistente solo lo suyo) ──
// Misma lógica que ya usaba getArqueoCajaHoy, extraída aquí para poder
// reutilizarla en cualquier endpoint que desglose datos por secretaria/usuario
// y así evitar que un asistente vea los ingresos de sus compañeros.
async function getFiltroSecretaria(req) {
    const userRolRes = await pool.query(
        `SELECT r.nombre 
         FROM usuario_rol ur 
         JOIN rol r ON ur.id_rol = r.id_rol 
         WHERE ur.id_usuario = $1 AND ur.activo = TRUE 
         LIMIT 1`,
        [req.user.id]
    );

    const nombreRol = userRolRes.rows[0]?.nombre;

    if (nombreRol === 'Administrador') {
        // Admin: sin filtro, la consulta trae todo
        return null;
    }

    // Asistente (o cualquier otro rol): solo su propio id_secretaria
    const secRes = await pool.query(
        `SELECT id_secretaria FROM asistente_analista WHERE id_usuario = $1`,
        [req.user.id]
    );

    if (secRes.rows.length > 0) {
        return secRes.rows[0].id_secretaria;
    }

    // No es admin y no tiene perfil de secretaria: forzamos un ID inexistente
    return -1;
}

const dashboardController = {

    // ─── DASHBOARD ADMINISTRADOR ────────────────────────────────────────────
    getAdminStats: async (req, res) => {
        try {
            const hoy = getHoyLocal();
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
            const hoy = getHoyLocal();
            
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
    //
    // Alcance de los datos:
    //  - Si quien consulta tiene perfil de asistente/secretaria (asistente_analista),
    //    el arqueo se restringe SOLO a su propio id_secretaria (su propio turno/caja),
    //    para que en Dashboardasistente.jsx cada secretaria vea únicamente lo suyo.
    //  - Si quien consulta NO tiene ese perfil (p. ej. el administrador), se mantiene
    //    el comportamiento global de siempre (todas las secretarias), que es lo que
    //    consume Admindashboard.jsx.
getArqueoCajaHoy: async (req, res) => {
    try {
        const hoyISO = getHoyLocal(); // Función que ya tienes para fecha local
        const desde  = req.query.desde || hoyISO;
        const hasta  = req.query.hasta || hoyISO;

        // 1. OBTENER ROL DEL USUARIO
        // Buscamos el rol activo del usuario que hace la petición
        const userRolRes = await pool.query(
            `SELECT r.nombre 
             FROM usuario_rol ur 
             JOIN rol r ON ur.id_rol = r.id_rol 
             WHERE ur.id_usuario = $1 AND ur.activo = TRUE 
             LIMIT 1`,
            [req.user.id]
        );

        const nombreRol = userRolRes.rows[0]?.nombre;
        let id_secretaria_filtro = null;

        // 2. APLICAR LÓGICA DE FILTRO
        if (nombreRol === 'Administrador') {
            // Si es Admin, el filtro se queda en NULL para que la consulta traiga TODO
            id_secretaria_filtro = null;
        } else {
            // Si es Asistente (o cualquier otro), buscamos su ID de secretaria
            const secRes = await pool.query(
                `SELECT id_secretaria FROM asistente_analista WHERE id_usuario = $1`,
                [req.user.id]
            );
            
            if (secRes.rows.length > 0) {
                id_secretaria_filtro = secRes.rows[0].id_secretaria;
            } else {
                // Si no es admin y no tiene perfil de secretaria, 
                // forzamos un ID que no exista (-1) para que devuelva 0
                id_secretaria_filtro = -1;
            }
        }

        // 3. CONSULTA SQL
        // La magia está en: ($3::int IS NULL OR t.id_secretaria = $3)
        // Si $3 es NULL (Admin), la condición siempre es verdadera y trae todo.
        // Si $3 tiene un ID (Asistente), filtra solo sus registros.
        const queryTotales = `
            SELECT
                COALESCE(SUM(monto) FILTER (WHERE origen = 'pago' AND metodo ILIKE 'Efectivo%'), 0) -
                COALESCE(SUM(monto) FILTER (WHERE origen = 'reembolso' AND metodo ILIKE 'Efectivo%'), 0) AS efectivo,

                COALESCE(SUM(monto) FILTER (WHERE origen = 'pago' AND metodo ILIKE 'Transferencia%'), 0) -
                COALESCE(SUM(monto) FILTER (WHERE origen = 'reembolso' AND metodo ILIKE 'Transferencia%'), 0) AS transferencia,

                COALESCE(SUM(monto) FILTER (WHERE origen = 'pago' AND metodo ILIKE 'Efectivo%'), 0) AS efectivo_cobrado,
                COALESCE(SUM(monto) FILTER (WHERE origen = 'reembolso' AND metodo ILIKE 'Efectivo%'), 0) AS reembolsos_efectivo,
                COALESCE(SUM(monto) FILTER (WHERE origen = 'pago' AND metodo ILIKE 'Transferencia%'), 0) AS transferencia_cobrada,
                COALESCE(SUM(monto) FILTER (WHERE origen = 'reembolso' AND metodo ILIKE 'Transferencia%'), 0) AS reembolsos_transferencia
            FROM (
                SELECT 'pago' as origen, metodo_pago as metodo, monto, fecha_pago as fecha, id_secretaria FROM pago
                UNION ALL
                SELECT 'reembolso' as origen, metodo_reembolso as metodo, monto, fecha_reembolso as fecha, id_secretaria FROM reembolso
            ) t
            WHERE t.fecha::date BETWEEN $1 AND $2
              AND ($3::int IS NULL OR t.id_secretaria = $3)
        `;

        const resTotales = await pool.query(queryTotales, [desde, hasta, id_secretaria_filtro]);
        const totales = resTotales.rows[0];

        res.json({
            efectivo: parseFloat(totales.efectivo),
            transferencia: parseFloat(totales.transferencia),
            efectivo_cobrado: parseFloat(totales.efectivo_cobrado),
            reembolsos_efectivo: parseFloat(totales.reembolsos_efectivo),
            transferencia_cobrada: parseFloat(totales.transferencia_cobrada),
            reembolsos_transferencia: parseFloat(totales.reembolsos_transferencia)
        });

    } catch (e) {
        console.error("Error en getArqueoCajaHoy:", e);
        res.status(500).json({ error: "Fallo al calcular el arqueo de caja." });
    }
},

    // ─── DRILL-DOWN: ARQUEO DEL DÍA DESGLOSADO POR USUARIO ──────────────────
    getArqueoPorUsuario: async (req, res) => {
        try {
            const hoyISO = getHoyLocal();
            const desde  = req.query.desde || hoyISO;
            const hasta  = req.query.hasta || hoyISO;

            // Alcance: admin ve todos los asistentes, un asistente solo se ve a sí mismo.
            const id_secretaria_filtro = await getFiltroSecretaria(req);

            const query = `
                WITH cobros AS (
                    SELECT
                        id_secretaria,
                        COALESCE(SUM(monto) FILTER (WHERE metodo_pago ILIKE 'Efectivo%'), 0)      AS cobrado_efectivo,
                        COALESCE(SUM(monto) FILTER (WHERE metodo_pago ILIKE 'Transferencia%'), 0) AS cobrado_transferencia
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
                WHERE (cobros.id_secretaria IS NOT NULL OR devoluciones.id_secretaria IS NOT NULL)
                  AND ($3::int IS NULL OR aa.id_secretaria = $3)
                ORDER BY (neto_efectivo + neto_transferencia) DESC
            `;

            const result = await pool.query(query, [desde, hasta, id_secretaria_filtro]);

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
            const hoy = getHoyLocal();

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
        const hoy = getHoyLocal();

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
        const hoyISO = getHoyLocal();
        const desde  = req.query.desde || hoyISO;
        const hasta  = req.query.hasta || hoyISO;

        // Alcance: admin ve todos los asistentes, un asistente solo se ve a sí mismo.
        const id_secretaria_filtro = await getFiltroSecretaria(req);

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
            WHERE (cobros.id_secretaria IS NOT NULL OR devoluciones.id_secretaria IS NOT NULL)
              AND ($3::int IS NULL OR aa.id_secretaria = $3)
            ORDER BY total_generado DESC
        `, [desde, hasta, id_secretaria_filtro]);

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
        const hoy = getHoyLocal();

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

// ─────────────────────────────────────────────────────────────────────────────
// ARQUEO DE CAJA — LISTADO DETALLADO DE CIERRES (drill-down por turno)
// GET /dashboard/cierres-caja?desde=&hasta=&q=
//
// A diferencia de getArqueoCajaHoy (que agrega pago/reembolso por rango de
// fecha sin importar el turno), este endpoint consulta cierre_caja turno por
// turno: quién abrió/cerró, fondo inicial, cobrado, reembolsado, efectivo
// esperado vs contado y la diferencia. Incluye turnos ABIERTOS (con totales
// calculados en vivo) y CERRADOS (con los totales persistidos al cierre).
//
// Además arma 3 bloques de análisis para la parte de tesis:
//   - resumen:        conteos y montos globales, y descuadres (faltante/sobrante)
//   - tendencia:      serie de diferencias por cierre, ordenada por fecha (para gráfico)
//   - rankingCajeros:  por secretaria, precisión de cierre y monto gestionado
// ─────────────────────────────────────────────────────────────────────────────
getCierresCaja: async (req, res) => {
    try {
        const hoyISO = getHoyLocal();
        const desde  = req.query.desde || hoyISO;
        const hasta  = req.query.hasta || hoyISO;
        const q      = (req.query.q || '').trim() || null;

        const query = `
            SELECT
                cc.id_cierre,
                cc.id_secretaria,
                cc.fecha_apertura,
                cc.fecha_cierre,
                cc.estado,
                cc.monto_inicial,
                cc.efectivo_contado,
                cc.diferencia,
                cc.observaciones,
                u.nombres,
                u.apellidos,
                u.username,
                COALESCE(p.efectivo, 0)       AS pago_efectivo,
                COALESCE(p.transferencia, 0)  AS pago_transferencia,
                COALESCE(p.num_pagos, 0)      AS num_pagos,
                COALESCE(r.efectivo, 0)       AS reembolso_efectivo,
                COALESCE(r.transferencia, 0)  AS reembolso_transferencia,
                COALESCE(r.num_reembolsos, 0) AS num_reembolsos
            FROM cierre_caja cc
            JOIN asistente_analista aa ON cc.id_secretaria = aa.id_secretaria
            JOIN usuario u             ON aa.id_usuario    = u.id_usuario
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(monto) FILTER (WHERE metodo_pago ILIKE 'Efectivo%'), 0)      AS efectivo,
                    COALESCE(SUM(monto) FILTER (WHERE metodo_pago ILIKE 'Transferencia%'), 0) AS transferencia,
                    COUNT(*)                                                                  AS num_pagos
                FROM pago WHERE pago.id_cierre = cc.id_cierre
            ) p ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Efectivo'), 0)      AS efectivo,
                    COALESCE(SUM(monto) FILTER (WHERE metodo_reembolso = 'Transferencia'), 0) AS transferencia,
                    COUNT(*)                                                                   AS num_reembolsos
                FROM reembolso WHERE reembolso.id_cierre = cc.id_cierre
            ) r ON TRUE
            WHERE (cc.fecha_apertura AT TIME ZONE 'America/Guayaquil')::date BETWEEN $1 AND $2
              AND (
                    $3::text IS NULL
                    OR u.nombres   ILIKE '%' || $3 || '%'
                    OR u.apellidos ILIKE '%' || $3 || '%'
                    OR u.username  ILIKE '%' || $3 || '%'
                    OR CAST(cc.id_cierre AS TEXT) = $3
                  )
            ORDER BY cc.fecha_apertura DESC
        `;

        const { rows } = await pool.query(query, [desde, hasta, q]);

        const TOLERANCIA = 0.01; // diferencias de hasta 1 centavo se consideran "cuadradas"

        let totalCobradoEfectivo = 0, totalCobradoTransferencia = 0;
        let totalReembolsadoEfectivo = 0, totalReembolsadoTransferencia = 0;
        let cerrados = 0, cuadrados = 0, conDescuadre = 0;
        let faltanteMonto = 0, faltanteCount = 0, sobranteMonto = 0, sobranteCount = 0;
        const tendencia = [];
        const porCajero = {};

        const cierres = rows.map(row => {
            const montoInicial       = parseFloat(row.monto_inicial);
            const pagoEfectivo       = parseFloat(row.pago_efectivo);
            const pagoTransferencia  = parseFloat(row.pago_transferencia);
            const reembEfectivo      = parseFloat(row.reembolso_efectivo);
            const reembTransferencia = parseFloat(row.reembolso_transferencia);
            // Efectivo esperado calculado en vivo (consistente para ABIERTO y CERRADO,
            // en vez de depender únicamente de la columna persistida)
            const efectivoEsperado   = montoInicial + pagoEfectivo - reembEfectivo;

            const cerrado          = row.estado === 'CERRADO';
            const efectivoContado  = cerrado && row.efectivo_contado !== null ? parseFloat(row.efectivo_contado) : null;
            const diferencia       = cerrado && row.diferencia !== null ? parseFloat(row.diferencia) : null;

            let duracionMin = null;
            if (row.fecha_cierre) {
                duracionMin = Math.round((new Date(row.fecha_cierre) - new Date(row.fecha_apertura)) / 60000);
            }

            totalCobradoEfectivo          += pagoEfectivo;
            totalCobradoTransferencia     += pagoTransferencia;
            totalReembolsadoEfectivo      += reembEfectivo;
            totalReembolsadoTransferencia += reembTransferencia;

            const cajeroNombre = `${row.nombres} ${row.apellidos}`.trim();
            if (!porCajero[row.id_secretaria]) {
                porCajero[row.id_secretaria] = {
                    id_secretaria: row.id_secretaria,
                    cajero: cajeroNombre,
                    username: row.username,
                    total_cierres: 0,
                    cerrados: 0,
                    cuadrados: 0,
                    con_descuadre: 0,
                    monto_gestionado: 0,
                    suma_diferencias: 0,
                };
            }
            const cajeroStat = porCajero[row.id_secretaria];
            cajeroStat.total_cierres += 1;
            cajeroStat.monto_gestionado += pagoEfectivo + pagoTransferencia;

            if (cerrado) {
                cerrados += 1;
                cajeroStat.cerrados += 1;
                if (diferencia !== null) {
                    cajeroStat.suma_diferencias += diferencia;
                    if (Math.abs(diferencia) <= TOLERANCIA) {
                        cuadrados += 1;
                        cajeroStat.cuadrados += 1;
                    } else {
                        conDescuadre += 1;
                        cajeroStat.con_descuadre += 1;
                        if (diferencia < 0) { faltanteMonto += Math.abs(diferencia); faltanteCount += 1; }
                        else                { sobranteMonto += diferencia; sobranteCount += 1; }
                    }
                    tendencia.push({
                        id_cierre: row.id_cierre,
                        fecha: row.fecha_cierre,
                        cajero: cajeroNombre,
                        diferencia,
                    });
                }
            }

            return {
                id_cierre: row.id_cierre,
                id_secretaria: row.id_secretaria,
                cajero: cajeroNombre,
                username: row.username,
                fecha_apertura: row.fecha_apertura,
                fecha_cierre: row.fecha_cierre,
                estado: row.estado,
                duracion_minutos: duracionMin,
                monto_inicial: montoInicial,
                cobrado_efectivo: pagoEfectivo,
                cobrado_transferencia: pagoTransferencia,
                num_pagos: parseInt(row.num_pagos, 10),
                reembolsado_efectivo: reembEfectivo,
                reembolsado_transferencia: reembTransferencia,
                num_reembolsos: parseInt(row.num_reembolsos, 10),
                efectivo_esperado: parseFloat(efectivoEsperado.toFixed(2)),
                efectivo_contado: efectivoContado,
                diferencia,
                observaciones: row.observaciones,
            };
        });

        const rankingCajeros = Object.values(porCajero)
            .map(c => ({
                ...c,
                monto_gestionado: parseFloat(c.monto_gestionado.toFixed(2)),
                diferencia_promedio: c.cerrados > 0 ? parseFloat((c.suma_diferencias / c.cerrados).toFixed(2)) : null,
                precision_pct: c.cerrados > 0 ? parseFloat(((c.cuadrados / c.cerrados) * 100).toFixed(1)) : null,
            }))
            .sort((a, b) => b.monto_gestionado - a.monto_gestionado);

        res.json({
            cierres,
            resumen: {
                total_cierres:                   cierres.length,
                cierres_abiertos:                 cierres.length - cerrados,
                cierres_cerrados:                 cerrados,
                total_cobrado_efectivo:           parseFloat(totalCobradoEfectivo.toFixed(2)),
                total_cobrado_transferencia:      parseFloat(totalCobradoTransferencia.toFixed(2)),
                total_reembolsado_efectivo:       parseFloat(totalReembolsadoEfectivo.toFixed(2)),
                total_reembolsado_transferencia:  parseFloat(totalReembolsadoTransferencia.toFixed(2)),
                cierres_cuadrados:                cuadrados,
                cierres_con_descuadre:            conDescuadre,
                descuadres_faltante: { count: faltanteCount, monto: parseFloat(faltanteMonto.toFixed(2)) },
                descuadres_sobrante: { count: sobranteCount, monto: parseFloat(sobranteMonto.toFixed(2)) },
            },
            tendencia: tendencia.sort((a, b) => new Date(a.fecha) - new Date(b.fecha)),
            rankingCajeros,
        });
    } catch (e) {
        console.error('Error en getCierresCaja:', e);
        res.status(500).json({ error: 'Error interno al obtener el arqueo detallado de cierres de caja.' });
    }
},

// ─────────────────────────────────────────────────────────────────────────────
// GET /dashboard/cierres-caja/:id
// Drill-down de un cierre puntual: cabecera + lista de pagos + lista de
// reembolsos de ese turno (reutiliza cajaModule, misma fuente que usa la
// secretaria al cerrar su turno, para que los números siempre coincidan).
// ─────────────────────────────────────────────────────────────────────────────
getDetalleCierreCaja: async (req, res) => {
    try {
        const detalle = await cajaModule.obtenerDetalleCierre(parseInt(req.params.id));
        res.json(detalle);
    } catch (e) {
        res.status(e.message.includes('no existe') ? 404 : 500).json({ error: e.message });
    }
},

};

module.exports = dashboardController;