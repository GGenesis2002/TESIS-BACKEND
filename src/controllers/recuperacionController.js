const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { enviarCorreo } = require('../services/emailService');
const { registrarAuditoria } = require('../helpers/auditoria'); // ← NUEVO

const recuperacionController = {
    
    // A. RECUPERAR NOMBRE DE USUARIO
    enviarRecordatorioUsuario: async (req, res) => {
        const { identificador } = req.body;
        try {
            const query = `SELECT id_usuario, correo, username, nombres FROM usuario 
                           WHERE (correo = $1 OR cedula = $1) AND estado = TRUE`;
            const { rows } = await pool.query(query, [identificador]);

            if (rows.length === 0) return res.status(404).json({ msg: "Cuenta no encontrada" });

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
                    return res.status(500).json({
                        msg: "No se pudo enviar el correo"
                    });
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

            res.json({ msg: "Usuario enviado a su correo" });
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    // B. SOLICITAR CÓDIGO PARA NUEVA CONTRASEÑA
    // No tiene auditoría — el usuario aún no está autenticado y no hay acción sensible que registrar
    solicitarCodigoPassword: async (req, res) => {
        const { correo } = req.body;
        try {
            const query = `SELECT id_usuario, nombres FROM usuario WHERE correo = $1 AND estado = TRUE`;
            const { rows } = await pool.query(query, [correo]);

            if (rows.length === 0) return res.status(404).json({ msg: "Correo no registrado" });

            const user = rows[0];
            const codigo = Math.floor(100000 + Math.random() * 900000).toString();

            await pool.query('UPDATE usuario SET codigo_recuperacion = $1 WHERE id_usuario = $2', [codigo, user.id_usuario]);

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
                    ⏱ Este código es de un solo uso, al salir de esta página, debera pedir uno nuevo.⏱
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
            await enviarCorreo(correo, "Código de Seguridad", html);

            res.json({ msg: "Código enviado con éxito" });
        } catch (e) { res.status(500).json({ error: e.message }); }
    },

    // C. VALIDAR CÓDIGO Y CAMBIAR CONTRASEÑA
    validarYCambiarPassword: async (req, res) => {
        const { correo, codigo, nuevaPassword } = req.body;
        const client = await pool.connect();
        try {
            const query = `SELECT id_usuario FROM usuario WHERE correo = $1 AND codigo_recuperacion = $2`;
            const { rows } = await pool.query(query, [correo, codigo]);

            if (rows.length === 0) return res.status(400).json({ msg: "Código incorrecto o expirado" });

            const id_usuario = rows[0].id_usuario;
            const hash = await bcrypt.hash(nuevaPassword, 10);

            await client.query('BEGIN');

            await client.query(
                'UPDATE usuario SET password = $1, codigo_recuperacion = NULL WHERE id_usuario = $2',
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
            res.status(500).json({ error: e.message }); 
        } finally { client.release(); }
    }
};

module.exports = recuperacionController;