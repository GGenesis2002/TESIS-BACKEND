const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const personalController = {

    // ── 0. CONSULTAR POR CÉDULA (uso interno, para autocompletar el formulario) ─
    // No es la consulta al SRI (esa es /documento/consultar/:cedula). Esta busca
    // en NUESTRA base si la cédula ya pertenece a un usuario existente (por ej.
    // ya registrado como paciente en el app) para poder autocompletar sus datos
    // conocidos y, al guardar, simplemente sumarle el/los rol(es) de personal
    // en vez de crear una cuenta nueva y pisar su usuario/contraseña actuales.
    consultarPorCedula: async (req, res) => {
        try {
            const { cedula } = req.params;
            const query = `
                SELECT
                    u.id_usuario, u.username, u.nombres, u.apellidos, u.correo,
                    STRING_AGG(DISTINCT r.nombre, ', ') AS roles
                FROM usuario u
                LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario AND ur.activo = TRUE
                LEFT JOIN rol r ON r.id_rol = ur.id_rol
                WHERE u.cedula = $1
                GROUP BY u.id_usuario, u.username`;
            const { rows } = await pool.query(query, [cedula]);

            if (rows.length === 0) {
                return res.status(404).json({ existe: false, msg: 'Cédula no registrada aún en el sistema.' });
            }

            res.json({ existe: true, ...rows[0] });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // ── 1. REGISTRAR PERSONAL MULTI-ROL ──────────────────────────────────────
registrarPersonal: async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            id_rol, id_roles, cedula, nombres, apellidos,
            correo, username, password,
            cargo, especialidad, turno, examenes_asignados,
        } = req.body;

        await client.query('BEGIN');

        // ── NUEVO: verificar si la cédula ya existe (ej: registrado como paciente en el móvil) ──
        const { rows: existente } = await client.query(
            `SELECT id_usuario FROM usuario WHERE cedula = $1`,
            [cedula]
        );

        let id_usuario;

        if (existente.length > 0) {
            // Ya existe → reutilizamos el mismo usuario, solo actualizamos sus datos personales.
            // NO tocamos username/password aquí: mantenemos el login que ya tenía (móvil),
            // salvo que el admin haya escrito explícitamente una nueva contraseña.
            id_usuario = existente[0].id_usuario;

            if (password && password.trim() !== "") {
                const hashedPassword = await bcrypt.hash(password, 10);
                await client.query(
                    `UPDATE usuario SET nombres=$1, apellidos=$2, correo=$3, username=$4, password=$5
                     WHERE id_usuario=$6`,
                    [nombres, apellidos, correo, username, hashedPassword, id_usuario]
                );
            } else {
                await client.query(
                    `UPDATE usuario SET nombres=$1, apellidos=$2, correo=$3
                     WHERE id_usuario=$4`,
                    [nombres, apellidos, correo, id_usuario]
                );
            }
        } else {
            // No existe → se crea el usuario desde cero (flujo original)
            const hashedPassword = await bcrypt.hash(password, 10);
            const userRes = await client.query(
                `INSERT INTO usuario (cedula, nombres, apellidos, correo, username, password)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_usuario`,
                [cedula, nombres, apellidos, correo, username, hashedPassword]
            );
            id_usuario = userRes.rows[0].id_usuario;
        }

        const rolesSet = new Set([id_rol, ...(id_roles || [])].filter(Boolean).map(id => parseInt(id, 10)));
        const listaRoles = Array.from(rolesSet);

        for (const rolIdNum of listaRoles) {
            await client.query(
                `INSERT INTO usuario_rol (id_usuario, id_rol, activo) VALUES ($1, $2, TRUE)
                 ON CONFLICT (id_usuario, id_rol) DO UPDATE SET activo = TRUE`,
                [id_usuario, rolIdNum]
            );

            if (rolIdNum === 1) {
                await client.query(
                    `INSERT INTO administrador (id_usuario, cargo) VALUES ($1, $2)
                     ON CONFLICT (id_usuario) DO UPDATE SET cargo = EXCLUDED.cargo`,
                    [id_usuario, cargo || 'Personal Administrativo']
                );
            }
            if (rolIdNum === 3) {
                await client.query(
                    `INSERT INTO especialista (id_usuario, especialidad) VALUES ($1, $2)
                     ON CONFLICT (id_usuario) DO UPDATE SET especialidad = EXCLUDED.especialidad`,
                    [id_usuario, especialidad || 'General']
                );
            }
            if (rolIdNum === 4) {
                await client.query(
                    `INSERT INTO asistente_analista (id_usuario, turno) VALUES ($1, $2)
                     ON CONFLICT (id_usuario) DO UPDATE SET turno = EXCLUDED.turno`,
                    [id_usuario, turno || 'Mañana']
                );
            }
        }

        // ── FIX: antes este bloque no existía en registrarPersonal (solo estaba
        // en actualizarPersonal). Por eso al REGISTRAR un especialista nuevo con
        // exámenes marcados en el formulario, esos exámenes nunca se guardaban
        // en especialista_examen — el usuario y su fila en `especialista` sí se
        // creaban, pero las asignaciones se perdían silenciosamente.
        if (listaRoles.includes(3) && Array.isArray(examenes_asignados) && examenes_asignados.length > 0) {
            const espRes = await client.query(
                `SELECT id_especialista FROM especialista WHERE id_usuario = $1`, [id_usuario]
            );
            if (espRes.rowCount > 0) {
                const id_especialista = espRes.rows[0].id_especialista;
                for (const idExamen of examenes_asignados) {
                    await client.query(
                        `INSERT INTO especialista_examen (id_especialista, id_examen, estado)
                         VALUES ($1, $2, TRUE)
                         ON CONFLICT (id_especialista, id_examen) DO UPDATE SET estado = TRUE`,
                        [id_especialista, idExamen]
                    );
                }
            }
        }

        // Auditoría — usa client (dentro de transacción)
        await registrarAuditoria(
            client,
            req.user.id,
            req.user.id_usuario_rol,
            'REGISTRO_PERSONAL',
            existente.length > 0
                ? `Se agregaron roles de personal (IDs: ${listaRoles.join(', ')}) a un usuario ya existente (ID: ${id_usuario}, cédula previamente registrada)`
                : `Se registró al usuario ${username} con múltiples roles asignados (IDs: ${listaRoles.join(', ')}). ID nuevo usuario: ${id_usuario}`
        );

        await client.query('COMMIT');
        res.status(201).json({
            msg: existente.length > 0
                ? "El usuario ya existía (cédula registrada previamente); se le asignaron los nuevos roles de personal"
                : "Personal registrado exitosamente con Multi-Rol",
            id_usuario
        });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error en registrarPersonal:", e.message);
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
},

    // ── 2. ACTUALIZAR PERSONAL MULTI-ROL ─────────────────────────────────────
    actualizarPersonal: async (req, res) => {
        const client = await pool.connect();
        try {
            const { id } = req.params;
            const {
                id_rol, id_roles, cedula, nombres, apellidos,
                correo, username, password,
                cargo, especialidad, turno, examenes_asignados
            } = req.body;

            await client.query('BEGIN');

            if (password && password.trim() !== "") {
                const hashedPassword = await bcrypt.hash(password, 10);
                await client.query(
                    `UPDATE usuario SET cedula=$1, nombres=$2, apellidos=$3, correo=$4, username=$5, password=$6 
                     WHERE id_usuario=$7`,
                    [cedula, nombres, apellidos, correo, username, hashedPassword, id]
                );
            } else {
                await client.query(
                    `UPDATE usuario SET cedula=$1, nombres=$2, apellidos=$3, correo=$4, username=$5 
                     WHERE id_usuario=$6`,
                    [cedula, nombres, apellidos, correo, username, id]
                );
            }

            const rolesSet = new Set([id_rol, ...(id_roles || [])].filter(Boolean).map(rid => parseInt(rid, 10)));
            const listaRoles = Array.from(rolesSet);

            if (listaRoles.length > 0) {
                await client.query(
                    `UPDATE usuario_rol SET activo = FALSE WHERE id_usuario = $1 AND id_rol NOT IN (${listaRoles.join(',')})`,
                    [id]
                );
            }

            for (const rolIdNum of listaRoles) {
                await client.query(
                    `INSERT INTO usuario_rol (id_usuario, id_rol, activo) VALUES ($1, $2, TRUE)
                     ON CONFLICT (id_usuario, id_rol) DO UPDATE SET activo = TRUE`,
                    [id, rolIdNum]
                );

                if (rolIdNum === 1) {
                    const checkAdmin = await client.query(`SELECT 1 FROM administrador WHERE id_usuario = $1`, [id]);
                    if (checkAdmin.rowCount > 0) {
                        await client.query(`UPDATE administrador SET cargo = $1 WHERE id_usuario = $2`, [cargo, id]);
                    } else {
                        await client.query(`INSERT INTO administrador (id_usuario, cargo) VALUES ($1, $2)`, [id, cargo || 'Personal Administrativo']);
                    }
                }

                if (rolIdNum === 3) {
                    const checkEsp = await client.query(`SELECT 1 FROM especialista WHERE id_usuario = $1`, [id]);
                    if (checkEsp.rowCount > 0) {
                        await client.query(`UPDATE especialista SET especialidad = $1 WHERE id_usuario = $2`, [especialidad, id]);
                    } else {
                        await client.query(`INSERT INTO especialista (id_usuario, especialidad) VALUES ($1, $2)`, [id, especialidad || 'General']);
                    }
                }

                if (rolIdNum === 4) {
                    const checkAsi = await client.query(`SELECT 1 FROM asistente_analista WHERE id_usuario = $1`, [id]);
                    if (checkAsi.rowCount > 0) {
                        await client.query(`UPDATE asistente_analista SET turno = $1 WHERE id_usuario = $2`, [turno, id]);
                    } else {
                        await client.query(`INSERT INTO asistente_analista (id_usuario, turno) VALUES ($1, $2)`, [id, turno || 'Mañana']);
                    }
                }
            }

            if (listaRoles.includes(3) && Array.isArray(examenes_asignados)) {
                const espRes = await client.query(
                    `SELECT id_especialista FROM especialista WHERE id_usuario = $1`, [id]
                );
                if (espRes.rowCount > 0) {
                    const id_especialista = espRes.rows[0].id_especialista;
                    // ── FIX: en vez de DELETE físico (que rompe el historial e
                    // ignora el patrón de borrado lógico usado en el resto del
                    // sistema), desactivamos todo y reactivamos/insertamos solo
                    // lo que venga marcado. Esto es consistente con `estado`
                    // como columna de control que ya usa el resto del código
                    // (getByUsuarioId filtra por ee.estado = TRUE).
                    await client.query(
                        `UPDATE especialista_examen SET estado = FALSE WHERE id_especialista = $1`,
                        [id_especialista]
                    );
                    for (const idExamen of examenes_asignados) {
                        await client.query(
                            `INSERT INTO especialista_examen (id_especialista, id_examen, estado)
                             VALUES ($1, $2, TRUE)
                             ON CONFLICT (id_especialista, id_examen) DO UPDATE SET estado = TRUE`,
                            [id_especialista, idExamen]
                        );
                    }
                }
            }

            // Auditoría — usa client (dentro de transacción)
            await registrarAuditoria(
                client,
                req.user.id,
                req.user.id_usuario_rol,
                'UPDATE_PERSONAL',
                `Se actualizaron los datos y roles del usuario ID: ${id} (${username})`
            );

            await client.query('COMMIT');
            res.json({ msg: "Datos y roles de personal actualizados correctamente" });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("❌ Error en actualizarPersonal:", e.message);
            res.status(500).json({ error: e.message });
        } finally {
            client.release();
        }
    },

    // ── 3. OBTENER UN EMPLEADO POR ID ─────────────────────────────────────────
    obtenerEmpleado: async (req, res) => {
        try {
            const { id } = req.params;
            const query = `
                SELECT 
                    u.id_usuario, u.cedula, u.nombres, u.apellidos,
                    u.correo, u.username, u.estado,
                    u.fecha_creacion, u.ultimo_acceso,
                    adm.cargo, esp.especialidad, asi.turno,
                    STRING_AGG(DISTINCT r.nombre, ', ') AS roles
                FROM usuario u
                LEFT JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
                LEFT JOIN rol r ON ur.id_rol = r.id_rol
                LEFT JOIN administrador adm ON u.id_usuario = adm.id_usuario
                LEFT JOIN especialista esp ON u.id_usuario = esp.id_usuario
                LEFT JOIN asistente_analista asi ON u.id_usuario = asi.id_usuario
                WHERE u.id_usuario = $1
                GROUP BY u.id_usuario, adm.cargo, esp.especialidad, asi.turno
            `;
            const { rows } = await pool.query(query, [id]);
            if (rows.length === 0) return res.status(404).json({ msg: "Empleado no encontrado" });
            res.json(rows[0]);
        } catch (e) {
            console.error("❌ Error en obtenerEmpleado:", e.message);
            res.status(500).json({ error: "Error interno al obtener los datos del perfil: " + e.message });
        }
    },

    // ── 4. LISTAR TODO EL PERSONAL ────────────────────────────────────────────
    listarPersonal: async (req, res) => {
        try {
            const query = `
                SELECT 
                    u.id_usuario, u.cedula, u.nombres, u.apellidos,
                    u.correo, u.username,
                    STRING_AGG(r.nombre, ', ' ORDER BY r.nombre) AS roles,
                    u.estado, u.fecha_creacion, u.ultimo_acceso,
                    adm.cargo, esp.especialidad, asi.turno,
                    (
                        SELECT aud_u.username
                        FROM auditoria a2
                        JOIN usuario aud_u ON a2.id_usuario = aud_u.id_usuario
                        WHERE a2.accion = 'REGISTRO_PERSONAL'
                          AND a2.descripcion ILIKE '%ID nuevo usuario: ' || u.id_usuario || '%'
                        ORDER BY a2.fecha_hora ASC
                        LIMIT 1
                    ) AS registrado_por
                FROM usuario u
                JOIN usuario_rol ur ON u.id_usuario = ur.id_usuario AND ur.activo = TRUE
                JOIN rol r ON ur.id_rol = r.id_rol
                LEFT JOIN administrador      adm ON u.id_usuario = adm.id_usuario
                LEFT JOIN especialista       esp ON u.id_usuario = esp.id_usuario
                LEFT JOIN asistente_analista asi ON u.id_usuario = asi.id_usuario
                WHERE r.nombre != 'Paciente'
                GROUP BY u.id_usuario, adm.cargo, esp.especialidad, asi.turno
                ORDER BY u.id_usuario DESC
            `;
            const { rows } = await pool.query(query);
            res.json(rows);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },
};

module.exports = personalController;