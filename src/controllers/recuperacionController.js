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
            const html = `<h3>Hola, ${user.nombres}.</h3>
                          <p>Has solicitado recordar tu nombre de usuario para el sistema del Laboratorio.</p>
                          <p>Tu nombre de usuario es: <b>${user.username}</b></p>`;

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

            const html = `<h3>Código de Recuperación</h3>
                          <p>Hola ${user.nombres}, utiliza el siguiente código para cambiar tu contraseña:</p>
                          <h1 style="color: #2c3e50;">${codigo}</h1>
                          <p>Este código es de un solo uso.</p>`;

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