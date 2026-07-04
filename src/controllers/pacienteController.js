const pool = require('../config/db');
const Paciente = require('../modules/pacienteModule');
const bcrypt = require('bcryptjs');
const { registrarAuditoria } = require('../helpers/auditoria');

const pacienteController = {

    // ── OBTENER PERFIL PROPIO ──────────────────────────────────────────────────
    obtenerPerfilPropio: async (req, res) => {
        try {
            const id_usuario = req.user.id;
            const { rows } = await pool.query(
                `SELECT u.id_usuario, u.cedula, u.nombres, u.apellidos, u.correo, u.username,
                        p.telefono, p.direccion, p.genero, p.fecha_nacimiento
                 FROM usuario u
                 JOIN paciente p ON p.id_usuario = u.id_usuario
                 WHERE u.id_usuario = $1`,
                [id_usuario]
            );
            if (!rows[0]) return res.status(404).json({ error: 'Perfil no encontrado.' });
            res.json({ perfil: rows[0] });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // ── REGISTRO ──────────────────────────────────────────────────────────────
    registrarPaciente: async (req, res) => {
        const client = await pool.connect();
        try {
            const {
                cedula, nombres, apellidos, correo,
                username, password, fecha_nacimiento,
                telefono, direccion, genero
            } = req.body;

            await client.query('BEGIN');

            // ── Verificar si la cédula ya existe (ej: la persona ya es personal del laboratorio) ──
            const { rows: existente } = await client.query(
                `SELECT id_usuario FROM usuario WHERE cedula = $1`,
                [cedula]
            );

            let id_usuario;

            if (existente.length > 0) {
                // Ya existe → reutilizamos el mismo usuario y solo le sumamos el rol de Paciente.
                id_usuario = existente[0].id_usuario;

                // Validar que el correo no choque con OTRO usuario distinto al que reutilizamos
                const dupCheckCorreo = await client.query(
                    `SELECT COUNT(*)::int AS correo_existe FROM usuario WHERE correo = $1 AND id_usuario != $2`,
                    [correo, id_usuario]
                );
                if (dupCheckCorreo.rows[0].correo_existe > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'El correo ya está registrado.' });
                }

                // El username solo se valida/actualiza si de verdad se va a cambiar
                // (ver más abajo: solo se toca si viene una contraseña nueva).
                if (username && username.trim() !== "") {
                    const dupCheckUsername = await client.query(
                        `SELECT COUNT(*)::int AS username_existe FROM usuario WHERE username = $1 AND id_usuario != $2`,
                        [username, id_usuario]
                    );
                    if (dupCheckUsername.rows[0].username_existe > 0) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
                    }
                }

                // NO tocamos username/password si no se envía una contraseña nueva:
                // mantenemos el login que ya tenía (ej. como personal del laboratorio).
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
                // Cédula nueva → validar duplicados de correo/username y crear el usuario desde cero
                const dupCheck = await client.query(
                    `SELECT
                        (SELECT COUNT(*) FROM usuario WHERE correo   = $1)::int AS correo_existe,
                        (SELECT COUNT(*) FROM usuario WHERE username = $2)::int AS username_existe`,
                    [correo, username]
                );
                if (dupCheck.rows[0].correo_existe > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'El correo ya está registrado.' });
                }
                if (dupCheck.rows[0].username_existe > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'El nombre de usuario ya está en uso.' });
                }

                const hashedPassword = await bcrypt.hash(password, 10);
                const userRes = await client.query(
                    `INSERT INTO usuario (cedula, nombres, apellidos, correo, username, password)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_usuario`,
                    [cedula, nombres, apellidos, correo, username, hashedPassword]
                );
                id_usuario = userRes.rows[0].id_usuario;
            }

            // Validar teléfono duplicado entre pacientes (excluyendo al propio usuario, por si acaso)
            if (telefono && telefono.trim() !== "") {
                const telCheck = await client.query(
                    `SELECT COUNT(*)::int AS telefono_existe FROM paciente
                     WHERE telefono = $1 AND id_usuario != $2`,
                    [telefono, id_usuario]
                );
                if (telCheck.rows[0].telefono_existe > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'El teléfono ya está registrado.' });
                }
            }

            await client.query(
                `INSERT INTO usuario_rol (id_usuario, id_rol, activo)
                 VALUES ($1, (SELECT id_rol FROM rol WHERE nombre = 'Paciente'), TRUE)
                 ON CONFLICT (id_usuario, id_rol) DO UPDATE SET activo = TRUE`,
                [id_usuario]
            );

            // paciente.id_usuario no tiene restricción UNIQUE en la base actual, así que
            // no podemos usar ON CONFLICT. Verificamos manualmente si ya existe la fila.
            const { rows: pacienteExistente } = await client.query(
                `SELECT id_paciente FROM paciente WHERE id_usuario = $1`,
                [id_usuario]
            );

            if (pacienteExistente.length > 0) {
                await client.query(
                    `UPDATE paciente SET fecha_nacimiento=$1, telefono=$2, direccion=$3, genero=$4
                     WHERE id_usuario=$5`,
                    [fecha_nacimiento, telefono || null, direccion || null, genero || null, id_usuario]
                );
            } else {
                await client.query(
                    `INSERT INTO paciente (id_usuario, fecha_nacimiento, telefono, direccion, genero)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                        id_usuario,
                        fecha_nacimiento,
                        telefono   || null,
                        direccion  || null,
                        genero     || null,
                    ]
                );
            }

            const responsable    = req.user ? req.user.id           : id_usuario;
            const rolResponsable = req.user ? req.user.id_usuario_rol : null;

            await registrarAuditoria(
                client,
                responsable,
                rolResponsable,
                'REGISTRO_PACIENTE',
                existente.length > 0
                    ? `Se agregó el rol de Paciente a un usuario ya existente (ID: ${id_usuario}, cédula previamente registrada con otro rol)`
                    : `Se registró un nuevo paciente. ID Usuario: ${id_usuario}, Cédula: ${cedula}`
            );

            await client.query('COMMIT');
            res.status(201).json({
                msg: existente.length > 0
                    ? 'El usuario ya existía (cédula registrada previamente); se le asignó el rol de Paciente'
                    : 'Paciente registrado correctamente',
                id_usuario
            });
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message });
        } finally {
            client.release();
        }
    },

    // ── CONSULTAR POR CÉDULA (uso interno, para autocompletar el formulario) ──
    // No es la consulta al SRI (esa es /documento/consultar/:cedula). Esta busca
    // en NUESTRA base si la cédula ya pertenece a un usuario existente (por ej.
    // ya registrado como personal) para poder autocompletar sus datos conocidos
    // y, al guardar, simplemente sumarle el rol de Paciente en vez de duplicarlo.
    consultarPorCedula: async (req, res) => {
        try {
            const { cedula } = req.params;
            const query = `
                SELECT
                    u.id_usuario, u.username, u.nombres, u.apellidos, u.correo,
                    p.telefono, p.direccion, p.genero, p.fecha_nacimiento,
                    STRING_AGG(DISTINCT r.nombre, ', ') AS roles
                FROM usuario u
                LEFT JOIN paciente p ON p.id_usuario = u.id_usuario
                LEFT JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario AND ur.activo = TRUE
                LEFT JOIN rol r ON r.id_rol = ur.id_rol
                WHERE u.cedula = $1
                GROUP BY u.id_usuario, u.username, p.telefono, p.direccion, p.genero, p.fecha_nacimiento`;
            const { rows } = await pool.query(query, [cedula]);

            if (rows.length === 0) {
                return res.status(404).json({ existe: false, msg: 'Cédula no registrada aún en el sistema.' });
            }

            res.json({ existe: true, ...rows[0] });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    },

    // ── LISTAR ────────────────────────────────────────────────────────────────
    listarPacientes: async (req, res) => {
        try {
            const { buscar } = req.query;
            const data = buscar ? await Paciente.search(buscar) : await Paciente.getAll();
            res.json(data);
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    // ── ACTUALIZAR (admin / secretaria) ───────────────────────────────────────
    // ── ACTUALIZAR (admin / secretaria) ───────────────────────────────────────
    actualizarPaciente: async (req, res) => {
        const client = await pool.connect();
        try {
            const { id } = req.params;
            // 1. Agregamos la "cedula" al destructuring del body
            const { cedula, nombres, apellidos, correo, telefono, direccion, genero, fecha_nacimiento } = req.body;

            // 2. Validamos que la nueva cédula o correo no le pertenezcan a OTRO usuario distinto al que estamos editando
            const dupCheck = await pool.query(
                `SELECT
                    (SELECT COUNT(*) FROM usuario WHERE cedula = $1 AND id_usuario != $3)::int AS cedula_existe,
                    (SELECT COUNT(*) FROM usuario WHERE correo = $2 AND id_usuario != $3)::int AS correo_existe`,
                [cedula, correo, id]
            );
            
            if (dupCheck.rows[0].cedula_existe > 0) return res.status(400).json({ msg: 'La cédula ya está registrada en otro paciente.' });
            if (dupCheck.rows[0].correo_existe > 0) return res.status(400).json({ msg: 'El correo ya está registrado en otro paciente.' });

            await client.query('BEGIN');

            // 3. Incluimos la cédula en el UPDATE de la tabla usuario
            await client.query(
                `UPDATE usuario SET cedula=$1, nombres=$2, apellidos=$3, correo=$4 WHERE id_usuario=$5`,
                [cedula, nombres, apellidos, correo, id]
            );
            
            await client.query(
                `UPDATE paciente SET telefono=$1, direccion=$2, genero=$3, fecha_nacimiento=$4
                 WHERE id_usuario=$5`,
                [telefono, direccion, genero, fecha_nacimiento, id]
            );

            await registrarAuditoria(
                client,
                req.user.id,
                req.user.id_usuario_rol,
                'ACTUALIZAR_PACIENTE',
                `Editó datos del paciente ID: ${id}, Nueva Cédula: ${cedula}`
            );

            await client.query('COMMIT');
            res.json({ msg: 'Datos actualizados correctamente' });
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message });
        } finally { client.release(); }
    },

    // ── EDITAR PERFIL PROPIO (el paciente edita su propia cuenta desde la app) ─
    editarPerfilPropio: async (req, res) => {
        const client = await pool.connect();
        try {
            const id_usuario = req.user.id;
            const { nombres, apellidos, correo, telefono, direccion, genero, fecha_nacimiento } = req.body;

            await client.query('BEGIN');

            await client.query(
                `UPDATE usuario SET nombres=$1, apellidos=$2, correo=$3 WHERE id_usuario=$4`,
                [nombres, apellidos, correo, id_usuario]
            );
            await client.query(
                `UPDATE paciente SET telefono=$1, direccion=$2, genero=$3, fecha_nacimiento=$4
                 WHERE id_usuario=$5`,
                [telefono, direccion, genero, fecha_nacimiento, id_usuario]
            );

            await registrarAuditoria(
                client,
                id_usuario,
                req.user.id_usuario_rol,
                'EDITAR_PERFIL_PROPIO',
                `Paciente ID ${id_usuario} actualizó su propio perfil`
            );

            await client.query('COMMIT');

            // Devolver datos actualizados para refrescar la sesión en el app
            const updated = await pool.query(
                `SELECT u.id_usuario, u.nombres, u.apellidos, u.correo, u.username,
                        p.telefono, p.direccion, p.genero, p.fecha_nacimiento
                 FROM usuario u
                 JOIN paciente p ON p.id_usuario = u.id_usuario
                 WHERE u.id_usuario = $1`,
                [id_usuario]
            );
            res.json({ msg: 'Perfil actualizado correctamente', perfil: updated.rows[0] });
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ error: e.message });
        } finally { client.release(); }
    },

    // ── DESACTIVAR ────────────────────────────────────────────────────────────
    desactivar: async (req, res) => {
        try {
            const exito = await Paciente.logicalDelete(req.params.id);
            if (!exito) return res.status(404).json({ msg: 'No encontrado' });

            await registrarAuditoria(
                pool,
                req.user.id,
                req.user.id_usuario_rol,
                'DESACTIVAR_PACIENTE',
                `Desactivó paciente ID: ${req.params.id}`
            );

            res.json({ msg: 'Paciente enviado a la papelera' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    // ── REACTIVAR ─────────────────────────────────────────────────────────────
    reactivar: async (req, res) => {
        try {
            const paciente = await Paciente.reactivate(req.params.id);
            if (!paciente) return res.status(404).json({ msg: 'Paciente no encontrado' });
            res.json({ msg: 'Paciente reactivado exitosamente' });
        } catch (e) {
            res.status(500).json({ msg: 'Error al reactivar el paciente' });
        }
    },

    // ── VER RESULTADOS (paciente consulta sus propios resultados) ─────────────
    verResultadosPaciente: async (req, res) => {
        try {
            const { id_orden }        = req.params;
            const id_usuario_sesion   = req.user.id;

            // CORRECCIÓN: resultado se une a orden_medica por id_orden (no por id_detalle).
            // Los parámetros se acceden por: detalle_resultado → parametro_examen → examen.
            const query = `
                SELECT
                    o.estado,
                    o.numero_ticket,
                    u.correo                          AS correo_paciente,
                    e.nombre_examen,
                    pe.nombre_parametro,
                    pe.unidad,
                    pe.rango_min,
                    pe.rango_max,
                    dr.valor_obtenido                 AS valor_resultado,
                    dr.observacion                    AS observaciones,
                    ue.nombres                        AS especialista_procesador,
                    val.nombres                       AS validador_firma
                FROM orden_medica o
                JOIN paciente p       ON o.id_paciente        = p.id_paciente
                JOIN usuario u        ON p.id_usuario          = u.id_usuario
                JOIN resultado r      ON r.id_orden            = o.id_orden
                JOIN detalle_resultado dr ON dr.id_resultado   = r.id_resultado
                JOIN parametro_examen pe  ON pe.id_parametro   = dr.id_parametro
                JOIN examen e             ON e.id_examen        = pe.id_examen
                JOIN especialista esp     ON esp.id_especialista = r.id_especialista
                JOIN usuario ue           ON ue.id_usuario      = esp.id_usuario
                LEFT JOIN usuario val     ON o.id_validador     = val.id_usuario
                WHERE o.id_orden  = $1
                  AND p.id_usuario = $2
            `;

            const { rows } = await pool.query(query, [id_orden, id_usuario_sesion]);

            if (rows.length === 0) {
                return res.status(404).json({ msg: 'No se encontraron resultados para esta orden.' });
            }

            if (rows[0].estado !== 'Validado') {
                return res.status(403).json({
                    estado_actual: rows[0].estado,
                    msg: 'Sus resultados aún no han sido validados por el Jefe de Laboratorio. Por favor, intente más tarde.'
                });
            }

            res.json({ msg: 'Resultados validados', data: rows });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    }
};

module.exports = pacienteController;