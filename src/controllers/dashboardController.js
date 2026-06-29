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
                    (SELECT COALESCE(SUM(monto),0) FROM pago WHERE fecha_pago::date = $1)                           AS ingresos_hoy,
                    (SELECT COUNT(*) FROM insumos WHERE stock_actual <= stock_minimo)                                AS stock_bajo
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
                    (SELECT COUNT(*) FROM orden_medica WHERE estado IN ('Generada','En Proceso'))                    AS resultados_pen,
                    (SELECT COUNT(*) FROM orden_medica WHERE estado = 'Validado')                                    AS listos_entrega
            `;
            const stats = await pool.query(queryKpis, [hoy]);
            
            const pacientesRecientes = await pool.query(
                `SELECT u.nombres, u.apellidos, p.id_paciente
                 FROM usuario u JOIN paciente p ON u.id_usuario = p.id_usuario
                 ORDER BY p.id_paciente DESC LIMIT 5`
            );

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


    // Añadir esto dentro del objeto dashboardController
getArqueoCajaHoy: async (req, res) => {
    try {
        const query = `
            SELECT 
                COALESCE(SUM(monto) FILTER (WHERE metodo_pago = 'Efectivo'), 0) as efectivo,
                COALESCE(SUM(monto) FILTER (WHERE metodo_pago = 'Transferencia'), 0) as transferencia,
                0 as tarjeta
            FROM pago
            WHERE fecha_pago::date = CURRENT_DATE;
        `;
        
        // Ejecutamos la consulta
        const result = await pool.query(query);
        
        // Enviamos el resultado al frontend
        res.json(result.rows[0]);
    } catch (e) {
        console.error("Error en getArqueoCajaHoy:", e);
        res.status(500).json({ error: "Error en el servidor al calcular el arqueo" });
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
                r.nombre                                             AS rol
            FROM orden_medica o
            LEFT JOIN paciente          p   ON o.id_paciente   = p.id_paciente
            LEFT JOIN usuario           up  ON p.id_usuario    = up.id_usuario
            LEFT JOIN asistente_analista aa ON o.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario           uu  ON aa.id_usuario   = uu.id_usuario
            LEFT JOIN usuario_rol       ur  ON uu.id_usuario   = ur.id_usuario AND ur.activo = TRUE
            LEFT JOIN rol               r   ON ur.id_rol       = r.id_rol
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

// GET /dashboard/ingresos-por-usuario
getIngresosPorUsuario: async (req, res) => {
    try {
        const hoy = new Date().toISOString().split('T')[0];

        const result = await pool.query(`
            SELECT
                CONCAT(u.nombres, ' ', u.apellidos)    AS usuario,
                r.nombre                                AS rol,
                COUNT(o.id_orden)::int                  AS total_ordenes,
                COALESCE(SUM(o.total), 0)::numeric      AS total_generado
            FROM orden_medica o
            LEFT JOIN asistente_analista aa ON o.id_secretaria = aa.id_secretaria
            LEFT JOIN usuario            u  ON aa.id_usuario   = u.id_usuario
            LEFT JOIN usuario_rol        ur ON u.id_usuario    = ur.id_usuario AND ur.activo = TRUE
            LEFT JOIN rol                r  ON ur.id_rol       = r.id_rol
            WHERE o.fecha_orden::date = $1
            GROUP BY u.id_usuario, u.nombres, u.apellidos, r.nombre
            ORDER BY total_generado DESC
        `, [hoy]);

        // Mapeo limpio para asegurar tipos de datos correctos en el JSON de respuesta
        const rowsCorregidas = result.rows.map(row => ({
            ...row,
            total_generado: parseFloat(row.total_generado)
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