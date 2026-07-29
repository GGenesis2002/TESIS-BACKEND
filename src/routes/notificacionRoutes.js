const express = require('express');
const router = express.Router();
const notificacionController = require('../controllers/notificacionController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const NOTIFICACIONES = [ROLES.ADMIN, ROLES.PACIENTE, ROLES.ESPECIALISTA, ROLES.ASISTENTE, ROLES.TECNICO];

// Obtener todas las notificaciones del usuario en sesión filtradas por rol activo
router.get('/', verifyToken, checkRole(NOTIFICACIONES),notificacionController.listarMisNotificaciones);

// Marcar una notificación específica como leída
router.put('/:id/leer', verifyToken, checkRole(NOTIFICACIONES),notificacionController.leerNotificacion);

// NUEVO: Ruta para eliminar notificaciones (Resuelve por completo tus errores 404)
router.delete('/:id', verifyToken,checkRole(NOTIFICACIONES), notificacionController.eliminarNotificacion);

module.exports = router;