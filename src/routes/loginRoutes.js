const express = require('express');
const router = express.Router();
const { login } = require('../controllers/loginController');
const recCtrl = require('../controllers/recuperacionController');

const rateLimit = require('express-rate-limit');

// Limita intentos de login: 5 intentos cada 15 min por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.' },
});

// Limita solicitudes/validaciones de código de recuperación: 5 cada 10 min por IP
// (con solo 1,000,000 combinaciones posibles, un código de 6 dígitos es forzable
// en minutos sin este límite)
const codigoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { msg: 'Demasiados intentos. Intenta de nuevo en 10 minutos.' },
});

// --- Autenticación Estándar ---
// POST /api/seguridad/login
router.post('/login', loginLimiter, login);
// --- Recuperación de Credenciales ---

// 1. Recuperar nombre de usuario (vía correo o cédula)
// POST /api/seguridad/recuperar-usuario
router.post('/recuperar-usuario', loginLimiter, recCtrl.enviarRecordatorioUsuario);

// 2. Solicitar código de 6 dígitos para cambio de clave
// POST /api/seguridad/solicitar-codigo
router.post('/solicitar-codigo', codigoLimiter, recCtrl.solicitarCodigoPassword);

// 3. Validar código enviado y establecer nueva contraseña
// POST /api/seguridad/validar-codigo
router.post('/validar-codigo', codigoLimiter, recCtrl.validarYCambiarPassword);

module.exports = router;