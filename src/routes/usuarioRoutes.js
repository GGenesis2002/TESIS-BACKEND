const express = require('express');
const router = express.Router();
const controller = require('../controllers/usuarioController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');


const STAFF_RRHH = [ROLES.ADMIN, ROLES.TECNICO, ROLES.ASISTENTE, ROLES.ESPECIALISTA];


// El usuario logueado gestiona su perfil
router.put('/update-password', verifyToken, controller.actualizarPassword);
router.get('/perfil', verifyToken, checkRole(STAFF_RRHH), controller.obtenerPerfil);
router.get('/all', verifyToken,checkRole(STAFF_RRHH), controller.listarUsuarios);
router.patch('/status/:id', verifyToken, checkRole(STAFF_RRHH),controller.toggleEstado);

module.exports = router;