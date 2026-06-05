const resultadoModule    = require('../modules/resultadoModule');
const notificacionModule = require('../modules/notificacionModule');
const pool               = require('../config/db');
const { registrarAuditoria } = require('../helpers/auditoria');

// Helper: obtiene id_usuario_rol desde el header o lo resuelve desde la BD
const getIdUsuarioRol = async (req, executor = pool) => {
    if (req.user?.id_usuario_rol) return req.user.id_usuario_rol;
    const { rows } = await executor.query(
        `SELECT id_usuario_rol FROM usuario_rol WHERE id_usuario = $1 AND activo = TRUE LIMIT 1`,
        [req.user.id]
    );
    return rows[0]?.id_usuario_rol || null;
};

const resultadoController = {

    gestionarValor: async (req, res) => {
        const { id_resultado, id_parametro, valor_obtenido, observacion } = req.body;
        try {
            const check = await pool.query(
                "SELECT estado FROM resultado WHERE id_resultado = $1",
                [id_resultado]
            );
            if (!check.rows[0]) return res.status(404).json({ error: "Resultado no encontrado." });
            const estadoActual = check.rows[0].estado;
            if (!['En Proceso', 'Devuelto'].includes(estadoActual)) {
                return res.status(403).json({ error: "El resultado está bloqueado." });
            }
            const data = await resultadoModule.guardarOActualizarDetalle(
                id_resultado, id_parametro, valor_obtenido, observacion
            );

            // Auditoría — usa pool porque no hay transacción abierta
            const idRolAud1 = await getIdUsuarioRol(req, pool);

            await registrarAuditoria(
                pool,
                req.user.id,
                idRolAud1,
                'INGRESAR_VALOR_PARAMETRO',
                `Ingresó/actualizó valor en resultado ID: ${id_resultado}, parámetro ID: ${id_parametro}`
            );

            res.json({ success: true, data });
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    misOrdenes: async (req, res) => {
        try {
            const espRes = await pool.query(
                'SELECT id_especialista FROM especialista WHERE id_usuario = $1',
                [req.user.id]
            );
            if (espRes.rowCount === 0)
                return res.status(403).json({ error: "El usuario no está registrado como especialista." });

            const id_especialista = espRes.rows[0].id_especialista;

            const examenesAsig = await pool.query(
                `SELECT id_examen FROM especialista_examen
                 WHERE id_especialista = $1 AND estado = TRUE`,
                [id_especialista]
            );
            if (examenesAsig.rowCount === 0) return res.json([]);

            const idsExamenes = examenesAsig.rows.map(r => r.id_examen);

            const query = `
                SELECT
                    om.id_orden,
                    om.numero_ticket,
                    om.fecha_orden,
                    om.estado                               AS estado_orden,
                    u.nombres || ' ' || u.apellidos        AS paciente_nombre,
                    u.cedula                               AS paciente_cedula,
                    (
                        SELECT r_esp.estado
                        FROM resultado r_esp
                        WHERE r_esp.id_orden = om.id_orden
                          AND r_esp.id_especialista = $1
                        LIMIT 1
                    )                                       AS estado_resultado,
                    (
                        SELECT JSON_AGG(JSON_BUILD_OBJECT(
                            'id_examen',     e.id_examen,
                            'nombre_examen', e.nombre_examen,
                            'completado', COALESCE(
                                (SELECT BOOL_AND(dr.valor_obtenido IS NOT NULL AND dr.valor_obtenido != '')
                                 FROM resultado r2
                                 JOIN detalle_resultado dr ON dr.id_resultado = r2.id_resultado
                                 JOIN parametro_examen pe ON pe.id_parametro  = dr.id_parametro
                                 WHERE r2.id_orden = om.id_orden
                                   AND r2.id_especialista = $1
                                   AND pe.id_examen = e.id_examen
                                ), FALSE
                            )
                        ))
                        FROM examen e
                        JOIN especialista_examen ee2 ON ee2.id_examen = e.id_examen
                        WHERE ee2.id_especialista = $1
                          AND ee2.estado = TRUE
                          AND e.id_examen IN (
                              SELECT do3.id_examen FROM detalle_orden do3
                              WHERE do3.id_orden = om.id_orden
                          )
                    ) AS mis_examenes
                FROM orden_medica om
                JOIN paciente p ON om.id_paciente = p.id_paciente
                JOIN usuario u  ON p.id_usuario   = u.id_usuario
                JOIN detalle_orden do2 ON do2.id_orden = om.id_orden
                WHERE do2.id_examen = ANY($2)
                  AND om.estado IN ('En Proceso', 'Por Validar', 'Validado')
                GROUP BY om.id_orden, om.numero_ticket, om.fecha_orden, om.estado,
                         u.nombres, u.apellidos, u.cedula
                ORDER BY om.fecha_orden DESC
            `;
            const { rows } = await pool.query(query, [id_especialista, idsExamenes.map(Number)]);
            res.json(rows);
        } catch (e) {
            console.error("Error en misOrdenes:", e.message);
            res.status(500).json({ error: e.message });
        }
    },

    detalleOrden: async (req, res) => {
        try {
            const { id_orden } = req.params;

            const ordenRes = await pool.query(`
                SELECT
                    om.id_orden, om.numero_ticket, om.fecha_orden, om.estado,
                    om.observacion_validador   AS motivo_devolucion,
                    u.nombres || ' ' || u.apellidos AS paciente_nombre,
                    u.cedula                   AS paciente_cedula,
                    u.correo                   AS paciente_correo,
                    p.fecha_nacimiento, p.genero
                FROM orden_medica om
                JOIN paciente p ON om.id_paciente = p.id_paciente
                JOIN usuario u  ON p.id_usuario   = u.id_usuario
                WHERE om.id_orden = $1
            `, [id_orden]);

            if (ordenRes.rowCount === 0)
                return res.status(404).json({ error: "Orden no encontrada." });

            const orden = ordenRes.rows[0];
            const { fecha_nacimiento, genero, ...ordenPublica } = orden;

            const edadAnios = fecha_nacimiento
                ? Math.floor((Date.now() - new Date(fecha_nacimiento)) / (365.25 * 24 * 3600 * 1000))
                : null;

            const sexoPaciente = genero === 'M' ? 'Masculino'
                               : genero === 'F' ? 'Femenino'
                               : 'General';

            const espRes = await pool.query(
                'SELECT id_especialista FROM especialista WHERE id_usuario = $1',
                [req.user.id]
            );
            const id_especialista_logueado = espRes.rowCount > 0
                ? espRes.rows[0].id_especialista : null;

            if (id_especialista_logueado) {
                await pool.query(`
                    INSERT INTO resultado (id_orden, id_especialista, estado)
                    VALUES ($1, $2, 'En Proceso')
                    ON CONFLICT (id_orden, id_especialista) DO NOTHING
                `, [id_orden, id_especialista_logueado]);
            }

            const examenesRes = await pool.query(`
                SELECT
                    e.id_examen,
                    e.nombre_examen,
                    e.tipo_resultado,
                    ce.nombre_categoria                             AS categoria,
                    r.id_resultado,
                    r.estado                                        AS estado_resultado,
                    r.archivo_pdf,
                    CASE WHEN ee.id_especialista = $2 THEN true ELSE false END AS es_mio,
                    ue.nombres || ' ' || ue.apellidos              AS especialista_nombre,
                    CASE
                        WHEN e.tipo_resultado = 'PDF' THEN (r.archivo_pdf IS NOT NULL)
                        ELSE COALESCE(
                            (SELECT BOOL_AND(dr.valor_obtenido IS NOT NULL AND dr.valor_obtenido != '')
                             FROM detalle_resultado dr
                             JOIN parametro_examen pe2 ON pe2.id_parametro = dr.id_parametro
                             WHERE dr.id_resultado = r.id_resultado
                               AND pe2.id_examen = e.id_examen
                            ), FALSE
                        )
                    END                                             AS todos_parametros_llenos,
                    (
                        SELECT JSON_AGG(JSON_BUILD_OBJECT(
                            'id_parametro',      pe.id_parametro,
                            'nombre_parametro',  pe.nombre_parametro,
                            'unidad',            pe.unidad,
                            'sexo_referencia',   pe.sexo_referencia,
                            'rango_min',         pe.rango_min,
                            'rango_max',         pe.rango_max,
                            'descripcion_rango', pe.sexo_referencia || ' · ' || pe.edad_min || '-' || pe.edad_max || ' años',
                            'valor_obtenido',    dr.valor_obtenido,
                            'observacion',       dr.observacion,
                            'estado',            dr.estado,
                            'motivo_devolucion', dr.motivo_devolucion
                        ) ORDER BY pe.id_parametro)
                        FROM parametro_examen pe
                        LEFT JOIN detalle_resultado dr
                            ON dr.id_parametro = pe.id_parametro
                           AND dr.id_resultado = r.id_resultado
                        WHERE pe.id_examen = e.id_examen
                          AND pe.estado = TRUE
                          AND ($3::int IS NULL OR $3 BETWEEN pe.edad_min AND pe.edad_max)
                          AND pe.sexo_referencia = (
                              SELECT pe3.sexo_referencia
                              FROM parametro_examen pe3
                              WHERE pe3.id_examen = pe.id_examen
                                AND pe3.nombre_parametro = pe.nombre_parametro
                                AND pe3.estado = TRUE
                                AND ($3::int IS NULL OR $3 BETWEEN pe3.edad_min AND pe3.edad_max)
                              ORDER BY
                                  CASE pe3.sexo_referencia
                                      WHEN $4        THEN 1
                                      WHEN 'General' THEN 2
                                      ELSE                3
                                  END
                              LIMIT 1
                          )
                          AND NOT (
                              $4 IN ('Masculino', 'Femenino')
                              AND pe.sexo_referencia NOT IN ($4, 'General')
                          )
                    )                                               AS parametros
                FROM detalle_orden do2
                JOIN examen e ON e.id_examen = do2.id_examen
                LEFT JOIN categoria_examen ce ON ce.id_categoria = e.id_categoria
                LEFT JOIN especialista_examen ee ON ee.id_examen = e.id_examen
                                                 AND ee.estado = TRUE
                                                 AND ee.id_especialista = $2
                LEFT JOIN especialista esp ON esp.id_especialista = ee.id_especialista
                LEFT JOIN usuario ue       ON ue.id_usuario = esp.id_usuario
                LEFT JOIN resultado r      ON r.id_orden = do2.id_orden
                                          AND r.id_especialista = $2
                WHERE do2.id_orden = $1
                GROUP BY e.id_examen, e.nombre_examen, e.tipo_resultado, ce.nombre_categoria,
                         r.id_resultado, r.estado, r.archivo_pdf, ee.id_especialista,
                         ue.nombres, ue.apellidos
                ORDER BY es_mio DESC, e.nombre_examen ASC
            `, [id_orden, id_especialista_logueado, edadAnios, sexoPaciente]);

            res.json({ ...ordenPublica, edad_paciente: edadAnios, examenes: examenesRes.rows });

        } catch (e) {
            console.error("Error en detalleOrden:", e.message);
            res.status(500).json({ error: e.message });
        }
    },

    ordenesParaAdmin: async (req, res) => {
        try {
            const { estado } = req.query;
            const ESTADOS_VALIDOS = ['Por Validar','Validado','En Proceso','Devuelto','Generada'];

            let queryText, queryParams;
            if (estado && estado !== "todos" && ESTADOS_VALIDOS.includes(estado)) {
                queryText = `
                    SELECT
                        om.id_orden, om.numero_ticket, om.fecha_orden,
                        om.estado AS estado_orden, om.observacion_validador,
                        u.nombres || ' ' || u.apellidos AS paciente_nombre,
                        u.cedula AS paciente_cedula,
                        COUNT(r.id_resultado) AS total_resultados,
                        SUM(CASE WHEN r.estado = 'Por Validar' THEN 1 ELSE 0 END) AS por_validar,
                        SUM(CASE WHEN r.estado = 'Validado'    THEN 1 ELSE 0 END) AS validados,
                        SUM(CASE WHEN r.estado = 'Devuelto'    THEN 1 ELSE 0 END) AS devueltos,
                        SUM(CASE WHEN r.estado = 'En Proceso'  THEN 1 ELSE 0 END) AS en_proceso
                    FROM orden_medica om
                    JOIN paciente p  ON om.id_paciente = p.id_paciente
                    JOIN usuario u   ON p.id_usuario   = u.id_usuario
                    LEFT JOIN resultado r ON r.id_orden = om.id_orden
                    WHERE om.estado = $1
                    GROUP BY om.id_orden, om.numero_ticket, om.fecha_orden, om.estado,
                             om.observacion_validador, u.nombres, u.apellidos, u.cedula
                    ORDER BY om.fecha_orden DESC
                `;
                queryParams = [estado];
            } else {
                queryText = `
                    SELECT
                        om.id_orden, om.numero_ticket, om.fecha_orden,
                        om.estado AS estado_orden, om.observacion_validador,
                        u.nombres || ' ' || u.apellidos AS paciente_nombre,
                        u.cedula AS paciente_cedula,
                        COUNT(r.id_resultado) AS total_resultados,
                        SUM(CASE WHEN r.estado = 'Por Validar' THEN 1 ELSE 0 END) AS por_validar,
                        SUM(CASE WHEN r.estado = 'Validado'    THEN 1 ELSE 0 END) AS validados,
                        SUM(CASE WHEN r.estado = 'Devuelto'    THEN 1 ELSE 0 END) AS devueltos,
                        SUM(CASE WHEN r.estado = 'En Proceso'  THEN 1 ELSE 0 END) AS en_proceso
                    FROM orden_medica om
                    JOIN paciente p  ON om.id_paciente = p.id_paciente
                    JOIN usuario u   ON p.id_usuario   = u.id_usuario
                    LEFT JOIN resultado r ON r.id_orden = om.id_orden
                    WHERE om.estado = ANY($1)
                    GROUP BY om.id_orden, om.numero_ticket, om.fecha_orden, om.estado,
                             om.observacion_validador, u.nombres, u.apellidos, u.cedula
                    ORDER BY om.fecha_orden DESC
                `;
                queryParams = [ESTADOS_VALIDOS];
            }

            const { rows } = await pool.query(queryText, queryParams);
            res.json(rows);
        } catch (e) {
            console.error("Error en ordenesParaAdmin:", e.message);
            res.status(500).json({ error: e.message });
        }
    },

    detalleOrdenAdmin: async (req, res) => {
        try {
            const { id_orden } = req.params;

            const ordenRes = await pool.query(`
                SELECT
                    om.id_orden, om.numero_ticket, om.fecha_orden, om.estado,
                    om.observacion_validador,
                    u.nombres || ' ' || u.apellidos AS paciente_nombre,
                    u.cedula  AS paciente_cedula,
                    u.correo  AS paciente_correo,
                    p.genero,
                    EXTRACT(YEAR FROM AGE(p.fecha_nacimiento))::int AS edad_paciente,
                    uv.nombres || ' ' || uv.apellidos AS admin_nombre,
                    adm.cargo         AS admin_cargo,
                    adm.firma_digital AS admin_firma
                FROM orden_medica om
                JOIN paciente p ON om.id_paciente = p.id_paciente
                JOIN usuario u  ON p.id_usuario   = u.id_usuario
                LEFT JOIN usuario uv        ON uv.id_usuario  = COALESCE(om.id_validador, $2)
                LEFT JOIN administrador adm ON adm.id_usuario = COALESCE(om.id_validador, $2)
                WHERE om.id_orden = $1
            `, [id_orden, req.user.id]);

            if (ordenRes.rowCount === 0)
                return res.status(404).json({ error: "Orden no encontrada." });

            // Extraer edad y género para filtrar parámetros igual que en detalleOrden
            const { edad_paciente, genero } = ordenRes.rows[0];
            const sexoPaciente = genero === 'M' ? 'Masculino'
                               : genero === 'F' ? 'Femenino'
                               : 'General';

            const resultadosRes = await pool.query(`
                SELECT
                    r.id_resultado,
                    r.estado                                AS estado_resultado,
                    r.fecha_resultado,
                    r.archivo_pdf,
                    ue.nombres || ' ' || ue.apellidos       AS especialista_nombre,
                    esp.especialidad,
                    (
                        SELECT JSON_AGG(JSON_BUILD_OBJECT(
                            'id_examen',     e.id_examen,
                            'nombre_examen', e.nombre_examen,
                            'tipo_resultado', e.tipo_resultado,
                            'archivo_pdf',   CASE WHEN e.tipo_resultado = 'PDF' THEN r.archivo_pdf ELSE NULL END,
                            'parametros', (
                                SELECT JSON_AGG(JSON_BUILD_OBJECT(
                                    'id_parametro',     pe.id_parametro,
                                    'nombre_parametro', pe.nombre_parametro,
                                    'unidad',           pe.unidad,
                                    'rango_min',        pe.rango_min,
                                    'rango_max',        pe.rango_max,
                                    'valor_referencia', pe.valor_referencia,
                                    'valor_obtenido',   dr.valor_obtenido,
                                    'observacion',      dr.observacion
                                ) ORDER BY pe.id_parametro)
                                FROM parametro_examen pe
                                LEFT JOIN detalle_resultado dr
                                    ON dr.id_parametro  = pe.id_parametro
                                   AND dr.id_resultado  = r.id_resultado
                                WHERE pe.id_examen = e.id_examen
                                  AND pe.estado = TRUE
                                  -- Filtro por edad del paciente
                                  AND ($2::int IS NULL OR $2 BETWEEN pe.edad_min AND pe.edad_max)
                                  -- Filtro por género: elegir el rango más específico disponible
                                  AND pe.sexo_referencia = (
                                      SELECT pe2.sexo_referencia
                                      FROM parametro_examen pe2
                                      WHERE pe2.id_examen = pe.id_examen
                                        AND pe2.nombre_parametro = pe.nombre_parametro
                                        AND pe2.estado = TRUE
                                        AND ($2::int IS NULL OR $2 BETWEEN pe2.edad_min AND pe2.edad_max)
                                      ORDER BY
                                          CASE pe2.sexo_referencia
                                              WHEN $3        THEN 1
                                              WHEN 'General' THEN 2
                                              ELSE                3
                                          END
                                      LIMIT 1
                                  )
                                  AND NOT (
                                      $3 IN ('Masculino', 'Femenino')
                                      AND pe.sexo_referencia NOT IN ($3, 'General')
                                  )
                            )
                        ))
                        FROM detalle_orden do2
                        JOIN examen e ON e.id_examen = do2.id_examen
                        JOIN especialista_examen ee ON ee.id_examen        = e.id_examen
                                                   AND ee.id_especialista  = r.id_especialista
                                                   AND ee.estado           = TRUE
                        WHERE do2.id_orden = r.id_orden
                    ) AS examenes
                FROM resultado r
                JOIN especialista esp ON esp.id_especialista = r.id_especialista
                JOIN usuario ue       ON ue.id_usuario       = esp.id_usuario
                WHERE r.id_orden = $1
                ORDER BY r.fecha_resultado ASC
            `, [id_orden, edad_paciente ?? null, sexoPaciente]);

            res.json({ ...ordenRes.rows[0], resultados: resultadosRes.rows });
        } catch (e) {
            console.error("Error en detalleOrdenAdmin:", e.message);
            res.status(500).json({ error: e.message });
        }
    },

    enviarRevisionV2: async (req, res) => {
        const client = await pool.connect();
        try {
            const id_resultado = req.params.id;
            await client.query('BEGIN');

            const resData = await client.query(
                "UPDATE resultado SET estado = 'Por Validar' WHERE id_resultado = $1 RETURNING id_orden",
                [id_resultado]
            );
            const id_orden = resData.rows[0]?.id_orden;
            if (!id_orden) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: "Resultado no encontrado." });
            }

            const checkRes = await client.query(`
                SELECT
                    COUNT(*) AS total_examenes,
                    SUM(CASE WHEN estado IN ('Por Validar','Validado') THEN 1 ELSE 0 END) AS completados
                FROM resultado
                WHERE id_orden = $1
            `, [id_orden]);

            const { total_examenes, completados } = checkRes.rows[0];

            if (parseInt(total_examenes) > 0 && parseInt(completados) >= parseInt(total_examenes)) {
                await client.query(
                    "UPDATE orden_medica SET estado = 'Por Validar' WHERE id_orden = $1",
                    [id_orden]
                );
                const admins = await client.query(`
                    SELECT u.id_usuario FROM usuario u
                    JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
                    JOIN rol r ON ur.id_rol = r.id_rol AND LOWER(r.nombre) = 'administrador'
                    WHERE u.estado = TRUE
                `);
                for (const adm of admins.rows) {
                                        // DESPUÉS
                    const rolAdm = await client.query(
                        `SELECT ur.id_usuario_rol FROM usuario_rol ur
                        JOIN rol r ON ur.id_rol = r.id_rol
                        WHERE ur.id_usuario = $1 AND LOWER(r.nombre) = 'administrador' AND ur.activo = TRUE
                        LIMIT 1`,
                        [adm.id_usuario]
                    );
                    await client.query(
                        'INSERT INTO notificacion (id_usuario, mensaje, id_usuario_rol) VALUES ($1, $2, $3)',
                        [adm.id_usuario, `✅ Orden #${id_orden} lista para validación.`, rolAdm.rows[0]?.id_usuario_rol || null]
                    );
                }
            }

            // Auditoría — usa client porque estamos dentro de una transacción
            const idRolAud2 = await getIdUsuarioRol(req, client);

            await registrarAuditoria(
                client,
                req.user.id,
                idRolAud2,
                'ENVIAR_REVISION',
                `Resultado ID: ${id_resultado} enviado a revisión. Orden #${id_orden}`
            );

            await client.query('COMMIT');
            res.json({
                msg: "Examen enviado a revisión correctamente.",
                orden_completada: parseInt(completados) >= parseInt(total_examenes),
            });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Error en enviarRevisionV2:", e.message);
            res.status(500).json({ error: e.message });
        } finally { client.release(); }
    },

    devolverEspecialista: async (req, res) => {
        const { id_resultado } = req.params;
        const { motivo } = req.body;
        if (!motivo || !motivo.trim())
            return res.status(400).json({ error: "El motivo de devolución es obligatorio." });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Cambiar estado del resultado a Devuelto
            await client.query(
                "UPDATE resultado SET estado = 'Devuelto' WHERE id_resultado = $1",
                [id_resultado]
            );

            // 2. Marcar TODOS los detalle_resultado con estado Devuelto y el motivo
            //    para que el especialista vea cada parámetro en rojo con la razón
            await client.query(
                `UPDATE detalle_resultado
                 SET estado = 'Devuelto', motivo_devolucion = $1
                 WHERE id_resultado = $2`,
                [motivo.trim(), id_resultado]
            );

            const info = await client.query(
                "SELECT id_especialista, id_orden FROM resultado WHERE id_resultado = $1",
                [id_resultado]
            );
            const { id_especialista, id_orden } = info.rows[0];

            // 3. Guardar motivo en la orden y resetear estado a En Proceso
            await client.query(
                "UPDATE orden_medica SET observacion_validador = $1 WHERE id_orden = $2",
                [motivo.trim(), id_orden]
            );
            await client.query(
                "UPDATE orden_medica SET estado = 'En Proceso' WHERE id_orden = $1 AND estado = 'Por Validar'",
                [id_orden]
            );

            if (id_especialista) {
                const espUser = await client.query(
                    "SELECT id_usuario FROM especialista WHERE id_especialista = $1",
                    [id_especialista]
                );
                if (espUser.rowCount > 0) {
                   // DESPUÉS
                    const rolEsp1 = await client.query(
                        `SELECT ur.id_usuario_rol FROM usuario_rol ur
                        JOIN rol r ON ur.id_rol = r.id_rol
                        WHERE ur.id_usuario = $1 AND LOWER(r.nombre) = 'especialista' AND ur.activo = TRUE
                        LIMIT 1`,
                        [espUser.rows[0].id_usuario]
                    );
                    await client.query(
                        'INSERT INTO notificacion (id_usuario, mensaje, id_usuario_rol) VALUES ($1, $2, $3)',
                        [espUser.rows[0].id_usuario, `⚠️ Resultado devuelto para corrección: ${motivo.trim()}`, rolEsp1.rows[0]?.id_usuario_rol || null]
                    );
                }
            }

            // Auditoría dentro de la transacción
            const idRolAud3 = await getIdUsuarioRol(req, client);

            await registrarAuditoria(
                client,
                req.user.id,
                idRolAud3,
                'DEVOLVER_RESULTADO',
                `Resultado ID: ${id_resultado} devuelto al especialista. Motivo: ${motivo.trim()}`
            );

            await client.query('COMMIT');
            res.json({ msg: "Resultado devuelto para corrección." });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Error en devolverEspecialista:", e.message);
            res.status(500).json({ error: e.message });
        } finally { client.release(); }
    },

    devolverParametro: async (req, res) => {
        const { id_detalle } = req.params;
        const { motivo } = req.body;
        if (!motivo || !motivo.trim())
            return res.status(400).json({ error: "El motivo de devolución es obligatorio." });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const detalleRes = await client.query(`
                UPDATE detalle_resultado
                SET estado = 'Devuelto', motivo_devolucion = $1
                WHERE id_detalle_resultado = $2
                RETURNING id_resultado
            `, [motivo.trim(), id_detalle]);

            if (detalleRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: "Parámetro no encontrado." });
            }

            const id_resultado = detalleRes.rows[0].id_resultado;

            const resInfo = await client.query(`
                UPDATE resultado
                SET estado = 'Devuelto'
                WHERE id_resultado = $1
                RETURNING id_orden, id_especialista
            `, [id_resultado]);

            const { id_orden, id_especialista } = resInfo.rows[0];

            await client.query(`
                UPDATE orden_medica
                SET estado = 'En Proceso', observacion_validador = $1
                WHERE id_orden = $2 AND estado IN ('Por Validar', 'En Proceso')
            `, [motivo.trim(), id_orden]);

            if (id_especialista) {
                const espUser = await client.query(
                    "SELECT id_usuario FROM especialista WHERE id_especialista = $1",
                    [id_especialista]
                );
                if (espUser.rowCount > 0) {
                    // DESPUÉS
                    const rolEsp2 = await client.query(
                        `SELECT ur.id_usuario_rol FROM usuario_rol ur
                        JOIN rol r ON ur.id_rol = r.id_rol
                        WHERE ur.id_usuario = $1 AND LOWER(r.nombre) = 'especialista' AND ur.activo = TRUE
                        LIMIT 1`,
                        [espUser.rows[0].id_usuario]
                    );
                    await client.query(
                        'INSERT INTO notificacion (id_usuario, mensaje, id_usuario_rol) VALUES ($1, $2, $3)',
                        [espUser.rows[0].id_usuario, `⚠️ Un parámetro fue devuelto para corrección en la Orden #${id_orden}: ${motivo.trim()}`, rolEsp2.rows[0]?.id_usuario_rol || null]
                    );
                }
            }

            // Auditoría — usa client porque estamos dentro de una transacción
            const idRolAud4 = await getIdUsuarioRol(req, client);

            await registrarAuditoria(
                client,
                req.user.id,
                idRolAud4,
                'DEVOLVER_PARAMETRO',
                `Parámetro (detalle ID: ${id_detalle}) devuelto en resultado ID: ${id_resultado}. Motivo: ${motivo.trim()}`
            );

            await client.query('COMMIT');
            res.json({ msg: "Parámetro devuelto para corrección al especialista." });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Error en devolverParametro:", e.message);
            res.status(500).json({ error: e.message });
        } finally { client.release(); }
    },

    publicarFinal: async (req, res) => {
        const { id_resultado } = req.params;
        const { pdf_url, firma } = req.body;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const resData = await client.query(
                `UPDATE resultado 
                 SET estado = 'Validado', archivo_pdf = COALESCE($1, archivo_pdf), firma_documento = $2
                 WHERE id_resultado = $3 RETURNING id_orden`,
                [pdf_url || null, firma, id_resultado]
            );

            const id_orden = resData.rows[0]?.id_orden;
            if (!id_orden) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: "Resultado no encontrado." });
            }

            await client.query(
                "UPDATE orden_medica SET id_validador = $1, fecha_validacion = NOW() WHERE id_orden = $2",
                [req.user.id, id_orden]
            );

            const checkRes = await client.query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN estado = 'Validado' THEN 1 ELSE 0 END) AS validados
                FROM resultado
                WHERE id_orden = $1
            `, [id_orden]);

            const { total, validados } = checkRes.rows[0];
            const todosValidados = parseInt(total) > 0 && parseInt(validados) >= parseInt(total);

            if (todosValidados) {
                await client.query(
                    "UPDATE orden_medica SET estado = 'Validado' WHERE id_orden = $1",
                    [id_orden]
                );
                const pac = await client.query(`
                    SELECT p.id_usuario FROM orden_medica o
                    JOIN paciente p ON o.id_paciente = p.id_paciente
                    WHERE o.id_orden = $1
                `, [id_orden]);
                if (pac.rowCount > 0) {
                    // DESPUÉS
                    const rolPac = await client.query(
                        `SELECT ur.id_usuario_rol FROM usuario_rol ur
                        JOIN rol r ON ur.id_rol = r.id_rol
                        WHERE ur.id_usuario = $1 AND LOWER(r.nombre) = 'paciente' AND ur.activo = TRUE
                        LIMIT 1`,
                        [pac.rows[0].id_usuario]
                    );
                    await notificacionModule.crear(
                        pac.rows[0].id_usuario,
                        "✅ Tus resultados de laboratorio ya están disponibles.",
                        rolPac.rows[0]?.id_usuario_rol || null
                    );
                }
            }

            // Auditoría — usa client porque estamos dentro de una transacción
            const idRolAud5 = await getIdUsuarioRol(req, client);

            await registrarAuditoria(
                client,
                req.user.id,
                idRolAud5,
                'PUBLICAR_RESULTADO',
                `Resultado ID: ${id_resultado} publicado. Orden #${id_orden} ${todosValidados ? '— completamente validada' : '— parcialmente validada'}`
            );

            await client.query('COMMIT');
            res.json({
                msg: todosValidados
                    ? "Orden completamente validada. PDF generado y paciente notificado."
                    : "Resultado validado. Quedan resultados pendientes.",
                todos_validados: todosValidados,
            });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Error en publicarFinal:", e.message);
            res.status(500).json({ error: e.message });
        } finally { client.release(); }
    },
};

module.exports = resultadoController;