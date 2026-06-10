const express = require('express');
const router = express.Router();
const controller = require('../controllers/usuarioController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

// El usuario logueado gestiona su perfil
router.put('/update-password', verifyToken, controller.actualizarPassword);

// El Administrador gestiona a todos los usuarios
router.get('/all', verifyToken, controller.listarUsuarios);
router.patch('/status/:id', verifyToken, controller.toggleEstado);

module.exports = router;