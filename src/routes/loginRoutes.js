const express = require('express');
const router = express.Router();
const { login } = require('../controllers/loginController');
const recCtrl = require('../controllers/recuperacionController');

// --- Autenticación Estándar ---
// POST /api/seguridad/login
router.post('/login', login);

// --- Recuperación de Credenciales ---

// 1. Recuperar nombre de usuario (vía correo o cédula)
// POST /api/seguridad/recuperar-usuario
router.post('/recuperar-usuario', recCtrl.enviarRecordatorioUsuario);

// 2. Solicitar código de 6 dígitos para cambio de clave
// POST /api/seguridad/solicitar-codigo
router.post('/solicitar-codigo', recCtrl.solicitarCodigoPassword);

// 3. Validar código enviado y establecer nueva contraseña
// POST /api/seguridad/validar-codigo
router.post('/validar-codigo', recCtrl.validarYCambiarPassword);

module.exports = router;