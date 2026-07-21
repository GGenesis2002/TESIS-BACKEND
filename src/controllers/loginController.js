const loginModule = require('../modules/loginModule');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getConfig } = require('./configuracionController');
const { enviarCorreo } = require('../services/emailService'); // ajusta la ruta si es distinta

const login = async (req, res) => {
    const { username, password, origen } = req.body;
    const origenTexto = origen === 'web'
        ? 'el sistema web'
        : origen === 'movil'
            ? 'la aplicación móvil'
            : 'un dispositivo no identificado';

    try {
        const cfg = await getConfig();
        const user = await loginModule.getUserByUsername(username);

        if (!user) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        if (user.estado === false) {
            return res.status(403).json({ message: "Esta cuenta está desactivada." });
        }

        const { rows: fallos } = await pool.query(
            `SELECT COUNT(*) FROM auditoria
             WHERE id_usuario = $1 AND accion = 'LOGIN_FAIL'
             AND fecha_hora > NOW() - INTERVAL '5 minutes'`,
            [user.id_usuario]
        );

        const intentosFallidos = parseInt(fallos[0].count, 10);
        console.log(`[LOGIN] Usuario: ${username} | Intentos fallidos actuales: ${intentosFallidos} de ${cfg.reintentosLogin}`);

        if (intentosFallidos >= cfg.reintentosLogin) {
            return res.status(401).json({
                message: "Cuenta bloqueada preventivamente. Espera 5 minutos."
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            await loginModule.recordFailure(user.id_usuario, "Contraseña incorrecta", req.ip);

            const totalFallidosAhora = intentosFallidos + 1;
            const restantes = cfg.reintentosLogin - totalFallidosAhora;

            // ── Justo en el intento que agota el límite: se envía el correo ──
            if (totalFallidosAhora >= cfg.reintentosLogin && user.correo) {
                const htmlAlerta = `
                    <p>Hola ${user.nombres || ''},</p>
                    <p>Detectamos <strong>${totalFallidosAhora} intentos fallidos</strong> de inicio de sesión
                    en tu cuenta (usuario: <strong>${user.username}</strong>), realizados desde
                    <strong>${origenTexto}</strong>.</p>
                    <p>Por seguridad, tu cuenta ha sido <strong>bloqueada temporalmente durante 5 minutos</strong>.</p>
                    <p>Si fuiste tú, simplemente espera ese tiempo e inténtalo de nuevo. Si <strong>no reconoces
                    estos intentos</strong>, te recomendamos cambiar tu contraseña lo antes posible desde la opción
                    "¿Olvidaste tu contraseña?".</p>
                    <p>— Laboratorio Clínico Garófalo</p>
                `;

                enviarCorreo(
                    user.correo,
                    "Alerta de seguridad: intentos fallidos de inicio de sesión",
                    htmlAlerta
                ).catch(err => console.error("Error enviando alerta de bloqueo:", err));
            }

            return res.status(401).json({
                message: restantes > 0
                    ? `Credenciales inválidas. Intentos restantes: ${restantes}`
                    : `Cuenta bloqueada preventivamente. Esperar 5 minutos.`
            });
        }

        // 4. PREPARACIÓN MULTI-ROL COMPATIBLE
        const rolPrincipal = user.roles && user.roles.length > 0 ? user.roles[0] : 'Paciente';
        const idUsuarioRolPrincipal = user.id_usuario_rol || null;

        const token = jwt.sign(
            {
                id: user.id_usuario,
                id_usuario_rol: idUsuarioRolPrincipal,
                roles: user.roles
            },
            process.env.JWT_SECRET,
            { expiresIn: `${cfg.expiracionQR}h` }
        );

        await loginModule.recordAccess(user.id_usuario, req.ip);

        res.json({
            token,
            user: {
                id: user.id_usuario,
                id_usuario_rol: idUsuarioRolPrincipal,
                nombres: user.nombres,
                apellidos: user.apellidos,
                correo: user.correo,
                username: user.username,
                rol: rolPrincipal,
                roles: user.roles,
                rolesConId: user.rolesConId
            }
        });

    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
};

module.exports = {
    login
};