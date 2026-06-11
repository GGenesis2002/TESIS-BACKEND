const loginModule = require('../modules/loginModule');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { getConfig } = require('./configuracionController');

const login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const cfg = await getConfig();
        const user = await loginModule.getUserByUsername(username);

        // 1. Validar existencia del usuario
        if (!user) {
            return res.status(401).json({ message: "Credenciales inválidas" });
        }

        if (user.estado === false) {
            return res.status(403).json({ message: "Esta cuenta está desactivada." });
        }

        // 2. Contar intentos fallidos buscando estrictamente por ID
        const { rows: fallos } = await pool.query(
            `SELECT COUNT(*) FROM auditoria
             WHERE id_usuario = $1 AND accion = 'LOGIN_FAIL'
             AND fecha_hora > NOW() - INTERVAL '5 minutes'`,
            [user.id_usuario]
        );
        
        const intentosFallidos = parseInt(fallos[0].count, 10);
        console.log(`[LOGIN] Usuario: ${username} | Intentos fallidos actuales: ${intentosFallidos} de ${cfg.reintentosLogin}`);

        // Validación preventiva: Si ya alcanzó el límite de intentos permitidos
        if (intentosFallidos >= cfg.reintentosLogin) {
            return res.status(401).json({
                message: "Cuenta bloqueada preventivamente. Espera 5 minutos."
            });
        }


      

        // 3. Validar Password utilizando bcrypt
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            // Registramos el fallo en el módulo de auditoría
            await loginModule.recordFailure(user.id_usuario, "Contraseña incorrecta", req.ip);
            
            const restantes = cfg.reintentosLogin - (intentosFallidos + 1);
            
            return res.status(401).json({
                message: restantes > 0
                    ? `Credenciales inválidas. Intentos restantes: ${restantes}`
                    : `Cuenta bloqueada preventivamente. Esperar 5 minutos.`
            });
        }

        // 4. PREPARACIÓN MULTI-ROL COMPATIBLE
        // Extraemos el rol principal por defecto para compatibilidad
        const rolPrincipal = user.roles && user.roles.length > 0 ? user.roles[0] : 'Paciente';

        // id_usuario_rol del rol principal (primer rol activo)
        const idUsuarioRolPrincipal = user.id_usuario_rol || null;

        // Firmamos el token con id, id_usuario_rol del rol principal, y el array de roles
        const token = jwt.sign(
            { 
                id: user.id_usuario,
                id_usuario_rol: idUsuarioRolPrincipal,  // ← rol principal por defecto
                roles: user.roles
            },
            process.env.JWT_SECRET,
            { expiresIn: `${cfg.expiracionQR}h` }
        );

        // Registrar el acceso exitoso y limpiar/auditar en BD
        await loginModule.recordAccess(user.id_usuario, req.ip);

        // 5. Respuesta exitosa adaptada al Frontend
        res.json({
            token,
            user: {
                id: user.id_usuario,
                id_usuario_rol: idUsuarioRolPrincipal,  // ← necesario para filtrar notificaciones
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