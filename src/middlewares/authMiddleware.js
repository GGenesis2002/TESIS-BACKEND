const jwt = require('jsonwebtoken');

// ─────────────────────────────────────────────
// CÓMO GENERAR EL TOKEN EN TU CONTROLADOR LOGIN
// ─────────────────────────────────────────────
// Después de validar credenciales y obtener usuario con loginModule.getUserByUsername():
//
// const token = jwt.sign(
//     {
//         id_usuario : usuario.id_usuario,
//         roles      : usuario.roles,      // ['Administrador', 'Especialista']
//         nombres    : usuario.nombres,
//         cedula     : usuario.cedula
//     },
//     process.env.JWT_SECRET,
//     { expiresIn: '8h' }
// );
// ─────────────────────────────────────────────


/**
 * verifyToken
 * Mantiene el nombre original. Valida que el JWT sea correcto 
 * y lo adjunta a req.user.
 */
const verifyToken = (req, res, next) => {
    const authHeader = req.header('Authorization') || req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(403).json({ msg: "Acceso denegado. No se proporcionó un token." });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;

        // ← NUEVO: si el frontend envía el rol activo, usarlo
        const idUsuarioRolActivo = req.headers['x-id-usuario-rol'];
        if (idUsuarioRolActivo) {
            req.user.id_usuario_rol = parseInt(idUsuarioRolActivo);
        }

        next();
    } catch (err) {
        res.status(401).json({ msg: "Token no válido o expirado." });
    }
};


/**
 * checkRole
 * Mantiene el nombre original. Permite el acceso si el usuario tiene
 * AL MENOS UNO de los roles indicados en el arreglo.
 * * Uso en rutas:
 * router.get('/examenes', verifyToken, checkRole(['Especialista', 'Administrador']), handler);
 */
const checkRole = (rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ msg: "No autorizado" });
        }

        // Se asume que req.user.roles es un arreglo ['Secretaria', 'Administrador']
        // Si en algún token viejo viene como string, se fuerza a un arreglo para evitar caídas
        const rolesUsuario = Array.isArray(req.user.roles) 
            ? req.user.roles 
            : (req.user.roles ? [req.user.roles] : []);

        const autorizado = rolesPermitidos.some(rol => rolesUsuario.includes(rol));

        if (!autorizado) {
            return res.status(403).json({ 
                msg: `Acceso denegado. Se requiere uno de estos roles: ${rolesPermitidos.join(', ')}`,
                tus_roles: rolesUsuario
            });
        }

        next();
    };
};


/**
 * esPropietarioOTieneRol (Opcional - Añadido por comodidad si lo requieres)
 * Permite el acceso si el usuario es el dueño del recurso o si tiene el rol.
 */
const esPropietarioOTieneRol = (campo, rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ msg: "No autorizado" });
        }

        const rolesUsuario = Array.isArray(req.user.roles) ? req.user.roles : [req.user.roles];
        const idUsuarioToken = req.user.id_usuario;

        const valorCampo = req.params[campo] || req.body[campo] || req.query[campo];

        const esPropietario = valorCampo && parseInt(valorCampo) === idUsuarioToken;
        const tienePermisoRol = rolesPermitidos.some(rol => rolesUsuario.includes(rol));

        if (!esPropietario && !tienePermisoRol) {
            return res.status(403).json({
                msg: 'Acceso denegado: no eres el propietario ni tienes el rol necesario'
            });
        }

        next();
    };
};


// Mantenemos exactamente las mismas exportaciones del archivo original
module.exports = { verifyToken, checkRole, esPropietarioOTieneRol };