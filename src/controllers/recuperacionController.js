const crypto = require('crypto');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { enviarCorreo } = require('../services/emailService');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const CODIGO_EXPIRA_MINUTOS = 10;
const PASSWORD_MIN_LENGTH = 8;

const recuperacionController = {
    
    // A. RECUPERAR NOMBRE DE USUARIO
    enviarRecordatorioUsuario: async (req, res) => {
        const { identificador } = req.body;
        try {
            const query = `SELECT id_usuario, correo, username, nombres FROM usuario 
                           WHERE (correo = $1 OR cedula = $1) AND estado = TRUE`;
            const { rows } = await pool.query(query, [identificador]);

            // No revelamos si la cuenta existe o no (previene enumeración de usuarios).
            // Si no existe, respondemos igual que en el caso exitoso pero sin enviar nada.
            if (rows.length === 0) {
                return res.json({ msg: "Si la cuenta existe, se ha enviado un correo con el nombre de usuario" });
            }

            const user = rows[0];
            const html = `
                <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border:1px solid #e0e0e0; padding:20px; border-radius:10px;">

                <h2 style="color:#2c3e50; text-align:center;">
                    Laboratorio Clínico Garófalo
                </h2>

                <hr>

                <p>Estimado/a <b>${user.nombres}</b>,</p>

                <p>
                    Hemos recibido una solicitud para recuperar su nombre de usuario en nuestro sistema.
                </p>

                <p><b>Su nombre de usuario es:</b></p>

                <div style="text-align:center; font-size:28px; font-weight:bold; color:#1a73e8; padding:10px;">
                    ${user.username}
                </div>

                <p style="text-align:center; color:#2c3e50;">
                    Puede iniciar sesión normalmente con este usuario.
                </p>

                <hr>

                <p style="font-size:12px; color:gray;">
                    Si usted no realizó esta solicitud, puede ignorar este mensaje o contactar al laboratorio.
                </p>

                </div>
                `;

            const enviado = await enviarCorreo(
                    user.correo,
                    "Recordatorio de Usuario",
                    html
                );

                if (!enviado) {
                    console.error("No se pudo enviar el correo de recordatorio de usuario a", user.correo);
                    // Mismo mensaje genérico: no delatamos fallos internos ni existencia de la cuenta
                    return res.json({ msg: "Si la cuenta existe, se ha enviado un correo con el nombre de usuario" });
                }

            // Auditoría — usa pool (sin transacción)
            // Nota: id_usuario_rol es null aquí porque el usuario NO está logueado todavía
            await registrarAuditoria(
                pool,
                user.id_usuario,
                null,
                'RECUPERAR_USER',
                'Se envió el nombre de usuario al correo registrado'
            );

            res.json({ msg: "Si la cuenta existe, se ha enviado un correo con el nombre de usuario" });
        } catch (e) {
            console.error("Error en enviarRecordatorioUsuario:", e.message);
            res.status(500).json({ msg: "Error interno del servidor" });
        }
    },

    // B. SOLICITAR CÓDIGO PARA NUEVA CONTRASEÑA
    // No tiene auditoría — el usuario aún no está autenticado y no hay acción sensible que registrar
    solicitarCodigoPassword: async (req, res) => {
        const { correo } = req.body;
        try {
            const query = `SELECT id_usuario, nombres FROM usuario WHERE correo = $1 AND estado = TRUE`;
            const { rows } = await pool.query(query, [correo]);

            // No revelamos si el correo está registrado o no (previene enumeración de usuarios)
            if (rows.length === 0) {
                return res.json({ msg: "Si el correo está registrado, recibirá un código de verificación" });
            }

            const user = rows[0];
            // crypto.randomInt es seguro para propósitos criptográficos; Math.random() no lo es
            const codigo = crypto.randomInt(100000, 1000000).toString();
            const codigoHash = await bcrypt.hash(codigo, 10);
            const expira = new Date(Date.now() + CODIGO_EXPIRA_MINUTOS * 60 * 1000);

            // NOTA: requiere la columna `codigo_recuperacion_expira` (timestamp) en la tabla `usuario`.
            // Ver migración sugerida al final del archivo.
            await pool.query(
                'UPDATE usuario SET codigo_recuperacion = $1, codigo_recuperacion_expira = $2 WHERE id_usuario = $3',
                [codigoHash, expira, user.id_usuario]
            );

            const html = `
                <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto; border:1px solid #e0e0e0; padding:20px; border-radius:10px;">

                <h2 style="color:#2c3e50; text-align:center;">
                    Laboratorio Clínico Garófalo
                </h2>

                <hr>

                <p>Estimado/a <b>${user.nombres}</b>,</p>

                <p>
                    Hemos recibido una solicitud para restablecer su contraseña en el sistema del laboratorio.
                </p>

                <p><b>Su código de verificación es:</b></p>

                <div style="text-align:center; font-size:32px; letter-spacing:5px; font-weight:bold; color:#1a73e8; padding:10px;">
                    ${codigo}
                </div>

                <p style="text-align:center; color:#e74c3c;">
                    ⏱ Este código es de un solo uso y expira en ${CODIGO_EXPIRA_MINUTOS} minutos.⏱
                </p>

                <p style="text-align:center; color:#2c3e50;">
                    Ingrese este código en la plataforma para continuar con el cambio de contraseña.
                </p>

                <hr>

                <p style="font-size:12px; color:gray;">
                    Si usted no solicitó este cambio, ignore este mensaje o contacte al laboratorio.
                </p>

                </div>
                `;
            const enviado = await enviarCorreo(correo, "Código de Seguridad", html);
            if (!enviado) {
                console.error("No se pudo enviar el correo de código de recuperación a", correo);
            }

            res.json({ msg: "Si el correo está registrado, recibirá un código de verificación" });
        } catch (e) {
            console.error("Error en solicitarCodigoPassword:", e.message);
            res.status(500).json({ msg: "Error interno del servidor" });
        }
    },

    // C. VALIDAR CÓDIGO Y CAMBIAR CONTRASEÑA
    validarYCambiarPassword: async (req, res) => {
        const { correo, codigo, nuevaPassword } = req.body;

        if (!correo || !codigo || !nuevaPassword) {
            return res.status(400).json({ msg: "Faltan datos requeridos" });
        }
        if (nuevaPassword.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                msg: `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`
            });
        }

        const client = await pool.connect();
        try {
            // Buscamos solo por correo: el código está hasheado y no se puede comparar en SQL directamente
            const query = `SELECT id_usuario, codigo_recuperacion, codigo_recuperacion_expira
                           FROM usuario WHERE correo = $1 AND estado = TRUE`;
            const { rows } = await pool.query(query, [correo]);

            // Mensaje genérico igual sea que el correo no exista, el código no coincida o haya expirado
            const CODIGO_INVALIDO = { msg: "Código incorrecto o expirado" };

            if (rows.length === 0 || !rows[0].codigo_recuperacion) {
                return res.status(400).json(CODIGO_INVALIDO);
            }

            const user = rows[0];

            if (!user.codigo_recuperacion_expira || new Date(user.codigo_recuperacion_expira) < new Date()) {
                return res.status(400).json(CODIGO_INVALIDO);
            }

            const codigoValido = await bcrypt.compare(codigo, user.codigo_recuperacion);
            if (!codigoValido) {
                return res.status(400).json(CODIGO_INVALIDO);
            }

            const id_usuario = user.id_usuario;
            const hash = await bcrypt.hash(nuevaPassword, 10);

            await client.query('BEGIN');

            await client.query(
                'UPDATE usuario SET password = $1, codigo_recuperacion = NULL, codigo_recuperacion_expira = NULL WHERE id_usuario = $2',
                [hash, id_usuario]
            );

            // Auditoría — usa client (dentro de transacción)
            // id_usuario_rol es null porque el usuario aún no tiene sesión activa
            await registrarAuditoria(
                client,
                id_usuario,
                null,
                'RESET_PASSWORD',
                'Contraseña restablecida exitosamente vía código de correo'
            );

            await client.query('COMMIT');
            res.json({ msg: "Contraseña actualizada correctamente" });
        } catch (e) {
            await client.query('ROLLBACK');
            console.error("Error en validarYCambiarPassword:", e.message);
            res.status(500).json({ msg: "Error interno del servidor" });
        } finally { client.release(); }
    }
};

module.exports = recuperacionController;

// ─────────────────────────────────────────────
// MIGRACIÓN REQUERIDA (ejecutar una sola vez en tu BD):
//
//   ALTER TABLE usuario
//     ADD COLUMN IF NOT EXISTS codigo_recuperacion_expira TIMESTAMP;
//
// La columna `codigo_recuperacion` ahora almacena un HASH bcrypt del código,
// no el código en texto plano. Si tenías índices o lógica externa que dependían
// de comparar ese campo directamente, tendrán que actualizarse.
// ─────────────────────────────────────────────